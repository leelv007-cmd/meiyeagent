import type { Pool } from 'pg';
import type {
  LegacyInFlightDecision,
  LegacyInFlightDecisionPort,
} from '../../product/legacy-inflight-decision.js';

function isDecision(value: unknown): value is LegacyInFlightDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const decision = value as Partial<LegacyInFlightDecision>;
  return (
    typeof decision.jobId === 'string' &&
    typeof decision.status === 'string' &&
    (decision.decision === 'legacy_drain' ||
      decision.decision === 'new_owner_recovery' ||
      decision.decision === 'manual') &&
    typeof decision.owner === 'string' &&
    decision.owner.length > 0 &&
    typeof decision.reason === 'string' &&
    decision.reason.length > 0 &&
    decision.preserveOriginalTaskRef === true &&
    decision.allowRegeneration === false
  );
}

export class PostgresLegacyInFlightDecisionPort
  implements LegacyInFlightDecisionPort
{
  constructor(private readonly pool: Pool) {}

  async get(workspaceId: string, jobId: string) {
    const result = await this.pool.query<{ decision: unknown }>(
      `SELECT decisions.decision
         FROM p1_cutover_inflight_decisions decisions
         JOIN p1_cutover_execution_runs runs
           ON runs.workspace_id = decisions.workspace_id
          AND runs.run_id = decisions.run_id
        WHERE decisions.workspace_id = $1
          AND decisions.job_id = $2
          AND runs.status IN ('frozen', 'active')
        ORDER BY runs.updated_at DESC
        LIMIT 1`,
      [workspaceId, jobId]
    );
    const decision = result.rows[0]?.decision;
    return isDecision(decision) ? structuredClone(decision) : null;
  }
}
