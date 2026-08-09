/**
 * PostgreSQL acceptance for PostgresResultAdjustSnapshotReadPort.
 *
 * The port had no test at all: its recursive lineage CTE, its ready-artifact
 * query and the branch that separates "no ready revision" from "a ready
 * revision that cannot be read" were only ever exercised through a fake in
 * `operations-result-command-port.test.ts`. That fake decides for itself what
 * the port would return, so it could not have caught the port returning the
 * wrong row, ignoring the workspace, or reading an unparseable revision as
 * absent. Skips when TEST_DATABASE_URL is unset (no self-start Postgres).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { ARTIFACT_UPDATE_SCHEMA_VERSION } from '@meiye/contracts';
import { AgentSemanticEventProjector } from '../agent-semantic-events/semantic-event-projector.js';
import { PostgresAgentSemanticEventStore } from '../agent-semantic-events/postgres-semantic-event-store.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { CreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { PostgresCreationSubmissionStore } from '../execution-spine/postgres-creation-submission-store.js';
import type { ResultAdjustSnapshotReadPort } from './operations-visual-adoption.js';
import { PostgresResultAdjustSnapshotReadPort } from './postgres-result-adjust-snapshot.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

test(
  'the read port separates a legacy Result, a run with no ready revision, and one whose ready revision cannot be read',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const submissions = new PostgresCreationSubmissionStore(pool, {
      async reserve() {},
    });
    const events = new PostgresAgentSemanticEventStore(pool);
    // Typed as the port interface on purpose: the assertions below are the
    // contract its consumer sees, not the narrower shape the class infers.
    const port: ResultAdjustSnapshotReadPort =
      new PostgresResultAdjustSnapshotReadPort(pool);
    const suffix = randomUUID();
    const workspaceId = `adjust-read-${suffix}`;

    try {
      await submissions.applySchema();
      await events.migrate();
      const projector = new AgentSemanticEventProjector(events);

      // 1. Legacy: delivered before agentBinding.threadId existed.
      const legacy = noteSnapshot(workspaceId, `${suffix}-legacy`);
      await insertSubmission(pool, workspaceId, legacy, {});
      const legacyRead = await port.get({
        snapshotId: legacy.id,
        workspaceId,
      });
      assert.ok(legacyRead && 'snapshot' in legacyRead);
      assert.equal(legacyRead.snapshot.id, legacy.id);
      assert.equal(legacyRead.agentThreadId, undefined);
      assert.equal(legacyRead.artifactLineage, undefined);
      assert.equal(legacyRead.artifactLineageUnreadable, undefined);

      // 2. Bound, but the run never reached a ready revision. A partial
      //    revision exists, so this also proves the status filter is doing the
      //    work rather than the absence of any artifact event.
      const partial = noteSnapshot(workspaceId, `${suffix}-partial`);
      const partialThread = `thread-${suffix}-partial`;
      await insertSubmission(pool, workspaceId, partial, {
        agentBinding: { threadId: partialThread, runId: `run-${suffix}-a` },
      });
      await projector.project(
        artifactCandidate({
          artifactId: `note:${partial.contentPackage.id}`,
          eventId: `artifact.revised:${suffix}-partial:r1`,
          resourceId: workspaceId,
          revision: 1,
          status: 'partial',
          threadId: partialThread,
        }),
      );
      const partialRead = await port.get({
        snapshotId: partial.id,
        workspaceId,
      });
      assert.ok(partialRead && 'snapshot' in partialRead);
      assert.equal(partialRead.agentThreadId, partialThread);
      assert.equal(partialRead.artifactLineage, undefined);
      assert.equal(partialRead.artifactLineageUnreadable, undefined);

      // 3. Ready: the latest ready revision wins, and the artifactId falls back
      //    to the lens prefix when the submission stored none.
      const ready = noteSnapshot(workspaceId, `${suffix}-ready`);
      const readyThread = `thread-${suffix}-ready`;
      await insertSubmission(pool, workspaceId, ready, {
        agentBinding: { threadId: readyThread, runId: `run-${suffix}-b` },
      });
      for (const revision of [4, 9]) {
        await projector.project(
          artifactCandidate({
            artifactId: `note:${ready.contentPackage.id}`,
            eventId: `artifact.revised:${suffix}-ready:r${revision}`,
            resourceId: workspaceId,
            revision,
            status: 'ready',
            threadId: readyThread,
          }),
        );
      }
      const readyRead = await port.get({ snapshotId: ready.id, workspaceId });
      assert.ok(readyRead && 'snapshot' in readyRead);
      assert.deepEqual(readyRead.artifactLineage, {
        artifactId: `note:${ready.contentPackage.id}`,
        parentRevision: 9,
      });
      assert.equal(readyRead.artifactLineageUnreadable, undefined);

      // 4. A ready revision that does not parse as artifact-update/v1. It
      //    satisfies both SQL filters, so only the parse separates it from
      //    case 3 — and reading it as "absent" would silently start a fresh
      //    artifact and lose the merchant's revision history.
      const corrupt = noteSnapshot(workspaceId, `${suffix}-corrupt`);
      const corruptThread = `thread-${suffix}-corrupt`;
      await insertSubmission(pool, workspaceId, corrupt, {
        agentBinding: { threadId: corruptThread, runId: `run-${suffix}-c` },
      });
      await projector.project({
        ...artifactCandidate({
          artifactId: `note:${corrupt.contentPackage.id}`,
          eventId: `artifact.revised:${suffix}-corrupt:r1`,
          resourceId: workspaceId,
          revision: 1,
          status: 'ready',
          threadId: corruptThread,
        }),
        payload: {
          schemaVersion: ARTIFACT_UPDATE_SCHEMA_VERSION,
          artifactId: `note:${corrupt.contentPackage.id}`,
          artifactType: 'note',
          status: 'ready',
          revision: 'not-a-number',
        },
      });
      const corruptRead = await port.get({
        snapshotId: corrupt.id,
        workspaceId,
      });
      assert.ok(corruptRead && 'snapshot' in corruptRead);
      assert.equal(corruptRead.agentThreadId, corruptThread);
      assert.equal(corruptRead.artifactLineage, undefined);
      assert.equal(corruptRead.artifactLineageUnreadable, true);
    } finally {
      await cleanup(pool, workspaceId);
      await pool.end();
    }
  },
);

test(
  'the read port follows the semantic-decision successor and never crosses a workspace',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const submissions = new PostgresCreationSubmissionStore(pool, {
      async reserve() {},
    });
    const events = new PostgresAgentSemanticEventStore(pool);
    // Typed as the port interface on purpose: the assertions below are the
    // contract its consumer sees, not the narrower shape the class infers.
    const port: ResultAdjustSnapshotReadPort =
      new PostgresResultAdjustSnapshotReadPort(pool);
    const suffix = randomUUID();
    const workspaceId = `adjust-lineage-${suffix}`;
    const otherWorkspaceId = `adjust-other-${suffix}`;

    try {
      await submissions.applySchema();
      await events.migrate();

      const parent = noteSnapshot(workspaceId, `${suffix}-parent`);
      await insertSubmission(pool, workspaceId, parent, {}, '2026-08-09T09:00:00.000Z');
      // The successor a semantic answer creates: same Work, new snapshot,
      // pointing back at the snapshot the merchant answered from.
      const successor = {
        ...noteSnapshot(workspaceId, `${suffix}-successor`),
        semanticDecision: {
          sourceSnapshotId: parent.id,
          reference: {
            field: 'note_style',
            id: `decision-${suffix}`,
            revision: 1,
            value: '故事版',
          },
        },
      } as unknown as CreationExecutionSnapshot;
      await insertSubmission(
        pool,
        workspaceId,
        successor,
        {},
        '2026-08-09T09:05:00.000Z',
      );

      // Asking for the parent returns the newest snapshot in its chain.
      const chained = await port.get({ snapshotId: parent.id, workspaceId });
      assert.ok(chained && 'snapshot' in chained);
      assert.equal(chained.snapshot.id, successor.id);
      assert.equal(
        chained.snapshot.semanticDecision?.reference.value,
        '故事版',
      );

      // Snapshot ids are globally unique (`creation_submissions_pkey` is on `id`
      // alone), so the workspace predicate cannot be a collision guard — it is a
      // scoping guard, and this is what it buys: the row exists, and another
      // workspace asking for it by id still gets nothing.
      assert.equal(
        await port.get({ snapshotId: parent.id, workspaceId: otherWorkspaceId }),
        null,
      );
      assert.equal(
        await port.get({ snapshotId: `${parent.id}-absent`, workspaceId }),
        null,
      );
    } finally {
      await cleanup(pool, workspaceId);
      await cleanup(pool, otherWorkspaceId);
      await pool.end();
    }
  },
);

function noteSnapshot(workspaceId: string, suffix: string) {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      catalogModel: { id: 'note-model-1', revision: 'catalog-r1' },
      contentModules: ['social_cover'],
      contentPackageId: `adjust-package-${suffix}`,
      creationMode: 'customized',
      deliverable: {
        kind: 'note',
        quantity: 1,
        aspectRatio: '9:16',
        notePageBound: 3,
      },
      deliverables: [
        {
          id: 'image_text_note-main',
          kind: 'image_text_note',
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
          notePageBound: 3,
        },
      ],
      distributionTarget: 'export',
      expectedContentPackageRevision: 0,
      identity: { id: 'identity-1', revision: 'identity-r1' },
      idempotencyKey: `submission-${suffix}`,
      intent: '把夏日护理项目做成可发布的图文',
      lens: 'image_text_note',
      modelPolicy: { id: 'policy-1', mode: 'fixed', revision: 'policy-r1' },
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      quote: { id: `adjust-quote-${suffix}`, revision: 'quote-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      rights: { revision: 'rights-r1', summary: 'authorized source assets' },
      route: { id: 'route-1', revision: 'route-r1' },
      sources: {
        assets: [{ id: 'asset-1', revision: 'asset-r1', role: 'reference' }],
      },
      surface: { id: 'surface-1', revision: 'surface-r1' },
      taskId: `adjust-task-${suffix}`,
      workId: `adjust-work-${suffix}`,
      workspaceId,
    },
    '2026-08-09T08:00:00.000Z',
  );
}

function artifactCandidate(input: {
  artifactId: string;
  eventId: string;
  resourceId: string;
  revision: number;
  status: 'partial' | 'ready';
  threadId: string;
}) {
  return {
    eventId: input.eventId,
    threadId: input.threadId,
    resourceId: input.resourceId,
    contextRole: 'excluded' as const,
    sourceDomain: 'make_harness.artifact',
    sourceEntityId: input.artifactId,
    sourceRevision: String(input.revision),
    correlationId: input.eventId,
    eventType: 'artifact.revised',
    payload: {
      schemaVersion: ARTIFACT_UPDATE_SCHEMA_VERSION,
      artifactId: input.artifactId,
      artifactType: 'note' as const,
      revision: input.revision,
      status: input.status,
      mode: 'snapshot' as const,
      full: { pages: [{ pageIndex: 0, stage: 'image' as const }] },
      summary: `note page 1 image ${input.status}`,
    },
    occurredAt: '2026-08-09T08:00:00.000Z',
  };
}

async function insertSubmission(
  pool: Pool,
  workspaceId: string,
  snapshot: CreationExecutionSnapshot,
  extra: Record<string, unknown>,
  createdAt = '2026-08-09T08:00:00.000Z',
) {
  await pool.query(
    `INSERT INTO execution_spine.creation_submissions
       (id, workspace_id, idempotency_key, payload_hash, submission,
        harness_state, task_id, created_at)
     VALUES ($1,$2,$3,$3,$4::jsonb,'started',$5,$6::timestamptz)`,
    [
      snapshot.id,
      workspaceId,
      `idempotency-${workspaceId}-${snapshot.id}`,
      JSON.stringify({
        ...extra,
        contentPackage: { expectedRevision: 0, id: snapshot.contentPackage.id },
        snapshot,
        task: { id: snapshot.task.id },
        usageReservation: {
          id: `usage-${snapshot.task.id}`,
          units: [{ resource: 'image', quantity: 1 }],
        },
        work: { id: snapshot.work.id },
      }),
      snapshot.task.id,
      createdAt,
    ],
  );
}

async function cleanup(pool: Pool, workspaceId: string) {
  await pool
    .query(
      'DELETE FROM execution_spine.creation_submissions WHERE workspace_id = $1',
      [workspaceId],
    )
    .catch(() => undefined);
  await pool
    .query('DELETE FROM p1_agent_semantic_events WHERE resource_id = $1', [
      workspaceId,
    ])
    .catch(() => undefined);
}
