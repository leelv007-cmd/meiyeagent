import type { CatalogReturnRestoreSnapshot } from './fullscreen-catalog';

const PREFIX = 'composer.catalog.return:';
const ALLOWED_KEYS = new Set([
  'tab',
  'category',
  'scrollY',
  'focusKey',
  'query',
  'surfaceRevisionId',
]);

function browserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

function snapshotFromUnknown(
  value: unknown,
  returnKey: string
): CatalogReturnRestoreSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bag = value as Record<string, unknown>;
  if (Object.keys(bag).some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (bag.tab !== 'templates') return null;
  if (typeof bag.category !== 'string' || !bag.category) return null;
  if (
    typeof bag.scrollY !== 'number' ||
    !Number.isFinite(bag.scrollY) ||
    bag.scrollY < 0
  ) {
    return null;
  }
  for (const key of ['focusKey', 'query', 'surfaceRevisionId'] as const) {
    if (bag[key] !== undefined && typeof bag[key] !== 'string') return null;
  }
  return {
    tab: bag.tab,
    category: bag.category,
    scrollY: bag.scrollY,
    ...(bag.focusKey ? { focusKey: bag.focusKey as string } : {}),
    ...(bag.query ? { query: bag.query as string } : {}),
    ...(bag.surfaceRevisionId
      ? { surfaceRevisionId: bag.surfaceRevisionId as string }
      : {}),
    returnKey,
  };
}

export function saveCatalogReturnSnapshot(
  snapshot: CatalogReturnRestoreSnapshot,
  storage: Storage | undefined = browserStorage(),
  key: string = crypto.randomUUID()
): string {
  if (!storage) return key;
  const safeSnapshot = {
    tab: snapshot.tab,
    category: snapshot.category,
    scrollY: snapshot.scrollY,
    ...(snapshot.focusKey ? { focusKey: snapshot.focusKey } : {}),
    ...(snapshot.query ? { query: snapshot.query } : {}),
    ...(snapshot.surfaceRevisionId
      ? { surfaceRevisionId: snapshot.surfaceRevisionId }
      : {}),
  };
  storage.setItem(`${PREFIX}${key}`, JSON.stringify(safeSnapshot));
  return key;
}

export function loadCatalogReturnSnapshot(
  key: string | undefined,
  storage: Storage | undefined = browserStorage()
): CatalogReturnRestoreSnapshot | null {
  if (!key || !storage) return null;
  const storageKey = `${PREFIX}${key}`;
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  storage.removeItem(storageKey);
  try {
    return snapshotFromUnknown(JSON.parse(raw) as unknown, key);
  } catch {
    return null;
  }
}
