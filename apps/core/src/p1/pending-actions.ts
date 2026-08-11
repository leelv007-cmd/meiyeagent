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
import { projectInboxEventSources } from './result-delivery/inbox-sources.js';

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
    creativeWorks?: Array<{ id: string; intent?: string }>;
    creativeJobs?: Array<{
      id: string;
      workId: string;
      workspaceId: string;
      status: string;
      updatedAt: string;
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
    // The single classifier (可恢复异常 / terminal / delivery rules) — shared
    // with ResultDeliveryProjectionService so the two surfaces cannot diverge.
    const sources = projectInboxEventSources({
      workspaceId: input.workspaceId,
      contentPackages: workspace?.contentPackages,
      tasks: workspace?.tasks,
      taskEvents: workspace?.taskEvents,
      creativeWorks: workspace?.creativeWorks,
      creativeJobs: workspace?.creativeJobs,
      modelRuns,
    });
    if (sources.tasks.length === 0 && sources.deliveryEvents.length === 0) {
      return pendingActions;
    }
    return pendingActionsResponseSchema.parse(
      projectExtendedActionableInbox({
        pendingActions,
        tasks: sources.tasks,
        deliveryEvents: sources.deliveryEvents,
        workIdByTaskId: sources.workIdByTaskId,
      }),
    );
  }
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
