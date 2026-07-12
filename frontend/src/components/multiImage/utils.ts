import type { ImageRecord } from '../../types';

/**
 * buildDemoVariants
 * -----------------
 * The BODR Image Prompt online sandbox ships with one image per item, so the four
 * multi-image schemes have nothing to show. To make the demo interactive
 * without permanently mutating the bundled JSON, this helper clones the
 * original image into 4 synthetic "variants" with distinct roles and ids.
 *
 * Variants are deterministic for a given source so React keys are stable
 * across renders.
 */
export function buildDemoVariants(source: ImageRecord): ImageRecord[] {
  const basePath = source.preview_path || source.thumb_path || source.original_path;
  const seed = (source.id || 'seed').replace(/[^a-z0-9]/gi, '');
  const roles: Array<Pick<ImageRecord, 'role' | 'id'>> = [
    { id: `${seed}-demo-1`, role: 'result_image' },
    { id: `${seed}-demo-2`, role: 'reference_image' },
    { id: `${seed}-demo-3`, role: 'result_image' },
    { id: `${seed}-demo-4`, role: 'result_image' },
  ];
  return roles.map((variant, index) => ({
    ...source,
    id: variant.id,
    role: variant.role as ImageRecord['role'],
    sort_order: index,
    original_path: basePath,
    preview_path: basePath,
    thumb_path: basePath,
  }));
}

/**
 * shouldExpandDemoImages
 * ----------------------
 * Centralized predicate so the modal and any preview pages agree on when
 * to swap in synthetic demo variants.
 */
export function shouldExpandDemoImages(isDemoMode: boolean, imageCount: number) {
  return isDemoMode && imageCount === 1;
}
