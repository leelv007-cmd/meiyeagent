export type CatalogSearch = {
  tab?: 'templates';
  category?: string;
  surfaceRevisionId?: string;
  returnKey?: string;
  q?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Catalog URL allowlist; safe to import from node tests. */
export function validateCatalogSearch(
  search: Record<string, unknown>
): CatalogSearch {
  const tabRaw = optionalString(search.tab);
  const tab =
    tabRaw === 'templates'
      ? tabRaw
      : tabRaw === 'recipe'
        ? 'templates'
        : undefined;
  return {
    ...(tab ? { tab } : {}),
    ...(optionalString(search.category)
      ? { category: optionalString(search.category) }
      : {}),
    ...(optionalString(search.surfaceRevisionId)
      ? { surfaceRevisionId: optionalString(search.surfaceRevisionId) }
      : {}),
    ...(optionalString(search.returnKey)
      ? { returnKey: optionalString(search.returnKey) }
      : {}),
    ...(optionalString(search.q) ? { q: optionalString(search.q) } : {}),
  };
}
