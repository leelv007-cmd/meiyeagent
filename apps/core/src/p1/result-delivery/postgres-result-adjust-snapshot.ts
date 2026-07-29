import type { Pool } from 'pg';

import { creationExecutionSnapshotSchema } from '../execution-spine/creation-execution-snapshot.js';
import type { ResultAdjustSnapshotReadPort } from './operations-visual-adoption.js';

export class PostgresResultAdjustSnapshotReadPort
  implements ResultAdjustSnapshotReadPort
{
  constructor(private readonly pool: Pool) {}

  async get(input: { snapshotId: string; workspaceId: string }) {
    const result = await this.pool.query<{ snapshot: unknown }>(
      `WITH RECURSIVE lineage AS (
         SELECT id, submission, created_at
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2
         UNION
         SELECT child.id, child.submission, child.created_at
           FROM execution_spine.creation_submissions child
           JOIN lineage parent
             ON child.submission->'snapshot'->'semanticDecision'
                  ->>'sourceSnapshotId' = parent.id
          WHERE child.workspace_id = $1
       )
       SELECT submission->'snapshot' AS snapshot
         FROM lineage
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [input.workspaceId, input.snapshotId],
    );
    const snapshot = result.rows[0]?.snapshot;
    return snapshot ? creationExecutionSnapshotSchema.parse(snapshot) : null;
  }
}
