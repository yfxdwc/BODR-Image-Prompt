import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, ExternalLink, Heart, Maximize2, Pencil, Plus, Trash2, X } from 'lucide-react';
import GenerationPanel from './GenerationPanel';
import PromptComposer from './PromptComposer';
import { api, mediaUrl } from '../api/client';
import type { ClusterRecord, ImageRecord, ItemDetail, PromptRecord, TagRecord, UiLanguage } from '../types';
import { copyTextToClipboard } from '../utils/clipboard';
import { localizedDemoTitle } from '../utils/demoTitles';
import { downloadFileName, downloadImageAsJpeg, imageDisplayPath, imageHeroPath, imageOriginalPath, selectPrimaryImage } from '../utils/images';
import type { Translator } from '../utils/i18n';
import { PROMPT_LANGUAGE_LABELS, resolveOriginalPrompt, resolvePromptText, type PromptCopyLanguage, type PromptLanguage } from '../utils/prompts';

const LANG_LABELS: Record<string, string> = {
  ...PROMPT_LANGUAGE_LABELS,
  en: 'ENG',
};
const promptDisplayOrder = ['zh_hans'];

function getImageIdentity(image: ImageRecord) {
  return image.thumb_path || image.preview_path || image.original_path || image.id;
}

function dedupeImages(images: ImageRecord[]) {
  const seenImageKeys = new Set<string>();
  return images.filter(image => {
    const key = getImageIdentity(image);
    if (seenImageKeys.has(key)) return false;
    seenImageKeys.add(key);
    return true;
  });
}

function isReferenceImage(image?: ImageRecord) {
  return image?.role === 'reference_image';
}

function resolvePromptRecord<T extends { language: string; text: string }>(
  prompts: T[],
  selectedLanguage: string,
  preferredLanguage: PromptLanguage,
): T | undefined {
  const usable = prompts.filter(prompt => prompt.text.trim().length > 0);
  return usable.find(prompt => prompt.language === selectedLanguage)
    || usable.find(prompt => prompt.language === preferredLanguage)
    || usable.find(prompt => prompt.language === 'en')
    || usable[0];
}


function resolveInitialPromptLanguage(prompts: PromptRecord[], preferredLanguage: PromptCopyLanguage): PromptLanguage {
  if (preferredLanguage === 'origin') {
    const originalLanguage = resolveOriginalPrompt(prompts)?.language;
    if (originalLanguage === 'en' || originalLanguage === 'zh_hant' || originalLanguage === 'zh_hans') return originalLanguage;
    return 'en';
  }
  return preferredLanguage;
}

function InlineEditableField({
  className,
  value,
  placeholder,
  inputList,
  onCommit,
  editable = true,
  children,
}: {
  className: string;
  value: string;
  placeholder?: string;
  inputList?: string;
  onCommit: (value: string) => void;
  editable?: boolean;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const confirm = () => { onCommit(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };
  if (editing) {
    return (
      <span className={`inline-editable ${className} is-editing`}>
        <input
          value={draft}
          placeholder={placeholder}
          list={inputList}
          autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') confirm();
            if (event.key === 'Escape') cancel();
          }}
        />
        {children}
        <span className="inline-edit-controls">
          <button type="button" className="inline-edit-confirm" onClick={confirm} aria-label="Confirm edit"><Check size={14} /></button>
          <button type="button" className="inline-edit-cancel" onClick={cancel} aria-label="Cancel edit"><X size={14} /></button>
        </span>
      </span>
    );
  }
  if (!editable) {
    return <span className={`inline-editable ${className} is-read-only`}>{value || placeholder}</span>;
  }
  return (
    <span className={`inline-editable ${className}`} onDoubleClick={() => setEditing(true)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setEditing(true); }}>
      {value || placeholder}
    </span>
  );
}

