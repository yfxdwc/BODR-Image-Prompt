import type { UiLanguage } from '../types';
export type { UiLanguage } from '../types';
type TranslationKey =
  | 'filters' | 'searchAria' | 'searchPlaceholder' | 'config' | 'searchChip' | 'collectionChip'
  | 'sortChip' | 'sortByUpdated' | 'sortByCreated' | 'sortByTitle'
  | 'explore' | 'cards' | 'uiLanguage' | 'promptCopyLanguage' | 'promptCopyLanguageHelp' | 'providers'
  | 'globalThumbnails' | 'globalThumbnailsHelp'
  | 'showMore'
  | 'calm' | 'balanced' | 'dense' | 'compact' | 'gallery' | 'full' | 'libraryPath' | 'databasePath'
  | 'libraryEmptyTitle' | 'libraryEmptyHelp' | 'noMatchingPrompts' | 'noMatchingPromptsHelp' | 'addFirstPrompt'
  | 'copyPrompt' | 'favorite' | 'saved' | 'edit' | 'noImage' | 'unclustered'
  | 'collections' | 'closeFilters' | 'searchCollections' | 'allReferences' | 'noCollectionsFound'
  | 'loading' | 'copySuccess' | 'copyFailed' | 'add' | 'close' | 'closeConfig'
  | 'newReference' | 'updateReference' | 'addPromptCard' | 'editPromptCard' | 'editorHelp'
  | 'title' | 'titlePlaceholder' | 'collection' | 'collectionPlaceholder' | 'tags' | 'tagsPlaceholder' | 'existingTagSuggestions'
  | 'traditionalChinesePrompt' | 'traditionalPromptPlaceholder' | 'simplifiedChinesePrompt' | 'simplifiedPromptPlaceholder' | 'englishPrompt' | 'englishPromptPlaceholder'
  | 'resultImageAlreadySaved' | 'resultImageRequired' | 'resultImageHelp' | 'referencePhotoOptional' | 'referencePhotoHelp'
  | 'deleteReference' | 'deleteReferenceConfirm' | 'selectReferences' | 'selectedReferences' | 'deleteSelectedReferences' | 'deleteSelectedReferencesConfirm' | 'cancel' | 'saving' | 'saveReference' | 'saveFailed'
  | 'primaryNavigation' | 'appHome' | 'currentFilters' | 'preferredPromptLanguage' | 'globalThumbnailBudget'
  | 'adminPanel' | 'logout' | 'confirmLogout' | 'roleAdmin' | 'roleUser'
  | 'collectionFilters' | 'itemActions' | 'promptLanguage' | 'promptText' | 'source' | 'defaultModel' | 'localReference'
  | 'imageGeneratedFrom' | 'author' | 'sourceUrl' | 'notes' | 'addNote' | 'origin' | 'markAsOriginal' | 'originalPromptHelp'
  | 'constellationGraph' | 'constellationControls' | 'zoomOut' | 'zoomIn' | 'resetView' | 'thumbnailsVisible' | 'visible' | 'references' | 'more'
  | 'onlineReadOnlyDemo' | 'runLocallyForPrivateLibrary' | 'localV06SupportsMobileGeneration' | 'viewOnGitHub'
  | 'chooseLanguage' | 'chooseLanguageHelp' | 'changeLanguageLater'
  | 'product_library' | 'productLibraryEmpty' | 'productLibraryEmptyHelp' | 'spec' | 'sellingPoints' | 'productImages' | 'pasteImage' | 'dropImage' | 'uploadImage' | 'uploadHint' | 'setCover' | 'removeCover' | 'deleteImage' | 'deleteConfirm' | 'uploading' | 'coverBadge' | 'noImagesPlaceholder'
  // 2026-07-10 主人拍: 产品库 grid↔timeline 内部切换
  | 'viewGrid' | 'viewTimeline' | 'viewToggleAria' | 'imageCountShort'
  // 2026-07-10 11:03 主人拍: 设置压缩开关
  | 'imageCompression' | 'imageCompressionHelp' | 'on' | 'off'
  | 'resultImages' | 'referenceImages' | 'multiImageUploadHint' | 'removeImage' | 'setAsCover' | 'maxResultImages' | 'maxReferenceImages' | 'coverIsSet' | 'dragToReorder' | 'imageLimitReached' | 'imageCount'
  // 2026-07-04 ProductModal redesign: left product info + right prompt
  | 'productInfo' | 'productPrompt' | 'productImage' | 'name' | 'series' | 'category' | 'categoryPlaceholder' | 'categoryCreateNew' | 'categoryNewPlaceholder' | 'seriesPlaceholder' | 'seriesCreateNew' | 'seriesNewPlaceholder' | 'confirm' | 'cancel' | 'afterSales' | 'afterSalesPlaceholder' | 'afterSalesOption1' | 'afterSalesOption2' | 'afterSalesOption3' | 'afterSalesOption4' | 'certifications' | 'certificationsPlaceholder' | 'certificationsOption1' | 'save' | 'promptStyle' | 'promptSlogan' | 'promptSubjectAngle' | 'promptComposition' | 'promptLighting' | 'promptDisplayStageAndLogo' | 'promptMaterialTexture' | 'promptBackground' | 'promptColorTone' | 'selectImageForPrompt' | 'limitReached' | 'productModel' | 'productModelHelp'
  // 2026-07-04 21:44 中栏大图复制按钮
  | 'copy' | 'copyImage' | 'copied' | 'copying'
  // 2026-07-04 21:51 右栏图片基础信息 (只读, 自动识别)
  | 'imgInfo' | 'imgRatio' | 'imgSize' | 'imgPixels' | 'imgFormat' | 'searchClear' | 'quickFilterCategory' | 'quickFilterSeries' | 'allShort' | 'productsShown' | 'productsShownHelp';

