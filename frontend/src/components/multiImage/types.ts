import type { ReactElement } from 'react';
import type { ImageRecord } from '../../types';

/**
 * MultiImageDesignId
 * ------------------
 * Stable id for one of the four image-browsing interaction schemes available
 * inside `ItemDetailModal`. Stored in localStorage so the user's pick survives
 * reloads.
 */
export type MultiImageDesignId = 'carousel' | 'card-stack' | 'photos' | 'grid';

/**
 * MultiImageViewerProps
 * ---------------------
 * The contract every gallery implementation must satisfy. All schemes share
 * the same surface so the `ItemDetailModal` can swap them at runtime without
 * touching its own state model.
 */
export interface MultiImageViewerProps {
  /** Already-deduplicated image list. Length is guaranteed to be >= 1. */
  images: ImageRecord[];
  /** Currently active image index (controlled). */
  selectedIndex: number;
  /** Inform the parent which image should become active. */
  onSelectIndex: (index: number) => void;
  /** Localized item title (used for `alt` text + download filename). */
  title: string;
  /** Whether mutation actions (favorite/edit/delete) should be exposed. */
  canMutate: boolean;
  /** Whether a "Generate variant" affordance is supported. */
  canGenerate?: boolean;
  /** Item currently favorited? */
  isFavorite?: boolean;
  /** True when the gallery is rendered in the (mobile) fullscreen overlay. */
  isHeroFullscreen?: boolean;
  /** Open / close the hero-only fullscreen overlay. */
  onToggleHeroFullscreen: () => void;
  /** Close the (mobile) fullscreen overlay only. */
  onCloseHeroFullscreen: () => void;
  /** Close the whole modal. */
  onCloseModal: () => void;
  /** Download the currently selected image. */
  onDownload: () => void;
  /** Toggle favorite. Optional because favorites can be disabled. */
  onToggleFavorite?: () => void;
  /** Open the editor modal for the whole item. */
  onEdit?: () => void;
  /** Delete the whole item. */
  onDelete?: () => void;
  /** Open the generation panel. */
  onGenerate?: () => void;
  /**
   * Synthetic-variant badge. When the gallery is previewing demo variants
   * (i.e. the item only had one real image), the badge text is shown so the
   * user knows the extras are placeholders.
   */
  syntheticBadge?: string;
}

/**
 * MultiImageViewerComponent
 * -------------------------
 * The minimal interface every implementation exposes so the registry can
 * pick one at runtime.
 */
export type MultiImageViewerComponent = (props: MultiImageViewerProps) => ReactElement;