function InlineEditableTextArea({
  className,
  value,
  placeholder,
  onCommit,
  editable = true,
}: {
  className: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  editable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const confirm = () => { onCommit(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };
  if (editing) {
    return (
      <div className={`inline-editable ${className} is-editing`}>
        <textarea
          value={draft}
          placeholder={placeholder}
          autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') confirm();
            if (event.key === 'Escape') cancel();
          }}
        />
        <span className="inline-edit-controls">
          <button type="button" className="inline-edit-confirm" onClick={confirm} aria-label="Confirm edit"><Check size={14} /></button>
          <button type="button" className="inline-edit-cancel" onClick={cancel} aria-label="Cancel edit"><X size={14} /></button>
        </span>
      </div>
    );
  }
  if (!editable) {
    return <div className={`inline-editable ${className} is-read-only ${value ? '' : 'notes-empty'}`}>{value ? <p>{value}</p> : <span className="add-note-affordance">{placeholder}</span>}</div>;
  }
  return (
    <div className={`inline-editable ${className} ${value ? '' : 'notes-empty'}`} onDoubleClick={() => setEditing(true)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setEditing(true); }}>
      {value ? <p>{value}</p> : <span className="add-note-affordance">{placeholder}</span>}
    </div>
  );
}

export default function ItemDetailModal({
  id,
  t,
  uiLanguage,
  preferredLanguage,
  clusters,
  tags,
  onClose,
  onCopyPrompt,
  onEdit,
  onChanged,
  onDelete,
  onOpenItem,
  showMutations = true,
  canGenerate = false,
  promptVariablesEnabled = false,
  initialGenerationJobId,
}: {
  id?: string;
  t: Translator;
  uiLanguage: UiLanguage;
  preferredLanguage: PromptCopyLanguage;
  clusters: ClusterRecord[];
  tags: TagRecord[];
  onClose: () => void;
  onCopyPrompt: (success: boolean) => void;
  // 2026-07-13 主人拍: 普通用户不传 onEdit, 内部相关按钮都不可见 (showMutations=false 也已守护).
  onEdit?: (item: ItemDetail) => void;
  onChanged: () => void;
  onDelete?: (item: ItemDetail) => void;
  onOpenItem?: (id: string) => void;
  showMutations?: boolean;
  canGenerate?: boolean;
  promptVariablesEnabled?: boolean;
  initialGenerationJobId?: string;
}) {
  const [item, setItem] = useState<ItemDetail>();
  const [lang, setLang] = useState<string>(preferredLanguage);
  const [addingTag, setAddingTag] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [editingPromptLanguage, setEditingPromptLanguage] = useState<string>();
  const [promptDraft, setPromptDraft] = useState('');
  const [generationOpen, setGenerationOpen] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string>();
  const [toast, setToast] = useState<{ message: string; actionLabel?: string; item?: ItemDetail }>();
  const [isClosing, setIsClosing] = useState(false);
  const [isHeroFullscreen, setIsHeroFullscreen] = useState(false);
  const lastDefaultPromptKeyRef = useRef('');
  const heroFullscreenFrameRef = useRef<HTMLDivElement | null>(null);
  // === Scatter stack (主人 6/19 设计的 '高质量现代 UI' 散落 peek 堆叠) ===
  // CSS 类名从 .scatter-* (主人认可的设计) 读, poker-deck 是 OH 6/18 起的别名, 已统一
  const [scatterIsDragging, setScatterIsDragging] = useState(false);
  const [scatterDragX, setScatterDragX] = useState(0);
  const scatterSurfaceRef = useRef<HTMLDivElement | null>(null);
  const scatterDragStartRef = useRef<{ x: number; pointerId: number } | null>(null);
  const heroImageRef = useRef<HTMLImageElement | null>(null);
  // Wheel-throttle: 避免滚轮快速滚动导致多张图连跳 (debounce 240ms)
  const scatterWheelLastRef = useRef(0);
  const SCATTER_WHEEL_THROTTLE_MS = 240;
  const goToImageByOffset = (offset: number) => {
    if (!item || uniqueImages.length <= 1) return;
    const idx = uniqueImages.findIndex(img => img.id === selectedImageId);
    const currentIndex = idx >= 0 ? idx : 0;
    const nextIndex = (currentIndex + offset + uniqueImages.length) % uniqueImages.length;
    setSelectedImageId(uniqueImages[nextIndex].id);
  };
  // 滚轮切换: deltaY > 0 = 向下滚 = 下一张; deltaY < 0 = 上一张
  const handleScatterWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!scatterHasMultiple) return;
    if (isHeroFullscreen) return;
    // 仅在 hero 上滚动才切图, 避免在侧边 prompt 滚动时误触发
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a, [data-no-swipe="true"], textarea, input, .detail-side')) return;
    event.preventDefault();
    const now = Date.now();
    if (now - scatterWheelLastRef.current < SCATTER_WHEEL_THROTTLE_MS) return;
    scatterWheelLastRef.current = now;
    if (event.deltaY > 0) goToImageByOffset(1);
    else if (event.deltaY < 0) goToImageByOffset(-1);
  };

  const handleClose = () => {
    setIsClosing(true);
    window.setTimeout(onClose, 180);
  };

  const closeHeroFullscreen = async () => {
    if (document.fullscreenElement === heroFullscreenFrameRef.current) {
      await document.exitFullscreen?.();
    }
    setIsHeroFullscreen(false);
  };

  const toggleHeroFullscreen = async () => {
    if (document.fullscreenElement === heroFullscreenFrameRef.current || isHeroFullscreen) {
      await closeHeroFullscreen();
      return;
    }
    if (!heroFullscreenFrameRef.current) return;
    try {
      if (heroFullscreenFrameRef.current.requestFullscreen) {
        await heroFullscreenFrameRef.current.requestFullscreen();
      } else {
        setIsHeroFullscreen(true);
      }
    } catch {
      setIsHeroFullscreen(true);
    }
  };

  useEffect(() => { setLang(preferredLanguage); }, [preferredLanguage, id]);
  useEffect(() => { if (id) setIsClosing(false); }, [id]);
  useEffect(() => { setGenerationOpen(Boolean(initialGenerationJobId)); }, [initialGenerationJobId]);

  useEffect(() => {
    if (!id) return;
    setItem(undefined);
    api.item(id).then(setItem);
  }, [id]);

  useEffect(() => {
    const syncHeroFullscreenState = () => setIsHeroFullscreen(document.fullscreenElement === heroFullscreenFrameRef.current);
    document.addEventListener('fullscreenchange', syncHeroFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncHeroFullscreenState);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(undefined), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Load persisted multi-image design choice once on mount.
  const availablePromptRecords = useMemo(() => {
    if (!item) return [];
    return promptDisplayOrder
      .map(promptLanguage => item.prompts.find(prompt => prompt.language === promptLanguage && prompt.text.trim().length > 0))
      .filter((prompt): prompt is NonNullable<typeof prompt> => Boolean(prompt));
  }, [item]);

  useEffect(() => {
    if (!item || !id) return;
    const defaultPromptKey = `${id}:${preferredLanguage}`;
    if (lastDefaultPromptKeyRef.current === defaultPromptKey) return;
    const initialLanguage = resolveInitialPromptLanguage(item.prompts, preferredLanguage);
    const nextPrompt = resolvePromptRecord(availablePromptRecords, initialLanguage, initialLanguage);
    if (nextPrompt) setLang(nextPrompt.language);
    lastDefaultPromptKeyRef.current = defaultPromptKey;
  }, [item, availablePromptRecords, preferredLanguage, id]);

  const uniqueImages = dedupeImages(item?.images || []).filter(image => image.role !== 'reference_image');
  const primaryImage = selectPrimaryImage(uniqueImages);
  const selectedImage = uniqueImages.find(image => image.id === selectedImageId) || primaryImage;
  const selectedImageIndex = selectedImage ? uniqueImages.findIndex(image => image.id === selectedImage.id) : -1;

  useEffect(() => {
    if (!item || uniqueImages.length === 0) {
      setSelectedImageId(undefined);
      return;
    }
    if (!selectedImageId || !uniqueImages.some(image => image.id === selectedImageId)) {
      setSelectedImageId(primaryImage?.id || uniqueImages[0]?.id);
    }
  }, [item?.id, uniqueImages.length, primaryImage?.id, selectedImageId]);

  const filteredTagSuggestions = useMemo(() => {
    if (!item) return [];
    const existing = new Set(item.tags.map(tag => tag.name));
    const query = tagQuery.trim().toLowerCase();
    return tags
      .filter(tag => !existing.has(tag.name) && (!query || tag.name.toLowerCase().includes(query)))
      .slice(0, 8);
  }, [item, tags, tagQuery]);

  if (!id) return null;

  const prompt = item?.prompts.find(promptRecord => promptRecord.language === lang);
  const displayTitle = item ? localizedDemoTitle(item, uiLanguage) : '';
  const originalPrompt = resolveOriginalPrompt(item?.prompts);
  const fallbackLanguage = preferredLanguage === 'origin' ? resolveInitialPromptLanguage(item?.prompts || [], preferredLanguage) : preferredLanguage;
  const resolvedPrompt = resolvePromptRecord(availablePromptRecords, lang, fallbackLanguage);
  const copyText = prompt?.text || resolvedPrompt?.text || resolvePromptText(item?.prompts, preferredLanguage, displayTitle || item?.title || '');
  const toggleFavorite = () => {
    if (!item) return;
    api.favorite(item.id).then(updated => { setItem(updated); onChanged(); });
  };
  const commitInlineUpdate = async (payload: Record<string, unknown>) => {
    if (!item) return;
    const updated = await api.updateItem(item.id, payload);
    setItem(updated);
    onChanged();
  };
  const handleCopyPrompt = async (text = copyText) => {
    const copied = await copyTextToClipboard(text);
    onCopyPrompt(copied);
  };
  const commitPrompt = (language: string, text: string) => {
    if (!item) return;
    const merged = new Map(item.prompts.map(existing => [existing.language, existing.text]));
    if (text.trim()) merged.set(language, text.trim());
    else merged.delete(language);
    const orderedPromptTexts = promptDisplayOrder.map(promptLanguage => ({ promptLanguage, text: merged.get(promptLanguage)?.trim() || '' }));
    const primaryLanguage = orderedPromptTexts.find(nextPrompt => nextPrompt.text)?.promptLanguage;
    const prompts = orderedPromptTexts
      .map(nextPrompt => ({ language: nextPrompt.promptLanguage, text: nextPrompt.text, is_primary: nextPrompt.promptLanguage === primaryLanguage }))
      .filter(nextPrompt => nextPrompt.text);
    commitInlineUpdate({ prompts });
  };
  const startPromptEdit = (language: string, text: string) => {
    setEditingPromptLanguage(language);
    setPromptDraft(text);
  };
  const cancelPromptEdit = () => {
    setEditingPromptLanguage(undefined);
    setPromptDraft('');
  };
  const confirmPromptEdit = () => {
    if (!editingPromptLanguage) return;
    commitPrompt(editingPromptLanguage, promptDraft);
    cancelPromptEdit();
  };
  const unlinkTag = (tagName: string) => {
    if (!item) return;
    commitInlineUpdate({ tags: item.tags.filter(tag => tag.name !== tagName).map(tag => tag.name) });
  };
  const addTag = (tagName: string) => {
    if (!item) return;
    const nextTag = tagName.trim();
    if (!nextTag) return;
    const nextTags = Array.from(new Set([...item.tags.map(tag => tag.name), nextTag]));
    commitInlineUpdate({ tags: nextTags });
    setAddingTag(false);
    setTagQuery('');
  };

  // === Scatter stack swipe (touch + mouse unified via pointer events) ===
  const scatterHasMultiple = uniqueImages.length > 1;
  const SCATTER_COMMIT_THRESHOLD = 90; // px past which a release flips the active image

  const handleScatterPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scatterHasMultiple) return;
    if (isHeroFullscreen) return;
    // Ignore drags that originate from interactive controls (fullscreen button, badges, etc.)
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a, [data-no-swipe="true"]')) return;
    scatterDragStartRef.current = { x: event.clientX, pointerId: event.pointerId };
    setScatterIsDragging(true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
  };

  const handleScatterPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scatterIsDragging || !scatterDragStartRef.current) return;
    const deltaX = event.clientX - scatterDragStartRef.current.x;
    // Clamp so the user cannot over-drag
    const clamped = Math.max(-160, Math.min(160, deltaX));
    setScatterDragX(clamped);
  };

  const endScatterDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scatterIsDragging || !scatterDragStartRef.current) return;
    const deltaX = event.clientX - scatterDragStartRef.current.x;
    setScatterIsDragging(false);
    setScatterDragX(0);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    scatterDragStartRef.current = null;
    if (Math.abs(deltaX) >= SCATTER_COMMIT_THRESHOLD) {
      // Swipe right (positive deltaX) → previous; left (negative) → next
      goToImageByOffset(deltaX > 0 ? -1 : 1);
    }
  };

  const scatterStackImages = (() => {
    if (uniqueImages.length <= 1) return [];
    // Up to 2 non-selected images peek at bottom-left in stacking order.
    // They wrap around the deck so the deck always feels “alive”.
    const next = uniqueImages[(selectedImageIndex + 1) % uniqueImages.length];
    const after = uniqueImages[(selectedImageIndex + 2) % uniqueImages.length];
    const stack: Array<{ image: typeof uniqueImages[number]; depth: 1 | 2 }> = [];
    if (next) stack.push({ image: next, depth: 1 });
    if (after && uniqueImages.length > 2) stack.push({ image: after, depth: 2 });
    return stack;
  })();

  return (
    <div className={`modal-backdrop${isClosing ? ' is-closing' : ''}`} onClick={handleClose}>
      <div className="detail modal polished-modal" onClick={e => e.stopPropagation()}>
        {!item ? (
          <p className="modal-loading">{t('loading')}</p>
        ) : (
          <div className="modal-content-enter" key={item.id}>
            <div className="detail-layout">
              <section className="detail-block-primary">
              <section
                className={`modal-hero is-scatter${scatterIsDragging ? ' is-dragging' : ''}${scatterHasMultiple ? '' : ' is-single'}${isHeroFullscreen ? ' is-mobile-fullscreen' : ''}`}
                ref={scatterSurfaceRef}
                onPointerDown={handleScatterPointerDown}
                onPointerMove={handleScatterPointerMove}
                onPointerUp={endScatterDrag}
                onPointerCancel={endScatterDrag}
                onWheel={handleScatterWheel}
                style={{ '--scatter-drag-x': `${scatterDragX}px` } as React.CSSProperties}
              >
                {selectedImage ? (
                  <>
                    {/* Bottom-left peek stack (smaller, behind) */}
                    <div className="scatter-peek-stack" aria-hidden="true">
                      {scatterStackImages.map(({ image, depth }) => (
                        <div
                          key={`peek-${getImageIdentity(image)}-${depth}`}
                          className={`scatter-peek-card scatter-peek-depth-${depth}${scatterIsDragging ? ' is-peek-dragging' : ''}`}
                          data-no-swipe="true"
                        >
                          <img src={mediaUrl(imageDisplayPath(image))} alt="" draggable={false} />
                        </div>
                      ))}
                    </div>

                    {/* Top-right hero (the live / selected image) */}
                    <div
                      ref={heroFullscreenFrameRef}
                      className={`scatter-hero-frame detail-fullscreen-frame${isHeroFullscreen ? ' is-mobile-fullscreen' : ''}${scatterIsDragging ? ' is-hero-dragging' : ''}`}
                    >
                      <img
                        ref={heroImageRef}
                        className="hero-image"
                        src={mediaUrl(isHeroFullscreen ? imageOriginalPath(selectedImage) : imageHeroPath(selectedImage))}
                        alt={displayTitle || item.title}
                        draggable={false}
                      />
                      <button className="modal-icon-button detail-fullscreen-close" type="button" onClick={closeHeroFullscreen} aria-label="Close fullscreen" data-no-swipe="true"><X size={20} strokeWidth={2.25} /></button>
                    </div>

                    {uniqueImages.length > 1 && <span className="image-counter" data-no-swipe="true">{selectedImageIndex + 1} / {uniqueImages.length}</span>}
                    {isReferenceImage(selectedImage) && <span className="image-role-badge" data-no-swipe="true">Reference</span>}
                    <button className="modal-icon-button detail-fullscreen-overlay" type="button" onClick={toggleHeroFullscreen} aria-label="View fullscreen" title="View fullscreen" data-no-swipe="true">
                      <Maximize2 size={20} strokeWidth={2.25} />
                    </button>
                  </>
                ) : (
                  <div className="placeholder hero-image" data-no-swipe="true">{t('noImage')}</div>
                )}
                <div className="mobile-hero-actions" aria-label={t('itemActions')} data-no-swipe="true">
                  <button className="modal-icon-button mobile-hero-close" onClick={handleClose} aria-label={t('close')}>
                    <X size={20} strokeWidth={2.25} />
                  </button>
                  {showMutations && (
                    <span className="mobile-hero-primary-actions">
                      <button className="modal-icon-button favorite-button" onClick={toggleFavorite} aria-label={item.favorite ? t('saved') : t('favorite')}>
                        <Heart size={18} fill={item.favorite ? 'currentColor' : 'none'} />
                      </button>
                      <button className="modal-icon-button edit-button" onClick={() => onEdit?.(item)} aria-label={t('edit')}>
                        <Pencil size={18} />
                      </button>
                      <button className="modal-icon-button detail-delete-button" onClick={() => onDelete?.(item)} aria-label={t('deleteReference')} title={t('deleteReference')}>
                        <Trash2 size={18} />
                      </button>
                      {canGenerate && <button className="modal-icon-button mobile-generate-variant-button" onClick={() => setGenerationOpen(true)} aria-label="Generate variant">
                        <Plus size={18} />
                        <span className="mobile-generate-variant-label">Generate variant</span>
                      </button>}
                    </span>
                  )}
                </div>
              </section>

              <aside className="detail-side">
                <div className="detail-side-actions">
                  <span className="detail-side-primary-actions">
                    {showMutations && canGenerate && <button className="secondary generate-variant-button" onClick={() => setGenerationOpen(true)}>Generate variant</button>}
                    {selectedImage && <button type="button" className="modal-icon-button download-button" onClick={async () => { try { await downloadImageAsJpeg(displayTitle || item.title, mediaUrl(selectedImage.original_path || imageHeroPath(selectedImage))); api.products.trackImage(selectedImage.id, 'download'); } catch (e) { /* 静默 */ } }} aria-label="Download" title="Download"><Download size={18} /></button>}
                    {showMutations && <button className="modal-icon-button favorite-button" onClick={toggleFavorite} aria-label={item.favorite ? t('saved') : t('favorite')}>
                      <Heart size={18} fill={item.favorite ? 'currentColor' : 'none'} />
                    </button>}
                    {showMutations && <button className="modal-icon-button edit-button" onClick={() => onEdit?.(item)} aria-label={t('edit')}>
                      <Pencil size={18} />
                    </button>}
                    {showMutations && <button className="modal-icon-button detail-delete-button" onClick={() => onDelete?.(item)} aria-label={t('deleteReference')} title={t('deleteReference')}>
                      <Trash2 size={18} />
                    </button>}
                  </span>
                  <button className="modal-icon-button close" onClick={handleClose} aria-label={t('close')}>
                    <X size={20} strokeWidth={2.25} />
                  </button>
                </div>
                <InlineEditableField className="collection-inline-edit" value={item.cluster?.name || ''} placeholder={t('unclustered')} inputList="detail-collection-suggestions" onCommit={value => commitInlineUpdate({ cluster_name: value.trim() || null })} editable={showMutations}>
                  <datalist id="detail-collection-suggestions">
                    {clusters.map(collection => <option key={collection.id} value={collection.name} />)}
                  </datalist>
                </InlineEditableField>
                <h2>
                  <InlineEditableField className="title-inline-edit" value={showMutations ? item.title : (displayTitle || item.title)} placeholder={t('titlePlaceholder')} onCommit={value => commitInlineUpdate({ title: value.trim() || item.title })} editable={showMutations} />
                </h2>
                <p className="muted metadata-row">
                  <InlineEditableField className="metadata-inline-edit" value={item.model || t('defaultModel')} placeholder={t('imageGeneratedFrom')} onCommit={value => commitInlineUpdate({ model: value.trim() || item.model })} editable={showMutations} />
                  <span>·</span>
                  <InlineEditableField className="metadata-inline-edit" value={`@${item.author || 'User'}`} placeholder="@User" onCommit={value => commitInlineUpdate({ author: value.replace(/^@/, '').trim() || 'User' })} editable={showMutations} />
                  {item.source_url && (
                    <a className="source-icon-link" href={item.source_url} target="_blank" rel="noreferrer" aria-label={t('source')}>
                      <ExternalLink size={16} />
                    </a>
                  )}
                </p>

                <InlineEditableTextArea className="notes-inline-edit" value={item.notes || ''} placeholder={t('addNote')} onCommit={value => commitInlineUpdate({ notes: value.trim() || null })} editable={showMutations} />

                <div className="tags detail-tags">
                  {item.tags.map(tag => (
                    <span className="detail-tag-chip" key={tag.id}>#{tag.name}{showMutations && <button type="button" className="tag-unlink-button" onClick={() => unlinkTag(tag.name)} aria-label={`Remove ${tag.name}`}><X size={12} /></button>}</span>
                  ))}
                  {showMutations && (addingTag ? (
                    <span className="tag-add-popover">
                      <input className="tag-add-input" autoFocus value={tagQuery} onChange={event => setTagQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addTag(tagQuery); if (event.key === 'Escape') setAddingTag(false); }} placeholder={t('tags')} />
                      <button type="button" className="inline-edit-confirm" onClick={() => addTag(tagQuery)}><Check size={12} /></button>
                      <button type="button" className="inline-edit-cancel" onClick={() => setAddingTag(false)}><X size={12} /></button>
                      {filteredTagSuggestions.length > 0 && <span className="tag-add-suggestions">{filteredTagSuggestions.map(tag => <button type="button" key={tag.id} onClick={() => addTag(tag.name)}>#{tag.name}</button>)}</span>}
                    </span>
                  ) : (
                    <button type="button" className="add-tag-chip" onClick={() => setAddingTag(true)} aria-label={t('tags')}><Plus size={14} /></button>
                  ))}
                </div>

                <div className="prompt-blocks" aria-label={t('promptLanguage')}>
                  {(() => {
                    return (
                      <section className="prompt-block prompt-panel active">
                        <header className="prompt-block-header">
                          <div className="prompt-language-tabs tabs" role="tablist" aria-label={t('promptLanguage')}>
                            {promptDisplayOrder.map(promptLanguage => {
                              const tabPrompt = item.prompts.find(prompt => prompt.language === promptLanguage);
                              const isOriginalPrompt = Boolean(tabPrompt?.is_original || originalPrompt?.language === promptLanguage);
                              return (
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={lang === promptLanguage}
                                  className={`prompt-language-tab ${lang === promptLanguage ? 'active' : ''} ${isOriginalPrompt ? 'is-original' : ''}`}
                                  onClick={() => { setLang(promptLanguage); cancelPromptEdit(); }}
                                  title={tabPrompt?.text.trim() ? undefined : t('promptText')}
                                  key={promptLanguage}
                                >
                                  提示词模板
                                  {isOriginalPrompt && <span className="origin-badge">{t('origin')}</span>}
                                </button>
                              );
                            })}
                          </div>
                          <span className="prompt-block-actions">
                            <button type="button" className="prompt-copy-icon" onClick={() => handleCopyPrompt(prompt?.text || '')} aria-label={t('copyPrompt')} disabled={!prompt?.text}>
                              <Copy size={15} />
                            </button>
                            {showMutations && <button type="button" className="prompt-edit-icon" onClick={() => startPromptEdit(lang, prompt?.text || '')} aria-label={t('edit')}>
                              <Pencil size={15} />
                            </button>}
                          </span>
                        </header>
                        <div className="prompt-panel-body">
                          {editingPromptLanguage === lang ? (
                            <>
                              <textarea
                                className="prompt-edit-textarea"
                                value={promptDraft}
                                placeholder={t('promptText')}
                                autoFocus
                                onChange={event => setPromptDraft(event.target.value)}
                                onKeyDown={event => {
                                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') confirmPromptEdit();
                                  if (event.key === 'Escape') cancelPromptEdit();
                                }}
                              />
                              <span className="prompt-edit-controls">
                                <button type="button" className="inline-edit-confirm" onClick={confirmPromptEdit} aria-label="Confirm edit"><Check size={14} /></button>
                                <button type="button" className="inline-edit-cancel" onClick={cancelPromptEdit} aria-label="Cancel edit"><X size={14} /></button>
                              </span>
                            </>
                          ) : (
                            <div className={`prompt-inline-edit ${prompt?.text ? '' : 'notes-empty'} ${showMutations ? '' : 'is-read-only'}`} onDoubleClick={() => { if (showMutations) startPromptEdit(lang, prompt?.text || ''); }} tabIndex={showMutations ? 0 : undefined} onKeyDown={event => { if (showMutations && event.key === 'Enter') startPromptEdit(lang, prompt?.text || ''); }}>
                              {prompt?.text ? <p>{prompt.text}</p> : <span className="add-note-affordance">{t('promptText')}</span>}
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })()}
                </div>
              </aside>

              </section>

              <section className="detail-block-composer">
              <PromptComposer
                item={item}
                currentPrompt={prompt}
                promptLanguage={lang}
                t={t}
                onCommitted={onChanged}
                onPromptCopied={onCopyPrompt}
              />
              </section>
            </div>
          </div>
        )}
        {toast && (
          <div className="toast generation-toast" role="status">
            <span>{toast.message}</span>
            {toast.item && toast.actionLabel && (
              <button type="button" onClick={() => { setItem(toast.item); setToast(undefined); setGenerationOpen(false); }}>
                {toast.actionLabel}
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => setToast(undefined)}><X size={20} strokeWidth={2.25} /></button>
          </div>
        )}
        {generationOpen && item && (
          <GenerationPanel
            item={item}
            preferredLanguage={preferredLanguage}
            t={t}
            initialJobId={initialGenerationJobId}
            clusters={clusters}
            tags={tags}
            promptVariablesEnabled={promptVariablesEnabled}
            onClose={() => setGenerationOpen(false)}
            onAccepted={(acceptedItem, message) => {
              if (acceptedItem?.id && acceptedItem.id !== item.id) {
                setToast({ message: message || 'New variant item created', actionLabel: 'View item', item: acceptedItem });
                onChanged();
                onOpenItem?.(acceptedItem.id);
                return;
              }
              api.item(item.id).then(updated => {
                setItem(updated);
                const newestImage = updated.images[0];
                if (newestImage) setSelectedImageId(newestImage.id);
              }).catch(() => undefined);
              setToast({ message: message || 'Image added to item' });
              onChanged();
            }}
          />
        )}
      </div>
    </div>
  );
}
