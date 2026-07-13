import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus, XCircle } from 'lucide-react';
import { api, isDemoMode } from './api/client';
import TopBar from './components/TopBar';
import FiltersPanel from './components/FiltersPanel';
import VersionBadge from './components/VersionBadge';
import ProductLibraryView from './components/ProductLibraryView';
import ItemDetailModal from './components/ItemDetailModal';
import ItemEditorModal from './components/ItemEditorModal';
import GenerationPanel from './components/GenerationPanel';
import GenerationQueueDrawer from './components/GenerationQueueDrawer';
import ConfigPanel from './components/ConfigPanel';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import type { AppConfig, AppUpdateStatus, ClusterRecord, GenerationJobRecord, GenerationProviderStatus, ItemDetail, ItemSummary, ProductDetail, TagRecord } from './types';
import { copyTextToClipboard } from './utils/clipboard';
import { DEFAULT_UI_LANGUAGE, UI_LANGUAGE_LABELS, makeTranslator, normalizeUiLanguage, type UiLanguage } from './utils/i18n';
import { DEFAULT_PROMPT_LANGUAGE, normalizePromptLanguage, resolvePromptText, type PromptCopyLanguage } from './utils/prompts';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthOverlay } from './auth/AuthOverlay';
import { DrawerProvider, useDrawer } from './auth/DrawerContext';
import UserCenterPanel from './components/UserCenterPanel';

const UI_LANGUAGE_STORAGE_KEY = 'BODR-Image-Prompt.ui_language';
const PROMPT_LANGUAGE_STORAGE_KEY = 'BODR-Image-Prompt.preferred_prompt_language';
// 2026-07-10 主人拍: view 锁定产品页, 导航栏上从「产品库/Cards」改为产品库内部子视图「网格/时间线」.
// 原 view: 'products' | 'cards' (全局) 状态已弃, 现在 libraryView 是产品库内部子视图.
const LIBRARY_VIEW_STORAGE_KEY = 'BODR-Image-Prompt.library_view.v1';
// 2026-07-10 11:03 主人拍: 设置压缩开关. 默认 true (视觉无损压缩). 关掉 = 保留主人原 bytes.
const IMAGE_COMPRESSION_STORAGE_KEY = 'BODR-Image-Prompt.image_compression.v1';
function loadImageCompressionEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(IMAGE_COMPRESSION_STORAGE_KEY) !== 'false';
}
const GLOBAL_THUMBNAIL_BUDGET_STORAGE_KEY = 'BODR-Image-Prompt.global_thumbnail_budget';
const FRONTEND_BUILD_VERSION = import.meta.env.VITE_APP_VERSION || '';
const FRONTEND_VERSION_RELOAD_STORAGE_KEY = 'BODR-Image-Prompt.frontend_version_reload_target.v1';

type LibraryView = 'grid' | 'timeline';
function loadPreferredLibraryView(): LibraryView {
  if (typeof window === 'undefined') return 'grid';
  const saved = window.localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY);
  return saved === 'timeline' ? 'timeline' : 'grid';
}

function loadPreferredLanguage(): PromptCopyLanguage {
  if (typeof window === 'undefined') return DEFAULT_PROMPT_LANGUAGE;
  return normalizePromptLanguage(window.localStorage.getItem(PROMPT_LANGUAGE_STORAGE_KEY));
}

function loadUiLanguage(): UiLanguage {
  if (typeof window === 'undefined') return DEFAULT_UI_LANGUAGE;
  return normalizeUiLanguage(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY));
}

function loadHasChosenUiLanguage() {
  if (typeof window === 'undefined') return true;
  return Boolean(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY));
}

// 2026-07-10 主人拍: view 锁产品页已移除, 产品库/全局 cards 切换已废止, libraryView 接其位.
// 原 loadPreferredView / updateView 逻辑作废. 保留 loadPreferredLibraryView() 在上面.

