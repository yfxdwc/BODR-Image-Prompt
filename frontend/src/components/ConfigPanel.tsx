import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, isDemoMode } from '../api/client';
import { useDrawer } from '../auth/DrawerContext';
import type { AppConfig, AppUpdateStatus, CodexNativeAuthStart, GenerationProviderStatus } from '../types';
import { UI_LANGUAGE_LABELS, type Translator, type UiLanguage } from '../utils/i18n';
import { type PromptCopyLanguage } from '../utils/prompts';

const LANGUAGE_OPTIONS: PromptCopyLanguage[] = ['zh_hans', 'en']; // 2026-07-05 08:49 主人拍: 和 UI 模式一样 2 选 1, 不要 Origin
const UI_LANGUAGE_OPTIONS: UiLanguage[] = ['zh_hans', 'en']; // 2026-07-05 08:46 主人拍: 只留简体 + English
// 2026-07-11 主人拍: globalThumbnailBudget 改成「网格每行卡片数」3/4/5/6 四档, 不再是图片总数.
const GLOBAL_DENSITY_OPTIONS: number[] = [3, 4, 5, 6];
const GLOBAL_DENSITY_DEFAULT = 4;
const FOCUS_BUDGET_MIN = 24;
const FOCUS_BUDGET_MAX = 100;
const FOCUS_BUDGET_STEP = 4;

function providerStateLabel(provider: GenerationProviderStatus) {
  if (provider.state === 'not_configured') return 'Not configured';
  if (provider.state === 'not_connected') return 'Not connected';
  if (provider.state === 'connected') return 'Connected';
  if (provider.state === 'demo_unavailable') return 'Local only';
  if (provider.state === 'available') return 'Available';
  if (provider.state === 'expired') return 'Expired';
  return provider.state || 'Unavailable';
}

function featureSummary(provider: GenerationProviderStatus) {
  const features = [
    provider.features.text_to_image ? 'Text→Image' : undefined,
    provider.features.text_reference_to_image ? 'Text+Reference→Image' : undefined,
    provider.features.image_edit ? 'Image edit' : undefined,
    provider.features.manual_result_upload ? 'Manual upload' : undefined,
  ].filter(Boolean);
  return features.length ? features.join(' · ') : 'No generation features enabled';
}

const providerFallback: GenerationProviderStatus[] = [
  {
    provider: 'manual_upload',
    display_name: 'Manual upload',
    optional: false,
    configured: true,
    authenticated: true,
    available: true,
    state: 'available',
    reason: null,
    features: { manual_result_upload: true },
  },
  {
    provider: 'openai_codex_oauth_native',
    display_name: 'ChatGPT / Codex OAuth',
    auth_mode: 'codex_oauth_native',
    optional: true,
    configured: false,
    authenticated: false,
    available: false,
    state: 'not_configured',
    reason: 'provider_status_unavailable',
    features: { text_to_image: false, text_reference_to_image: false, image_edit: false },
    token_present: false,
    account_id: null,
  },
];


