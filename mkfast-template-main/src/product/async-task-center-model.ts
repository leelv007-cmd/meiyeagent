import { m } from '@/locale/paraglide/messages';
import { creativeOutputLabel } from './creative-quote';

import type { RawCanonicalHistory } from './canonical-history-model';
import type {
  VideoWorkflow,
  VideoWorkflowEnvelope,
} from './video-workflow-model';

export type AsyncTaskStatus =
  | 'submitting'
  | 'queued'
  | 'running'
  | 'recoverable'
  | 'unknown'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface AsyncTaskSummary {
  createdAt: string;
  creativeJobId?: string;
  href: string;
  id: string;
  kind: 'image' | 'video';
  label: string;
  operation: 'image.generate' | 'video.generate';
  providerJobId: string;
  source: 'creative' | 'canvas' | 'video_workflow';
  status: AsyncTaskStatus;
  updatedAt: string;
}

type ComposedVideoJobStatus = Exclude<
  AsyncTaskStatus,
  'recoverable' | 'submitting'
>;

export interface ComposedVideoTaskEnvelope {
  job:
    | (NonNullable<VideoWorkflowEnvelope['job']> & {
        createdAt: string;
        jobId: string;
        status: ComposedVideoJobStatus;
        updatedAt: string;
      })
    | null;
  workflow: VideoWorkflow & {
    actorId: string;
    createdAt: string;
    workspaceId: string;
  };
}

export interface AsyncTaskReadState {
  recentKeys: string[];
  seenTerminalKeys: string[];
  unreadKeys: string[];
}

const TERMINAL_STATUSES = new Set<AsyncTaskStatus>([
  'cancelled',
  'completed',
  'failed',
]);
const NOTIFIABLE_STATUSES = new Set<AsyncTaskStatus>([
  ...TERMINAL_STATUSES,
  'recoverable',
]);

export function asyncTaskTerminalKey(task: AsyncTaskSummary) {
  return NOTIFIABLE_STATUSES.has(task.status)
    ? `${task.id}:${task.status}:${task.updatedAt}`
    : undefined;
}

export function asyncTaskElapsedLabel(
  task: AsyncTaskSummary,
  now = Date.now()
) {
  const startedAt = Date.parse(task.createdAt);
  const endedAt = TERMINAL_STATUSES.has(task.status)
    ? Date.parse(task.updatedAt)
    : now;
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt < startedAt
  ) {
    return undefined;
  }
  const minutes = Math.ceil((endedAt - startedAt) / 60_000);
  const terminal = TERMINAL_STATUSES.has(task.status);
  if (minutes < 1) {
    return terminal
      ? m.async_task_elapsed_total_less_than_minute()
      : m.async_task_elapsed_running_less_than_minute();
  }
  if (minutes < 60) {
    return terminal
      ? m.async_task_elapsed_total_minutes({ minutes })
      : m.async_task_elapsed_running_minutes({ minutes });
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) {
    return terminal
      ? m.async_task_elapsed_total_hours_minutes({
          hours,
          minutes: remainingMinutes,
        })
      : m.async_task_elapsed_running_hours_minutes({
          hours,
          minutes: remainingMinutes,
        });
  }
  return terminal
    ? m.async_task_elapsed_total_hours({ hours })
    : m.async_task_elapsed_running_hours({ hours });
}

