/**
 * The single classifier from workspace facts to actionable-inbox event
 * sources (可恢复异常 / terminal states / delivery events).
 *
 * Until 2026-08-12 this decision lived twice — once in the platform
 * pending-actions assembler and once inside ResultDeliveryProjectionService —
 * with divergent rules: a `recoverable` creative job was an exception on one
 * surface and invisible on the other, `legacy_handoff_event`-published was
 * only recognized on one side, and the two produced different deep links for
 * the same delivery event. Worse, the live wire had no producer for its
 * taskEvents branch and no modelRuns reader wired, so the shipped inbox never
 * surfaced any terminal/recovery item at all. Both HTTP surfaces now call
 * this module; the classification rule is stated once.
 */
import type { ContentPackage } from '@meiye/contracts';
import type { ModelSupplyResult } from '../model-supply/ledger-contracts.js';
import type {
  InboxDeliveryEventSource,
  InboxTaskTerminalSource,
} from './actionable-inbox.js';

/** Narrow structural facts this classifier needs — a subset of workspace state. */
export type InboxSourceFacts = {
  workspaceId: string;
  contentPackages?: readonly ContentPackage[];
  tasks?: ReadonlyArray<{
    id: string;
    title?: string;
    relatedObject?: { id: string; kind: string };
  }>;
  taskEvents?: ReadonlyArray<{
    id: string;
    taskId: string;
    event: string;
    createdAt: string;
  }>;
  creativeWorks?: ReadonlyArray<{
    id: string;
    intent?: string;
  }>;
  creativeJobs?: ReadonlyArray<{
    id: string;
    workId: string;
    workspaceId: string;
    status: string;
    updatedAt: string;
  }>;
  modelRuns?: readonly ModelSupplyResult[];
};

export type InboxEventSources = {
  tasks: InboxTaskTerminalSource[];
  deliveryEvents: InboxDeliveryEventSource[];
  workIdByTaskId: Record<string, string>;
};

/**
 * Publish outcome of a delivery event. `legacy_handoff_event` with operation
 * `published` counts as published — the rule that previously existed only on
 * the projection-service side.
 */
export function deliveryStatusOf(event: {
  type: string;
  status?: string;
  operation?: string;
}): 'published' | 'failed' | 'unknown' | undefined {
  if (
    event.status === 'published' ||
    event.status === 'failed' ||
    event.status === 'unknown'
  ) {
    return event.status;
  }
  if (event.type === 'legacy_handoff_event' && event.operation === 'published') {
    return 'published';
  }
  return undefined;
}

export function projectInboxEventSources(
  facts: InboxSourceFacts,
): InboxEventSources {
  const workspaceId = facts.workspaceId;
  const tasks = facts.tasks ?? [];
  const taskEvents = facts.taskEvents ?? [];
  const creativeJobs = facts.creativeJobs ?? [];
  const creativeWorks = facts.creativeWorks ?? [];
  const modelRuns = facts.modelRuns ?? [];
  const contentPackages = facts.contentPackages ?? [];

  const terminal: InboxTaskTerminalSource[] = [];
  const seenTaskIds = new Set<string>();
  const push = (source: InboxTaskTerminalSource) => {
    if (seenTaskIds.has(source.taskId)) return;
    seenTaskIds.add(source.taskId);
    terminal.push(source);
  };

  // 1) Content Task execution terminal events (latest per task).
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const latestByTask = new Map<string, (typeof taskEvents)[number]>();
  for (const event of taskEvents) {
    if (
      event.event !== 'execution_completed' &&
      event.event !== 'execution_failed'
    ) {
      continue;
    }
    const previous = latestByTask.get(event.taskId);
    if (!previous || previous.createdAt < event.createdAt) {
      latestByTask.set(event.taskId, event);
    }
  }
  for (const event of latestByTask.values()) {
    const task = taskById.get(event.taskId);
    if (!task || task.relatedObject?.kind !== 'work') continue;
    push({
      taskId: task.id,
      workspaceId,
      workId: task.relatedObject.id,
      taskStatus:
        event.event === 'execution_completed' ? 'completed' : 'failed',
      occurredAt: event.createdAt,
      title: task.title,
    });
  }

  // 2) Creative jobs in terminal or recovery-relevant states. `recoverable`
  //    and `unknown` are 可恢复异常 and must surface on every inbox surface.
  const workById = new Map(creativeWorks.map((work) => [work.id, work]));
  for (const job of creativeJobs) {
    const work = workById.get(job.workId);
    if (!work) continue;
    const taskStatus =
      job.status === 'completed'
        ? ('completed' as const)
        : job.status === 'failed'
          ? ('failed' as const)
          : job.status === 'unknown' || job.status === 'recoverable'
            ? ('acceptance_unknown' as const)
            : null;
    if (!taskStatus) continue;
    push({
      taskId: job.id,
      workspaceId: job.workspaceId,
      workId: job.workId,
      taskStatus,
      occurredAt: job.updatedAt,
      title: work.intent,
    });
  }

  // 3) Model supply runs (when a runs reader is wired).
  for (const run of modelRuns) {
    const workId = run.origin?.projectId;
    if (!workId) continue;
    const taskStatus =
      run.status === 'completed'
        ? ('completed' as const)
        : run.status === 'failed'
          ? ('failed' as const)
          : run.attempt.acceptance === 'acceptance_unknown'
            ? ('acceptance_unknown' as const)
            : null;
    if (!taskStatus) continue;
    push({
      taskId: run.jobId,
      workspaceId,
      workId,
      taskStatus,
      occurredAt: run.attempt.createdAt,
      title: `Model supply ${run.operation ?? 'generation'}`,
    });
  }

  // Delivery events: one deep-link rule. contentId is always the owning
  // package; version prefers the event's own variant, falling back to the
  // package's current (or latest) version.
  const deliveryEvents: InboxDeliveryEventSource[] = [];
  for (const contentPackage of contentPackages) {
    const workId =
      contentPackage.source?.workId ??
      contentPackage.source?.layoutCanvas?.workId;
    if (!workId) continue;
    for (const event of contentPackage.deliveryEvents ?? []) {
      const status = deliveryStatusOf(event);
      deliveryEvents.push({
        eventId: event.id,
        packageId: contentPackage.id,
        workspaceId,
        workId,
        occurredAt: event.occurredAt,
        eventType: event.type,
        ...(status ? { deliveryStatus: status } : {}),
        contentId: contentPackage.id,
        versionId:
          event.variantVersionId ??
          contentPackage.currentVersionId ??
          contentPackage.versions.at(-1)?.id,
        contentRevision: contentPackage.revision,
      });
    }
  }

  const workIdByTaskId: Record<string, string> = Object.fromEntries([
    ...creativeJobs.map((job) => [job.id, job.workId] as const),
    ...tasks.flatMap((task) =>
      task.relatedObject?.kind === 'work'
        ? [[task.id, task.relatedObject.id] as const]
        : [],
    ),
  ]);

  return { tasks: terminal, deliveryEvents, workIdByTaskId };
}
