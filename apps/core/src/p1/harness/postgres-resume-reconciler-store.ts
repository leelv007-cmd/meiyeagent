import { structuredDecisionInputSchema } from '@meiye/contracts';
import type { Pool } from 'pg';

import type {
  HarnessPendingResume,
  HarnessResumeReconcilerStore,
} from './resume-reconciler.js';
import type { HarnessWorkflowInput } from './task-admission.js';

export class PostgresHarnessResumeReconcilerStore
  implements HarnessResumeReconcilerStore
{
  constructor(private readonly pool: Pool) {}

  async listPending(limit: number): Promise<HarnessPendingResume[]> {
    const result = await this.pool.query<{
      event_id: string;
      idempotency_key: string;
      payload: unknown;
      question_id: string;
      request: HarnessWorkflowInput;
      resolution_source: 'decision' | 'late_answer';
      task_id: string;
      workflow_revision: string;
      workspace_id: string;
    }>(
      `select events.id as event_id,
              events.idempotency_key,
              events.payload,
              events.question_id,
              requests.request,
              events.resolution_source,
              requests.workflow_id as task_id,
              events.workflow_revision::text as workflow_revision,
              requests.request->>'workspaceId' as workspace_id
       from harness_runtime.decision_events events
       join harness_runtime.task_requests requests
         on requests.runtime_id=events.task_id
       where events.resume_status='pending'
         and events.resolution_source in ('decision','late_answer')
       order by events.created_at, events.id
       limit $1`,
      [limit]
    );
    return result.rows.map((row) => {
      const payload = record(row.payload);
      return {
        eventId: row.event_id,
        workspaceId: row.workspace_id,
        taskId: row.task_id,
        request: row.request,
        resolutionSource: row.resolution_source,
        command: structuredDecisionInputSchema.parse({
          idempotencyKey: row.idempotency_key,
          questionId: row.question_id,
          workflowRevision: Number(row.workflow_revision),
          patch: payload?.patch,
          decision: payload?.decision,
        }),
      };
    });
  }

  async markResumed(eventId: string) {
    await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='sent'
       where id=$1 and resume_status='pending'`,
      [eventId]
    );
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
