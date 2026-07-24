import type { MouseEvent } from 'react';
import { api } from '../api/client';
import { Check, Copy, Download, Heart, Pencil, Star } from 'lucide-react';
import { mediaUrl } from '../api/client';
import type { ImageRecord, ItemSummary } from '../types';
import { downloadFileName, downloadImageAsJpeg, imageDisplayPath, imageThumbnailPath, selectPrimaryImage } from '../utils/images';
import type { Translator } from '../utils/i18n';

const STACK_PREVIEW_COUNT = 4; // 卡片堆叠最多 4 张, 超出显示 +N

export default function ItemCard({
  item,
  t,
  onOpen,
  onFavorite,
  onEdit,
  onToggleSelection,
  onCopyPrompt,
  showActions = true,
  isSelecting = false,
  isSelected = false,
}: {
  item: ItemSummary;
  t: Translator;
  onOpen: (id: string) => void;
  onFavorite?: (id: string) => void;
  onEdit?: (item: ItemSummary) => void;
  onToggleSelection?: (id: string) => void;
  onCopyPrompt: (item: ItemSummary) => void;
  showActions?: boolean;
  isSelecting?: boolean;
  isSelected?: boolean;
}) {
  // 多图堆叠: 优先用 item.images, 降级用 [item.first_image]
  const allImages: ImageRecord[] = (item.images && item.images.length > 0)
    ? item.images
    : (item.first_image ? [item.first_image] : []);
  const stackImages = allImages.slice(0, STACK_PREVIEW_COUNT);
  const overflow = allImages.length - STACK_PREVIEW_COUNT;
  const hasMultiple = stackImages.length > 1;
  const totalImages = allImages.length;
  
  const primaryImage = selectPrimaryImage(stackImages);
  const imagePath = imageDisplayPath(primaryImage);
  const imageAspectRatio = primaryImage?.width && primaryImage?.height
    ? `${primaryImage.width} / ${primaryImage.height}`
    : undefined;
  const hasTemplateTag = item.tags.some(tag => tag.name === 'template');
  const copyPrompt = (event: MouseEvent) => {
    event.stopPropagation();
    onCopyPrompt(item);
  };
  const favorite = (event: MouseEvent) => {
    event.stopPropagation();
    onFavorite?.(item.id);
  };
  const edit = (event: MouseEvent) => {
    event.stopPropagation();
    onEdit?.(item);
  };
  const toggleSelection = (event?: MouseEvent) => {
    event?.stopPropagation();
    onToggleSelection?.(item.id);
  };

  return (
    <article className={`item-card ${item.favorite ? 'is-favorite' : ''} ${isSelecting ? 'is-selecting' : ''} ${isSelected ? 'is-selected' : ''}`} style={{ breakInside: 'avoid' }} onClick={() => isSelecting ? toggleSelection() : onOpen(item.id)}>
      {stackImages.length > 0 ? (
        <div className={`card-image-frame ${imageAspectRatio ? 'has-reserved-ratio' : 'natural-ratio'}`} style={{ aspectRatio: imageAspectRatio }}>
          <div className="item-image-stack">
            {stackImages.map((img, i) => (
              <img
                key={img.id}
                src={mediaUrl(imageThumbnailPath(img))}
                loading="lazy"
                decoding="async"
                width={img.width || undefined}
                height={img.height || undefined}
                alt=""
                className={`item-stack-img ${i === 0 ? 'is-cover' : ''}`}
              />
            ))}
          </div>
          {totalImages > 1 && (
            <div className="item-image-count-badge">
              <Star size={10} fill="currentColor" className="star" />
              <span>{totalImages}</span>
            </div>
          )}
        </div>
      ) : <div className="placeholder">{t('noImage')}</div>}
      <div className="card-body">
        <h3>{item.title}</h3>
      </div>
      {hasTemplateTag && <span className="card-template-badge" aria-label="Template prompt">Template</span>}
      {isSelecting && (
        <button className="card-select-action" type="button" onClick={toggleSelection} aria-label={isSelected ? 'Deselect reference' : 'Select reference'} aria-pressed={isSelected}>
          <span className="selection-check">{isSelected && <Check size={15} />}</span>
        </button>
      )}
      {!isSelecting && <div className="card-actions" aria-label={t('itemActions')}>
        <button className="hover-action" onClick={copyPrompt} aria-label={t('copyPrompt')} title={t('copyPrompt')}><Copy size={15} /></button>
        {primaryImage && imagePath && <button type="button" className="hover-action" onClick={async event => { event.stopPropagation(); try { await downloadImageAsJpeg(item.title, mediaUrl(primaryImage.original_path || imagePath)); api.products.trackImage(primaryImage.id, 'download'); } catch (e) { /* 静默 */ } }} aria-label="Download" title="Download"><Download size={15} /></button>}
        {showActions && onFavorite && <button className="hover-action" onClick={favorite} aria-label={item.favorite ? t('saved') : t('favorite')} title={item.favorite ? t('saved') : t('favorite')}><Heart size={15} fill={item.favorite ? 'currentColor' : 'none'} /></button>}
        {showActions && onEdit && <button className="hover-action" onClick={edit} aria-label={t('edit')} title={t('edit')}><Pencil size={15} /></button>}
      </div>}
    </article>
  );
}
