import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Settings as SettingsIcon, X } from 'lucide-react';
import headerLogo from '../assets/header-logo.png';
import { useDrawer } from '../auth/DrawerContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import type { CategoryRecord, SeriesRecord } from '../types';
import type { Translator } from '../utils/i18n';
import UserMenu from './UserMenu';

type LibraryView = 'grid' | 'timeline';

// 2026-07-10 主人拍: 导航栏从「产品库/Cards」改为产品库内部「网格/时间线」. 删 ViewToggle, 新增 LibraryViewToggle.
function LibraryViewToggle({ libraryView, onLibraryView, t }: { libraryView: LibraryView; onLibraryView: (v: LibraryView) => void; t: Translator }) {
  return (
    <div className="library-view-toggle" role="tablist" aria-label={t('viewToggleAria') || '视图切换'}>
      <button
        type="button"
        role="tab"
        aria-selected={libraryView === 'grid'}
        className={libraryView === 'grid' ? 'active' : ''}
        onClick={() => onLibraryView('grid')}
      >{t('viewGrid') || '网格'}</button>
      <button
        type="button"
        role="tab"
        aria-selected={libraryView === 'timeline'}
        className={libraryView === 'timeline' ? 'active' : ''}
        onClick={() => onLibraryView('timeline')}
      >{t('viewTimeline') || '时间线'}</button>
    </div>
  );
}

interface Props {
  q: string;
  t: Translator;
  searchQuery?: string;
  updateBadgeLabel?: string;
  onQ: (v: string) => void;
  libraryView: LibraryView;
  onLibraryView: (v: LibraryView) => void;
  onFilters: () => void;
  onConfig?: () => void;     // 2026-07-12 legacy: 现在用 DrawerContext, 保留兼容
  onOpenAdmin?: () => void;  // 2026-07-12 legacy: 不再使用
  count: number;
  clusterName?: string;
  clearCluster: () => void;
  // 2026-07-12 主人拍: TopBar 加 2 个快速筛选胶囊 (品类 / 系列), 用于 ProductLibraryView.
  categoryId?: number;
  seriesId?: number;
  onCategoryId: (id: number | undefined) => void;
  onSeriesId: (id: number | undefined) => void;
}

