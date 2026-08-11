import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import { harnessRuntimeId } from '../harness/workspace-scope.js';
import type {
  CampaignPaidWorkLifecycleRecord,
  CampaignPaidWorkLifecycleStore,
  CampaignPaidWorkResult,
  CampaignPaidWorkSubmission,
} from './campaign-paid-work-lifecycle.js';

type PayloadRow = {
  payload: unknown;
  work_1_state: string;
  work_2_state: string;
};

const CLAIM_LEASE_MS = 60_000;

export class PostgresCampaignPaidWorkLifecycleStore<
    TSubmission extends CampaignPaidWorkSubmission,
    TResult extends CampaignPaidWorkResult,
  >
  implements
    CampaignPaidWorkLifecycleStore<TSubmission, TResult>,
    PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_campaign_paid_work_lifecycles (
        campaign_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        payload jsonb NOT NULL,
        work_1_state text NOT NULL DEFAULT 'pending'
          CHECK (work_1_state IN ('pending', 'claimed', 'complete')),
        work_2_state text NOT NULL DEFAULT 'pending'
          CHECK (work_2_state IN ('pending', 'claimed', 'complete')),
        work_1_claimed_at timestamptz,
        work_2_claimed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS p1_campaign_paid_work_workspace_idx
        ON p1_campaign_paid_work_lifecycles (workspace_id, updated_at DESC)
    `);
    await client.query(`
      ALTER TABLE p1_campaign_paid_work_lifecycles
        ADD COLUMN IF NOT EXISTS work_1_claimed_at timestamptz,
        ADD COLUMN IF NOT EXISTS work_2_claimed_at timestamptz
    `);
  }

  async create(record: CampaignPaidWorkLifecycleRecord<TSubmission, TResult>) {
    await this.pool.query(
      `INSERT INTO p1_campaign_paid_work_lifecycles
         (campaign_id, workspace_id, payload)
       VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (campaign_id) DO NOTHING`,
      [record.campaignId, record.workspaceId, JSON.stringify(record)]
    );
    const stored = await this.get(record.workspaceId, record.campaignId);
    if (!stored) {
      throw new Error('Campaign id already belongs to another workspace.');
    }
    return stored;
  }

  async get(workspaceId: string, campaignId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload, work_1_state, work_2_state
         FROM p1_campaign_paid_work_lifecycles
        WHERE workspace_id=$1 AND campaign_id=$2`,
      [workspaceId, campaignId]
    );
    return result.rows[0] ? parseRecord<TSubmission, TResult>(result.rows[0]) : null;
  }

  async isDelivered(workspaceId: string, taskId: string) {
    const runtimeId = harnessRuntimeId(workspaceId, taskId);
    // Living Plan prepared attempts admit as `${taskId}:plan-rN` workflow ids.
    // Campaign results store the bare composer task id — match both so Work 2
    // can advance after package_delivered on the prepared attempt.
    const result = await this.pool.query<{ delivered: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM harness_runtime.task_requests request
           JOIN harness_runtime.audit_events delivery
             ON delivery.workflow_id=request.task_id
            AND delivery.event_type='package_delivered'
          WHERE request.request->>'workspaceId'=$1
            AND (
              request.workflow_id=$2
              OR request.workflow_id LIKE $2 || ':%'
              OR request.task_id=$3
              OR request.runtime_id=$3
            )
       ) AS delivered`,
      [workspaceId, taskId, runtimeId]
    );
    return result.rows[0]?.delivered === true;
  }

  async listOpen(limit: number) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload, work_1_state, work_2_state
         FROM p1_campaign_paid_work_lifecycles
        WHERE work_2_state <> 'complete'
        ORDER BY updated_at, campaign_id
        LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => parseRecord<TSubmission, TResult>(row));
  }

  async claimWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number
  ) {
    const column = workStateColumn(workOrdinal);
    const claimedAtColumn = workClaimedAtColumn(workOrdinal);
    const claimed = await this.pool.query<PayloadRow>(
      `UPDATE p1_campaign_paid_work_lifecycles
          SET ${column}='claimed', ${claimedAtColumn}=clock_timestamp(),
              updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND campaign_id=$2
          AND (${column}='pending' OR (
            ${column}='claimed'
            AND ${claimedAtColumn} < clock_timestamp() - ($3 * interval '1 millisecond')
          ))
        RETURNING payload, work_1_state, work_2_state`,
      [workspaceId, campaignId, CLAIM_LEASE_MS]
    );
    if (claimed.rows[0]) {
      return {
        kind: 'claimed' as const,
        record: parseRecord<TSubmission, TResult>(claimed.rows[0]),
      };
    }
    const current = await this.readRow(workspaceId, campaignId);
    return {
      kind: current[column] === 'complete' ? ('complete' as const) : ('busy' as const),
      record: parseRecord<TSubmission, TResult>(current),
    };
  }

  async completeWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number,
    result: TResult
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.readRow(workspaceId, campaignId, client, true);
      const record = parseRecord<TSubmission, TResult>(current);
      record.results[workOrdinal - 1] ??= result;
      const column = workStateColumn(workOrdinal);
      const claimedAtColumn = workClaimedAtColumn(workOrdinal);
      const updated = await client.query<PayloadRow>(
        `UPDATE p1_campaign_paid_work_lifecycles
            SET payload=$3::jsonb, ${column}='complete',
                ${claimedAtColumn}=NULL, updated_at=clock_timestamp()
          WHERE workspace_id=$1 AND campaign_id=$2
          RETURNING payload, work_1_state, work_2_state`,
        [workspaceId, campaignId, JSON.stringify(record)]
      );
      await client.query('COMMIT');
      return parseRecord<TSubmission, TResult>(updated.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseWork(
    workspaceId: string,
    campaignId: string,
    workOrdinal: number
  ) {
    const column = workStateColumn(workOrdinal);
    const claimedAtColumn = workClaimedAtColumn(workOrdinal);
    await this.pool.query(
      `UPDATE p1_campaign_paid_work_lifecycles
          SET ${column}='pending', ${claimedAtColumn}=NULL,
              updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND campaign_id=$2 AND ${column}='claimed'`,
      [workspaceId, campaignId]
    );
  }

  private async readRow(
    workspaceId: string,
    campaignId: string,
    db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.pool,
    lock = false
  ) {
    const result = await db.query<PayloadRow>(
      `SELECT payload, work_1_state, work_2_state
         FROM p1_campaign_paid_work_lifecycles
        WHERE workspace_id=$1 AND campaign_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [workspaceId, campaignId]
    );
    if (!result.rows[0]) {
      throw new Error('Campaign paid Work lifecycle was not found.');
    }
    return result.rows[0];
  }
}

function parseRecord<
  TSubmission extends CampaignPaidWorkSubmission,
  TResult extends CampaignPaidWorkResult,
>(row: PayloadRow): CampaignPaidWorkLifecycleRecord<TSubmission, TResult> {
  return structuredClone(
    row.payload as CampaignPaidWorkLifecycleRecord<TSubmission, TResult>
  );
}

function workStateColumn(workOrdinal: number): 'work_1_state' | 'work_2_state' {
  if (workOrdinal === 1) return 'work_1_state';
  if (workOrdinal === 2) return 'work_2_state';
  throw new Error('Campaign workOrdinal must be 1 or 2.');
}

function workClaimedAtColumn(
  workOrdinal: number
): 'work_1_claimed_at' | 'work_2_claimed_at' {
  if (workOrdinal === 1) return 'work_1_claimed_at';
  if (workOrdinal === 2) return 'work_2_claimed_at';
  throw new Error('Campaign workOrdinal must be 1 or 2.');
}
