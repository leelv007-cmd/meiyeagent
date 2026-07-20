/**
 * Device relay contract: same /dashboard/ location for desktop↔mobile handoff.
 * Distinct from publish handoff packages (/dashboard/handoff/$token).
 */

export type RelayStage = 'action' | 'progress' | 'handoff';

export type RelayTarget =
  | { kind: 'work'; workId: string; stage?: RelayStage }
  | { kind: 'package'; packageId: string; stage?: RelayStage };

const RELAY_STAGES = new Set<RelayStage>(['action', 'progress', 'handoff']);

function nonEmptyId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStage(value: unknown): RelayStage | undefined {
  if (typeof value !== 'string') return undefined;
  return RELAY_STAGES.has(value as RelayStage)
    ? (value as RelayStage)
    : undefined;
}

export function buildRelayLocation(target: RelayTarget): {
  pathname: string;
  search: Record<string, string>;
  pathWithSearch: string;
} {
  if (target.kind === 'work') {
    const workId = nonEmptyId(target.workId);
    if (!workId) {
      throw new Error('Relay work target requires a non-empty workId.');
    }
    const search: Record<string, string> = { workId };
    if (target.stage) search.stage = target.stage;
    return {
      pathname: '/dashboard/',
      search,
      pathWithSearch: serializeDashboardSearch(search),
    };
  }
  if (target.kind === 'package') {
    const packageId = nonEmptyId(target.packageId);
    if (!packageId) {
      throw new Error('Relay package target requires a non-empty packageId.');
    }
    const search: Record<string, string> = { packageId };
    if (target.stage) search.stage = target.stage;
    return {
      pathname: '/dashboard/',
      search,
      pathWithSearch: serializeDashboardSearch(search),
    };
  }
  throw new Error('Unknown relay target kind.');
}

function serializeDashboardSearch(search: Record<string, string>): string {
  const params = new URLSearchParams();
  // Stable order for round-trips and tests.
  for (const key of ['workId', 'packageId', 'stage'] as const) {
    if (search[key]) params.set(key, search[key]);
  }
  const query = params.toString();
  return query ? `/dashboard?${query}` : '/dashboard';
}

/** Parse dashboard search (or a full path/URL search) into a relay target. */
export function parseRelayTarget(
  input: Record<string, unknown> | string | URLSearchParams
): RelayTarget | undefined {
  const search =
    typeof input === 'string'
      ? Object.fromEntries(
          new URLSearchParams(input.replace(/^\?/, '')).entries()
        )
      : input instanceof URLSearchParams
        ? Object.fromEntries(input.entries())
        : input;

  const stage = parseStage(search.stage);
  const workId = nonEmptyId(search.workId);
  const packageId = nonEmptyId(search.packageId);

  // Prefer explicit work when both present (workbench identity).
  if (workId) {
    return stage ? { kind: 'work', workId, stage } : { kind: 'work', workId };
  }
  if (packageId) {
    return stage
      ? { kind: 'package', packageId, stage }
      : { kind: 'package', packageId };
  }
  return undefined;
}

/**
 * Desktop landing for a relay URL: a package target opened on desktop should
 * land on the content detail page (the workbench only consumes workId).
 * Returns undefined when the workbench already owns the location.
 */
export function desktopRelayLanding(search: {
  workId?: string;
  packageId?: string;
}): { contentId: string } | undefined {
  if (nonEmptyId(search.workId)) return undefined;
  const packageId = nonEmptyId(search.packageId);
  return packageId ? { contentId: packageId } : undefined;
}

export function tryBuildRelayLocation(
  target: unknown
): ReturnType<typeof buildRelayLocation> | undefined {
  if (!target || typeof target !== 'object') return undefined;
  const record = target as Record<string, unknown>;
  try {
    if (record.kind === 'work' && typeof record.workId === 'string') {
      return buildRelayLocation({
        kind: 'work',
        workId: record.workId,
        ...(parseStage(record.stage)
          ? { stage: parseStage(record.stage) }
          : {}),
      });
    }
    if (record.kind === 'package' && typeof record.packageId === 'string') {
      return buildRelayLocation({
        kind: 'package',
        packageId: record.packageId,
        ...(parseStage(record.stage)
          ? { stage: parseStage(record.stage) }
          : {}),
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}