// 2026-07-12 主人拍: 6 项同排, 从左到右:
// [①站点图标] [②BODR Image Prompt] [③搜索栏] [④网格│时间线] [⑤设置齿轮] [⑥用户中心]
// ⑤ 设置齿轮 = 弹设置弹窗 (ConfigPanel); ⑥ 用户中心 = 弹用户中心弹窗 (UserPanel + Admin tabs).
// 设置里再无「Admin Panel」按钮, 因为用户中心弹窗里直接有 admin tab.
export default function TopBar({
  q,
  t,
  searchQuery,
  updateBadgeLabel,
  onQ,
  libraryView,
  onLibraryView,
  onFilters,
  onConfig: _onConfig,
  onOpenAdmin: _onOpenAdmin,
  count,
  clusterName,
  clearCluster,
  categoryId,
  seriesId,
  onCategoryId,
  onSeriesId,
}: Props) {
  // 2026-07-12 主人拍: 顶栏设置齿轮 + 用户头像直接通过 DrawerContext 打开对应抽屉,
  // 不依赖上层 prop drilling.
  const { openConfig } = useDrawer();
  // 2026-07-12 主人拍: 守护字典拉取, 避免初次挂载 401 触发到 AuthOverlay 之外的 API.
  const { status: authStatus } = useAuth();

  // 2026-07-12 主人拍: 品类 / 系列胶囊 - 拉一次字典, 按需联动.
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesRecord[]>([]);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [seriesMenuOpen, setSeriesMenuOpen] = useState(false);
  // 2026-07-12 主人拍: 用 ref + useEffect 替代 autoFocus (React 19 不推荐 autoFocus).
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    api.products.listCategories()
      .then(res => { if (!cancelled) setCategories(res.items); })
      .catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [authStatus]);

  // 系列胶囊: 选了品类才传 category_id 给后端, 联动过滤.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    api.products.listSeries(categoryId)
      .then(res => { if (!cancelled) setSeriesList(res.items); })
      .catch(() => { if (!cancelled) setSeriesList([]); });
    return () => { cancelled = true; };
  }, [authStatus, categoryId]);

  // 切换品类时: 如果当前 seriesId 不在新列表里, 清空 (避免隐项)
  useEffect(() => {
    if (seriesId == null) return;
    if (!seriesList.some(s => s.id === seriesId)) onSeriesId(undefined);
  }, [seriesList, seriesId, onSeriesId]);

  // 2026-07-12 主人拍: 搜索框挂载后立即聚焦 (替代 autoFocus 属性).
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const categoryName = useMemo(
    () => categories.find(c => c.id === categoryId)?.name,
    [categories, categoryId]
  );
  const seriesName = useMemo(
    () => seriesList.find(s => s.id === seriesId)?.name,
    [seriesList, seriesId]
  );

  return (
    <header className="chrome">
      <nav className="nav-row" aria-label={t('primaryNavigation')}>
        {/* ① 站点图标 */}
        <a className="brand-logo-link" href="/" aria-label={t('appHome')} onClick={e => e.preventDefault()}>
          <img src={headerLogo} alt="" aria-hidden="true" className="brand-logo" />
        </a>

        {/* ② 品牌名 */}
        <a className="brand-name-link" href="/" aria-label={t('appHome')} onClick={e => e.preventDefault()}>
          <b className="brand-name">BODR Image Prompt</b>
        </a>

        {/* ③ 搜索栏 */}
        <div className="search toolbar-search" role="search">
          {/* ③.a 品类快速筛选胶囊 - 2026-07-12 主人拍: 在搜索图标前面 */}
          <div className="quick-filter-dock inline">
            <button
              type="button"
              className={`quick-filter-pill inline ${categoryId != null ? 'active' : ''}`}
              onClick={() => { setCategoryMenuOpen(v => !v); setSeriesMenuOpen(false); }}
              aria-haspopup="listbox"
              aria-expanded={categoryMenuOpen}
              title={t('quickFilterCategory') || '按品类筛选'}
            >
              <span>{t('category') || '品类'}</span>
              <b>{categoryName ?? (t('allShort') || '全部')}</b>
              <ChevronDown size={12} />
            </button>
            {categoryMenuOpen && (
              <div className="quick-filter-menu" role="listbox" onMouseLeave={() => setCategoryMenuOpen(false)}>
                <button type="button" className={categoryId == null ? 'active' : ''} onClick={() => { onCategoryId(undefined); onSeriesId(undefined); setCategoryMenuOpen(false); }}>
                  <span>{t('allShort') || '全部'}</span>
                </button>
                {categories.map(c => (
                  <button type="button" key={c.id} className={categoryId === c.id ? 'active' : ''} onClick={() => { onCategoryId(c.id); setCategoryMenuOpen(false); }}>
                    <span>{c.name}</span>
                    <b>{c.count}</b>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ③.b 系列快速筛选胶囊 - 2026-07-12 主人拍: 在搜索图标前面 */}
          <div className="quick-filter-dock inline">
            <button
              type="button"
              className={`quick-filter-pill inline ${seriesId != null ? 'active' : ''}`}
              onClick={() => { setSeriesMenuOpen(v => !v); setCategoryMenuOpen(false); }}
              aria-haspopup="listbox"
              aria-expanded={seriesMenuOpen}
              disabled={categories.length === 0}
              title={t('quickFilterSeries') || '按系列筛选'}
            >
              <span>{t('series') || '系列'}</span>
              <b>{seriesName ?? (t('allShort') || '全部')}</b>
              <ChevronDown size={12} />
            </button>
            {seriesMenuOpen && (
              <div className="quick-filter-menu" role="listbox" onMouseLeave={() => setSeriesMenuOpen(false)}>
                <button type="button" className={seriesId == null ? 'active' : ''} onClick={() => { onSeriesId(undefined); setSeriesMenuOpen(false); }}>
                  <span>{t('allShort') || '全部'}</span>
                </button>
                {seriesList.map(s => (
                  <button type="button" key={s.id} className={seriesId === s.id ? 'active' : ''} onClick={() => { onSeriesId(s.id); setSeriesMenuOpen(false); }}>
                    <span>{s.name}</span>
                    <b>{s.count}</b>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Search size={20} />
          <input
            ref={searchInputRef}
            value={q}
            onChange={e => onQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { onQ(''); onCategoryId(undefined); onSeriesId(undefined); (e.currentTarget as HTMLInputElement).blur(); } }}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchAria')}
          />
          {(q || categoryId || seriesId) && (
            <button
              type="button"
              className="search-clear-btn"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onQ(''); onCategoryId(undefined); onSeriesId(undefined); }}
              aria-label={t('searchClear') || '清除筛选'}
              title={t('searchClear') || '清除筛选'}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* ④ 网格 / 时间线 切换 */}
        <div className="view-dock nav-view-dock">
          <LibraryViewToggle t={t} libraryView={libraryView} onLibraryView={onLibraryView} />
        </div>

        {/* ⑤ 设置齿轮 - 独立一格 */}
        <button
          type="button"
          data-drawer-trigger="config"
          className="iconbtn nav-config-button"
          onClick={openConfig}
          aria-label={t('config') || '设置'}
          title={t('config') || '设置'}
        >
          <SettingsIcon size={20} />
          {updateBadgeLabel && <span className="update-available-badge-nav">{updateBadgeLabel}</span>}
        </button>

        {/* ⑥ 用户中心 - 最右一格 */}
        <div className="nav-right">
          <UserMenu t={t} />
        </div>
      </nav>

      <div className="status-row mobile-status-view-row">
        <div className="active-filter-strip" aria-label={t('currentFilters')}>
          <span className="template-count">{count} {t('productsShown')}</span>
          {searchQuery && <span className="chip soft-chip">{t('searchChip')}: "{searchQuery}"</span>}
          {clusterName && (
            <button className="chip active-filter" onClick={clearCluster}>
              {t('collectionChip')}: {clusterName} ×
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
