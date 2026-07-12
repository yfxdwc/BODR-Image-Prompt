import { useCallback, useEffect, useRef } from 'react';
import { mediaUrl } from '../../api/client';
import { imageHeroPath, imageOriginalPath, imageThumbnailPath } from '../../utils/images';
import DemoFrame from './DemoFrame';
import type { MultiImageViewerProps } from './types';

/**
 * Scheme 3 — Apple Photos.app style
 * ----------------------------------
 * Layout:
 *   ┌──────────────────────────┬──────────┐
 *   │                          │  [thumb] │
 *   │                          │  [thumb] │ ← vertical column
 *   │      Full-bleed image    │  [thumb] │   of thumbnails
 *   │      (object-fit         │  [thumb] │   on the right
 *   │       contain, no pad)   │  [thumb] │
 *   │                          │  [thumb] │
 *   └──────────────────────────┴──────────┘
 *
 * The big image dominates the area; the right-hand rail lists every
 * variant as a small glass thumbnail. Scrolling the rail does not
 * scroll the page (overflow: auto inside the rail).
 *
 * Interactions:
 *   • Click a thumb to jump (and the rail scrolls into view).
 *   • Vertical wheel inside the hero also steps prev/next (matches the
 *     Photos.app "two-finger swipe / wheel" feel).
 *   • ← / → arrow keys for keyboard users.
 *   • Touch swipe still works on the hero.
 *
 * Why this scheme (pros):
 *   • Maximizes the image — there is no chrome eating vertical space.
 *   • Always shows *every* image at a glance; ideal for users with many
 *     variants per item (4+).
 *   • Familiar to anyone who has used Apple Photos, Google Photos, etc.
 *
 * Trade-offs (cons):
 *   • Only works well in a landscape (wide) layout. On phones the rail
 *     collapses to a bottom strip — see the mobile styles.
 *   • The thumbs-on-the-right pattern competes with the right-side
 *     detail panel in BODR Image Prompt's wider modal layout; we mitigate by reserving
 *     the rail inside the gallery container only.
 */
export default function PhotosStyleGallery(props: MultiImageViewerProps) {
  const { images, selectedIndex, onSelectIndex, title, isHeroFullscreen } = props;
  const selected = images[selectedIndex] || images[0];
  const railRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startX: number; pointerId: number } | null>(null);

  const goPrev = useCallback(() => {
    if (images.length <= 1) return;
    onSelectIndex((selectedIndex - 1 + images.length) % images.length);
  }, [images.length, selectedIndex, onSelectIndex]);

  const goNext = useCallback(() => {
    if (images.length <= 1) return;
    onSelectIndex((selectedIndex + 1) % images.length);
  }, [images.length, selectedIndex, onSelectIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isHeroFullscreen) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); goPrev(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); goNext(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); goPrev(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); goNext(); }
  };

  // Vertical wheel on the hero acts like prev/next (only when the wheel
  // is consumed in the rail). Photos.app does this on macOS via the
  // trackpad two-finger swipe.
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (isHeroFullscreen) return;
    if (images.length <= 1) return;
    if (event.deltaY === 0 && event.deltaX === 0) return;
    // Throttle: only react to the dominant axis and ignore small jitters.
    const dominant = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(dominant) < 24) return;
    if (dominant > 0) goNext(); else goPrev();
  };

  // Pointer swipe
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isHeroFullscreen) return;
    if (images.length <= 1) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a, [data-no-swipe="true"], .miv-photos-rail')) return;
    dragStateRef.current = { startX: event.clientX, pointerId: event.pointerId };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    const delta = event.clientX - state.startX;
    dragStateRef.current = null;
    try { event.currentTarget.releasePointerCapture(state.pointerId); } catch { /* noop */ }
    if (Math.abs(delta) >= 60) {
      if (delta > 0) goPrev(); else goNext();
    }
  };

  // Auto-scroll the rail so the active thumb is always visible
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const active = rail.querySelector<HTMLElement>(`[data-rail-index="${selectedIndex}"]`);
    if (!active) return;
    const railRect = rail.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const overflowTop = activeRect.top - railRect.top;
    const overflowBottom = activeRect.bottom - railRect.bottom;
    if (overflowTop < 12) rail.scrollBy({ top: overflowTop - 12, behavior: 'smooth' });
    else if (overflowBottom > -12) rail.scrollBy({ top: overflowBottom + 12, behavior: 'smooth' });
  }, [selectedIndex]);

  return (
    <DemoFrame {...props}>
      <div
        ref={surfaceRef}
        className={`miv-photos${images.length <= 1 ? ' is-single' : ''}`}
        tabIndex={0}
        role="region"
        aria-label="Item image photos-style browser"
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="miv-photos-hero" data-no-swipe="true">
          <img
            className="miv-photos-image"
            src={mediaUrl(isHeroFullscreen ? imageOriginalPath(selected) : imageHeroPath(selected))}
            alt={title}
            draggable={false}
          />
        </div>
        {images.length > 1 && (
          <div className="miv-photos-rail" ref={railRef} role="tablist" aria-label="Image variants" data-no-swipe="true">
            {images.map((image, index) => {
              const isActive = index === selectedIndex;
              return (
                <button
                  key={image.id || `${image.original_path}-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`Image ${index + 1}`}
                  data-rail-index={index}
                  className={`miv-photos-thumb${isActive ? ' is-active' : ''}`}
                  onClick={() => onSelectIndex(index)}
                >
                  <img src={mediaUrl(imageThumbnailPath(image))} alt="" draggable={false} loading="lazy" />
                </button>
              );
            })}
          </div>
        )}
        {images.length === 1 && (
          <span className="miv-photos-hint" data-no-swipe="true">Single image</span>
        )}
      </div>
    </DemoFrame>
  );
}
