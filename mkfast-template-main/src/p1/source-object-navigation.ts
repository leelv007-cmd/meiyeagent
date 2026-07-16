export type DirectSourceKind = 'asset' | 'content' | 'publish';

export function directSourceHref(kind: DirectSourceKind, id: string) {
  const sourceId = id.trim();
  if (!sourceId) return undefined;
  if (kind === 'asset') {
    return `/dashboard/assets/${encodeURIComponent(sourceId)}`;
  }
  const params = new URLSearchParams();
  if (kind === 'publish') {
    params.set('handoffId', sourceId);
    return `/dashboard/content?${params.toString()}`;
  }
  params.set('contentId', sourceId);
  return `/dashboard/content?${params.toString()}`;
}

export function sourceObjectElementId(kind: DirectSourceKind, id: string) {
  return `source-${kind}-${encodeURIComponent(id)}`;
}

export function optionalSourceId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function storeSourceTab(value: unknown, assetId?: string) {
  if (value === 'profile' || value === 'assets' || value === 'qualification') {
    return value;
  }
  return assetId ? 'assets' : 'profile';
}
