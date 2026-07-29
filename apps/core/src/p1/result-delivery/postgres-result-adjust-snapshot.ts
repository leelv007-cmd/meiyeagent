import type { Pool } from 'pg';

import { creationExecutionSnapshotSchema } from '../execution-spine/creation-execution-snapshot.js';
import type { ResultAdjustSnapshotReadPort } from './operations-visual-adoption.js';

export class PostgresResultAdjustSnapshotReadPort
  implements ResultAdjustSnapshotReadPort
{
  constructor(private readonly pool: Pool) {}

  async get(input: { snapshotId: string; workspaceId: string }) {
    const result = await this.pool.query<{ snapshot: unknown }>(
      `SELECT submission->'snapshot' AS snapshot
         FROM execution_spine.creation_submissions
        WHERE workspace_id = $1 AND id = $2`,
      [input.workspaceId, input.snapshotId],
    );
    const snapshot = result.rows[0]?.snapshot;
    return snapshot ? creationExecutionSnapshotSchema.parse(snapshot) : null;
  }
}
