/**
 * Pure filter + CSV export for the governance audit list.
 *
 * Sits on top of the existing AdminAuditControl projection (template lifecycle,
 * catalog revisions, rollback audits). No new data source — callers pass the
 * already-merged event array and get a filtered view plus a CSV of that view.
 */

export interface AuditListEvent {
  id: string;
  action: string;
  actor: string;
  correlationId: string;
  createdAt: string;
  reason: string;
  scope: string;
}

/** All dimensions optional; empty string means "no constraint". */
export interface AuditListFilters {
  /** Inclusive lower bound as YYYY-MM-DD (local calendar day). */
  fromDate: string;
  /** Inclusive upper bound as YYYY-MM-DD (local calendar day). */
  toDate: string;
  /** Case-insensitive substring match on actor. */
  actor: string;
  /** Case-insensitive substring match on action. */
  action: string;
}

export function emptyAuditListFilters(): AuditListFilters {
  return {
    fromDate: '',
    toDate: '',
    actor: '',
    action: '',
  };
}

export function hasActiveAuditFilters(filters: AuditListFilters): boolean {
  return (
    filters.fromDate.trim() !== '' ||
    filters.toDate.trim() !== '' ||
    filters.actor.trim() !== '' ||
    filters.action.trim() !== ''
  );
}

/**
 * Local start-of-day for a YYYY-MM-DD string. Invalid input yields null so the
 * filter dimension is ignored rather than dropping every row.
 */
function parseLocalDayStart(dateOnly: string): number | null {
  const trimmed = dateOnly.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const [year, month, day] = trimmed.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  const start = new Date(year, month - 1, day);
  if (
    start.getFullYear() !== year ||
    start.getMonth() !== month - 1 ||
    start.getDate() !== day
  ) {
    return null;
  }
  return start.getTime();
}

function parseLocalDayEndExclusive(dateOnly: string): number | null {
  const start = parseLocalDayStart(dateOnly);
  if (start === null) {
    return null;
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return end.getTime();
}

function matchesSubstring(value: string, needle: string): boolean {
  const term = needle.trim().toLowerCase();
  if (!term) {
    return true;
  }
  return value.toLowerCase().includes(term);
}

function matchesTimeRange(
  createdAt: string,
  fromDate: string,
  toDate: string
): boolean {
  const fromMs = fromDate.trim() ? parseLocalDayStart(fromDate) : null;
  const toExclusive = toDate.trim() ? parseLocalDayEndExclusive(toDate) : null;
  if (fromMs === null && toExclusive === null) {
    return true;
  }
  const time = new Date(createdAt).getTime();
  if (Number.isNaN(time)) {
    // Unparseable timestamps cannot satisfy a time window — drop them when
    // the operator asked for a date range, keep them when no range is set.
    return false;
  }
  if (fromMs !== null && time < fromMs) {
    return false;
  }
  if (toExclusive !== null && time >= toExclusive) {
    return false;
  }
  return true;
}

/**
 * Combine time / actor / action with AND semantics. Empty dimensions pass all.
 * Order of the input array is preserved (callers already sort newest-first).
 */
export function filterAuditEvents(
  events: readonly AuditListEvent[],
  filters: AuditListFilters
): AuditListEvent[] {
  return events.filter(
    (event) =>
      matchesTimeRange(event.createdAt, filters.fromDate, filters.toDate) &&
      matchesSubstring(event.actor, filters.actor) &&
      matchesSubstring(event.action, filters.action)
  );
}

const CSV_COLUMNS = [
  'id',
  'action',
  'actor',
  'correlationId',
  'createdAt',
  'reason',
  'scope',
] as const;

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build a CSV document for the (already filtered) event list. Header row is
 * always present so an empty export is still a valid one-row file.
 */
export function buildAuditCsv(events: readonly AuditListEvent[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const event of events) {
    lines.push(
      CSV_COLUMNS.map((column) => escapeCsvCell(event[column] ?? '')).join(',')
    );
  }
  // Trailing newline keeps the file friendly for shell tools and spreadsheets.
  return `${lines.join('\n')}\n`;
}

export function auditCsvFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `audit-export-${y}${m}${d}.csv`;
}

/**
 * Trigger a browser download for a text/CSV body. Pure side-effect helper so
 * interaction tests can spy on `URL.createObjectURL` / anchor clicks.
 */
export function downloadAuditCsv(
  csv: string,
  filename: string = auditCsvFilename()
): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
