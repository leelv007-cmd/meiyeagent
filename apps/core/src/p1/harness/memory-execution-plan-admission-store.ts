/**
 * In-memory ExecutionPlanSnapshot store (V31-12 unit / fixture).
 */

import { isDeepStrictEqual } from 'node:util';

import { executionPlanSnapshotSchema } from '@meiye/contracts';

import {
  assertExecutionPlanPublishable,
  ExecutionPlanAdmissionError,
  type AdmittedExecutionPlanSnapshot,
  type ExecutionPlanSnapshotStore,
} from './execution-plan-admission.js';

export class MemoryExecutionPlanSnapshotStore
  implements ExecutionPlanSnapshotStore
{
  readonly #byHash = new Map<string, AdmittedExecutionPlanSnapshot>();
  readonly #byWorkflow = new Map<string, string>();

  async putImmutable(
    row: AdmittedExecutionPlanSnapshot,
  ): Promise<AdmittedExecutionPlanSnapshot> {
    const snapshot = executionPlanSnapshotSchema.parse(row.snapshot);
    assertExecutionPlanPublishable(snapshot.executionPlan);
    const normalized: AdmittedExecutionPlanSnapshot = {
      snapshot,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      admittedAt: row.admittedAt,
    };

    const existingByHash = this.#byHash.get(snapshot.snapshotHash);
    if (existingByHash) {
      if (
        existingByHash.workflowId === normalized.workflowId &&
        existingByHash.workspaceId === normalized.workspaceId &&
        isDeepStrictEqual(existingByHash.snapshot, snapshot)
      ) {
        return structuredClone(existingByHash);
      }
      throw new ExecutionPlanAdmissionError(
        'IDEMPOTENCY_CONFLICT',
        `ExecutionPlanSnapshot ${snapshot.snapshotHash} is immutable and already bound to a different admission row.`,
      );
    }

    const existingWorkflowHash = this.#byWorkflow.get(normalized.workflowId);
    if (existingWorkflowHash && existingWorkflowHash !== snapshot.snapshotHash) {
      throw new ExecutionPlanAdmissionError(
        'IDEMPOTENCY_CONFLICT',
        `Workflow ${normalized.workflowId} already admitted snapshot ${existingWorkflowHash}.`,
      );
    }

    this.#byHash.set(snapshot.snapshotHash, normalized);
    this.#byWorkflow.set(normalized.workflowId, snapshot.snapshotHash);
    return structuredClone(normalized);
  }

  async getByHash(
    snapshotHash: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null> {
    const row = this.#byHash.get(snapshotHash);
    return row ? structuredClone(row) : null;
  }

  async getByWorkflowId(
    workflowId: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null> {
    const hash = this.#byWorkflow.get(workflowId);
    if (!hash) return null;
    return this.getByHash(hash);
  }
}
