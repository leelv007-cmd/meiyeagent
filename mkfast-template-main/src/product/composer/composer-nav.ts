/**
 * Composer-owned navigation constants (C3 / #97).
 *
 * Prefer these over editing freeze-listed `lib/routes.ts`.
 * Dashboard integration wires the catalog route to this path.
 */

/** Canonical fullscreen catalog path (templates | tools dual tab). */
export const COMPOSER_CATALOG_PATH = '/dashboard/catalog';

/** Pro Studio canonical gate — never deep-link Canvas / bypass entitlement. */
export const PRO_STUDIO_CANONICAL_PATH = '/pro-studio';

/** Dashboard home (return target after catalog). */
export const COMPOSER_HOME_PATH = '/dashboard';

export type ComposerCatalogSearchParams = {
  /** Initial tab: templates (recipe) or tools. */
  tab?: 'templates' | 'tools';
  /** Task-language category filter. */
  category?: string;
  /** Surface revision freeze ref (non-sensitive). */
  surfaceRevisionId?: string;
  /** Opaque return key to restore composer draft / focus. */
  returnKey?: string;
  /**
   * Search query — only meaningful when search gate is open (≥12 items).
   * Never carries draft body / prompt / provider.
   */
  q?: string;
};

/** Build a relative catalog href from allowlisted search params only. */
export function buildComposerCatalogHref(
  params: ComposerCatalogSearchParams = {}
): string {
  const search = new URLSearchParams();
  if (params.tab === 'templates' || params.tab === 'tools') {
    search.set('tab', params.tab);
  }
  if (params.category && params.category.trim()) {
    search.set('category', params.category.trim());
  }
  if (params.surfaceRevisionId && params.surfaceRevisionId.trim()) {
    search.set('surfaceRevisionId', params.surfaceRevisionId.trim());
  }
  if (params.returnKey && params.returnKey.trim()) {
    search.set('returnKey', params.returnKey.trim());
  }
  if (params.q && params.q.trim()) {
    search.set('q', params.q.trim());
  }
  const qs = search.toString();
  return qs ? `${COMPOSER_CATALOG_PATH}?${qs}` : COMPOSER_CATALOG_PATH;
}

/** Parse catalog search from a URLSearchParams / location search bag. */
export function parseComposerCatalogSearch(
  raw: URLSearchParams | Record<string, unknown>
): ComposerCatalogSearchParams {
  const get = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) {
      const value = raw.get(key);
      return value && value.length > 0 ? value : undefined;
    }
    const value = raw[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };
  const tabRaw = get('tab');
  const tab =
    tabRaw === 'templates' ||
    tabRaw === 'tools' ||
    tabRaw === 'recipe' ||
    tabRaw === 'tool'
      ? tabRaw === 'recipe'
        ? 'templates'
        : tabRaw === 'tool'
          ? 'tools'
          : tabRaw
      : undefined;
  return {
    ...(tab ? { tab } : {}),
    ...(get('category') ? { category: get('category') } : {}),
    ...(get('surfaceRevisionId')
      ? { surfaceRevisionId: get('surfaceRevisionId') }
      : {}),
    ...(get('returnKey') ? { returnKey: get('returnKey') } : {}),
    ...(get('q') ? { q: get('q') } : {}),
  };
}
