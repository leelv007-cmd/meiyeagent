import type { Pool } from 'pg';

import { creationExecutionSnapshotSchema } from '../execution-spine/creation-execution-snapshot.js';
import { asAgentThreadIdentity } from '../execution-spine/submission-coordinator.js';
import { artifactUpdateWireSchema } from '@meiye/contracts';
import type { ResultAdjustSnapshotReadPort } from './operations-visual-adoption.js';

export class PostgresResultAdjustSnapshotReadPort
  implements ResultAdjustSnapshotReadPort
{
  constructor(private readonly pool: Pool) {}

  async get(input: { snapshotId: string; workspaceId: string }) {
	const result = await this.pool.query<{ snapshot: unknown; submission: unknown }>(
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
	   SELECT submission->'snapshot' AS snapshot, submission
         FROM lineage
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [input.workspaceId, input.snapshotId],
    );
    const snapshot = result.rows[0]?.snapshot;
	if (!snapshot) return null;
	const parsed = creationExecutionSnapshotSchema.parse(snapshot);
	const submission = result.rows[0]?.submission as {
	  agentBinding?: { threadId?: unknown };
	  artifactLineage?: { artifactId?: unknown };
	} | undefined;
	const threadValue = submission?.agentBinding?.threadId;
	if (typeof threadValue !== 'string') return { snapshot: parsed };
	const agentThreadId = asAgentThreadIdentity(threadValue);
	const storedArtifactId = submission?.artifactLineage?.artifactId;
	const artifactId =
	  typeof storedArtifactId === 'string' && storedArtifactId.trim()
		? storedArtifactId
		: `${parsed.lens === 'image_text_note' ? 'note' : parsed.lens === 'video' ? 'video' : parsed.lens}:${parsed.contentPackage.id}`;
	const artifact = await this.pool.query<{ payload: unknown }>(
	  `SELECT payload
	     FROM p1_agent_semantic_events
	    WHERE thread_id = $1
	      AND resource_id = $3
	      AND event_type = 'artifact.revised'
	      AND payload->'payload'->>'artifactId' = $2
	      AND payload->'payload'->>'status' = 'ready'
	    ORDER BY stream_offset DESC
	    LIMIT 1`,
	  [agentThreadId, artifactId, input.workspaceId],
	);
	const event = artifact.rows[0]?.payload as { payload?: unknown } | undefined;
	const wire = event?.payload ? artifactUpdateWireSchema.safeParse(event.payload) : undefined;
	// No ready revision at all is ordinary: the run may have ended partial, or the
	// Result predates artifact lineage. A ready revision we cannot read is not —
	// the caller fails closed on it rather than starting a fresh artifact and
	// losing the merchant's revision history.
	if (wire && !wire.success) {
	  return { snapshot: parsed, agentThreadId, artifactLineageUnreadable: true as const };
	}
	return {
	  snapshot: parsed,
	  agentThreadId,
	  ...(wire?.success
		? { artifactLineage: { artifactId: wire.data.artifactId, parentRevision: wire.data.revision } }
		: {}),
	};
  }
}
