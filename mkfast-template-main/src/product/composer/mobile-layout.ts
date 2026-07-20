/**
 * Composer mobile layout contract (C3 / #97, D-084).
 *
 * Cold six cards: two-col three-row at 320/390.
 * 200% zoom or content width < 280px → single column, no truncation.
 * After lens select: P0 cards stay two-col two-row (or single when narrow).
 */

/** Content width below this → single-column card grid (D-084). */
export const COMPOSER_SINGLE_COLUMN_MAX_WIDTH = 280;

/** Canonical mobile portrait fixtures for acceptance matrix. */
export const COMPOSER_VIEWPORT_FIXTURES = {
  phone320: { width: 320, height: 720, label: '320×720' },
  phone390: { width: 390, height: 844, label: '390×844' },
  landscape: { width: 844, height: 390, label: 'landscape' },
  /** 200% zoom on 320 CSS px ≈ 160 device-independent content width. */
  zoom200: { width: 160, height: 360, label: '200% zoom' },
} as const;

export type ComposerViewport = {
  /** CSS content width available to the card grid. */
  width: number;
  height?: number;
};

export type ComposerCardGridLayout = {
  /** Number of CSS grid columns. */
  columns: 1 | 2;
  /** True when titles/summaries/actions must wrap without line-clamp. */
  allowTruncate: false;
  /** True for the single-column narrow/zoom path. */
  singleColumn: boolean;
  /** Cold six expects three visual rows when two-col. */
  coldRows: number;
  /** P0 after lens: at most two visual rows when two-col (≤4 cards). */
  p0MaxRows: number;
};

/**
 * Resolve card grid layout from content width (D-084).
 * 320 and 390 stay two-column; <280 or 200% zoom → single column.
 */
export function resolveComposerCardGridLayout(
  viewport: ComposerViewport,
  options?: { cardCount?: number }
): ComposerCardGridLayout {
  const singleColumn = viewport.width < COMPOSER_SINGLE_COLUMN_MAX_WIDTH;
  const columns: 1 | 2 = singleColumn ? 1 : 2;
  const cardCount = options?.cardCount ?? 6;
  const rows = Math.ceil(cardCount / columns);
  return {
    columns,
    allowTruncate: false,
    singleColumn,
    coldRows: rows,
    p0MaxRows: singleColumn ? cardCount : Math.min(2, rows),
  };
}

/** True when viewport matches the cold two-col matrix (320 / 390 / landscape wide enough). */
export function isTwoColumnMobileViewport(viewport: ComposerViewport): boolean {
  return !resolveComposerCardGridLayout(viewport).singleColumn;
}

/**
 * Card text must never use line-clamp / truncate classes in single-column mode.
 * Hosts may always opt out of truncation for safety.
 */
export const COMPOSER_CARD_TEXT_CLASS =
  'whitespace-normal break-words [overflow-wrap:anywhere]';
