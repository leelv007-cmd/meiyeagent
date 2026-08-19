/**
 * LINK-01 / R-P1-09: one typed deep-link mapping table.
 *
 * Notification, Feishu, device relay, and global command must name a live
 * consumer. Historical ProductState content/handoff ids have no ContentPackage
 * counterpart — they resolve to an explicit unavailable destination and never
 * fall through to the default Composer.
 */
import type { ResultPanel } from './result-center-navigation.js';

export const DEEP_LINK_PRODUCERS = [
  'notification',
  'feishu',
  'device_relay',
  'global_command',
] as const;

export type DeepLinkProducer = (typeof DEEP_LINK_PRODUCERS)[number];

/** Inbound keys LINK-01 must not silently drop. */
export const DEEP_LINK_OBJECT_CLASSES = [
  'contentId',
  'handoffId',
  'packageId',
  'taskId',
  'stage',
  'entry',
] as const;

export type DeepLinkObjectClass = (typeof DEEP_LINK_OBJECT_CLASSES)[number];

export const DEEP_LINK_EXTRA_OBJECT_CLASSES = ['workId', 'jobId'] as const;

export type DeepLinkExtraObjectClass =
  (typeof DEEP_LINK_EXTRA_OBJECT_CLASSES)[number];

export type DeepLinkMappedObjectClass =
  | DeepLinkObjectClass
  | DeepLinkExtraObjectClass;

export const DEEP_LINK_CONSUMERS = [
  'composer_task',
  'result_center',
  'works_archive',
  'job_detail',
  'historical_unavailable',
] as const;

export type DeepLinkConsumer = (typeof DEEP_LINK_CONSUMERS)[number];

export const DEEP_LINK_STAGES = ['action', 'progress', 'handoff'] as const;
export type DeepLinkStage = (typeof DEEP_LINK_STAGES)[number];

export const DEEP_LINK_ENTRIES = ['feishu', 'notification'] as const;
export type DeepLinkEntry = (typeof DEEP_LINK_ENTRIES)[number];

export const DEEP_LINK_STAGE_TO_PANEL = {
  action: 'result',
  progress: 'run',
  handoff: 'delivery',
} as const satisfies Record<DeepLinkStage, ResultPanel>;

export type CanonicalDeepLinkMappingRow = {
  producer: DeepLinkProducer;
  objectClass: DeepLinkMappedObjectClass;
  consumer: DeepLinkConsumer;
  preserveOnCompanion?: true;
};

const OBJECT_CONSUMER: Record<
  Exclude<DeepLinkMappedObjectClass, 'stage' | 'entry'>,
  DeepLinkConsumer
> = {
  contentId: 'historical_unavailable',
  handoffId: 'historical_unavailable',
  packageId: 'works_archive',
  taskId: 'composer_task',
  workId: 'result_center',
  jobId: 'job_detail',
};

function mappingRows(): CanonicalDeepLinkMappingRow[] {
  const rows: CanonicalDeepLinkMappingRow[] = [];
  for (const producer of DEEP_LINK_PRODUCERS) {
    for (const objectClass of [
      ...DEEP_LINK_OBJECT_CLASSES,
      ...DEEP_LINK_EXTRA_OBJECT_CLASSES,
    ] as const) {
      if (objectClass === 'stage' || objectClass === 'entry') {
        rows.push({
          producer,
          objectClass,
          consumer: 'historical_unavailable',
          preserveOnCompanion: true,
        });
        continue;
      }
      rows.push({
        producer,
        objectClass,
        consumer: OBJECT_CONSUMER[objectClass],
      });
    }
  }
  return rows;
}

/** Exhaustive producer × object-class table. Every row names a consumer. */
export const CANONICAL_DEEP_LINK_MAPPING: readonly CanonicalDeepLinkMappingRow[] =
  mappingRows();

export function deepLinkConsumerFor(
  producer: DeepLinkProducer,
  objectClass: DeepLinkMappedObjectClass
): DeepLinkConsumer {
  const row = CANONICAL_DEEP_LINK_MAPPING.find(
    (item) => item.producer === producer && item.objectClass === objectClass
  );
  if (!row) {
    throw new Error(
      `Canonical deep-link mapping missing ${producer}/${objectClass}.`
    );
  }
  return row.consumer;
}

