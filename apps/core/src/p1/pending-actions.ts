import {
  pendingActionsSchema,
  pendingActionsResponseSchema,
  type ActionableInboxItem,
  type ContentPackage,
  type PendingAction,
  type QuestionCard,
} from '@meiye/contracts';
import type { ModelSupplyResult } from './model-supply/ledger-contracts.js';

import { TaskBlockingNodeConflictError } from './operations/repository.js';
import {
  projectActionableInbox,
  type InboxDeliveryEventSource,
  type InboxTaskTerminalSource,
} from './result-delivery/actionable-inbox.js';

/**
 * Platform pending-actions projection (#94 / Z2-WIRING).
 * Assembled unconditionally in `apps/core/src/main.ts` (no harnessRuntimeConfig
 * gate). Questions may come from harness_runtime schema when present; approvals
 * come from operations workspace state. See pending-actions-assembly.test.ts.
 */

export interface PendingQuestionReader {
  listPendingQuestions(workspaceId: string): Promise<
    Array<{
      createdAt: string;
      question: QuestionCard;
      taskId: string;
    }>
  >;
}

export interface PendingActionsWorkspaceReader {
  hasMembership(userId: string, workspaceId: string): Promise<boolean>;
  loadWorkspace(workspaceId: string): Promise<{
    contentPackages: ContentPackage[];
    tasks?: Array<{
      id: string;
      title: string;
      relatedObject?: { id: string; kind: string };
    }>;
    taskEvents?: Array<{
      id: string;
      taskId: string;
      event: string;
      createdAt: string;
    }>;
  } | null>;
}

export interface PendingActionsModelRunReader {
  listJobs(workspaceId: string): Promise<ModelSupplyResult[]>;
}

export class PendingActionsAccessError extends Error {
  readonly code = 'PENDING_ACTIONS_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Pending actions were not found.');
    this.name = 'PendingActionsAccessError';
  }
}

export class PendingActionsService {
  constructor(
    private readonly questions: PendingQuestionReader,
    private readonly workspaces: PendingActionsWorkspaceReader,
    private readonly modelRuns?: PendingActionsModelRunReader,
  ) {}

  async list(input: { userId: string; workspaceId: string }) {
    if (
      !(await this.workspaces.hasMembership(input.userId, input.workspaceId))
    ) {
      throw new PendingActionsAccessError();
    }
    const [questions, workspace, modelRuns] = await Promise.all([
      this.questions.listPendingQuestions(input.workspaceId),
      this.workspaces.loadWorkspace(input.workspaceId),
      this.modelRuns?.listJobs(input.workspaceId) ?? Promise.resolve([]),
    ]);
    const actions: PendingAction[] = [
      ...questions.map(({ createdAt, question, taskId }) => ({
        createdAt,
        kind: 'question' as const,
        nodeId: question.questionId,
        questionOrApprovalRef: question.questionId,
        taskId,
        workflowId: question.workflowId,
        workflowRevision: question.workflowRevision,
      })),
      ...(workspace?.contentPackages ?? []).flatMap((contentPackage) =>
        (contentPackage.approvalRequests ?? [])
          .filter((request) => request.status === 'pending')
          .map((request) => ({
            approvalRequest: request,
            createdAt: request.createdAt,
            kind: 'approval' as const,
            nodeId: request.nodeId,
            questionOrApprovalRef: request.id,
            taskId: request.taskId,
            workflowId: request.workflowId,
            workflowRevision: request.workflowRevision,
          }))
      ),
    ];
    const taskIds = new Set<string>();
    for (const action of actions) {
      if (taskIds.has(action.taskId)) {
        throw new TaskBlockingNodeConflictError(action.taskId);
      }
      taskIds.add(action.taskId);
    }
    const pendingActions = pendingActionsSchema.parse(
      actions.sort(comparePendingActions),
    );
    const terminalTasks = projectTerminalTaskSources(
      input.workspaceId,
      workspace?.tasks ?? [],
      workspace?.taskEvents ?? [],
      modelRuns,
    );
    const deliveryEvents = projectDeliveryEventSources(
      input.workspaceId,
      workspace?.contentPackages ?? [],
    );
    if (terminalTasks.length === 0 && deliveryEvents.length === 0) {
      return pendingActions;
    }
    return pendingActionsResponseSchema.parse(
      projectExtendedActionableInbox({
        pendingActions,
        tasks: terminalTasks,
        deliveryEvents,
        workIdByTaskId: Object.fromEntries(
          (workspace?.tasks ?? []).flatMap((task) =>
            task.relatedObject?.kind === 'work'
              ? [[task.id, task.relatedObject.id]]
              : [],
          ),
        ),
      }),
    );
  }
}