export default function ConfigPanel({
  t,
  uiLanguage,
  onUiLanguage,
  preferredLanguage,
  onPreferredLanguage,
  globalThumbnailBudget,
  onGlobalThumbnailBudget,
  imageCompressionEnabled,
  onImageCompressionEnabled,
  updateStatus,
  onRefreshUpdateStatus,
  onUpdateInstalled,
  onProvidersChanged = () => undefined,
}: {
  t: Translator;
  uiLanguage: UiLanguage;
  onUiLanguage: (language: UiLanguage) => void;
  preferredLanguage: PromptCopyLanguage;
  onPreferredLanguage: (language: PromptCopyLanguage) => void;
  globalThumbnailBudget: number;
  onGlobalThumbnailBudget: (budget: number) => void;
  // 2026-07-10 11:03 主人拍: 压缩开关. 默认 true.
  imageCompressionEnabled: boolean;
  onImageCompressionEnabled: (enabled: boolean) => void;
  updateStatus?: AppUpdateStatus;
  onRefreshUpdateStatus: () => Promise<AppUpdateStatus | undefined>;
  onUpdateInstalled: (targetVersion: string) => void;
  onProvidersChanged?: () => void;
}) {
  // 2026-07-12 主人拍: 用 DrawerContext 管理开/关状态, 顶栏齿轮直接通过 context 触发
  const { configOpen: open, closeConfig: onClose } = useDrawer();
  const [cfg, setCfg] = useState<AppConfig>();
  const [providers, setProviders] = useState<GenerationProviderStatus[]>([]);
  const [authStart, setAuthStart] = useState<CodexNativeAuthStart>();
  const [providerMessage, setProviderMessage] = useState<string>();
  const [providerBusy, setProviderBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string>();
  const [updateInstalled, setUpdateInstalled] = useState<{ targetVersion: string; requiresManualRestart: boolean }>();
  const [showActiveUpdateConfirm, setShowActiveUpdateConfirm] = useState(false);

  const loadProviders = () => api.generationProviders().then(nextProviders => {
    setProviders(nextProviders);
    onProvidersChanged();
  }).catch(() => {
    setProviders(providerFallback);
    setProviderMessage('Could not load provider status from the local backend. Showing safe local fallback.');
    onProvidersChanged();
  });

  useEffect(() => {
    if (open) {
      api.config().then(setCfg).catch(() => undefined);
      onRefreshUpdateStatus().catch(() => undefined);
      loadProviders();
    }
  }, [open, onRefreshUpdateStatus]);

  const startCodexAuth = async () => {
    setProviderBusy(true);
    setProviderMessage(undefined);
    try {
      const started = await api.codexNativeAuthStart();
      setAuthStart(started);
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : 'Could not start OAuth.');
    } finally {
      setProviderBusy(false);
    }
  };

  const pollCodexAuth = async () => {
    if (!authStart) return;
    setProviderBusy(true);
    setProviderMessage(undefined);
    try {
      const pollResult = await api.codexNativeAuthPoll({ device_auth_id: authStart.device_auth_id, user_code: authStart.user_code });
      if ('status' in pollResult && pollResult.status === 'pending') {
        setProviderMessage('Authorization is still pending. Complete the browser approval, then check again.');
        return;
      }
      setAuthStart(undefined);
      await loadProviders();
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : 'Authorization is not complete yet.');
    } finally {
      setProviderBusy(false);
    }
  };

  const disconnectCodexAuth = async () => {
    setProviderBusy(true);
    setProviderMessage(undefined);
    try {
      await api.codexNativeAuthDisconnect();
      setAuthStart(undefined);
      await loadProviders();
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : 'Could not disconnect provider.');
    } finally {
      setProviderBusy(false);
    }
  };

  const activeUpdateJobs = (updateStatus?.active_generation_jobs.running || 0) + (updateStatus?.active_generation_jobs.queued || 0);
  const refreshUpdateStatus = () => onRefreshUpdateStatus().catch(() => {
    setUpdateMessage('Could not check app updates.');
    return undefined;
  });
  const beginUpdate = async (cancelActiveGenerationJobs: boolean) => {
    if (!updateStatus?.latest_version) return;
    setUpdateBusy(true);
    setUpdateMessage(undefined);
    try {
      const result = await api.startAppUpdate({ target_version: updateStatus.latest_version, cancel_active_generation_jobs: cancelActiveGenerationJobs });
      setShowActiveUpdateConfirm(false);
      setUpdateInstalled({ targetVersion: result.target_version, requiresManualRestart: result.requires_manual_restart });
      onUpdateInstalled(result.target_version);
      setUpdateMessage(undefined);
      await refreshUpdateStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not install update.';
      if (message.includes('active_generation_jobs')) setShowActiveUpdateConfirm(true);
      setUpdateMessage(message);
    } finally {
      setUpdateBusy(false);
    }
  };
  const requestUpdate = () => {
    if (activeUpdateJobs > 0) {
      setShowActiveUpdateConfirm(true);
      return;
    }
    void beginUpdate(false);
  };
  const restartInstruction = updateInstalled?.requiresManualRestart
    ? 'Stop the running Terminal server, then start BODR Image Prompt again to use the new version.'
    : 'The update has been installed. The macOS service restart has been scheduled; reconnect after it comes back online.';

  return (
    <aside data-drawer="config" className={`config drawer ${open ? 'open' : ''}`}>
      <div className="drawer-head">
        <h2>{t('config')}</h2>
        <button className="panel-close" onClick={onClose} aria-label={t('closeConfig')}><X size={20} strokeWidth={2.25} /></button>
      </div>

      <section className="setting-group">
        <h3>{t('uiLanguage')}</h3>
        <div className="segmented-control" aria-label={t('uiLanguage')}>
          {UI_LANGUAGE_OPTIONS.map(language => (
            <button
              key={language}
              className={uiLanguage === language ? 'active' : ''}
              onClick={() => onUiLanguage(language)}
            >
              {UI_LANGUAGE_LABELS[language]}
            </button>
          ))}
        </div>
      </section>

      <section className="setting-group">
        <h3>{t('promptCopyLanguage')}</h3>
        <p className="muted">{t('promptCopyLanguageHelp')}</p>
        <div className="segmented-control prompt-copy-language-control" aria-label={t('preferredPromptLanguage')}>
          {LANGUAGE_OPTIONS.map(language => (
            <button
              key={language}
              className={preferredLanguage === language ? 'active' : ''}
              onClick={() => onPreferredLanguage(language)}
            >
              {UI_LANGUAGE_LABELS[language as UiLanguage]}
            </button>
          ))}
        </div>
      </section>

      {/* 2026-07-10 11:03 主人拍: 压缩开关. 默认开, 关掉后端保留原文件. */}
      <section className="setting-group">
        <h3>{t('imageCompression')}</h3>
        <p className="muted">{t('imageCompressionHelp')}</p>
        <div className="segmented-control" role="group" aria-label={t('imageCompression')}>
          <button
            type="button"
            className={imageCompressionEnabled ? 'active' : ''}
            aria-pressed={imageCompressionEnabled}
            onClick={() => onImageCompressionEnabled(true)}
          >{t('on') || '开'}</button>
          <button
            type="button"
            className={!imageCompressionEnabled ? 'active' : ''}
            aria-pressed={!imageCompressionEnabled}
            onClick={() => onImageCompressionEnabled(false)}
          >{t('off') || '关'}</button>
        </div>
      </section>

      {/* 2026-07-11 主人拍: globalThumbnailBudget 改成「网格每行卡片数」3/4/5/6 四档. 默认 4. */}
      <section className="setting-group">
        <div className="setting-title-row">
          <h3>{t('globalThumbnails')}</h3>
          <strong>{globalThumbnailBudget}</strong>
        </div>
        <p className="muted">{t('globalThumbnailsHelp')}</p>
        <div className="segmented-control global-density-control" role="group" aria-label={t('globalThumbnailBudget')}>
          {GLOBAL_DENSITY_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              className={globalThumbnailBudget === option ? 'active' : ''}
              aria-pressed={globalThumbnailBudget === option}
              onClick={() => onGlobalThumbnailBudget(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section className="setting-group app-update-section">
        <h3>App update</h3>
        {!updateStatus && <p className="muted">Checking for updates…</p>}
        {updateInstalled ? (
          <div className="update-card update-complete-card" role="status">
            <p className="update-kicker">Update installed</p>
            <p className="update-title">Restart required to finish updating to <code>{updateInstalled.targetVersion}</code>.</p>
            <p className="provider-help">{restartInstruction}</p>
            {updateInstalled.requiresManualRestart && <p className="update-command-hint"><code>BODR-Image-Prompt start</code></p>}
          </div>
        ) : updateStatus && !updateStatus.update_available ? (
          <p className="muted">BODR Image Prompt is up to date. Current version: <code>{updateStatus.current_version}</code></p>
        ) : updateStatus?.update_available && (
          <div className="update-card">
            <p className="muted"><strong>Update available</strong>: <code>{updateStatus.latest_version}</code></p>
            <p className="muted">Current version: <code>{updateStatus.current_version}</code></p>
            {showActiveUpdateConfirm ? (
              <div className="update-warning">
                <p>Updating requires restarting the app.</p>
                <p>There are {updateStatus.active_generation_jobs.running} generation jobs running and {updateStatus.active_generation_jobs.queued} queued. If you continue now, unfinished jobs will be cancelled and unfinished results will not be saved.</p>
                <div className="provider-actions">
                  <button className="secondary" onClick={() => setShowActiveUpdateConfirm(false)} disabled={updateBusy}>Update later</button>
                  <button className="danger" onClick={() => beginUpdate(true)} disabled={updateBusy}>Cancel jobs and update</button>
                </div>
              </div>
            ) : (
              <div className="provider-actions">
                <button className="primary" onClick={requestUpdate} disabled={updateBusy}>{updateBusy ? 'Installing…' : 'Update and restart'}</button>
                {updateStatus.release_url && <a className="secondary" href={updateStatus.release_url} target="_blank" rel="noreferrer">View release</a>}
              </div>
            )}
            <p className="provider-help">{updateStatus.requires_manual_restart ? 'This app is running from Terminal. After installation, stop the server and start it again to use the new version.' : 'This app is running as a macOS service. The updater can restart the service after installation.'}</p>
          </div>
        )}
        {updateMessage && <p className="provider-message">{updateMessage}</p>}
      </section>

      {/* 2026-07-05 08:46 主人拍: 隐藏供应商卡片 (恢复: 删除本注释块包裹) */}
      {false && (
      <section className="setting-group provider-section">
        <h3>{t('providers')}</h3>
        <p className="muted">Generation providers are optional. The core library remains usable without OAuth.</p>
        <div className="provider-list">
          {providers.map(provider => (
            <article className={`provider-card state-${provider.state}`} key={provider.provider}>
              <div className="provider-card-head">
                <div>
                  <strong>{provider.provider === 'openai_codex_oauth_native' ? 'ChatGPT / Codex OAuth' : provider.display_name}</strong>
                  <span>{provider.optional ? 'Optional provider' : 'Built in'}</span>
                </div>
                <b>{providerStateLabel(provider)}</b>
              </div>
              <p className="muted">{featureSummary(provider)}</p>
              {provider.provider === 'openai_codex_oauth_native' && (
                <div className="provider-actions">
                  {provider.state === 'not_configured' && (
                    <p className="provider-help">Set IMAGE_PROMPT_LIBRARY_CODEX_CLIENT_ID or ~/.BODR-Image-Prompt/config.json locally to enable Connect.</p>
                  )}
                  {provider.account_id && <p className="provider-help">Account: <code>{provider.account_id}</code></p>}
                  {authStart && (
                    <div className="provider-auth-box">
                      <p>Open <a href={authStart.verification_url || authStart.verification_uri_complete || authStart.verification_uri} target="_blank" rel="noreferrer">verification_url</a> and enter code <code>user_code: {authStart.user_code}</code>.</p>
                      <button className="secondary" onClick={pollCodexAuth} disabled={providerBusy}>Check authorization</button>
                    </div>
                  )}
                  {!provider.authenticated && !authStart && (
                    <button className="secondary" onClick={startCodexAuth} disabled={isDemoMode || provider.state === 'not_configured' || providerBusy}>Connect</button>
                  )}
                  {provider.authenticated && <button className="secondary" onClick={disconnectCodexAuth} disabled={providerBusy}>Disconnect</button>}
                </div>
              )}
            </article>
          ))}
        </div>
        {providerMessage && <p className="provider-message">{providerMessage}</p>}
      </section>
      )}
    </aside>
  );
}
