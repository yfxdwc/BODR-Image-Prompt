import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Star, Trash2, Upload, X } from 'lucide-react';
import { api } from '../api/client';
import type { ClusterRecord, DraftImage, ImageRecord, ItemDetail, TagRecord, UploadImageRole } from '../types';
import type { Translator } from '../utils/i18n';

function promptText(item: ItemDetail | undefined, language: string) {
  return item?.prompts.find(prompt => prompt.language === language)?.text || '';
}

function initialTraditionalPrompt(item: ItemDetail | undefined) {
  return promptText(item, 'zh_hant') || promptText(item, 'original');
}

function initialOriginalLanguage(item: ItemDetail | undefined) {
  const original = item?.prompts.find(prompt => prompt.is_original);
  if (original?.language === 'en' || original?.language === 'zh_hant' || original?.language === 'zh_hans') return original.language;
  return 'en';
}

function promptProvenance(language: string, originalLanguage: string) {
  if (language === originalLanguage) return { kind: 'manual', source_language: language, derived_from: null, method: null };
  return { kind: 'manual', source_language: originalLanguage, derived_from: originalLanguage, method: null };
}

const MAX_RESULT_IMAGES = 9;
const MAX_REFERENCE_IMAGES = 4;

type ImageSection = 'result' | 'reference';

function emptyDraft(): DraftImage {
  return { previewUrl: '', role: 'result_image', name: '' };
}

function buildDraftFromExisting(images: ImageRecord[] | undefined, role: UploadImageRole): DraftImage[] {
  if (!images) return [];
  return images
    .filter(img => img.role === role)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(img => ({
      id: img.id,
      previewUrl: img.preview_path || img.thumb_path || img.original_path,
      role,
      name: img.original_path?.split('/').pop() || img.id,
    }));
}