export const UI_LANGUAGE_LABELS: Record<UiLanguage, string> = {
  zh_hant: '繁體中文',
  zh_hans: '简体中文',
  en: 'English',
};

export const DEFAULT_UI_LANGUAGE: UiLanguage = 'zh_hans';

export function normalizeUiLanguage(value?: string | null): UiLanguage {
  if (value === 'zh_hant' || value === 'zh_hans' || value === 'en') return value;
  return DEFAULT_UI_LANGUAGE;
}

const TRANSLATIONS: Record<UiLanguage, Record<TranslationKey, string>> = {
  zh_hant: {
    filters: '篩選', searchAria: '搜尋所有 prompts', searchPlaceholder: '搜尋所有 prompts、標題、標籤… 可用 sort:title', config: '設定', searchChip: '搜尋', collectionChip: 'Collection', sortChip: '排序', sortByUpdated: '最近更新', sortByCreated: '最近加入', sortByTitle: '標題 A–Z',
    explore: 'Explore', cards: 'Cards', uiLanguage: '介面語言', promptCopyLanguage: 'Prompt 複製語言', promptCopyLanguageHelp: '原文最貼近 sample 圖。', providers: '供應商',
    globalThumbnails: '卡片密度', globalThumbnailsHelp: '每行 3/4/5/6 卡片。', showMore: '顯示更多',
    calm: '寬鬆', balanced: '平衡', dense: '密集', compact: '精簡', gallery: '圖庫', full: '完整', libraryPath: 'Library 路徑', databasePath: 'Database 路徑',
    libraryEmptyTitle: '你的 library 仍然是空的', libraryEmptyHelp: '新增第一個 prompt，或安裝 sample library 先瀏覽示例內容。', noMatchingPrompts: '找不到符合的 prompts', noMatchingPromptsHelp: '請嘗試另一個搜尋、清除篩選，或新增 prompt 參考。', addFirstPrompt: '新增第一個 prompt',
    copyPrompt: '複製 prompt', favorite: '收藏', saved: '已儲存', edit: '編輯', noImage: '沒有圖片', unclustered: '未分類',
    collections: 'Collections', closeFilters: '關閉篩選', searchCollections: '搜尋 collections', allReferences: '全部參考', noCollectionsFound: '找不到 collections',
    loading: '載入中…', copySuccess: 'Prompt 已複製', copyFailed: '複製失敗', add: '新增', close: '關閉', closeConfig: '關閉設定',
    newReference: '新增參考', updateReference: '更新參考', addPromptCard: '新增 prompt 卡片', editPromptCard: '編輯 prompt 卡片', editorHelp: '將完成圖片、collection、標籤和可重用的多語言 prompts 一併保存。',
    title: '標題', titlePlaceholder: '為此參考命名，方便日後辨識', collection: 'Collection', collectionPlaceholder: '例如：產品商業', tags: '標籤', tagsPlaceholder: 'poster, product, cinematic', existingTagSuggestions: '現有標籤建議',
    traditionalChinesePrompt: '繁體中文 prompt', traditionalPromptPlaceholder: '貼上繁體中文 prompt…', simplifiedChinesePrompt: '簡體中文 prompt', simplifiedPromptPlaceholder: '貼上簡體中文 prompt…', englishPrompt: '英文 prompt', englishPromptPlaceholder: '貼上英文 prompt…',
    resultImageAlreadySaved: '完成圖片已儲存', resultImageRequired: '完成圖片為必填', resultImageHelp: '必填的最終輸出圖片 · PNG、JPG、WEBP 或 GIF', referencePhotoOptional: '參考圖片可選', referencePhotoHelp: '此 prompt 的可選來源／參考圖片',
    deleteReference: '刪除參考', deleteReferenceConfirm: '刪除此參考？\n這會刪除 library 記錄；如果本機圖片檔案沒有被其他參考使用，也會一併刪除。', selectReferences: '選取', selectedReferences: '已選取', deleteSelectedReferences: '刪除', deleteSelectedReferencesConfirm: '刪除已選取的 ${selectedItemIds.size} 個參考？\nLibrary 記錄會被刪除；未被其他參考使用的本機圖片檔案也會一併刪除。', cancel: '取消', saving: '儲存中…', saveReference: '儲存參考', saveFailed: '儲存失敗，請再試一次。',
    primaryNavigation: '主要導覽', appHome: 'BODR Image Prompt 首頁', currentFilters: '目前篩選', preferredPromptLanguage: '偏好 prompt 語言', globalThumbnailBudget: '全域縮圖數量', adminPanel: 'Admin 面板', logout: '登出', confirmLogout: '確認登出?', roleAdmin: '管理員', roleUser: '使用者',
    collectionFilters: 'Collection 篩選', itemActions: '項目操作', promptLanguage: 'Prompt 語言', promptText: 'Prompt 文字', source: '來源', defaultModel: 'ChatGPT Image', localReference: '本機參考',
    imageGeneratedFrom: 'Image generated from', author: '作者', sourceUrl: '來源 URL', notes: '備註', addNote: '新增備註', origin: '原文', markAsOriginal: '標記為原文', originalPromptHelp: '原文 prompt 通常最接近 sample image 的生成結果。',
    constellationGraph: 'Prompt clusters 縮圖星座圖', constellationControls: '星座圖控制', zoomOut: '縮小', zoomIn: '放大', resetView: '重設', thumbnailsVisible: '張縮圖顯示中', visible: '顯示中', references: '個參考', more: '更多',
    onlineReadOnlyDemo: 'Online Read Only Demo', runLocallyForPrivateLibrary: '新增／編輯／生成需要本機安裝，請在本機運行以建立你的私人 prompt library。', localV06SupportsMobileGeneration: '最新 v0.7 beta 加入 prompt variables 和 Template 標示', viewOnGitHub: '在 GitHub 查看',
    chooseLanguage: '選擇介面語言', chooseLanguageHelp: '請選擇你想使用的介面語言。', changeLanguageLater: '之後可在設定中更改。',
    product_library: '產品庫', productLibraryEmpty: '目前沒有產品', productLibraryEmptyHelp: 'prompt-cms 同步尚未回傳任何產品，請稍候再試。', spec: '規格', sellingPoints: '賣點', productImages: '圖片', pasteImage: '貼上圖片', dropImage: '拖曳圖片到這裡', uploadImage: '上傳圖片', uploadHint: '可拖曳檔案、貼上 (⌘V)，或點擊選擇', setCover: '設為封面', removeCover: '取消封面', deleteImage: '刪除', deleteConfirm: '刪除這張圖？', uploading: '上傳中…', coverBadge: '封面', noImagesPlaceholder: '尚未上傳任何圖片', viewGrid: '網格', viewTimeline: '時間線', viewToggleAria: '視圖切換', imageCountShort: '張', imageCompression: '上傳壓縮', imageCompressionHelp: '預設開，關則不重編碼。', on: '開', off: '關', productsShown: '個產品', productsShownHelp: '產品庫總數量', searchClear: '清除搜尋', quickFilterCategory: '按類別篩選', quickFilterSeries: '按系列篩選', allShort: '全部',
    resultImages: '完成圖片', referenceImages: '參考圖片', multiImageUploadHint: '可拖曳多張檔案、貼上 (⌘V)，或點擊選擇多張', removeImage: '刪除圖片', setAsCover: '設為封面', maxResultImages: '最多 9 張完成圖片', maxReferenceImages: '最多 4 張參考圖片', coverIsSet: '已設為封面', dragToReorder: '拖曳縮圖可調整排序', imageLimitReached: '已達到上限', imageCount: '${current} / ${max}',
    // 2026-07-04 ProductModal redesign
    productInfo: '產品資訊', productPrompt: '提示詞', productImage: '產品圖', name: '產品名', series: '系列', category: '產品類別', categoryPlaceholder: '— 未設定 —', categoryCreateNew: '+ 新建類別…', categoryNewPlaceholder: '新類別名', seriesPlaceholder: '— 未設定 —', seriesCreateNew: '+ 新建系列…', seriesNewPlaceholder: '新系列名', confirm: '確定', afterSales: '售後', afterSalesPlaceholder: '— 未設定 —', afterSalesOption1: '3年聯保', afterSalesOption2: '3年配件包換', afterSalesOption3: '2年配件包換', afterSalesOption4: '1年配件包換', certifications: '認證', certificationsPlaceholder: '— 未設定 —', certificationsOption1: '3C認證', save: '儲存', promptStyle: '風格', promptSlogan: '宣傳標語', promptSubjectAngle: '主體角度', promptComposition: '構圖', promptLighting: '燈光', promptDisplayStageAndLogo: '展台及展台正面 logo (品牌展示核心)', promptMaterialTexture: '材質觸感', promptBackground: '背景', promptColorTone: '色調', selectImageForPrompt: '先在下邊選一張圖', limitReached: '已達上限', productModel: '產品型號', productModelHelp: '頂部主標題',
    copy: '複製', copyImage: '複製圖片到剪貼簿', copied: '已複製', copying: '複製中…',
    imgInfo: '圖片資訊', imgRatio: '比例', imgSize: '檔案大小', imgPixels: '像素', imgFormat: '格式',
  },
  zh_hans: {
    filters: '筛选', searchAria: '搜索所有 prompts', searchPlaceholder: '搜索所有 prompts、标题、标签… 可用 sort:title', config: '设置', searchChip: '搜索', collectionChip: 'Collection', sortChip: '排序', sortByUpdated: '最近更新', sortByCreated: '最近加入', sortByTitle: '标题 A–Z',
    explore: 'Explore', cards: 'Cards', uiLanguage: '界面语言', promptCopyLanguage: 'Prompt 复制语言', promptCopyLanguageHelp: '原文最接近 sample 图。', providers: '供应商',
    globalThumbnails: '卡片密度', globalThumbnailsHelp: '每行 3/4/5/6 卡片。', showMore: '显示更多',
    calm: '宽松', balanced: '平衡', dense: '密集', compact: '精简', gallery: '图库', full: '完整', libraryPath: 'Library 路径', databasePath: 'Database 路径',
    libraryEmptyTitle: '你的 library 还是空的', libraryEmptyHelp: '新增第一个 prompt，或安装 sample library 先浏览示例内容。', noMatchingPrompts: '找不到符合的 prompts', noMatchingPromptsHelp: '请尝试另一个搜索、清除筛选，或新增 prompt 参考。', addFirstPrompt: '新增第一个 prompt',
    copyPrompt: '复制 prompt', favorite: '收藏', saved: '已保存', edit: '编辑', noImage: '无图片', unclustered: '未分类',
    collections: 'Collections', closeFilters: '关闭筛选', searchCollections: '搜索 collections', allReferences: '全部参考', noCollectionsFound: '找不到 collections',
    loading: '加载中…', copySuccess: 'Prompt 已复制', copyFailed: '复制失败', add: '新增', close: '关闭', closeConfig: '关闭设置',
    newReference: '新增参考', updateReference: '更新参考', addPromptCard: '新增 prompt 卡片', editPromptCard: '编辑 prompt 卡片', editorHelp: '将完成图片、collection、标签和可复用的多语言 prompts 一并保存。',
    title: '标题', titlePlaceholder: '为此参考命名，方便日后辨识', collection: 'Collection', collectionPlaceholder: '例如：产品商业', tags: '标签', tagsPlaceholder: 'poster, product, cinematic', existingTagSuggestions: '现有标签建议',
    traditionalChinesePrompt: '繁体中文 prompt', traditionalPromptPlaceholder: '贴上繁体中文 prompt…', simplifiedChinesePrompt: '简体中文 prompt', simplifiedPromptPlaceholder: '粘贴简体中文 prompt…', englishPrompt: '英文 prompt', englishPromptPlaceholder: '粘贴英文 prompt…',
    resultImageAlreadySaved: '完成图片已保存', resultImageRequired: '完成图片为必填', resultImageHelp: '必填的最终输出图片 · PNG、JPG、WEBP 或 GIF', referencePhotoOptional: '参考图片可选', referencePhotoHelp: '此 prompt 的可选来源／参考图片',
    deleteReference: '删除参考', deleteReferenceConfirm: '删除此参考？\n这会删除 library 记录；如果本地图片文件没有被其他参考使用，也会一并删除。', selectReferences: '选择', selectedReferences: '已选择', deleteSelectedReferences: '删除', deleteSelectedReferencesConfirm: '删除已选择的 ${selectedItemIds.size} 个参考？\nLibrary 记录会被删除；未被其他参考使用的本地图片文件也会一并删除。', cancel: '取消', saving: '保存中…', saveReference: '保存参考', saveFailed: '保存失败，请再试一次。',
    primaryNavigation: '主要导航', appHome: 'BODR Image Prompt 首页', currentFilters: '当前筛选', preferredPromptLanguage: '偏好 prompt 语言', globalThumbnailBudget: '全局缩图数量', adminPanel: 'Admin 面板', logout: '登出', confirmLogout: '确认登出?', roleAdmin: '管理员', roleUser: '用户',
    collectionFilters: 'Collection 筛选', itemActions: '项目操作', promptLanguage: 'Prompt 语言', promptText: 'Prompt 文字', source: '来源', defaultModel: 'ChatGPT Image', localReference: '本地参考',
    imageGeneratedFrom: 'Image generated from', author: '作者', sourceUrl: '来源 URL', notes: '备注', addNote: '新增备注', origin: '原文', markAsOriginal: '标记为原文', originalPromptHelp: '原文 prompt 通常最接近 sample image 的生成结果。',
    constellationGraph: 'Prompt clusters 缩图星座图', constellationControls: '星座图控制', zoomOut: '缩小', zoomIn: '放大', resetView: '重置', thumbnailsVisible: '张缩图显示中', visible: '显示中', references: '个参考', more: '更多',
    onlineReadOnlyDemo: 'Online Read Only Demo', runLocallyForPrivateLibrary: '新增／编辑／生成需要本机安装，请在本机运行以建立你的私人 prompt library。', localV06SupportsMobileGeneration: '最新 v0.6 beta 改善生成流程并支持附件改图', viewOnGitHub: '在 GitHub 查看',
    chooseLanguage: '选择界面语言', chooseLanguageHelp: '请选择你想使用的界面语言。', changeLanguageLater: '之后可在设置中更改。',
    product_library: '产品库', productLibraryEmpty: '目前没有产品', productLibraryEmptyHelp: 'prompt-cms 同步尚未返回任何产品，请稍候再试。', spec: '规格', sellingPoints: '卖点', productImages: '图片', pasteImage: '粘贴图片', dropImage: '拖拽图片到此处', uploadImage: '上传图片', uploadHint: '可拖拽文件、粘贴 (⌘V)，或点击选择', setCover: '设为封面', removeCover: '取消封面', deleteImage: '删除', deleteConfirm: '删除这张图？', uploading: '上传中…', coverBadge: '封面', noImagesPlaceholder: '尚未上传任何图片', viewGrid: '网格', viewTimeline: '时间线', viewToggleAria: '视图切换', imageCountShort: '张', imageCompression: '上传压缩', imageCompressionHelp: '默认开，关则不重编码。', on: '开', off: '关', productsShown: '个产品', productsShownHelp: '产品库总数量', searchClear: '清除搜索', quickFilterCategory: '按品类筛选', quickFilterSeries: '按系列筛选', allShort: '全部',
    resultImages: '完成图片', referenceImages: '参考图片', multiImageUploadHint: '可拖拽多张文件、粘贴 (⌘V)，或点击选择多张', removeImage: '删除图片', setAsCover: '设为封面', maxResultImages: '最多 9 张完成图片', maxReferenceImages: '最多 4 张参考图片', coverIsSet: '已设为封面', dragToReorder: '拖拽缩图可调整排序', imageLimitReached: '已达到上限', imageCount: '${current} / ${max}',
    // 2026-07-04 ProductModal redesign
    productInfo: '产品信息', productPrompt: '提示词', productImage: '产品图', name: '产品名', series: '系列', category: '产品类别', categoryPlaceholder: '— 未设置 —', categoryCreateNew: '+ 新建类别…', categoryNewPlaceholder: '新类别名', seriesPlaceholder: '— 未设置 —', seriesCreateNew: '+ 新建系列…', seriesNewPlaceholder: '新系列名', confirm: '确定', afterSales: '售后', afterSalesPlaceholder: '— 未设置 —', afterSalesOption1: '3年联保', afterSalesOption2: '3年配件包换', afterSalesOption3: '2年配件包换', afterSalesOption4: '1年配件包换', certifications: '认证', certificationsPlaceholder: '— 未设置 —', certificationsOption1: '3C认证', save: '保存', promptStyle: '风格', promptSlogan: '宣传标语', promptSubjectAngle: '主体角度', promptComposition: '构图', promptLighting: '灯光', promptDisplayStageAndLogo: '展台及展台正面 logo (品牌展示核心)', promptMaterialTexture: '材质触感', promptBackground: '背景', promptColorTone: '色调', selectImageForPrompt: '先在下边选一张图', limitReached: '已达上限', productModel: '产品型号', productModelHelp: '顶部主标题',
    copy: '复制', copyImage: '复制图片到剪贴板', copied: '已复制', copying: '复制中…',
    imgInfo: '图片信息', imgRatio: '比例', imgSize: '文件大小', imgPixels: '像素', imgFormat: '格式',
  },
  en: {
    filters: 'Filters', searchAria: 'Search all prompts', searchPlaceholder: 'Search all prompts, titles, tags… try sort:title', config: 'Config', searchChip: 'Search', collectionChip: 'Collection', sortChip: 'Sort', sortByUpdated: 'Recently updated', sortByCreated: 'Recently added', sortByTitle: 'Title A–Z',
    explore: 'Explore', cards: 'Cards', uiLanguage: 'UI language', promptCopyLanguage: 'Prompt copy language', promptCopyLanguageHelp: 'Matches sample.', providers: 'Providers',
    globalThumbnails: 'Card density', globalThumbnailsHelp: '3–6 cards/row.', showMore: 'Show more',
    calm: 'Calm', balanced: 'Balanced', dense: 'Dense', compact: 'Compact', gallery: 'Gallery', full: 'Full', libraryPath: 'Library path', databasePath: 'Database path',
    libraryEmptyTitle: 'Your library is empty', libraryEmptyHelp: 'Add your first prompt, or install the sample library if you want demo content first.', noMatchingPrompts: 'No matching prompts', noMatchingPromptsHelp: 'Try another search, clear filters, or add a new prompt reference.', addFirstPrompt: 'Add your first prompt',
    copyPrompt: 'Copy prompt', favorite: 'Favorite', saved: 'Saved', edit: 'Edit', noImage: 'No image', unclustered: 'Unclustered',
    collections: 'Collections', closeFilters: 'Close filters', searchCollections: 'Search collections', allReferences: 'All references', noCollectionsFound: 'No collections found',
    loading: 'Loading…', copySuccess: 'Prompt copied', copyFailed: 'Copy failed', add: 'Add', close: 'Close', closeConfig: 'Close config',
    newReference: 'New reference', updateReference: 'Update reference', addPromptCard: 'Add prompt card', editPromptCard: 'Edit prompt card', editorHelp: 'Keep the finished result image, collection, tags, and reusable multilingual prompts together.',
    title: 'Title', titlePlaceholder: 'Give this reference a memorable name', collection: 'Collection', collectionPlaceholder: 'e.g. Product commercial', tags: 'Tags', tagsPlaceholder: 'poster, product, cinematic', existingTagSuggestions: 'Existing tag suggestions',
    traditionalChinesePrompt: 'Traditional Chinese prompt', traditionalPromptPlaceholder: 'Paste the Traditional Chinese prompt…', simplifiedChinesePrompt: 'Simplified Chinese prompt', simplifiedPromptPlaceholder: 'Paste the Simplified Chinese prompt…', englishPrompt: 'English prompt', englishPromptPlaceholder: 'Paste the English prompt…',
    resultImageAlreadySaved: 'Result image already saved', resultImageRequired: 'Result image required', resultImageHelp: 'Required finished output image · PNG, JPG, WEBP or GIF', referencePhotoOptional: 'Reference photo optional', referencePhotoHelp: 'Optional source/reference image for this prompt',
    deleteReference: 'Delete reference', deleteReferenceConfirm: 'Delete this reference?\nThis deletes the library record. Local image files are also deleted if no other reference uses them.', selectReferences: 'Select', selectedReferences: 'selected', deleteSelectedReferences: 'Delete', deleteSelectedReferencesConfirm: 'Delete ${selectedItemIds.size} selected references?\nLibrary records will be deleted. Local image files are also deleted if no other reference uses them.', cancel: 'Cancel', saving: 'Saving…', saveReference: 'Save reference', saveFailed: 'Save failed. Please try again.',
    primaryNavigation: 'Primary navigation', appHome: 'BODR Image Prompt home', currentFilters: 'Current filters', preferredPromptLanguage: 'Preferred prompt language', globalThumbnailBudget: 'Global thumbnail budget', adminPanel: 'Admin panel', logout: 'Sign out', confirmLogout: 'Sign out?', roleAdmin: 'Admin', roleUser: 'User',
    collectionFilters: 'Collection filters', itemActions: 'Item actions', promptLanguage: 'Prompt language', promptText: 'Prompt text', source: 'Source', defaultModel: 'ChatGPT Image', localReference: 'Local reference',
    imageGeneratedFrom: 'Image generated from', author: 'Author', sourceUrl: 'Source URL', notes: 'Notes', addNote: 'Add note', origin: 'Origin', markAsOriginal: 'Mark as origin', originalPromptHelp: 'The source/original prompt is usually closest to the sample image result.',
    constellationGraph: 'Prompt clusters thumbnail constellation graph', constellationControls: 'Constellation controls', zoomOut: 'Zoom out', zoomIn: 'Zoom in', resetView: 'Reset', thumbnailsVisible: 'thumbnails visible', visible: 'visible', references: 'references', more: 'more',
    onlineReadOnlyDemo: 'Online Read Only Demo', runLocallyForPrivateLibrary: 'Add/edit/generation require local install; run locally to create your private prompt library.', localV06SupportsMobileGeneration: 'Latest v0.7 beta adds prompt variables and bulk delete', viewOnGitHub: 'View on GitHub',
    chooseLanguage: 'Choose your language', chooseLanguageHelp: 'Choose the interface language you want to use.', changeLanguageLater: 'You can change this later in Config.',
    product_library: 'Product Library', productLibraryEmpty: 'No products yet', productLibraryEmptyHelp: 'The prompt-cms sync has not returned any products yet. Please try again shortly.', spec: 'Spec', sellingPoints: 'Selling points', productImages: 'Images', pasteImage: 'Paste image', dropImage: 'Drop image here', uploadImage: 'Upload image', uploadHint: 'Drag files, paste (⌘V), or click to choose', setCover: 'Set cover', removeCover: 'Remove cover', deleteImage: 'Delete', deleteConfirm: 'Delete this image?', uploading: 'Uploading…', coverBadge: 'Cover', noImagesPlaceholder: 'No images uploaded yet', viewGrid: 'Grid', viewTimeline: 'Timeline', viewToggleAria: 'View toggle', imageCountShort: 'img', imageCompression: 'Image compression', imageCompressionHelp: 'Default on; off=raw.', on: 'On', off: 'Off', productsShown: 'products', productsShownHelp: 'Total products in library', searchClear: 'Clear search', quickFilterCategory: 'Filter by category', quickFilterSeries: 'Filter by series', allShort: 'All',
    resultImages: 'Result images', referenceImages: 'Reference images', multiImageUploadHint: 'Drag multiple files, paste (⌘V), or click to choose', removeImage: 'Remove image', setAsCover: 'Set as cover', maxResultImages: 'Up to 9 result images', maxReferenceImages: 'Up to 4 reference images', coverIsSet: 'Cover set', dragToReorder: 'Drag thumbnails to reorder', imageLimitReached: 'Limit reached', imageCount: '${current} / ${max}',
    // 2026-07-04 ProductModal redesign
    productInfo: 'Product info', productPrompt: 'Prompt', productImage: 'Product image', name: 'Name', series: 'Series', category: 'Product category', categoryPlaceholder: '— Not set —', categoryCreateNew: '+ New category…', categoryNewPlaceholder: 'New category name', seriesPlaceholder: '— Not set —', seriesCreateNew: '+ New series…', seriesNewPlaceholder: 'New series name', confirm: 'OK', afterSales: 'After-sales', afterSalesPlaceholder: '— Not set —', afterSalesOption1: '3-year warranty', afterSalesOption2: '3-year parts swap', afterSalesOption3: '2-year parts swap', afterSalesOption4: '1-year parts swap', certifications: 'Certifications', certificationsPlaceholder: '— Not set —', certificationsOption1: '3C certified', save: 'Save', promptStyle: 'Style', promptSlogan: 'Slogan', promptSubjectAngle: 'Subject angle', promptComposition: 'Composition', promptLighting: 'Lighting', promptDisplayStageAndLogo: 'Stage & front-logo (brand core)', promptMaterialTexture: 'Material / texture', promptBackground: 'Background', promptColorTone: 'Color tone', selectImageForPrompt: 'Select an image below first', limitReached: 'Limit reached', productModel: 'Product model', productModelHelp: 'Top title',
    copy: 'Copy', copyImage: 'Copy image to clipboard', copied: 'Copied', copying: 'Copying…',
    imgInfo: 'Image info', imgRatio: 'Ratio', imgSize: 'File size', imgPixels: 'Pixels', imgFormat: 'Format',
  },
};

export type Translator = (key: TranslationKey) => string;

export function makeTranslator(language: UiLanguage): Translator {
  return (key: TranslationKey) => TRANSLATIONS[language][key] || TRANSLATIONS.en[key] || key;
}
