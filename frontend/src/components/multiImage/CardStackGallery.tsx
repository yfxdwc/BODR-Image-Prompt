import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../../api/client';
import { imageHeroPath, imageOriginalPath, imageThumbnailPath } from '../../utils/images';
import DemoFrame from './DemoFrame';
import type { MultiImageViewerProps } from './types';

/**
 * Scheme 2 — Card Stack (Tinder / Feishu-Docs style)
 * --------------------------------------------------
 * Layout:
 *                       ┌─────────────┐
 *                       │  depth 3    │  ← rotated, dimmed, behind
 *                       └─────────────┘
 *                  ┌─────────────┐
 *                  │  depth 2    │       ← rotated, smaller, behind
 *                  └─────────────┘
 *             ┌─────────────┐
 *             │  depth 1    │            ← rotated, smallest peek
 *             └─────────────┘
 *        ╔═══════════════╗
 *        ║   TOP CARD    ║             ← the live / selected image (full)
 *        ║  (drag/swipe) ║
 *        ╚═══════════════╝
 *
 * The top card follows the pointer during drag (with subtle spring
 * easing) and snaps back or commits on release. Three preview cards
 * peek from underneath to telegraph "more behind". Cards stack from
 * the *next* image, so swiping left always reveals the next one in
 * sequence — even after wrap-around.
 *
 * Why this scheme (pros):
 *   • Highly tactile — the deck metaphor makes browsing feel like
 *     flipping through a stack of polaroids, not paging through a list.
 *   • No chrome overhead: the whole image area is the deck, so the hero
 *     keeps maximum size.
 *   • Great for ≤ ~12 variants per item (most BODR Image Prompt items have 1-4).
 *
 * Trade-offs (cons):
 *   • Less efficient for power users scanning 20+ variants: there is no
 *     overview / page-jump shortcut. Mitigation: the picker also exposes
 *     Carousel, Photos, and Grid as escape hatches.
 *   • Drag-only navigation is harder for keyboard-only users. Mitigation:
 *     ← / → arrow keys still flip through.
 */
const STACK_DEPTHS = [1, 2, 3] as const;
const COMMIT_DISTANCE = 90;
const COMMIT_VELOCITY = 0.5;

export default function CardStackGallery(props: MultiImageViewerProps) {
  const { images, selectedIndex, onSelectIndex, title, isHeroFullscreen } = props;
  const selected = images[selectedIndex] || images[0];
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; pointerId: number; t: number } | null>(null);

  const goNext = useCallback(() => {
    if (images.length <= 1) return;
    onSelectIndex((selectedIndex + 1) % images.length);
  }, [images.length, selectedIndex, onSelectIndex]);
  const goPrev = useCallback(() => {
    if (images.length <= 1) return;
    onSelectIndex((selectedIndex - 1 + images.length) % images.length);
  }, [images.length, selectedIndex, onSelectIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isHeroFullscreen) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); goPrev(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); goNext(); }
  };

  // Pointer drag handling (touch + mouse unified)
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isHeroFullscreen) return;
    if (images.length <= 1) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a, [data-no-swipe="true"]')) return;
    dragStartRef.current = { x: event.clientX, pointerId: event.pointerId, t: performance.now() };
    setIsDragging(true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const delta = event.clientX - dragStartRef.current.x;
    setDragX(Math.max(-180, Math.min(180, delta)));
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const state = dragStartRef.current;
    const delta = event.clientX - state.x;
    const dt = Math.max(1, performance.now() - state.t);
    const velocity = Math.abs(delta) / dt;
    dragStartRef.current = null;
    setIsDragging(false);
    setDragX(0);
    try { event.currentTarget.releasePointerCapture(state.pointerId); } catch { /* noop */ }
    if (Math.abs(delta) >= COMMIT_DISTANCE || velocity >= COMMIT_VELOCITY) {
      if (delta > 0) goPrev(); else goNext();
    }
  };

  // Reset drag whenever the underlying selection changes
  useEffect(() => {
    setDragX(0);
    setIsDragging(false);
    dragStartRef.current = null;
  }, [selectedIndex]);

  const stackCards = (() => {
    if (images.length <= 1) return [] as Array<{ image: typeof images[number]; depth: typeof STACK_DEPTHS[number] }>;
    const ordered = STACK_DEPTHS.map(depth => {
      const index = (selectedIndex + depth) % images.length;
      return { image: images[index], depth };
    });
    // Skip cards that point at the currently selected image (only happens with 1 image).
    return ordered.filter(card => card.image.id !== selected?.id);
  })();

  return (
    <DemoFrame {...props}>
      <div
        ref={surfaceRef}
        className={`miv-stack${isDragging ? ' is-dragging' : ''}${images.length <= 1 ? ' is-single' : ''}`}
        tabIndex={0}
        role="region"
        aria-label="Item image card stack"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ '--miv-drag-x': `${dragX}px` } as React.CSSProperties}
      >
        {/* Peek cards behind the top card (smallest first so they sit at the back) */}
        {stackCards.slice().reverse().map(({ image, depth }) => (
          <div
            key={`peek-${image.id || image.original_path}-${depth}`}
            className={`miv-stack-peek miv-stack-depth-${depth}`}
            data-no-swipe="true"
            aria-hidden="true"
          >
            <img src={mediaUrl(imageThumbnailPath(image))} alt="" draggable={false} />
          </div>
        ))}

        {/* Top live card */}
        <div className="miv-stack-top" data-no-swipe="true">
          <img
            className="miv-stack-image"
            src={mediaUrl(isHeroFullscreen ? imageOriginalPath(selected) : imageHeroPath(selected))}
            alt={title}
            draggable={false}
          />
        </div>

        {images.length === 1 && (
          <span className="miv-stack-hint" data-no-swipe="true">Single image</span>
        )}
      </div>
    </DemoFrame>
  );
}
