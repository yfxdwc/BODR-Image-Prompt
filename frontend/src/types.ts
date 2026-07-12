export type UploadImageRole = 'result_image' | 'reference_image';
export type UiLanguage = 'zh_hant' | 'zh_hans' | 'en';
export interface PromptRecord { id: string; item_id: string; language: string; text: string; is_primary: boolean; is_original?: boolean; provenance?: Record<string, unknown> }
export interface ImageRecord { id: string; item_id: string; original_path: string; thumb_path?: string; preview_path?: string; width?: number; height?: number; role?: UploadImageRole; sort_order?: number; file_sha256?: string | null; created_at?: string }
export interface ClusterRecord { id: string; name: string; names?: Partial<Record<UiLanguage, string>>; description?: string; count: number; preview_images: string[] }
export interface TagRecord { id: string; name: string; kind: string; count: number }
export interface AppConfig { version: string; library_path: string; database_path: string; preferred_prompt_language?: string; features?: { camelot?: { percival?: boolean } } }
export interface AppUpdateStatus { current_version: string; latest_version?: string | null; update_available: boolean; release_url?: string | null; update_command?: string | null; checked_at: string; error?: string | null; service_mode: string; active_generation_jobs: { running: number; queued: number }; can_restart: boolean; requires_manual_restart: boolean }
export interface AppUpdateRequest { target_version?: string | null; cancel_active_generation_jobs: boolean }
export interface AppUpdateResult { status: string; target_version: string; cancelled_generation_jobs: number; restart_mode: string; requires_manual_restart: boolean; message: string; stdout?: string; stderr?: string }
export interface GenerationProviderFeatures { text_to_image?: boolean; text_reference_to_image?: boolean; image_edit?: boolean; manual_result_upload?: boolean }
export interface GenerationProviderStatus { provider: string; display_name: string; auth_mode?: string; optional: boolean; configured: boolean; authenticated: boolean; available: boolean; state: string; reason?: string | null; features: GenerationProviderFeatures; token_present?: boolean; account_id?: string | null; auth_store_path?: string; orchestrator_models?: string[]; default_orchestrator_model?: string; image_models?: string[]; default_image_model?: string }
export interface CodexNativeAuthStart { device_auth_id: string; user_code: string; verification_url: string; verification_uri?: string; verification_uri_complete?: string; expires_in?: number; interval?: number }
export interface CodexNativeAuthPending { provider: string; auth_mode?: string; status: 'pending' }
export type CodexNativeAuthPollResponse = GenerationProviderStatus | CodexNativeAuthPending
export interface CodexNativeAuthPollRequest { device_auth_id: string; user_code: string }
export interface GenerationJobCreate { source_item_id?: string; mode?: string; provider: string; model?: string | null; prompt_language?: string | null; prompt_text: string; edited_prompt_text?: string | null; reference_image_ids?: string[]; parameters?: Record<string, unknown> }
export interface GenerationJobRecord extends GenerationJobCreate { id: string; status: string; result_path?: string | null; result_width?: number | null; result_height?: number | null; result_sha256?: string | null; metadata?: Record<string, unknown>; error?: string | null; accepted_image_id?: string | null; created_at: string; updated_at: string; started_at?: string | null; completed_at?: string | null; accepted_at?: string | null; discarded_at?: string | null; cancelled_at?: string | null }
export interface GenerationJobList { jobs: GenerationJobRecord[]; total: number; limit: number; offset: number }
export interface GenerationJobAcceptAsNewItemPayload { title?: string; cluster_name?: string; tags?: string[]; prompts?: Array<{language: string; text: string; is_primary?: boolean; is_original?: boolean; provenance?: Record<string, unknown>}>; model?: string; source_name?: string; source_url?: string; author?: string; notes?: string }
export interface GenerationJobAcceptResult { job: GenerationJobRecord; item: ItemDetail }
export interface GenerationJobRetryResult { discarded_job: GenerationJobRecord; retry_job: GenerationJobRecord }
export interface ItemSummary { id: string; title: string; demo_titles?: Partial<Record<UiLanguage, string>>; slug: string; model: string; source_name?: string; source_url?: string; cluster?: ClusterRecord; tags: TagRecord[]; prompts: PromptRecord[]; prompt_snippet?: string; first_image?: ImageRecord; images?: ImageRecord[]; rating: number; favorite: boolean; archived: boolean; updated_at: string; created_at: string }
export interface ItemDetail extends ItemSummary { images: ImageRecord[]; notes?: string; author?: string }
export interface ItemList { items: ItemSummary[]; total: number; limit: number; offset: number }
export interface Product { id: number; source_id: number; name: string; series?: string | null; category?: string | null; spec?: string | null; selling_points?: string | null; after_sales?: string | null; certifications?: string | null; created_at?: string | null; updated_at?: string | null }
export interface ProductList { items: Product[]; total: number }

// 2026-06-17 加: product image group (migration 010, 不破坏 4caf16a Product)
// 2026-07-04 重设计: 每张图独立提示词 (5 字段) + 产品新增 after_sales/certifications
// 2026-07-06: 8 字段专业商品摄影 schema (主人拍重设计)
export interface ProductImageRecord { id: string; product_id: number; original_path: string; thumb_path?: string | null; preview_path?: string | null; remote_url?: string | null; width?: number | null; height?: number | null; file_sha256?: string | null; file_size_bytes?: number | null; sort_order: number; is_cover: boolean; created_at: string; slogan?: string | null; subject_angle?: string | null; composition?: string | null; lighting?: string | null; display_stage_and_logo?: string | null; material_texture?: string | null; background?: string | null; style?: string | null; color_tone?: string | null; effective_uploaded_at?: string | null }
export interface ProductImageList { items: ProductImageRecord[]; total: number }
export interface ProductDetail { id: number; source_id: number; name: string; series?: string | null; category?: string | null; spec?: string | null; selling_points?: string | null; after_sales?: string | null; certifications?: string | null; created_at?: string | null; updated_at?: string | null; cover_image_id?: string | null; cover_image?: ProductImageRecord | null; images: ProductImageRecord[] }
export interface ProductDetailList { items: ProductDetail[]; total: number }
export type ItemSortMode = 'updated_desc' | 'created_desc' | 'title_asc'
export interface ItemCreate { title: string; cluster_name?: string; tags?: string[]; prompts: Array<{language: string; text: string; is_primary?: boolean; is_original?: boolean; provenance?: Record<string, unknown>}>; model?: string; source_name?: string; source_url?: string; author?: string; notes?: string; cover_index?: number }
// 2026-06-20 multi-image editor
export interface ItemUpdatePayload { title?: string; cluster_name?: string; tags?: string[]; prompts?: Array<{language: string; text: string; is_primary?: boolean; is_original?: boolean; provenance?: Record<string, unknown>}>; model?: string; source_name?: string; source_url?: string; author?: string; notes?: string; rating?: number; favorite?: boolean; archived?: boolean; cover_index?: number }
// 弹窗内多图草稿: 新文件 = file + 本地 preview; 已有图 = image_id
export interface DraftImage { id?: string; file?: File; previewUrl: string; role: UploadImageRole; name: string; isCover?: boolean }

// 2026-07-06: 字典记录 (类别 + 系列下拉)
export interface CategoryRecord { id: number; name: string; created_at?: string | null; count: number }
export interface SeriesRecord { id: number; name: string; created_at?: string | null; count: number }
export interface CategoryList { items: CategoryRecord[]; total: number }
export interface SeriesList { items: SeriesRecord[]; total: number }
