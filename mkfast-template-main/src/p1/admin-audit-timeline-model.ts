/**
 * Pure model behind the admin audit activity stream.
 *
 * The audit surfaces (governance control, BYOK projection) render one shared
 * shape: day buckets, each holding a timeline of entries whose detail cards are
 * individually collapsible. Only the computation lives here — the components
 * keep their queries, their open-state and their clipboard handling.
 *
 * Nothing mutates its argument: the entry arrays come straight out of a
 * `useMemo`/`select` and are shared by reference with the query cache.
 */

export type AuditBucketKey = 'today' | 'yesterday' | 'earlier';

/** Output order is fixed here, not by the order the records arrive in. */
const AUDIT_BUCKET_ORDER: readonly AuditBucketKey[] = [
  'today',
  'yesterday',
  'earlier',
];

export interface AuditBucket<T> {
  key: AuditBucketKey;
  entries: T[];
}

function startOfLocalDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

/**
 * Calendar-day bucketing, not a 24h window: an event from 23:50 yesterday is
 * "yesterday" at 00:10 today, which is how an operator reads a log.
 *
 * An unparseable or missing timestamp falls into `earlier` rather than being
 * dropped — an audit record without a readable time is still a record, and
 * hiding it would understate the log. A timestamp ahead of `now` (clock skew
 * between the Core service and the browser) counts as today, so a just-written
 * record does not sink to the bottom of the page.
 */
function bucketFor(createdAt: string, now: Date): AuditBucketKey {
  if (!createdAt) {
    return 'earlier';
  }
  const parsed = new Date(createdAt);
  const time = parsed.getTime();
  if (Number.isNaN(time)) {
    return 'earlier';
  }
  const day = startOfLocalDay(parsed);
  const today = startOfLocalDay(now);
  if (day >= today) {
    return 'today';
  }
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  ).getTime();
  return day === yesterday ? 'yesterday' : 'earlier';
}

/**
 * Empty buckets are dropped rather than rendered as a heading with nothing
 * under it, which is also what lets the caller show its empty state when the
 * result is an empty array.
 */
export function groupAuditIntoBuckets<
  T extends { id: string; createdAt: string },
>(entries: readonly T[], now: Date = new Date()): Array<AuditBucket<T>> {
  const assigned = entries.map((entry) => ({
    bucket: bucketFor(entry.createdAt, now),
    entry,
  }));
  return AUDIT_BUCKET_ORDER.map((key) => ({
    key,
    entries: assigned
      .filter((item) => item.bucket === key)
      .map((item) => item.entry),
  })).filter((bucket) => bucket.entries.length > 0);
}

/**
 * The first entries start expanded so the log does not open as a wall of
 * collapsed cards. Derived from the incoming order — the caller keeps it in
 * state from there, so it is decided once rather than re-derived on every
 * refetch (a card the operator closed must stay closed).
 */
export function initialOpenAuditIds(
  entries: readonly { id: string }[],
  count = 2
): Set<string> {
  return new Set(entries.slice(0, count).map((entry) => entry.id));
}

export function toggleOpenAuditId(
  openIds: ReadonlySet<string>,
  id: string,
  open: boolean
): Set<string> {
  const next = new Set(openIds);
  if (open) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}
