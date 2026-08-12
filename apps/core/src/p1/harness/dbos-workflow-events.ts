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
import {
  productUsageRefundLanded,
  projectActionUsage,
} from './action-usage.js';
import { HARNESS_SUPERSEDED_BY_REPRICE_OUTCOME } from './workflow-core.js';
import { merchantFailureReport } from './merchant-delivery-language.js';
import { harnessRuntimeId } from './workspace-scope.js';
import {
  authorizeHarnessAction,
  HarnessActionAuthorizationError,
} from './action-registry.js';
import { HARNESS_ACTION_CARRIERS } from './action-carriers.js';

const HOLD_EXPIRY_REFUND_SETTLED_MESSAGE =
  '超时未选择，本次任务已取消，积分已退回';

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
  /**
   * DBOS status string, or null when the workflow has not been created yet.
   * Optional so bespoke test transports keep the plain end-of-stream
   * semantics; the production transport must provide it — without it a
   * subscription opened before 开始制作 ends with zero frames (V31-56 runs
   * only start on the Living Plan strip).
   */
  getWorkflowStatus?(workflowId: string): Promise<string | null>;
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
  async getWorkflowStatus(workflowId) {
    return (await DBOS.getWorkflowStatus(workflowId))?.status ?? null;
  },
};

/** DBOS statuses under which the progress stream can still grow. */
const ACTIVE_WORKFLOW_STATUSES = new Set(['PENDING', 'ENQUEUED', 'DELAYED']);

const STREAM_RETRY_DELAY_MS = 500;

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
    // DBOS.readStream ends for a workflow that does not exist yet, and the
    // browser subscribes right after the 202 while a V31-56 prepared run is
    // only created at 开始制作 — so an ended stream is final only once the
    // workflow exists and is no longer active. Replayed offsets on a retried
    // stream are skipped, never re-yielded.
    let delivered = 0;
    while (!signal.aborted) {
      let offset = 0;
      const iterator = this.transport
        .readStream(runtimeWorkflowId, 'progress')
        [Symbol.asyncIterator]();
      try {
        while (!signal.aborted) {
          const next = await nextUnlessAborted(iterator, signal);
          if (!next || next.done) break;
          offset += 1;
          if (offset <= delivered) continue;
          delivered = offset;
          const token = workflowTokenEnvelopeSchema.safeParse(next.value);
          yield token.success
            ? token.data
            : workflowProgressEnvelopeSchema.parse(next.value);
        }
      } finally {
        await iterator.return?.();
      }
      if (signal.aborted || !this.transport.getWorkflowStatus) return;
      const status = await this.transport.getWorkflowStatus(runtimeWorkflowId);
      if (status !== null && !ACTIVE_WORKFLOW_STATUSES.has(status)) return;
      await abortableDelay(STREAM_RETRY_DELAY_MS, signal);
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
      const usage = await this.usage?.getUsage(workflowId, workspaceId);
      // V31-63: superseded_by_reprice settled nothing on this run — its hold
      // was refunded by the successor admission, so the projected action usage
      // is 'rejected' (zero settled units), same as a cancellation.
      const actionUsage = usage
        ? projectActionUsage(
            usage,
            snapshot.outcome === 'cancelled' ||
              snapshot.outcome === HARNESS_SUPERSEDED_BY_REPRICE_OUTCOME
              ? 'rejected'
              : 'completed',
          )
        : null;
      // Credit-era full refunds land with refundedQuantity=0. Prefer ledger
      // truth (status/refundedCredits) so a cancellation that still carries
      // 「积分退款处理中」upgrades once ProductUsage shows the credits back.
      const currentSnapshot =
        snapshot.outcome === 'cancelled' && productUsageRefundLanded(usage)
          ? {
              ...snapshot,
              merchantMessage: HOLD_EXPIRY_REFUND_SETTLED_MESSAGE,
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
      const usage = await this.usage?.getUsage(workflowId, workspaceId);
      const actionUsage = usage ? projectActionUsage(usage, 'rejected') : null;
      const currentFailure = productUsageRefundLanded(usage)
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

}

function failureRevision(failure: Record<string, unknown> | null) {
  const revision = failure?.currentRevision;
  return typeof revision === 'number' && Number.isInteger(revision)
    ? revision
    : 0;
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
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