function projectTerminalTaskSources(
  workspaceId: string,
  tasks: NonNullable<
    Awaited<ReturnType<PendingActionsWorkspaceReader['loadWorkspace']>>
  >['tasks'] extends infer T
    ? NonNullable<T>
    : never,
  taskEvents: NonNullable<
    Awaited<ReturnType<PendingActionsWorkspaceReader['loadWorkspace']>>
  >['taskEvents'] extends infer T
    ? NonNullable<T>
    : never,
  modelRuns: readonly ModelSupplyResult[],
): InboxTaskTerminalSource[] {
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
  const operationTasks = [...latestByTask.values()].flatMap((event) => {
    const task = taskById.get(event.taskId);
    if (!task || task.relatedObject?.kind !== 'work') return [];
    return [
      {
        taskId: task.id,
        workspaceId,
        workId: task.relatedObject.id,
        taskStatus:
          event.event === 'execution_completed'
            ? ('completed' as const)
            : ('failed' as const),
        occurredAt: event.createdAt,
        title: task.title,
      },
    ];
  });
  const generationTasks = modelRuns.flatMap((run) => {
    const workId = run.origin?.projectId;
    if (!workId) return [];
    const taskStatus =
      run.status === 'completed'
        ? ('completed' as const)
        : run.status === 'failed'
          ? ('failed' as const)
          : run.attempt.acceptance === 'acceptance_unknown'
            ? ('acceptance_unknown' as const)
            : null;
    if (!taskStatus) return [];
    return [
      {
        taskId: run.jobId,
        workspaceId,
        workId,
        taskStatus,
        occurredAt: run.attempt.createdAt,
        title: `Model supply ${run.operation ?? 'generation'}`,
      },
    ];
  });
  return [...operationTasks, ...generationTasks];
}

function projectDeliveryEventSources(
  workspaceId: string,
  contentPackages: readonly ContentPackage[],
): InboxDeliveryEventSource[] {
  return contentPackages.flatMap((contentPackage) => {
    const workId =
      contentPackage.source?.workId ??
      contentPackage.source?.layoutCanvas?.workId;
    if (!workId) return [];
    return (contentPackage.deliveryEvents ?? []).map((event) => ({
      eventId: event.id,
      packageId: contentPackage.id,
      workspaceId,
      workId,
      occurredAt: event.occurredAt,
      eventType: event.type,
      ...('status' in event ? { deliveryStatus: event.status } : {}),
      versionId: event.variantVersionId,
      contentRevision: contentPackage.revision,
    }));
  });
}

export function comparePendingActions(left: PendingAction, right: PendingAction) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.taskId.localeCompare(right.taskId) ||
    left.workflowId.localeCompare(right.workflowId) ||
    left.nodeId.localeCompare(right.nodeId) ||
    left.kind.localeCompare(right.kind) ||
    left.questionOrApprovalRef.localeCompare(right.questionOrApprovalRef)
  );
}

/**
 * Extended actionable inbox: PendingAction question|approval plus Task terminal
 * and deliveryEvents reference projections (D-097). Pure composition helper —
 * callers supply already-authorized source rows.
 */
export function projectExtendedActionableInbox(input: {
  pendingActions: readonly PendingAction[];
  tasks?: readonly InboxTaskTerminalSource[];
  deliveryEvents?: readonly InboxDeliveryEventSource[];
  workIdByTaskId?: Readonly<Record<string, string>>;
}): ActionableInboxItem[] {
  return projectActionableInbox({
    pendingActions: input.pendingActions,
    tasks: input.tasks,
    deliveryEvents: input.deliveryEvents,
    workIdByTaskId: input.workIdByTaskId,
  });
}
