import { structuredDecisionInputSchema } from '@meiye/contracts';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type {
  HarnessPendingResume,
  HarnessResumeReconcilerStore,
} from './resume-reconciler.js';
import { interactionResumeSignalFromEvent } from './interaction-resume.js';
import type { HarnessWorkflowInput } from './task-admission.js';

export class PostgresHarnessResumeReconcilerStore
  implements HarnessResumeReconcilerStore
{
  constructor(private readonly pool: Pool) {}

  async claimPending(limit: number): Promise<HarnessPendingResume[]> {
    return this.claim(limit, null);
  }

  async claimEvent(eventId: string) {
    return (await this.claim(1, eventId))[0] ?? null;
  }

  private async claim(
    limit: number,
    eventId: string | null,
  ): Promise<HarnessPendingResume[]> {
    const claimId = randomUUID();
    const result = await this.pool.query<{
      event_id: string;
      idempotency_key: string;
      payload: unknown;
      question_id: string;
      request: HarnessWorkflowInput | null;
      reservation_released: boolean;
      resolution_source: 'decision' | 'late_answer' | 'system_default';
      runtime_task_id: string;
      task_id: string | null;
      workflow_revision: string;
      workspace_id: string | null;
    }>(
      `with ready as (
         select events.id
         from harness_runtime.decision_events events
         where (
             events.resume_status='pending'
             or (
               events.resume_status='sending'
               and (
                 events.resume_lease_expires_at is null
                 or events.resume_lease_expires_at <= clock_timestamp()
               )
             )
           )
           and events.resolution_source in (
             'decision',
             'late_answer',
             'system_default'
           )
           and ($3::text is null or events.id=$3)
         order by events.created_at, events.id
         limit $1
         for update skip locked
       ),
       claimed as (
         update harness_runtime.decision_events events
         set resume_status='sending',
             resume_claim_id=$2,
             resume_lease_expires_at=clock_timestamp() + interval '5 minutes',
             resume_attempts=events.resume_attempts + 1
         from ready
         where events.id=ready.id
         returning events.*
       )
       select events.id as event_id,
              events.idempotency_key,
              events.payload,
              events.question_id,
              requests.request,
              (
                exists (
                  select 1
                    from harness_runtime.reservation_sweeps sweeps
                   where sweeps.workspace_id=requests.request->>'workspaceId'
                     and sweeps.task_id=requests.workflow_id
                     and sweeps.status='completed'
                )
                or exists (
                  select 1
                    from p1_product_billing_usage usage
                   where usage.workspace_id=requests.request->>'workspaceId'
                     and usage.task_id=coalesce(
                       nullif(requests.request->>'sourceTaskId', ''),
                       requests.workflow_id
                     )
                     and usage.status<>'reserved'
                )
              ) as reservation_released,
              events.resolution_source,
              events.task_id as runtime_task_id,
              requests.workflow_id as task_id,
              events.workflow_revision::text as workflow_revision,
              requests.request->>'workspaceId' as workspace_id
       from claimed events
       left join harness_runtime.task_requests requests
         on requests.runtime_id=events.task_id
       order by events.created_at, events.id`,
      [limit, claimId, eventId]
    );
    return result.rows.map((row) => {
      try {
        if (!row.task_id || !row.workspace_id || !row.request) {
          throw new Error(
            'A Harness resume event requires an owning task request.',
          );
        }
        const payload = record(row.payload);
        if (payload?.kind === 'harness_interaction_resolution') {
          if (row.resolution_source === 'late_answer') {
            throw new Error(
              'A late-answer event cannot carry an interaction resume.',
            );
          }
          return {
            kind: 'interaction' as const,
            claimId,
            eventId: row.event_id,
            workspaceId: row.workspace_id,
            taskId: row.task_id,
            resolutionSource: row.resolution_source,
            resume: interactionResumeSignalFromEvent({
              idempotencyKey: row.idempotency_key,
              payload: row.payload,
              questionId: row.question_id,
              resolutionSource: row.resolution_source,
              runId: row.task_id,
              workflowRevision: Number(row.workflow_revision),
            }),
          };
        }
        if (row.resolution_source === 'system_default') {
          throw new Error(
            'A system-default event requires a typed interaction payload.',
          );
        }
        return {
          kind: 'structured_decision' as const,
          claimId,
          eventId: row.event_id,
          workspaceId: row.workspace_id,
          taskId: row.task_id,
          request: row.request,
          reservationReleased: row.reservation_released === true,
          resolutionSource: row.resolution_source,
          command: structuredDecisionInputSchema.parse({
            idempotencyKey: row.idempotency_key,
            questionId: row.question_id,
            workflowRevision: Number(row.workflow_revision),
            patch: payload?.patch,
            decision: payload?.decision,
          }),
        };
      } catch {
        return {
          kind: 'malformed' as const,
          claimId,
          eventId: row.event_id,
          workspaceId: row.workspace_id ?? '',
          taskId: row.task_id ?? row.runtime_task_id,
        };
      }
    });
  }

  async markResumed(eventId: string, claimId: string) {
    const result = await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='sent',
           resume_claim_id=null,
           resume_lease_expires_at=null
       where id=$1
         and resume_status='sending'
         and resume_claim_id=$2`,
      [eventId, claimId]
    );
    return result.rowCount === 1;
  }

  async release(eventId: string, claimId: string) {
    await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='pending',
           resume_claim_id=null,
           resume_lease_expires_at=null
       where id=$1
         and resume_status='sending'
         and resume_claim_id=$2`,
      [eventId, claimId]
    );
  }

  async markInvalid(eventId: string, claimId: string) {
    const result = await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='invalid',
           resume_claim_id=null,
           resume_lease_expires_at=null
       where id=$1
         and resume_status='sending'
         and resume_claim_id=$2`,
      [eventId, claimId],
    );
    return result.rowCount === 1;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
