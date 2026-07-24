import type { AppConfig, AppUpdateRequest, AppUpdateResult, AppUpdateStatus, ClusterRecord, CodexNativeAuthPollRequest, CodexNativeAuthPollResponse, CodexNativeAuthStart, GenerationJobAcceptAsNewItemPayload, GenerationJobAcceptResult, GenerationJobCreate, GenerationJobList, GenerationJobRecord, GenerationJobRetryResult, GenerationProviderStatus, ItemCreate, ItemDetail, ItemList, ItemSortMode, ItemSummary, ItemUpdatePayload, Product, ProductDetail, ProductDetailList, ProductImageList, ProductList, TagRecord, UploadImageRole, CategoryList, SeriesList } from '../types';
import { DEFAULT_ITEM_SORT } from '../utils/searchSort';

const API = '';
const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
const DEMO_DATA_BASE = `${import.meta.env.BASE_URL || '/'}demo-data`.replace(/\/+/g, '/');

function demoUrl(path: string) {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${path.replace(/^\/+/, '')}`;
}

// ── 重试逻辑 (2026-07-06 15:41 主人拍 B 升级) ──────────────────────
// 作用: 所有 json() 调用自动兼享一次重试 (限流/上游满载/网络抖动)
// 不重试: 4xx (除 408/429) + 503 (Codex 需重新认证, 重试无意义) + DELETE/PATCH/POST 业务调用 (防止重复换副作用)
// 设计选择:
//   - 诒 client.ts 集中改 = 所有 API 调用零改受惠 (§58.3 复用优先于从零)
//   - 保留 escape hatch: init._retries 可临时禁用重试 (侧别调试用)
//   - 默认退避: 3s (主人拍)
const _RETRYABLE_RE = /(overloaded_error|^\s*\{[^}]*"?(529|502|429|408|504)|timeout|ETIMEDOUT|ECONNRESET|fetch failed|NetworkError|failed to fetch)/i;
const _RETRY_DELAY_MS = 3000;
const _RETRY_MAX = 1;
const _sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// 只对 GET / HEAD / OPTIONS 重试; POST/PATCH/PUT/DELETE 可能产生副作用, 除非显式 _idempotent
// 主体: 即使 POST 失败重试 1 次, 对于“上游限流报告一表 5 字段反推”这种可重入调用还是较安全的;
// 保留 init._skipRetry 让调用方跳重试 (code 错误类专用, 503 认证错)。
function _isRetryableHttpStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status === 408 || status === 429;
}

async function _fetchOnce(url: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  // 2026-07-11 BIP auth/RBAC: 全局带 cookie (HttpOnly bip_access/bip_refresh). 跨 cloudflare tunnel 也带上.
  // 注意: caller 可以通过 init.credentials 覆盖 (e.g. blob 下载走 omit).
  const merged: RequestInit = { ...init, headers, credentials: init.credentials ?? 'include' };
  return fetch(API + url, merged);
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const reqInit = init ?? {};
  for (let attempt = 0; attempt <= _RETRY_MAX; attempt++) {
    let r: Response;
    try {
      r = await _fetchOnce(url, reqInit);
    } catch (e) {
      // 网络级错误 (fetch 本身拋) - 可重试
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < _RETRY_MAX && _RETRYABLE_RE.test(msg)) {
        await _sleep(_RETRY_DELAY_MS);
        continue;
      }
      throw new Error(msg);
    }
    if (r.ok) return r.json() as Promise<T>;
    // 不重试 503 (认证),不重试 4xx (除 408/429)
    const status = r.status;
    const text = await r.text();
    const shouldRetry = _isRetryableHttpStatus(status) || _RETRYABLE_RE.test(text);
    // 跳过重试: init._skipRetry 显式还位; 或者 503 (Codex 需重新认证)
    const skip = (reqInit as any)._skipRetry === true;
    if (skip || status === 503 || !shouldRetry || attempt >= _RETRY_MAX) {
      throw new Error(text || `HTTP ${status}`);
    }
    // 重试一次
    await _sleep(_RETRY_DELAY_MS);
  }
  // 不会到这里 (上面已 return / throw)
  throw new Error('Unreachable');
}

async function demoJson<T>(path: string): Promise<T> {
  const r = await fetch(demoUrl(path));
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

let demoItemsCache: Promise<ItemSummary[]> | undefined;
const demoItems = () => demoItemsCache ||= demoJson<ItemSummary[]>('demo-data/items.json');

function normalizeSearchText(item: ItemSummary) {
  return [
    item.title,
    item.cluster?.name,
    item.source_name,
    item.model,
    ...item.tags.map(tag => tag.name),
    ...item.prompts.map(prompt => prompt.text),
  ].filter(Boolean).join('\n').toLowerCase();
}

function demoItemSort(sort: ItemSortMode) {
  if (sort === 'created_desc') return (a: ItemSummary, b: ItemSummary) => b.created_at.localeCompare(a.created_at);
  if (sort === 'title_asc') return (a: ItemSummary, b: ItemSummary) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  return (a: ItemSummary, b: ItemSummary) => b.updated_at.localeCompare(a.updated_at);
}

async function demoItemList(params: Record<string, string | number | boolean | undefined>): Promise<ItemList> {
  const allItems = await demoItems();
  const q = String(params.q || '').trim().toLowerCase();
  const cluster = String(params.cluster || '').trim();
  const tag = String(params.tag || '').trim();
  const sort = (params.sort === 'created_desc' || params.sort === 'title_asc' || params.sort === 'updated_desc') ? params.sort : DEFAULT_ITEM_SORT;
  const limit = Math.max(0, Number(params.limit || 100));
  const offset = Math.max(0, Number(params.offset || 0));
  const filtered = allItems.filter(item => {
    if (cluster && item.cluster?.id !== cluster) return false;
    if (tag && !item.tags.some(itemTag => itemTag.name === tag || itemTag.id === tag)) return false;
    if (q && !normalizeSearchText(item).includes(q)) return false;
    return true;
  });
  return { items: filtered.sort(demoItemSort(sort)).slice(offset, offset + limit), total: filtered.length, limit, offset };
}

async function demoItem(id: string): Promise<ItemDetail> {
  const allItems = await demoItems();
  const item = allItems.find(candidate => candidate.id === id);
  if (!item) throw new Error('Demo item not found');
  return { ...item, images: item.first_image ? [item.first_image] : [], notes: 'Online Read Only Demo sample. Demo images are compressed; run the app locally for your own private full library.', author: (item as ItemDetail).author };
}

function demoReadOnly<T = never>(): Promise<T> {
  return Promise.reject(new Error('The online sandbox is read-only. Run BODR Image Prompt locally to create your own private library.'));
}

export const mediaUrl = (path?: string) => {
  if (!path) return '';
  if (isDemoMode && path.startsWith('demo-data/')) return demoUrl(path);
  return `/media/${path}`;
};

export const api = isDemoMode ? {
  health: () => Promise.resolve({ ok: true, version: 'demo' }),
  config: () => Promise.resolve<AppConfig>({ version: 'demo', library_path: 'GitHub Pages read-only sandbox', database_path: 'Static JSON bundle', preferred_prompt_language: 'en', features: { camelot: { percival: true } } }),
  updateStatus: () => Promise.resolve<AppUpdateStatus>({ current_version: 'demo', latest_version: null, update_available: false, checked_at: new Date().toISOString(), service_mode: 'not_applicable', active_generation_jobs: { running: 0, queued: 0 }, can_restart: false, requires_manual_restart: true }),
  startAppUpdate: (_payload: AppUpdateRequest) => demoReadOnly(),
  items: demoItemList,
  item: demoItem,
  createItem: (_payload: ItemCreate) => demoReadOnly(),
  updateItem: (_id: string, _payload: Partial<ItemCreate>) => demoReadOnly(),
  createItemMultipart: (_payload: ItemCreate, _resultFiles: File[], _refFiles: File[]) => demoReadOnly(),
  updateItemMultipart: (_id: string, _payload: ItemUpdatePayload, _resultFiles: File[], _refFiles: File[]) => demoReadOnly(),
  deleteItem: (_id: string) => demoReadOnly(),
  favorite: (_id: string) => demoReadOnly(),
  uploadImage: (_id: string, _file: File, _role: UploadImageRole = 'result_image') => demoReadOnly(),
  deleteItemImage: (_id: string, _imageId: string) => demoReadOnly(),
  setItemImageCover: (_id: string, _imageId: string) => demoReadOnly(),
  reorderItemImages: (_id: string, _imageIds: string[]) => demoReadOnly(),
  generationProviders: () => Promise.resolve<GenerationProviderStatus[]>([
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
      state: 'demo_unavailable',
      reason: 'local_only',
      features: { text_to_image: false, text_reference_to_image: false, image_edit: false },
      token_present: false,
      account_id: null,
    },
  ]),
  codexNativeAuthStart: () => demoReadOnly(),
  codexNativeAuthPoll: (_payload: CodexNativeAuthPollRequest) => demoReadOnly(),
  codexNativeAuthDisconnect: () => demoReadOnly(),
  generationJobs: () => Promise.resolve<GenerationJobList>({ jobs: [], total: 0, limit: 100, offset: 0 }),
  createGenerationJob: (_payload: GenerationJobCreate) => demoReadOnly(),
  runGenerationJob: (_id: string) => demoReadOnly(),
  uploadGenerationResult: (_id: string, _file: File) => demoReadOnly(),
  acceptGenerationJob: (_id: string) => demoReadOnly(),
  acceptGenerationJobAsNewItem: (_id: string, _payload?: GenerationJobAcceptAsNewItemPayload) => demoReadOnly(),
  cancelGenerationJob: (_id: string) => demoReadOnly(),
  retryGenerationJob: (_id: string) => demoReadOnly(),
  markGenerationJobFailed: (_id: string) => demoReadOnly(),
  discardGenerationJob: (_id: string) => demoReadOnly(),
  discardAndRetryGenerationJob: (_id: string) => demoReadOnly(),
  clusters: () => demoJson<ClusterRecord[]>('demo-data/clusters.json'),
  tags: () => demoJson<TagRecord[]>('demo-data/tags.json'),
  products: {
    list: (_filters?: { q?: string; category_id?: number; series_id?: number }) => Promise.resolve<ProductDetailList>({ items: [], total: 0 }),
    get: (_id: number) => demoReadOnly(),
    getBySource: (_sourceId: number) => demoReadOnly(),
    listImages: (_id: number) => Promise.resolve<ProductImageList>({ items: [], total: 0 }),
    uploadImage: (_id: number, _file: File) => demoReadOnly(),
    setCover: (_id: number, _imageId: string) => demoReadOnly(),
    deleteImage: (_id: number, _imageId: string) => demoReadOnly(),
    deleteProduct: (_id: number) => demoReadOnly<void>(),
    reorderImages: (_id: number, _imageIds: string[]) => demoReadOnly(),
    updateInfo: (_id: number, _body: { name?: string; series?: string; category?: string; spec?: string; selling_points?: string; after_sales?: string; certifications?: string }) => demoReadOnly<ProductDetail>(),
    updateImagePrompt: (_id: number, _imageId: string, _body: { slogan?: string; subject_angle?: string; composition?: string; lighting?: string; display_stage_and_logo?: string; material_texture?: string; background?: string; style?: string; color_tone?: string }) => demoReadOnly<ProductDetail>(),
    // 2026-07-06 下拉字典 demo fallback
    listCategories: () => Promise.resolve<CategoryList>({ items: [], total: 0 }),
    createCategory: (_body: { name: string }) => Promise.resolve<CategoryList>({ items: [], total: 0 }),
    listSeries: () => Promise.resolve<SeriesList>({ items: [], total: 0 }),
    trackImage: (_imageId: string, _action: 'copy' | 'download') => undefined,
    createSeries: (_body: { name: string; category_id?: number }) => Promise.resolve<SeriesList>({ items: [], total: 0 }),
  },
  // 2026-07-05 19:30 主人拍 B 方案: 缩略图 ✨ 按钮调 Codex vision 反推 5 字段
  analyzeImage: (_payload: { product_id: number; image_id: string; language?: string }) => demoReadOnly<{ slogan: string | null; subject_angle: string | null; composition: string | null; lighting: string | null; display_stage_and_logo: string | null; material_texture: string | null; background: string | null; style: string | null; color_tone: string | null; raw_text: string | null; model: string; duration_ms: number }>(),
  polishPrompt: (_payload: { text: string; language?: string }) => demoReadOnly(),
} : {
  health: () => json<{ok: boolean; version: string}>('/api/health'),
  config: () => json<AppConfig>('/api/config'),
  updateStatus: () => json<AppUpdateStatus>('/api/update-status'),
  startAppUpdate: (payload: AppUpdateRequest) => json<AppUpdateResult>('/api/app-update/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  items: (params: Record<string, string | number | boolean | undefined>) => { const qs = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); }); return json<ItemList>(`/api/items?${qs}`); },
  item: (id: string) => json<ItemDetail>(`/api/items/${id}`),
  createItem: (payload: ItemCreate) => json<ItemDetail>('/api/items', { method: 'POST', body: JSON.stringify(payload) }),
  updateItem: (id: string, payload: Partial<ItemCreate>) => json<ItemDetail>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  createItemMultipart: (payload: ItemCreate, resultFiles: File[], refFiles: File[]) => {
    const fd = new FormData();
    fd.set('title', payload.title);
    if (payload.model) fd.set('model', payload.model);
    if (payload.source_name) fd.set('source_name', payload.source_name);
    if (payload.source_url) fd.set('source_url', payload.source_url);
    if (payload.author) fd.set('author', payload.author);
    if (payload.notes) fd.set('notes', payload.notes);
    if (payload.cluster_name) fd.set('cluster_name', payload.cluster_name);
    if (payload.tags) fd.set('tags', JSON.stringify(payload.tags));
    fd.set('prompts', JSON.stringify(payload.prompts));
    if (payload.cover_index != null) fd.set('cover_index', String(payload.cover_index));
    for (const f of resultFiles) fd.append('result_files', f);
    for (const f of refFiles) fd.append('reference_files', f);
    return json<ItemDetail>('/api/items', { method: 'POST', body: fd });
  },
  updateItemMultipart: (id: string, payload: ItemUpdatePayload, resultFiles: File[], refFiles: File[]) => {
    const fd = new FormData();
    if (payload.title != null) fd.set('title', payload.title);
    if (payload.model != null) fd.set('model', payload.model);
    if (payload.source_name != null) fd.set('source_name', payload.source_name);
    if (payload.source_url != null) fd.set('source_url', payload.source_url);
    if (payload.author != null) fd.set('author', payload.author);
    if (payload.notes != null) fd.set('notes', payload.notes);
    if (payload.cluster_name != null) fd.set('cluster_name', payload.cluster_name);
    if (payload.tags != null) fd.set('tags', JSON.stringify(payload.tags));
    if (payload.prompts != null) fd.set('prompts', JSON.stringify(payload.prompts));
    if (payload.rating != null) fd.set('rating', String(payload.rating));
    if (payload.favorite != null) fd.set('favorite', String(payload.favorite));
    if (payload.archived != null) fd.set('archived', String(payload.archived));
    if (payload.cover_index != null) fd.set('cover_index', String(payload.cover_index));
    for (const f of resultFiles) fd.append('result_files', f);
    for (const f of refFiles) fd.append('reference_files', f);
    return json<ItemDetail>(`/api/items/${id}`, { method: 'PATCH', body: fd });
  },
  deleteItem: (id: string) => json<ItemDetail>(`/api/items/${id}`, { method: 'DELETE' }),
  favorite: (id: string) => json<ItemDetail>(`/api/items/${id}/favorite`, { method: 'POST' }),
  uploadImage: (id: string, file: File, role: UploadImageRole = 'result_image') => { const fd = new FormData(); fd.set('file', file); fd.set('role', role); return json(`/api/items/${id}/images`, { method: 'POST', body: fd }); },
  deleteItemImage: (id: string, imageId: string) => json<ItemDetail>(`/api/items/${id}/images/${imageId}`, { method: 'DELETE' }),
  setItemImageCover: (id: string, imageId: string) => json<ItemDetail>(`/api/items/${id}/images/${imageId}/cover`, { method: 'POST' }),
  reorderItemImages: (id: string, imageIds: string[]) => json<ItemDetail>(`/api/items/${id}/images/order`, { method: 'PUT', body: JSON.stringify({ image_ids: imageIds }) }),
  generationProviders: () => json<GenerationProviderStatus[]>('/api/generation-providers'),
  codexNativeAuthStart: () => json<CodexNativeAuthStart>('/api/generation-providers/openai-codex-native/auth/start', { method: 'POST' }),
  codexNativeAuthPoll: (payload: CodexNativeAuthPollRequest) => json<CodexNativeAuthPollResponse>('/api/generation-providers/openai-codex-native/auth/poll', { method: 'POST', body: JSON.stringify(payload) }),
  codexNativeAuthDisconnect: () => json<GenerationProviderStatus>('/api/generation-providers/openai-codex-native/auth/disconnect', { method: 'POST' }),
  generationJobs: (params: Record<string, string | number | boolean | undefined> = {}) => { const qs = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); }); return json<GenerationJobList>(`/api/generation-jobs?${qs}`); },
  createGenerationJob: (payload: GenerationJobCreate) => json<GenerationJobRecord>('/api/generation-jobs', { method: 'POST', body: JSON.stringify(payload) }),
  runGenerationJob: (id: string) => json<GenerationJobRecord>(`/api/generation-jobs/${id}/run`, { method: 'POST' }),
  uploadGenerationResult: (id: string, file: File) => { const fd = new FormData(); fd.set('file', file); return json<GenerationJobRecord>(`/api/generation-jobs/${id}/result`, { method: 'POST', body: fd }); },
  acceptGenerationJob: (id: string) => json<GenerationJobAcceptResult>(`/api/generation-jobs/${id}/accept`, { method: 'POST' }),
  acceptGenerationJobAsNewItem: (id: string, payload: GenerationJobAcceptAsNewItemPayload = {}) => json<GenerationJobAcceptResult>(`/api/generation-jobs/${id}/accept-as-new-item`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelGenerationJob: (id: string) => json<GenerationJobRecord>(`/api/generation-jobs/${id}/cancel`, { method: 'POST' }),
  retryGenerationJob: (id: string) => json<GenerationJobRecord>(`/api/generation-jobs/${id}/retry`, { method: 'POST' }),
  markGenerationJobFailed: (id: string) => json<GenerationJobRecord>(`/api/generation-jobs/${id}/mark-failed`, { method: 'POST' }),
  discardGenerationJob: (id: string) => json<GenerationJobRecord>(`/api/generation-jobs/${id}/discard`, { method: 'POST' }),
  discardAndRetryGenerationJob: (id: string) => json<GenerationJobRetryResult>(`/api/generation-jobs/${id}/discard-and-retry`, { method: 'POST' }),
  clusters: () => json<ClusterRecord[]>('/api/clusters'),
  tags: () => json<TagRecord[]>('/api/tags'),
  products: {
    list: (filters?: { q?: string; category_id?: number; series_id?: number }) => {
      const params = new URLSearchParams();
      if (filters?.q) params.set('q', filters.q);
      if (filters?.category_id != null) params.set('category_id', String(filters.category_id));
      if (filters?.series_id != null) params.set('series_id', String(filters.series_id));
      const qs = params.toString();
      return json<ProductDetailList>(`/api/v1/products${qs ? '?' + qs : ''}`);
    },
    get: (id: number) => json<ProductDetail>(`/api/v1/products/${id}`),
    getBySource: (sourceId: number) => json<ProductDetail>(`/api/v1/products/source/${sourceId}`),
    listImages: (id: number) => json<ProductImageList>(`/api/v1/products/${id}/images`),
    // 2026-07-10 11:03 主人拍: ConfigPanel 压缩开关. compress=false 时后端保留主人原 bytes (不调 _compress_lossless).
    uploadImage: (id: number, file: File, compress: boolean = true) => { const fd = new FormData(); fd.set('file', file); fd.set('compress', compress ? 'true' : 'false'); return json<ProductDetail>(`/api/v1/products/${id}/images`, { method: 'POST', body: fd }); },
    setCover: (id: number, imageId: string) => json<ProductDetail>(`/api/v1/products/${id}/cover`, { method: 'PUT', body: JSON.stringify({ cover_image_id: imageId }) }),
    deleteImage: (id: number, imageId: string) => json<ProductDetail>(`/api/v1/products/${id}/images/${imageId}`, { method: 'DELETE' }),
    deleteProduct: (id: number) => fetch(`/api/v1/products/${id}`, { method: 'DELETE' }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),
    reorderImages: (id: number, imageIds: string[]) => json<ProductDetail>(`/api/v1/products/${id}/images/order`, { method: 'PUT', body: JSON.stringify({ image_ids: imageIds }) }),
    // 2026-07-04 ProductModal redesign: product info edit + per-image 5-field prompt
    updateInfo: (id: number, body: { name?: string; series?: string; category?: string; spec?: string; selling_points?: string; after_sales?: string; certifications?: string }) =>
      json<ProductDetail>(`/api/v1/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    updateImagePrompt: (id: number, imageId: string, body: { slogan?: string; subject_angle?: string; composition?: string; lighting?: string; display_stage_and_logo?: string; material_texture?: string; background?: string; style?: string; color_tone?: string }) =>
      json<ProductDetail>(`/api/v1/products/${id}/images/${imageId}/prompt`, { method: 'PUT', body: JSON.stringify(body) }),
    // 2026-07-06 下拉字典
    listCategories: () => json<CategoryList>('/api/v1/categories'),
    createCategory: (body: { name: string }) => json<CategoryList>('/api/v1/categories', { method: 'POST', body: JSON.stringify(body) }),
    listSeries: (category_id?: number) => {
      // 2026-07-07 主人拍 A 方案: 品类和系列父子关系.
      // category_id 不传 → 返回全量; 传 N → 仅返回该 category 下的 series (后端过滤)
      const q = category_id != null ? `?category_id=${category_id}` : '';
      return json<SeriesList>(`/api/v1/series_dict${q}`);
    },
    createSeries: (body: { name: string; category_id?: number }) => json<SeriesList>('/api/v1/series_dict', { method: 'POST', body: JSON.stringify(body) }),
    // 2026-07-24 主人拍: 复制/下载计数上报 (fire-and-forget, 失败不影响主流程)
    // 2026-07-24 主人拍: 复制/下载计数上报 (fire-and-forget, 失败不影响主流程)
    // 返回 Promise<void> 避免 .catch() 链式调用 TS 报错
    trackImage: (imageId: string, action: 'copy' | 'download'): void => {
      fetch(`/api/v1/products/images/${imageId}/track`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Origin': window.location.origin },
        body: JSON.stringify({ action }),
      }).catch(() => undefined);
    },
  },
  polishPrompt: (payload: { text: string; language?: string }) => json<{ text: string; model: string; changed: boolean; duration_ms: number }>('/api/llm/polish-prompt', { method: 'POST', body: JSON.stringify(payload) }),
  // 2026-07-05 19:30 B 方案: 5 字段反推
  analyzeImage: (payload: { product_id: number; image_id: string; language?: string }) => json<{ slogan: string | null; subject_angle: string | null; composition: string | null; lighting: string | null; display_stage_and_logo: string | null; material_texture: string | null; background: string | null; style: string | null; color_tone: string | null; raw_text: string | null; model: string; duration_ms: number }>('/api/llm/analyze-image', { method: 'POST', body: JSON.stringify(payload) }),
};

export { DEMO_DATA_BASE, isDemoMode };
