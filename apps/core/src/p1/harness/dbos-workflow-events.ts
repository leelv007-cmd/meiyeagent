import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  merchantReportSchema,
  workflowProgressEnvelopeSchema,
  workflowStateEnvelopeSchema,
  workflowTokenEnvelopeSchema,
  type ProductUsageRecord,
  type WorkflowProgressEnvelope,
  type WorkflowTokenEnvelope,
} from '@meiye/contracts';

import type { HarnessWorkflowEventReader } from '../workflow-events.js';
import { projectActionUsage } from './action-usage.js';
import { merchantFailureReport } from './merchant-delivery-language.js';
import { harnessRuntimeId } from './workspace-scope.js';
import {
  authorizeHarnessAction,
  HarnessActionAuthorizationError,
} from './action-registry.js';
import { HARNESS_ACTION_CARRIERS } from './action-carriers.js';

export interface HarnessWorkflowEventAccess {
  taskBelongsToWorkspace(taskId: string, workspaceId: string): Promise<boolean>;
  workflowRuntimeId(
    workspaceId: string,
    workflowId: string,
  ): Promise<string | null>;
  readTerminalFailure(
    workspaceId: string,
    workflowId: string,
  ): Promise<Record<string, unknown> | null>;
}

export interface HarnessDbosEventTransport {
  readStream(workflowId: string, key: string): AsyncIterable<unknown>;
  getResult(workflowId: string): Promise<unknown>;
}

export interface HarnessActionUsageReader {
  getUsage(
    taskId: string,
    workspaceId: string,
  ): Promise<ProductUsageRecord | null>;
}

const dbosTransport: HarnessDbosEventTransport = {
  readStream(workflowId, key) {
    return DBOS.readStream(workflowId, key);
  },
  getResult(workflowId) {
    return DBOS.getResult(workflowId);
  },
};

export class HarnessDbosWorkflowEventReader
  implements HarnessWorkflowEventReader
{
  constructor(
    private readonly access: HarnessWorkflowEventAccess,
    private readonly transport: HarnessDbosEventTransport = dbosTransport,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly usage?: HarnessActionUsageReader,
  ) {}

  owns(workspaceId: string, workflowId: string) {
    return this.access.taskBelongsToWorkspace(workflowId, workspaceId);
  }

  async *readEvents(
    workspaceId: string,
    workflowId: string,
    signal: AbortSignal,
  ): AsyncIterable<WorkflowProgressEnvelope | WorkflowTokenEnvelope> {
    authorizeHarnessAction({
      actionId: HARNESS_ACTION_CARRIERS.subscription,
      caller: 'server',
    });
    const runtimeWorkflowId = await this.runtimeId(workspaceId, workflowId);
    const iterator = this.transport
      .readStream(runtimeWorkflowId, 'progress')
      [Symbol.asyncIterator]();
    try {
      while (!signal.aborted) {
        const next = await nextUnlessAborted(iterator, signal);
        if (!next || next.done) return;
        const token = workflowTokenEnvelopeSchema.safeParse(next.value);
        yield token.success
          ? token.data
          : workflowProgressEnvelopeSchema.parse(next.value);
      }
    } finally {
      await iterator.return?.();
    }
  }

  async readState(
    workspaceId: string,
    workflowId: string,
    _signal: AbortSignal,
  ) {
    authorizeHarnessAction({
      actionId: HARNESS_ACTION_CARRIERS.subscription,
      caller: 'server',
    });
    const runtimeWorkflowId = await this.runtimeId(workspaceId, workflowId);
    try {
      const result = await this.transport.getResult(runtimeWorkflowId);
      const snapshot = asSnapshot(result);
      // 诚实交付: a run that finished with part of the deliverable missing is a
      // success the merchant must still be told about (D-122). The workflow
      // result carries the 申报; the envelope lifts it so the browser never has
      // to read Core's result shape.
      const partial = merchantReportSchema.safeParse(snapshot.merchantReport);
      const actionUsage = await this.readActionUsage(
        workspaceId,
        workflowId,
        snapshot.outcome === 'cancelled' ? 'rejected' : 'completed',
      );
      const currentSnapshot =
        snapshot.outcome === 'cancelled' &&
        actionUsage &&
        actionUsage.refundedUnits > 0
          ? {
              ...snapshot,
              merchantMessage: '超时未选择，本次任务已取消，积分已退回',
            }
          : snapshot;
      return workflowStateEnvelopeSchema.parse({
        workflowId,
        sourceRevision: deliveryRevision(currentSnapshot),
        status: 'success',
        occurredAt: this.now(),
        snapshot: currentSnapshot,
        ...(partial.success ? { merchantReport: partial.data } : {}),
        ...(actionUsage ? { actionUsage } : {}),
      });
    } catch (error) {
      const failure = await this.access.readTerminalFailure(
        workspaceId,
        workflowId,
      );
      if (!failure) throw error;
      const actionUsage = await this.readActionUsage(
        workspaceId,
        workflowId,
        'rejected',
      );
      const currentFailure =
        actionUsage && actionUsage.refundedUnits > 0
          ? { ...failure, quotaRefunded: true }
          : failure;
      return workflowStateEnvelopeSchema.parse({
        workflowId,
        sourceRevision: failureRevision(currentFailure),
        status: 'failed',
        occurredAt: this.now(),
        snapshot: {
          outcome: 'failed',
          error: currentFailure,
        },
        // The 白话原因 + 下一步动作 the failure card renders. Deriving it here —
        // one deterministic mapping over the persisted failure — is what keeps
        // Core's failure copy from dying in the transport layer (P0-2).
        merchantReport: merchantFailureReport(currentFailure),
        ...(actionUsage ? { actionUsage } : {}),
      });
    }
  }

  private async runtimeId(workspaceId: string, workflowId: string) {
    if (!(await this.access.taskBelongsToWorkspace(workflowId, workspaceId))) {
      throw new HarnessActionAuthorizationError(
        'The Harness subscription is not authorized for this workspace.',
      );
    }
    return (
      (await this.access.workflowRuntimeId(workspaceId, workflowId)) ??
      harnessRuntimeId(workspaceId, workflowId)
    );
  }

  private async readActionUsage(
    workspaceId: string,
    workflowId: string,
    status: 'completed' | 'rejected',
  ) {
    const usage = await this.usage?.getUsage(workflowId, workspaceId);
    return usage ? projectActionUsage(usage, status) : null;
  }
}

function failureRevision(failure: Record<string, unknown> | null) {
  const revision = failure?.currentRevision;
  return typeof revision === 'number' && Number.isInteger(revision)
    ? revision
    : 0;
}

function nextUnlessAborted(
  iterator: AsyncIterator<unknown>,
  signal: AbortSignal,
) {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<IteratorResult<unknown> | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    void iterator.next().then(
      (next) => {
        signal.removeEventListener('abort', onAbort);
        resolve(next);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function asSnapshot(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return structuredClone(value) as Record<string, unknown>;
  }
  throw new Error('Harness workflow completed without a result snapshot.');
}

function deliveryRevision(snapshot: Record<string, unknown>) {
  const delivery = snapshot.delivery;
  if (typeof delivery !== 'object' || delivery === null) return 0;
  const revision = (delivery as Record<string, unknown>).revision;
  return typeof revision === 'number' && Number.isInteger(revision)
    ? revision
    : 0;
}
