import { serializeCanonicalDeepLink } from '@/product/canonical-deep-link';

export type DirectSourceKind = 'asset' | 'content' | 'publish';

export function directSourceHref(kind: DirectSourceKind, id: string) {
  const sourceId = id.trim();
  if (!sourceId) return undefined;
  if (kind === 'asset') {
    return `/dashboard/assets/${encodeURIComponent(sourceId)}`;
  }
  return serializeCanonicalDeepLink({
    producer: 'global_command',
    objectClass: kind === 'publish' ? 'handoffId' : 'contentId',
    id: sourceId,
  });
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