export function canonicalAsyncTaskSummaries(
  history: RawCanonicalHistory
): AsyncTaskSummary[] {
  return [
    ...history.jobs.flatMap((job): AsyncTaskSummary[] => {
      if (
        !job.providerJobId ||
        (job.contract.operation !== 'image.generate' &&
          job.contract.operation !== 'video.generate')
      ) {
        return [];
      }
      return [
        {
          createdAt: job.createdAt,
          creativeJobId: job.id,
          href: `/dashboard/jobs/${job.id}`,
          id: job.id,
          kind: job.contract.operation === 'video.generate' ? 'video' : 'image',
          label: creativeOutputLabel(
            job.contract.operation,
            job.contract.outputCount,
            job.contract.aspectRatio
          ),
          operation: job.contract.operation,
          providerJobId: job.providerJobId,
          source: 'creative',
          status: job.status,
          updatedAt: job.updatedAt,
        },
      ];
    }),
    ...history.imageJobs.map(
      (job): AsyncTaskSummary => ({
        createdAt: job.createdAt,
        href: `/dashboard/jobs/${job.id}`,
        id: job.id,
        kind: 'image',
        label: m.canonical_canvas_image_generation(),
        operation: 'image.generate',
        providerJobId: job.id,
        source: 'canvas',
        status: job.status as AsyncTaskStatus,
        updatedAt: job.updatedAt,
      })
    ),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function composedVideoAsyncTaskSummaries(
  envelopes: ComposedVideoTaskEnvelope[]
): AsyncTaskSummary[] {
  return envelopes
    .flatMap((envelope): AsyncTaskSummary[] => {
      const { job, workflow } = envelope;
      if (!job || !workflow.workId) return [];
      const status = composedVideoTaskStatus(envelope);
      return [
        {
          createdAt: workflow.createdAt,
          href: `/dashboard/works/${encodeURIComponent(workflow.workId)}`,
          id: `video-workflow:${workflow.id}`,
          kind: 'video',
          label: m.async_task_kind_video(),
          operation: 'video.generate',
          providerJobId: job.jobId,
          source: 'video_workflow',
          status,
          updatedAt:
            workflow.updatedAt.localeCompare(job.updatedAt) >= 0
              ? workflow.updatedAt
              : job.updatedAt,
        },
      ];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function composedVideoTaskStatus(
  envelope: ComposedVideoTaskEnvelope
): AsyncTaskStatus {
  if (envelope.job?.status === 'failed') return 'failed';
  switch (envelope.workflow.status) {
    case 'awaiting_quality_review':
      return 'recoverable';
    case 'cancel_requested':
    case 'cancelled':
    case 'completed':
    case 'failed':
      return envelope.workflow.status;
    case 'draft':
      return 'queued';
    case 'running':
      return envelope.job?.status ?? 'running';
  }
}

export function reconcileAsyncTaskReadState(
  previous: AsyncTaskReadState | undefined,
  tasks: AsyncTaskSummary[]
): AsyncTaskReadState {
  const currentTerminalKeys = tasks.flatMap((task) => {
    const key = asyncTaskTerminalKey(task);
    return key ? [key] : [];
  });
  if (!previous) {
    return {
      recentKeys: [],
      seenTerminalKeys: currentTerminalKeys,
      unreadKeys: [],
    };
  }
  const seen = new Set(previous.seenTerminalKeys);
  const unread = new Set(previous.unreadKeys);
  const newlyTerminal = currentTerminalKeys.filter(
    (key) => !seen.has(key) && !unread.has(key)
  );
  for (const key of newlyTerminal) unread.add(key);
  return {
    recentKeys: [
      ...newlyTerminal,
      ...previous.recentKeys.filter((key) => !newlyTerminal.includes(key)),
    ].slice(0, 20),
    seenTerminalKeys: [...seen],
    unreadKeys: [...unread],
  };
}

export function markAsyncTasksRead(
  state: AsyncTaskReadState
): AsyncTaskReadState {
  return {
    recentKeys: state.recentKeys,
    seenTerminalKeys: [
      ...new Set([...state.seenTerminalKeys, ...state.unreadKeys]),
    ],
    unreadKeys: [],
  };
}

export function asyncTaskStorageKey(userId: string) {
  return `meiye:async-task-center:${userId}`;
}

export function asyncTaskCenterPlan({
  panelOpen,
  recentKeys,
  tasks,
}: {
  panelOpen: boolean;
  recentKeys: string[];
  tasks: AsyncTaskSummary[];
}) {
  const recent = new Set(recentKeys);
  const activeTasks = tasks.filter(
    (task) => !TERMINAL_STATUSES.has(task.status)
  );
  const observerTasks = tasks.filter((task) =>
    ['queued', 'running', 'unknown', 'cancel_requested'].includes(task.status)
  );
  return {
    activeTasks,
    observerTasks,
    panelTasks: panelOpen
      ? [
          ...activeTasks,
          ...tasks.filter((task) => {
            const key = asyncTaskTerminalKey(task);
            return Boolean(key && recent.has(key));
          }),
        ].slice(0, 6)
      : [],
  };
}