export type CanonicalDeepLinkIntent = {
  producer: DeepLinkProducer;
  objectClass: Exclude<DeepLinkMappedObjectClass, 'stage' | 'entry'>;
  id: string;
  stage?: DeepLinkStage;
};

export type CanonicalDeepLinkDestination = {
  consumer: DeepLinkConsumer | 'composer_home';
  href: string;
  objectClass?: DeepLinkMappedObjectClass;
  objectId?: string;
  taskId?: string;
  workId?: string;
  packageId?: string;
  jobId?: string;
  stage?: DeepLinkStage;
  entry?: DeepLinkEntry;
  panel?: ResultPanel;
  reason?: 'historical' | 'unmapped';
};

const LIVE_OBJECT_PRIORITY = [
  'workId',
  'packageId',
  'taskId',
  'jobId',
] as const satisfies readonly DeepLinkMappedObjectClass[];

function nonEmptyId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseDeepLinkStage(value: unknown): DeepLinkStage | undefined {
  return typeof value === 'string' &&
    (DEEP_LINK_STAGES as readonly string[]).includes(value)
    ? (value as DeepLinkStage)
    : undefined;
}

export function parseDeepLinkEntry(value: unknown): DeepLinkEntry | undefined {
  return typeof value === 'string' &&
    (DEEP_LINK_ENTRIES as readonly string[]).includes(value)
    ? (value as DeepLinkEntry)
    : undefined;
}

function entryForProducer(
  producer: DeepLinkProducer
): DeepLinkEntry | undefined {
  if (producer === 'notification' || producer === 'feishu') return producer;
  return undefined;
}

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