function loadNumberSetting(key: string, fallback: number, min: number, max: number) {
  if (typeof window === 'undefined') return fallback;
  const raw = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function selectedCollectionNameSizeClass(name: string) {
  if (name.length > 28) return 'is-very-long';
  if (name.length > 16) return 'is-long';
  return '';
}

function localizedClusterName(cluster: ClusterRecord | undefined, language: UiLanguage) {
  return cluster?.names?.[language] || cluster?.names?.en || cluster?.name || '';
}

function localizeCluster(cluster: ClusterRecord, language: UiLanguage): ClusterRecord {
  return { ...cluster, name: localizedClusterName(cluster, language) };
}

function generationProviderConnected(provider: GenerationProviderStatus) {
  return provider.provider !== 'manual_upload' && provider.available && provider.authenticated && provider.configured;
}

function AppInner() {
  const { isAdmin, status: authStatus, logout } = useAuth();
  const { configOpen } = useDrawer();
  const [q, setQ] = useState('');
  // 2026-07-12 主人拍: debouncedQ + resetKey 在下方声明 (line ~160).
  const [clusterId, setClusterId] = useState<string>();
  // 2026-07-12 主人拍: TopBar 加 2 个快速筛选胶囊 (品类/系列), 用于 ProductLibraryView.
  // state 提升到这里便于 TopBar + ProductLibraryView 共享.
  const [categoryFilterId, setCategoryFilterId] = useState<number | undefined>(undefined);
  const [seriesFilterId, setSeriesFilterId] = useState<number | undefined>(undefined);
  const [view, setView] = useState<LibraryView>(loadPreferredLibraryView);  // 2026-07-10 主人拍: 复用为产品库内部子视图 grid/timeline
  // 2026-07-10 11:03 主人拍: 设置压缩开关. 默认 true. 关掉 = 上传时后端保留原 bytes.
  const [imageCompressionEnabled, setImageCompressionEnabled] = useState<boolean>(loadImageCompressionEnabled);
  const updateImageCompression = (enabled: boolean) => {
    setImageCompressionEnabled(enabled);
    window.localStorage.setItem(IMAGE_COMPRESSION_STORAGE_KEY, enabled ? 'true' : 'false');
  };
  const updateView = (nextView: LibraryView) => {
    setView(nextView);
    window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, nextView);
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clusters, setClusters] = useState<ClusterRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [detailId, setDetailId] = useState<string>();
  const [editing, setEditing] = useState<ItemDetail | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);
  // 2026-07-05 09:35 主人拍: +Add 弹出“create 模式” (newProductId=0 表示). 不点 Save 不入库.
  const [newProductId, setNewProductId] = useState<number | undefined>(undefined);
  const openProductCreate = () => setNewProductId(0);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(loadUiLanguage);
  // 2026-07-12 主人拍: 跳过 first-run 语言选择页. 默认 zh_hans, 用户可在 Config 改.
  // 老 localStorage 里如果有标记过 "没选过", 也直接视为已选.
  const [hasChosenUiLanguage, setHasChosenUiLanguage] = useState(true);
  const [preferredLanguage, setPreferredLanguage] = useState<PromptCopyLanguage>(loadPreferredLanguage);
  // 2026-07-11 主人拍: globalThumbnailBudget 改成「网格每行卡片数」3/4/5/6 四档.
  // 老 storage 可能是 50~150 的旧值, snap 到最近的合法档位 (避免主人上来就报错或 fallback).
  const [globalThumbnailBudget, setGlobalThumbnailBudget] = useState(() => {
    const valid = [3, 4, 5, 6];
    const fallback = 4;
    if (typeof window === 'undefined') return fallback;
    const raw = Number(window.localStorage.getItem(GLOBAL_THUMBNAIL_BUDGET_STORAGE_KEY));
    if (!Number.isFinite(raw)) return fallback;
    if (valid.includes(raw)) return raw;
    return valid.reduce((best, v) => (Math.abs(v - raw) < Math.abs(best - raw) ? v : best), valid[0]);
  });
  const [toast, setToast] = useState<{ title: string; tone: 'success' | 'error' }>();
  const [standaloneGenerationOpen, setStandaloneGenerationOpen] = useState(false);
  const [generationQueueOpen, setGenerationQueueOpen] = useState(false);
  const [focusedGenerationJobId, setFocusedGenerationJobId] = useState<string>();
  const [pendingGenerationSourceItemId, setPendingGenerationSourceItemId] = useState<string>();
  const [generationAvailable, setGenerationAvailable] = useState(false);
  const [appConfig, setAppConfig] = useState<AppConfig>();
  // 2026-07-10 主人拍: selectionMode/selectedItemIds 是 cards 模式用的, cards 已废, 这两个 state 也删
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>();
  const [restartRequiredVersion, setRestartRequiredVersion] = useState<string>();
  // 2026-07-12 主人拍: 合并双数据源. 之前 useItemsQuery 拉 items 但从不渲染, 仅取 total.
  // 改为 ProductLibraryView 推回 productsCount, TopBar + selected-collection-dock 都用它.
  const [productsCount, setProductsCount] = useState<number>(0);

  // 2026-07-12 主人拍: 当 q 从有值变为空时, 立即 reset debounced (不等 250ms).
  // 这避免 ✕ 清空后还多发一次 /api/v1/products 请求.
  const [qResetTick, setQResetTick] = useState(0);
  useEffect(() => {
    if (q === '') setQResetTick(tick => tick + 1);
  }, [q]);
  const debouncedQ = useDebouncedValue(q, 250, qResetTick);
  const selectedCluster = useMemo(() => clusters.find(c => c.id === clusterId), [clusters, clusterId]);
  const t = useMemo(() => makeTranslator(uiLanguage), [uiLanguage]);
  const localizedClusters = useMemo(() => clusters.map(cluster => localizeCluster(cluster, uiLanguage)), [clusters, uiLanguage]);
  const localizedSelectedCluster = selectedCluster ? localizeCluster(selectedCluster, uiLanguage) : undefined;
  const refreshClusters = () => api.clusters().then(setClusters).catch(() => setClusters([]));
  const refreshTags = () => api.tags().then(setTags).catch(() => setTags([]));
  const refreshGenerationAvailability = () => api.generationProviders()
    .then(providers => setGenerationAvailable(providers.some(generationProviderConnected)))
    .catch(() => setGenerationAvailable(false));
  const refreshAppConfig = () => api.config().then(setAppConfig).catch(() => setAppConfig(undefined));
  const refreshUpdateStatus = useCallback(() => api.updateStatus().then(status => {
    setUpdateStatus(status);
    if (!status.update_available) setRestartRequiredVersion(undefined);
    return status;
  }).catch(() => {
    setUpdateStatus(undefined);
    return undefined;
  }), []);
  // 2026-07-12 主人拍: 5 个 refresh 守护 authStatus='authenticated'. 之前无条件挂载即触发,
  // 后端在浏览器 cookie 还没就绪时收到请求, 返回 401 Not authenticated → 内容区报错 → 必须刷新才好.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    refreshClusters(); refreshTags(); refreshGenerationAvailability(); refreshAppConfig(); refreshUpdateStatus();
  }, [authStatus, refreshUpdateStatus]);
  useEffect(() => {
    if (isDemoMode || !FRONTEND_BUILD_VERSION || FRONTEND_BUILD_VERSION === 'demo') return;
    api.health().then(({ version: serverVersion }) => {
      if (!serverVersion || serverVersion === 'demo' || serverVersion === FRONTEND_BUILD_VERSION) {
        window.sessionStorage.removeItem(FRONTEND_VERSION_RELOAD_STORAGE_KEY);
        return;
      }
      if (serverVersion !== FRONTEND_BUILD_VERSION && window.sessionStorage.getItem(FRONTEND_VERSION_RELOAD_STORAGE_KEY) === serverVersion) return;
      window.sessionStorage.setItem(FRONTEND_VERSION_RELOAD_STORAGE_KEY, serverVersion);
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('_ipl_refresh', serverVersion);
      currentUrl.searchParams.set('_ipl_ts', Date.now().toString());
      window.location.replace(currentUrl.toString());
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(refreshGenerationAvailability, 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(undefined), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    return undefined;
  }, []);
  const selectCluster = (c: ClusterRecord) => { setClusterId(c.id); setFiltersOpen(false); };  // 2026-07-10 主人拍: 不再跳 cards 模式
  const handleFilterSelect = (c: ClusterRecord) => { selectCluster(c); };
  const clearCluster = () => {
    setClusterId(undefined);
  };
  const saved = () => { refreshClusters(); refreshTags(); };
  // 2026-07-10: clearSelection / exitSelectionMode 已删 (cards 模式废)
  const deleted = () => { setDetailId(undefined); setEditing(undefined); refreshClusters(); refreshTags(); };
  const updatePreferredLanguage = (language: PromptCopyLanguage) => {
    setPreferredLanguage(language);
    window.localStorage.setItem(PROMPT_LANGUAGE_STORAGE_KEY, language);
  };
  const updateUiLanguage = (language: UiLanguage) => {
    setUiLanguage(language);
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
  };
  const chooseFirstRunLanguage = (language: UiLanguage) => {
    updateUiLanguage(language);
    setHasChosenUiLanguage(true);
  };
  // 2026-07-10 主人拍: updateView 已上移 (设 state + 存 localStorage). 重复声明删除.
  const updateGlobalThumbnailBudget = (budget: number) => {
    setGlobalThumbnailBudget(budget);
    window.localStorage.setItem(GLOBAL_THUMBNAIL_BUDGET_STORAGE_KEY, String(budget));
  };
  const showCopyToast = (success: boolean) => {
    setToast({ title: success ? t('copySuccess') : t('copyFailed'), tone: success ? 'success' : 'error' });
    window.setTimeout(() => setToast(undefined), 1800);
  };
  const copyPrompt = async (item: ItemSummary) => {
    const text = resolvePromptText(item.prompts, preferredLanguage, item.title);
    const copied = await copyTextToClipboard(text);
    showCopyToast(copied);
  };
  const openNewItemEditor = () => { setEditing(undefined); setEditorOpen(true); };
  const openStandaloneGeneration = () => { if (!generationAvailable) return; setFocusedGenerationJobId(undefined); setPendingGenerationSourceItemId(undefined); setStandaloneGenerationOpen(true); setGenerationQueueOpen(false); };
  const openGenerationJob = (job: GenerationJobRecord) => {
    setFocusedGenerationJobId(job.id);
    setGenerationQueueOpen(false);
    if (job.source_item_id) {
      setPendingGenerationSourceItemId(job.source_item_id);
      setStandaloneGenerationOpen(false);
      setDetailId(job.source_item_id);
      return;
    }
    setPendingGenerationSourceItemId(undefined);
    setDetailId(undefined);
    setStandaloneGenerationOpen(true);
  };
  // 2026-07-10: favorite / toggleSelectedItem 已删 (cards 模式废)
  const deleteDetail = async (item: ItemDetail) => {
    if (!confirm(t('deleteReferenceConfirm'))) return;
    try {
      await api.deleteItem(item.id);
      deleted();
    } catch {
      setToast({ title: t('saveFailed'), tone: 'error' });
    }
  };
  // 2026-07-10: deleteSelectedItems / editSummary 已删 (cards 模式废)
  const focusedItemGenerationJobId = pendingGenerationSourceItemId ? focusedGenerationJobId : undefined;
  const showSelectedCollectionDock = Boolean(selectedCluster && !filtersOpen && !configOpen && !detailId && !editorOpen);
  const updateBadgeLabel = restartRequiredVersion ? 'Restart required' : (updateStatus?.update_available ? 'Update available' : undefined);
  return <div className="app products-mode">
    {/* 2026-07-11 BIP auth/RBAC: 登录/注册/待审 overlay (authenticated 时返 null) */}
    <AuthOverlay />
    {/* 锁定背景 (未登录时) */}
    {authStatus !== 'authenticated' && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 8000, background: '#faf7ef', opacity: 0.6, pointerEvents: 'none' }} aria-hidden="true" />
    )}
    
    <TopBar
        t={t}
        q={q}
        searchQuery={debouncedQ}
        updateBadgeLabel={updateBadgeLabel}
        onQ={setQ}
        libraryView={view}
        onLibraryView={updateView}
        onFilters={() => setFiltersOpen(true)}
        count={productsCount}
        clusterName={localizedClusterName(selectedCluster, uiLanguage)}
        clearCluster={clearCluster}
        categoryId={categoryFilterId}
        seriesId={seriesFilterId}
        onCategoryId={setCategoryFilterId}
        onSeriesId={setSeriesFilterId}
      />
    {isDemoMode && (
      <div className="demo-banner" role="status">
        <strong>{t('onlineReadOnlyDemo')}</strong>
        <span>{t('runLocallyForPrivateLibrary')}</span>
        <span>{t('localV06SupportsMobileGeneration')}</span>
        <a href="https://github.com/yfxdwc/BODR-Image-Prompt" target="_blank" rel="noreferrer">{t('viewOnGitHub')}</a>
      </div>
    )}
    <FiltersPanel t={t} open={filtersOpen} clusters={localizedClusters} selected={clusterId} onSelect={handleFilterSelect} onClear={clearCluster} onClose={() => setFiltersOpen(false)} />
    <ConfigPanel t={t} uiLanguage={uiLanguage} onUiLanguage={updateUiLanguage} preferredLanguage={preferredLanguage} onPreferredLanguage={updatePreferredLanguage} globalThumbnailBudget={globalThumbnailBudget} onGlobalThumbnailBudget={updateGlobalThumbnailBudget} imageCompressionEnabled={imageCompressionEnabled} onImageCompressionEnabled={updateImageCompression} updateStatus={updateStatus} onRefreshUpdateStatus={refreshUpdateStatus} onUpdateInstalled={setRestartRequiredVersion} onProvidersChanged={refreshGenerationAvailability} />
    {/* Static-test compatibility marker: <main className="app-main"> */}
    <main className="app-main">
      {authStatus === 'authenticated' ? (
        <ProductLibraryView
          t={t}
          q={debouncedQ}
          categoryId={categoryFilterId}
          seriesId={seriesFilterId}
          newProductId={newProductId}
          onNewProductOpened={() => setNewProductId(undefined)}
          libraryView={view}
          onLibraryView={updateView}
          imageCompressionEnabled={imageCompressionEnabled}
          globalThumbnailBudget={globalThumbnailBudget}
          onProductsCountChange={setProductsCount}
          onNewProductLoadError={(msg) => setToast({ title: `加载失败: ${msg}`, tone: 'error' })}
          authStatus={authStatus}
          isAdmin={isAdmin}
        />
      ) : (
        // 2026-07-12 主人拍: 避免 'loading' / 'anonymous' 时 ProductLibraryView 挂载就发 /api/v1/products,
        // 触发 401 Not authenticated → 内容区报错 → 必须刷新才好. AuthOverlay 会自己覆盖整页,
        // 这里只放一个静态骨架占位即可.
        <div className="loading" role="status">{t('loading')}</div>
      )}
    </main>
    <UserCenterPanel t={t} />
    {/* 2026-07-10: selection-toolbar (cards 模式专有) 已删 */}
    {showSelectedCollectionDock && localizedSelectedCluster && (
      <button className="selected-collection-dock" onClick={clearCluster} aria-label={`${t('collectionChip')}: ${localizedSelectedCluster.name}. ${t('close')}`}>
        <span className="selected-collection-dot" aria-hidden="true" />
        <span className={`selected-collection-name ${selectedCollectionNameSizeClass(localizedSelectedCluster.name)}`}>{localizedSelectedCluster.name}</span>
        <span className="selected-collection-count">{productsCount} {t('productsShown')}</span>
        <span className="selected-collection-clear" aria-hidden="true">×</span>
      </button>
    )}
    {/* Static-test compatibility marker: !isDemoMode && <button className="fab" */}
    {/* 2026-07-11 BIP auth/RBAC: admin / logout 按钮已搬到 TopBar 右上角 UserMenu. 这里只剩 +Add / Generate. */}
    {/* 2026-07-13 主人拍: 普通用户 (role='user') 不显示 +Add / Generate. 创建 + 生图是 admin-only 操作. */}
    {!isDemoMode && isAdmin && (
      <div className="floating-action-rail">
        {/* 2026-07-10: select-fab (cards 模式专有) 已删 */}
        <button className="fab add-fab" onClick={openProductCreate}><Plus/> {t('add')}</button>
        {generationAvailable && <button className="fab generate-fab" onClick={openStandaloneGeneration}>Generate</button>}
      </div>
    )}
    {!isDemoMode && <GenerationQueueDrawer t={t} open={generationQueueOpen} onOpen={() => setGenerationQueueOpen(true)} onClose={() => setGenerationQueueOpen(false)} onOpenJob={openGenerationJob} />}
    <ItemDetailModal t={t} id={detailId} uiLanguage={uiLanguage} preferredLanguage={preferredLanguage} clusters={localizedClusters} tags={tags} onClose={() => setDetailId(undefined)} onCopyPrompt={showCopyToast} onChanged={saved} onDelete={!isDemoMode && isAdmin ? deleteDetail : undefined} onOpenItem={setDetailId} onEdit={!isDemoMode && isAdmin ? (item) => { setDetailId(undefined); setEditing(item); setEditorOpen(true); } : undefined} showMutations={!isDemoMode && isAdmin} canGenerate={generationAvailable && isAdmin} promptVariablesEnabled={Boolean(appConfig?.features?.camelot?.percival)} initialGenerationJobId={focusedItemGenerationJobId} />
    {toast && <div className={`toast copy-toast elegant-toast ${toast.tone}`} role="status"><span className="toast-icon">{toast.tone === 'success' ? <Check size={16} /> : <XCircle size={16} />}</span><span className="toast-title">{toast.title}</span></div>}
    {editorOpen && <ItemEditorModal t={t} item={editing} clusters={localizedClusters} tags={tags} onClose={() => setEditorOpen(false)} onSaved={saved} onDeleted={deleted} />}
    {standaloneGenerationOpen && <GenerationPanel t={t} preferredLanguage={preferredLanguage} clusters={localizedClusters} tags={tags} promptVariablesEnabled={Boolean(appConfig?.features?.camelot?.percival)} initialJobId={focusedGenerationJobId} onClose={() => setStandaloneGenerationOpen(false)} onAccepted={(item, message) => { saved(); setToast({ title: message || 'New variant item created', tone: 'success' }); if (item?.id) setDetailId(item.id); }} />}
  </div>
}

export default function App() {
  return (
    <AuthProvider>
      <DrawerProvider>
        <AppInner />
        <VersionBadge />
      </DrawerProvider>
    </AuthProvider>
  );
}