export default function ItemEditorModal({
  item,
  t,
  clusters,
  tags: existingTags,
  onClose,
  onSaved,
  onDeleted,
}: {
  item?: ItemDetail;
  t: Translator;
  clusters: ClusterRecord[];
  tags: TagRecord[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(item?.title || '');
  const [model, setModel] = useState(item?.model || 'ChatGPT');
  const [author, setAuthor] = useState(item?.author || 'User');
  const [sourceUrl, setSourceUrl] = useState(item?.source_url || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [cluster, setCluster] = useState(item?.cluster?.name || '');
  const [tags, setTags] = useState(item?.tags.map(t => t.name).join(', ') || '');
  const [zhHantPrompt, setZhHantPrompt] = useState(initialTraditionalPrompt(item));
  const [zhHansPrompt, setZhHansPrompt] = useState(promptText(item, 'zh_hans'));
  const [englishPrompt, setEnglishPrompt] = useState(promptText(item, 'en'));
  const [originalLanguage, setOriginalLanguage] = useState(initialOriginalLanguage(item));

  // 多图草稿: 已存在图 (id) + 新选文件 (file)
  const [resultImages, setResultImages] = useState<DraftImage[]>(() => buildDraftFromExisting(item?.images, 'result_image'));
  const [referenceImages, setReferenceImages] = useState<DraftImage[]>(() => buildDraftFromExisting(item?.images, 'reference_image'));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [limitWarning, setLimitWarning] = useState('');

  const resultInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const resultDropRef = useRef<HTMLDivElement>(null);
  const referenceDropRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setIsClosing(true);
    // 释放预览 URL
    resultImages.forEach(img => { if (img.file) URL.revokeObjectURL(img.previewUrl); });
    referenceImages.forEach(img => { if (img.file) URL.revokeObjectURL(img.previewUrl); });
    window.setTimeout(onClose, 180);
  };

  // 卸载时清理预览 URL
  useEffect(() => () => {
    resultImages.forEach(img => { if (img.file) URL.revokeObjectURL(img.previewUrl); });
    referenceImages.forEach(img => { if (img.file) URL.revokeObjectURL(img.previewUrl); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasExistingResultImage = (item?.images || []).some(image => image.role === 'result_image');
  const hasResultInDraft = resultImages.length > 0;
  const hasPrompt = Boolean(zhHantPrompt.trim() || zhHansPrompt.trim() || englishPrompt.trim());
  const missingRequiredImage = !hasExistingResultImage && !hasResultInDraft;

  const filteredClusters = useMemo(() => {
    const query = cluster.trim().toLowerCase();
    if (!query) return clusters.slice(0, 8);
    return clusters.filter(c => c.name.toLowerCase().includes(query)).slice(0, 8);
  }, [cluster, clusters]);

  const filteredTags = useMemo(() => {
    const selected = new Set(tags.split(',').map(t => t.trim()).filter(Boolean));
    const query = tags.split(',').pop()?.trim().toLowerCase() || '';
    return existingTags
      .filter(tag => !selected.has(tag.name) && (!query || tag.name.toLowerCase().includes(query)))
      .slice(0, 10);
  }, [tags, existingTags]);

  const addSuggestedTag = (tagName: string) => {
    const parts = tags.split(',').map(t => t.trim()).filter(Boolean);
    const selected = new Set(parts);
    selected.add(tagName);
    setTags(Array.from(selected).join(', '));
  };

  // === 文件选择 (多张) ===
  const addFiles = (files: FileList | File[], section: ImageSection) => {
    const role: UploadImageRole = section === 'result' ? 'result_image' : 'reference_image';
    const limit = section === 'result' ? MAX_RESULT_IMAGES : MAX_REFERENCE_IMAGES;
    const setter = section === 'result' ? setResultImages : setReferenceImages;
    const current = section === 'result' ? resultImages : referenceImages;
    const incoming = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!incoming.length) return;
    const slots = limit - current.length;
    if (slots <= 0) {
      setLimitWarning(t('imageLimitReached') + ` (${t(section === 'result' ? 'resultImages' : 'referenceImages')}: ${limit})`);
      window.setTimeout(() => setLimitWarning(''), 3500);
      return;
    }
    const accepted = incoming.slice(0, slots);
    const dropped = incoming.length - accepted.length;
    if (dropped > 0) {
      setLimitWarning(t('imageLimitReached') + ` (${t(section === 'result' ? 'resultImages' : 'referenceImages')}: ${limit})`);
      window.setTimeout(() => setLimitWarning(''), 3500);
    }
    const drafts: DraftImage[] = accepted.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      role,
      name: file.name,
    }));
    setter([...current, ...drafts]);
  };

  const removeDraft = (section: ImageSection, index: number) => {
    const setter = section === 'result' ? setResultImages : setReferenceImages;
    setter(prev => {
      const target = prev[index];
      if (target?.file) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  // === 拖拽排序 (HTML5) ===
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const onDragStart = (section: ImageSection, index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${section}:${index}`);
  };
  const onDragOver = (section: ImageSection, index: number) => (e: React.DragEvent) => {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };
  const onDragLeave = () => setDragOverIndex(null);
  const onDrop = (section: ImageSection, index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverIndex(null);
    const from = dragIndex;
    setDragIndex(null);
    if (from === null || from === index) return;
    const setter = section === 'result' ? setResultImages : setReferenceImages;
    setter(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
  };
  const onDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // === 保存 ===
  const save = async () => {
    if (!title.trim() || !hasPrompt || missingRequiredImage) return;
    setSaving(true);
    setSaveError('');
    try {
      const promptDrafts = [
        { language: 'en', text: englishPrompt.trim(), is_primary: true },
        { language: 'zh_hant', text: zhHantPrompt.trim(), is_primary: !englishPrompt.trim() },
        { language: 'zh_hans', text: zhHansPrompt.trim(), is_primary: !englishPrompt.trim() && !zhHantPrompt.trim() },
      ];
      const availableOriginal = promptDrafts.find(prompt => prompt.language === originalLanguage && prompt.text)
        ? originalLanguage
        : promptDrafts.find(prompt => prompt.text)?.language || originalLanguage;
      const prompts = promptDrafts
        .filter(prompt => prompt.text)
        .map(prompt => ({
          ...prompt,
          is_original: prompt.language === availableOriginal,
          provenance: promptProvenance(prompt.language, availableOriginal),
        }));
      const payload = {
        title: title.trim(),
        model: model.trim() || undefined,
        author: author.trim() || 'User',
        source_url: sourceUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        cluster_name: cluster.trim() || undefined,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        prompts,
      };
      const resultFiles = resultImages.filter(d => d.file).map(d => d.file!) as File[];
      const referenceFiles = referenceImages.filter(d => d.file).map(d => d.file!) as File[];
      const isNew = !item;
      // 一次性 multipart 提交 (cc 兜底, OH 卡 33min 没写完)
      const saved = isNew
        ? await api.createItemMultipart(payload as any, resultFiles, referenceFiles)
        : await api.updateItemMultipart(item!.id, payload as any, resultFiles, referenceFiles);
      // 编辑模式 + 拖拽改变了已有图顺序: 持久化新顺序
      if (!isNew) {
        const existingIds = resultImages.filter(d => d.id).map(d => d.id!);
        const newResultIds = saved.images
          .filter(img => img.role === 'result_image')
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(img => img.id);
        // 比对: 本地草稿顺序的 id 列表 vs 后端新顺序, 不一致就 PUT reorder
        const localIdOrder = resultImages.map(d => d.id).filter(Boolean) as string[];
        const sameOrder = localIdOrder.length === newResultIds.length &&
          localIdOrder.every((id, i) => id === newResultIds[i]);
        if (localIdOrder.length > 1 && !sameOrder) {
          // 拼接: 本地草稿的 id 顺序 + 后端新增的 id
          const newOnlyIds = newResultIds.filter(id => !localIdOrder.includes(id));
          const finalOrder = [...localIdOrder, ...newOnlyIds];
          try {
            await api.reorderItemImages(saved.id, finalOrder);
          } catch (e) {
            // 顺序同步失败不阻塞保存
            // 2026-07-12 主人拍: 顺序同步失败不阻塞主流程, 仅 dev console 可见.
            // 上层无 toast 通道; 若需要通知, 加 onSaveSuccess/error 回调.
            if (typeof console !== 'undefined') console.warn('[ItemEditorModal] reorder failed:', e);
          }
        }
      }
      onSaved();
      handleClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // === 编辑模式: 删已有图走独立 API ===
  const removeExistingImage = async (section: ImageSection, imageId: string) => {
    if (!item) return;
    if (!confirm(t('deleteConfirm'))) return;
    try {
      await api.deleteItemImage(item.id, imageId);
      const setter = section === 'result' ? setResultImages : setReferenceImages;
      setter(prev => prev.filter(d => d.id !== imageId));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t('saveFailed'));
    }
  };

  // === 编辑模式: 整卡片删除 ===
  const deleteReference = async () => {
    if (!item) return;
    if (!confirm(t('deleteReferenceConfirm'))) return;
    setDeleting(true);
    try {
      await api.deleteItem(item.id);
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  // === 渲染缩略图网格 ===
  const renderImageSection = (section: ImageSection) => {
    const drafts = section === 'result' ? resultImages : referenceImages;
    const limit = section === 'result' ? MAX_RESULT_IMAGES : MAX_REFERENCE_IMAGES;
    const isResult = section === 'result';
    const inputRef = isResult ? resultInputRef : referenceInputRef;
    const dropRef = isResult ? resultDropRef : referenceDropRef;
    const role: UploadImageRole = isResult ? 'result_image' : 'reference_image';
    return (
      <div className="image-section">
        <div className="image-section-head">
          <strong>{t(isResult ? 'resultImages' : 'referenceImages')}</strong>
          <span className="image-count">{drafts.length} / {limit}</span>
        </div>
        <div className="image-grid" ref={dropRef}>
          {drafts.map((d, i) => (
            <div
              key={d.id || `${d.file?.name || 'draft'}-${i}`}
              className={`image-thumb ${i === 0 && isResult ? 'is-cover' : ''} ${dragOverIndex === i ? 'drag-over' : ''} ${dragIndex === i ? 'dragging' : ''}`}
              draggable
              onDragStart={onDragStart(section, i)}
              onDragOver={onDragOver(section, i)}
              onDragLeave={onDragLeave}
              onDrop={onDrop(section, i)}
              onDragEnd={onDragEnd}
              data-role={role}
            >
              <img src={d.previewUrl} alt={d.name} />
              {i === 0 && isResult && (
                <span className="cover-badge" title={t('coverBadge')}>
                  <Star size={12} fill="currentColor" /> {t('coverBadge')}
                </span>
              )}
              {isResult && i > 0 && (
                <button
                  type="button"
                  className="thumb-action set-cover"
                  title={t('setAsCover')}
                  onClick={() => {
                    setResultImages(prev => {
                      const next = [...prev];
                      const [m] = next.splice(i, 1);
                      next.unshift(m);
                      return next;
                    });
                  }}
                >
                  <Star size={12} />
                </button>
              )}
              <button
                type="button"
                className="thumb-action remove"
                title={t('removeImage')}
                onClick={() => {
                  if (d.id && item) removeExistingImage(section, d.id);
                  else removeDraft(section, i);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {drafts.length < limit && (
            <button
              type="button"
              className="image-add-tile"
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={e => {
                e.preventDefault();
                if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, section);
              }}
            >
              <Upload size={20} />
              <span>{t('uploadImage')}</span>
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files?.length) addFiles(e.target.files, section);
            e.target.value = '';
          }}
        />
        <p className="image-hint">
          {isResult ? t('dragToReorder') : t('multiImageUploadHint')}
        </p>
      </div>
    );
  };

  return (
    <div className={`modal-backdrop${isClosing ? ' is-closing' : ''}`} onClick={handleClose}>
      <div className="editor modal polished-modal" onClick={event => event.stopPropagation()}>
        <button className="close" onClick={handleClose} aria-label={t('close')}>
          <X size={20} strokeWidth={2.25} />
        </button>
        <div className="editor-head">
          <p className="modal-kicker">{item ? t('updateReference') : t('newReference')}</p>
          <h2>{item ? t('editPromptCard') : t('addPromptCard')}</h2>
          <p>{t('editorHelp')}</p>
        </div>

        <div className="editor-grid">
          <label className="field field-title">
            <span>{t('title')}</span>
            <input placeholder={t('titlePlaceholder')} value={title} onChange={e => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('collection')}</span>
            <input list="collection-suggestions" placeholder={t('collectionPlaceholder')} value={cluster} onChange={e => setCluster(e.target.value)} />
            <datalist id="collection-suggestions">
              {filteredClusters.map(collection => <option key={collection.id} value={collection.name} />)}
            </datalist>
          </label>
          <label className="field">
            <span>{t('imageGeneratedFrom')}</span>
            <input placeholder={t('defaultModel')} value={model} onChange={e => setModel(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('author')}</span>
            <input placeholder="User" value={author} onChange={e => setAuthor(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('sourceUrl')}</span>
            <input type="url" placeholder="https://…" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
          </label>
          <label className="field tag-field">
            <span>{t('tags')}</span>
            <input list="tag-suggestions" placeholder={t('tagsPlaceholder')} value={tags} onChange={e => setTags(e.target.value)} />
            <datalist id="tag-suggestions">
              {filteredTags.map(tag => <option key={tag.id} value={tag.name} />)}
            </datalist>
            {filteredTags.length > 0 && (
              <div className="tag-suggestions" aria-label={t('existingTagSuggestions')}>
                {filteredTags.map(tag => <button type="button" key={tag.id} onClick={() => addSuggestedTag(tag.name)}>#{tag.name}</button>)}
              </div>
            )}
          </label>
          <label className="field prompt-field">
            <span className="prompt-field-title">{t('simplifiedChinesePrompt')} <button type="button" className={`origin-marker ${originalLanguage === 'zh_hans' ? 'active' : ''}`} onClick={() => setOriginalLanguage('zh_hans')}>{originalLanguage === 'zh_hans' ? t('origin') : t('markAsOriginal')}</button></span>
            <textarea placeholder={t('simplifiedPromptPlaceholder')} value={zhHansPrompt} onChange={e => setZhHansPrompt(e.target.value)} />
          </label>
          <label className="field prompt-field">
            <span className="prompt-field-title">{t('traditionalChinesePrompt')} <button type="button" className={`origin-marker ${originalLanguage === 'zh_hant' ? 'active' : ''}`} onClick={() => setOriginalLanguage('zh_hant')}>{originalLanguage === 'zh_hant' ? t('origin') : t('markAsOriginal')}</button></span>
            <textarea placeholder={t('traditionalPromptPlaceholder')} value={zhHantPrompt} onChange={e => setZhHantPrompt(e.target.value)} />
          </label>
          <label className="field prompt-field">
            <span className="prompt-field-title">{t('englishPrompt')} <button type="button" className={`origin-marker ${originalLanguage === 'en' ? 'active' : ''}`} onClick={() => setOriginalLanguage('en')}>{originalLanguage === 'en' ? t('origin') : t('markAsOriginal')}</button></span>
            <textarea placeholder={t('englishPromptPlaceholder')} value={englishPrompt} onChange={e => setEnglishPrompt(e.target.value)} />
          </label>
          <label className="field prompt-field">
            <span>{t('notes')}</span>
            <textarea placeholder={t('addNote')} value={notes} onChange={e => setNotes(e.target.value)} />
          </label>

          <div className="image-upload-row">
            {renderImageSection('result')}
            {renderImageSection('reference')}
          </div>
        </div>

        {limitWarning && <p className="form-warning" role="alert">{limitWarning}</p>}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}

        <div className="editor-actions">
          {item && <button className="danger" disabled={deleting || saving} onClick={deleteReference}><Trash2 size={16} /> {t('deleteReference')}</button>}
          <button className="secondary" onClick={handleClose}>{t('cancel')}</button>
          <button className="primary" disabled={!title.trim() || !hasPrompt || missingRequiredImage || saving || deleting} onClick={save}>{saving ? t('saving') : t('saveReference')}</button>
        </div>
      </div>
    </div>
  );
}