function withSearch(pathname: string, search: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(search).sort()) {
    const value = search[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function companionSearch(input: {
  entry?: DeepLinkEntry;
  stage?: DeepLinkStage;
  panel?: ResultPanel;
}): Record<string, string> {
  const search: Record<string, string> = {};
  if (input.entry) search.entry = input.entry;
  if (input.stage) search.stage = input.stage;
  if (input.panel) search.panel = input.panel;
  return search;
}

export function formatCanonicalDeepLinkHref(input: {
  consumer: DeepLinkConsumer;
  objectClass: Exclude<DeepLinkMappedObjectClass, 'stage' | 'entry'>;
  id: string;
  stage?: DeepLinkStage;
  entry?: DeepLinkEntry;
}): string {
  const extras = companionSearch({
    ...(input.entry ? { entry: input.entry } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    ...(input.consumer === 'result_center' && input.stage
      ? { panel: DEEP_LINK_STAGE_TO_PANEL[input.stage] }
      : {}),
  });
  if (input.consumer === 'historical_unavailable') {
    const key = input.objectClass === 'handoffId' ? 'handoffId' : 'contentId';
    return withSearch('/dashboard/content', { [key]: input.id, ...extras });
  }
  if (input.consumer === 'composer_task') {
    return withSearch('/dashboard', { taskId: input.id, ...extras });
  }
  if (input.consumer === 'works_archive') {
    return withSearch(`/dashboard/works/${encodeId(input.id)}`, extras);
  }
  if (input.consumer === 'result_center') {
    return withSearch(`/dashboard/results/${encodeId(input.id)}`, extras);
  }
  return withSearch(`/dashboard/jobs/${encodeId(input.id)}`, extras);
}

export function serializeCanonicalDeepLink(
  intent: CanonicalDeepLinkIntent
): string {
  const id = nonEmptyId(intent.id);
  if (!id) {
    throw new Error(
      `Canonical deep link requires a non-empty ${intent.objectClass}.`
    );
  }
  return formatCanonicalDeepLinkHref({
    consumer: deepLinkConsumerFor(intent.producer, intent.objectClass),
    objectClass: intent.objectClass,
    id,
    ...(intent.stage ? { stage: intent.stage } : {}),
    ...(entryForProducer(intent.producer)
      ? { entry: entryForProducer(intent.producer) }
      : {}),
  });
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, '');
  return trimmed.length > 0 ? trimmed : '/';
}

function pathParam(
  pathname: string,
  prefix: string
): string | undefined {
  const normalized = normalizePathname(pathname);
  if (!normalized.startsWith(prefix)) return undefined;
  const rest = normalized.slice(prefix.length);
  if (!rest || rest.includes('/')) return undefined;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

function unavailableDestination(input: {
  href: string;
  objectClass: DeepLinkMappedObjectClass;
  objectId?: string;
  stage?: DeepLinkStage;
  entry?: DeepLinkEntry;
  reason: 'historical' | 'unmapped';
}): CanonicalDeepLinkDestination {
  return {
    consumer: 'historical_unavailable',
    href: input.href,
    objectClass: input.objectClass,
    ...(input.objectId ? { objectId: input.objectId } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    ...(input.entry ? { entry: input.entry } : {}),
    reason: input.reason,
  };
}

function liveDestination(input: {
  consumer: Exclude<DeepLinkConsumer, 'historical_unavailable'>;
  href: string;
  objectClass: DeepLinkMappedObjectClass;
  objectId: string;
  stage?: DeepLinkStage;
  entry?: DeepLinkEntry;
  panel?: ResultPanel;
}): CanonicalDeepLinkDestination {
  return {
    consumer: input.consumer,
    href: input.href,
    objectClass: input.objectClass,
    objectId: input.objectId,
    ...(input.objectClass === 'taskId' ? { taskId: input.objectId } : {}),
    ...(input.objectClass === 'workId' ? { workId: input.objectId } : {}),
    ...(input.objectClass === 'packageId' ? { packageId: input.objectId } : {}),
    ...(input.objectClass === 'jobId' ? { jobId: input.objectId } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    ...(input.entry ? { entry: input.entry } : {}),
    ...(input.panel ? { panel: input.panel } : {}),
  };
}

/**
 * Resolve an inbound location onto the mapping table.
 * Unmappable historical objects stay unavailable — never composer_home.
 */
export function resolveCanonicalDeepLink(input: {
  pathname: string;
  search?: Record<string, unknown>;
}): CanonicalDeepLinkDestination {
  const pathname = normalizePathname(input.pathname);
  const search = input.search ?? {};
  const stage = parseDeepLinkStage(search.stage);
  const entry = parseDeepLinkEntry(search.entry);
  const contentId = nonEmptyId(search.contentId);
  const handoffId = nonEmptyId(search.handoffId);
  const packageId = nonEmptyId(search.packageId);
  const taskId = nonEmptyId(search.taskId);
  const workId = nonEmptyId(search.workId);
  const jobId = nonEmptyId(search.jobId);

  const taskPathId = pathParam(pathname, '/dashboard/tasks/');
  const contentPathId = pathParam(pathname, '/dashboard/content/');
  const resultsPathId = pathParam(pathname, '/dashboard/results/');
  const worksPathId = pathParam(pathname, '/dashboard/works/');
  const jobsPathId = pathParam(pathname, '/dashboard/jobs/');

  const hrefFor = (
    objectClass: Exclude<DeepLinkMappedObjectClass, 'stage' | 'entry'>,
    id: string
  ) =>
    formatCanonicalDeepLinkHref({
      consumer: OBJECT_CONSUMER[objectClass],
      objectClass,
      id,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
    });

  if (resultsPathId) {
    return liveDestination({
      consumer: 'result_center',
      href: hrefFor('workId', resultsPathId),
      objectClass: 'workId',
      objectId: resultsPathId,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
      ...(stage ? { panel: DEEP_LINK_STAGE_TO_PANEL[stage] } : {}),
    });
  }
  if (worksPathId) {
    return liveDestination({
      consumer: 'works_archive',
      href: hrefFor('packageId', worksPathId),
      objectClass: 'packageId',
      objectId: worksPathId,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
    });
  }
  if (jobsPathId) {
    return liveDestination({
      consumer: 'job_detail',
      href: hrefFor('jobId', jobsPathId),
      objectClass: 'jobId',
      objectId: jobsPathId,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
    });
  }
  if (contentPathId) {
    return liveDestination({
      consumer: 'works_archive',
      href: hrefFor('packageId', contentPathId),
      objectClass: 'packageId',
      objectId: contentPathId,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
    });
  }
  if (taskPathId) {
    return liveDestination({
      consumer: 'composer_task',
      href: hrefFor('taskId', taskPathId),
      objectClass: 'taskId',
      objectId: taskPathId,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
    });
  }

  const live = {
    workId,
    packageId,
    taskId,
    jobId,
  };
  for (const objectClass of LIVE_OBJECT_PRIORITY) {
    const id = live[objectClass];
    if (!id) continue;
    const consumer = OBJECT_CONSUMER[objectClass];
    if (consumer === 'historical_unavailable') continue;
    return liveDestination({
      consumer,
      href: hrefFor(objectClass, id),
      objectClass,
      objectId: id,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
      ...(consumer === 'result_center' && stage
        ? { panel: DEEP_LINK_STAGE_TO_PANEL[stage] }
        : {}),
    });
  }

  const inboundHref = withSearch(
    pathname === '/dashboard' ? '/dashboard' : pathname,
    {
      ...(contentId ? { contentId } : {}),
      ...(handoffId ? { handoffId } : {}),
      ...(entry ? { entry } : {}),
      ...(stage ? { stage } : {}),
    }
  );

  if (contentId) {
    return unavailableDestination({
      href: inboundHref,
      objectClass: 'contentId',
      objectId: contentId,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
      reason: 'historical',
    });
  }
  if (handoffId) {
    return unavailableDestination({
      href: inboundHref,
      objectClass: 'handoffId',
      objectId: handoffId,
      ...(stage ? { stage } : {}),
      ...(entry ? { entry } : {}),
      reason: 'historical',
    });
  }
  if (stage && !workId && !packageId && !taskId && !jobId) {
    return unavailableDestination({
      href: inboundHref,
      objectClass: 'stage',
      ...(entry ? { entry } : {}),
      stage,
      reason: 'unmapped',
    });
  }
  if (entry && !workId && !packageId && !taskId && !jobId) {
    return unavailableDestination({
      href: inboundHref,
      objectClass: 'entry',
      entry,
      reason: 'unmapped',
    });
  }

  return {
    consumer: 'composer_home',
    href: '/dashboard',
  };
}

export function canonicalDeepLinkRedirectHref(
  currentPathname: string,
  destination: CanonicalDeepLinkDestination
): string | undefined {
  if (
    destination.consumer === 'composer_home' ||
    destination.consumer === 'historical_unavailable'
  ) {
    return undefined;
  }
  const current = normalizePathname(currentPathname);
  let targetPath = destination.href;
  const queryIndex = destination.href.indexOf('?');
  if (queryIndex >= 0) targetPath = destination.href.slice(0, queryIndex);
  if (normalizePathname(targetPath) === current) return undefined;
  return destination.href;
}

export function destinationPreservesIdentity(
  destination: CanonicalDeepLinkDestination,
  input: {
    objectClass: DeepLinkMappedObjectClass;
    id?: string;
    stage?: DeepLinkStage;
    entry?: DeepLinkEntry;
  }
): boolean {
  if (destination.consumer === 'composer_home') return false;
  if (input.objectClass === 'stage') {
    return destination.stage === input.stage && Boolean(input.stage);
  }
  if (input.objectClass === 'entry') {
    return destination.entry === input.entry && Boolean(input.entry);
  }
  if (!input.id) return false;
  if (destination.objectId !== input.id) return false;
  if (input.stage && destination.stage !== input.stage) return false;
  if (input.entry && destination.entry !== input.entry) return false;
  if (
    destination.consumer === 'result_center' &&
    input.stage &&
    destination.panel !== DEEP_LINK_STAGE_TO_PANEL[input.stage]
  ) {
    return false;
  }
  return destination.href.includes(encodeId(input.id)) ||
    destination.href.includes(input.id);
}
