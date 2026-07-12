import type { ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';
import type { MultiImageViewerProps } from './types';

/**
 * DemoFrame
 * ---------
 * A thin wrapper that every gallery implementation composes with. It owns
 * the chrome that should look identical across all four schemes:
 *   • counter badge (top-left)
 *   • reference-role badge (top-left)
 *   • fullscreen toggle (top-right)
 *   • fullscreen close button (only when fullscreen)
 *
 * The mobile action dock (favorite/edit/delete/download/generate) is
 * intentionally NOT rendered here — those live in the side panel of
 * `ItemDetailModal.tsx` and are wired to the same `selectedIndex` so the
 * master sees one set of affordances that always reflects the active image.
 */
export default function DemoFrame({
  images,
  selectedIndex,
  children,
  isHeroFullscreen,
  onCloseHeroFullscreen,
  onToggleHeroFullscreen,
}: MultiImageViewerProps & { children: ReactNode }) {
  const selected = images[selectedIndex] || images[0];
  const isReference = selected?.role === 'reference_image';

  return (
    <div className={`multi-image-frame${isHeroFullscreen ? ' is-mobile-fullscreen' : ''}`}>
      {children}

      {images.length > 1 && !isHeroFullscreen && (
        <span className="image-counter" data-no-swipe="true">
          {selectedIndex + 1} / {images.length}
        </span>
      )}
      {isReference && !isHeroFullscreen && (
        <span className="image-role-badge" data-no-swipe="true">Reference</span>
      )}

      <button
        className="modal-icon-button detail-fullscreen-overlay"
        type="button"
        onClick={onToggleHeroFullscreen}
        aria-label="View fullscreen"
        title="View fullscreen"
        data-no-swipe="true"
      >
        <Maximize2 size={20} strokeWidth={2.25} />
      </button>

      {isHeroFullscreen && (
        <button
          className="modal-icon-button detail-fullscreen-close"
          type="button"
          onClick={onCloseHeroFullscreen}
          aria-label="Close fullscreen"
          data-no-swipe="true"
        >
          <X size={20} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}