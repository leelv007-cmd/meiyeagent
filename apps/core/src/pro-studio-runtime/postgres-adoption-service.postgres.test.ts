import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresFoundationRepository } from '../p1/foundation/postgres-repository.js';
import { PostgresModelSupplyRepository } from '../p1/model-supply/postgres-repository.js';
import { AdvancedCanvasAdoptionError } from './adoption.js';
import { PostgresAdvancedCanvasAdoptionService } from './postgres-adoption-service.js';
import { migrateProStudioWorkspaceState } from './postgres-workspace-state.js';

const connectionString = process.env.TEST_DATABASE_URL;

async function seedP1OwnedAsset(
  repository: PostgresFoundationRepository,
  pool: Pool,
  input: {
    workspaceId: string;
    actorId: string;
    assetId: string;
    jobId: string;
    attemptId: string;
    routeSnapshotId: string;
  }
) {
  const createdAt = new Date().toISOString();
  await repository.insertRouteSnapshot({
    id: input.routeSnapshotId,
    workspaceId: input.workspaceId,
    catalogRevision: 'adoption-p1-catalog',
    policyRevision: 'adoption-p1-policy',
    priceRevision: 'adoption-p1-price',
    requestedCatalogModelId: 'adoption-p1-image',
    selectionMode: 'fixed',
    dataClass: 'public',
    fallbackConsent: false,
    allowedCandidates: [
      {
        catalogModelId: 'adoption-p1-image',
        deploymentId: 'adoption-p1-deployment',
        region: 'cn',
        credentialMode: 'platform',
        credentialVersion: 'adoption-p1-credential',
      },
    ],
    createdAt,
  });
  await repository.insertGenerationJob({
    id: input.jobId,
    workspaceId: input.workspaceId,
    operation: 'image',
    routeSnapshotId: input.routeSnapshotId,
    usageReservationId: `adoption-p1-usage-${input.jobId}`,
    status: 'completed',
    createdBy: input.actorId,
    correlationId: `adoption-p1-correlation-${input.jobId}`,
    createdAt,
    updatedAt: createdAt,
  });
  await repository.insertProviderAttempt({
    id: input.attemptId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    ordinal: 1,
    deploymentId: 'adoption-p1-deployment',
    acceptance: 'accepted',
    providerTaskRef: `adoption-p1-task-${input.attemptId}`,
    status: 'completed',
    createdAt,
    updatedAt: createdAt,
  });
  await pool.query(
    `INSERT INTO p1_owned_assets
     (workspace_id, id, job_id, attempt_id, object_key, sha256, size_bytes, media_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 8, 'image/png', $7::timestamptz)`,
    [
      input.workspaceId,
      input.assetId,
      input.jobId,
      input.attemptId,
      `${input.workspaceId}/private/${input.assetId}.png`,
      'b'.repeat(64),
      createdAt,
    ]
  );
}

test(
  'publishes one ordered ContentPackage version and rejects jobs from another revision atomically',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `adoption-workspace-${suffix}`;
    const userId = `adoption-user-${suffix}`;
    const projectId = `adoption-project-${suffix}`;
    const assetId = `adoption-asset-${suffix}`;
    const jobId = `adoption-job-${suffix}`;
    const revisionId = `adoption-revision-${suffix}`;
    const graph = {
      schemaVersion: 1,
      nodes: [
        { id: 'text-1', type: 'text', data: { text: 'Adopted copy' } },
        {
          id: 'image-1',
          type: 'image',
          data: { assetId, jobId, sourceAssetIds: ['source-1'] },
        },
      ],
      edges: [],
    };
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS "user" (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        email_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS p1_content_packages (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_operations_audit_events (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS pro_studio_audit_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id bigserial PRIMARY KEY,
        action text NOT NULL,
        project_id text,
        actor_id text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL
      )
    `);
    await migrateProStudioWorkspaceState(pool);
    await new PostgresModelSupplyRepository(pool).migrate();
    await pool.query(
      "INSERT INTO workspaces (id, name) VALUES ($1, 'Adoption test')",
      [workspaceId]
    );
    await pool.query(
      `INSERT INTO "user" (id, name, email)
       VALUES ($1, 'Adoption user', $2)`,
      [userId, `${userId}@example.test`]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId]
    );
    await pool.query(
      `INSERT INTO advanced_canvas_projects
       (workspace_id, id, name, graph, draft_version, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Adoption project', $3, 4, $4, now(), now())`,
      [workspaceId, projectId, graph, userId]
    );
    await pool.query(
      `INSERT INTO advanced_canvas_revisions
       (workspace_id, project_id, id, graph, draft_version, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, 4, 'checkpoint', $5, now())`,
      [workspaceId, projectId, revisionId, graph, userId]
    );
    await pool.query(
      `INSERT INTO pro_studio_owned_assets
       (workspace_id, id, object_key, sha256, size_bytes, content_type, file_name, source, created_at)
       VALUES ($1, $2, $3, $4, 8, 'image/png', 'result.png', $5, now())`,
      [
        workspaceId,
        assetId,
        `${workspaceId}/private/${assetId}.png`,
        'a'.repeat(64),
        { kind: 'generation', jobId },
      ]
    );
    await pool.query(
      `INSERT INTO pro_studio_workspace_state
       (namespace, workspace_id, state, updated_at)
       VALUES ('generation', $1, $2, now())`,
      [
        workspaceId,
        {
          quotes: [],
          jobs: [
            {
              id: jobId,
              workspaceId,
              origin: {
                kind: 'advanced_canvas',
                id: projectId,
                revisionId: 'another-revision',
              },
              operation: 'image.generate',
              modelId: 'recorded-image',
              prompt: 'test',
              parameters: {},
              inputAssetIds: [],
              idempotencyKey: 'generation-key',
              quoteId: 'quote-1',
              status: 'completed',
              outputAssetId: assetId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          reservations: [],
          attempts: [],
          providerCosts: [],
          outbox: [],
          assets: [],
          textDeliverables: [],
          receipts: [],
        },
      ]
    );
    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_content_packages WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM advanced_canvas_revisions WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM advanced_canvas_projects WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const service = new PostgresAdvancedCanvasAdoptionService(pool);
    const context = {
      correlationId: 'adoption-postgres',
      userId,
      workspaceId,
    };
    const command = {
      idempotencyKey: 'adoption-key-1',
      projectId,
      revisionRef: { kind: 'frozen' as const, revisionId },
      selection: {
        textNodeId: 'text-1',
        orderedMediaNodeIds: ['image-1'],
      },
      target: { kind: 'new_package' as const },
    };
    await assert.rejects(
      service.adopt(context, {
        ...command,
        idempotencyKey: 'adoption-mismatched-revision',
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'JOB_NOT_DELIVERED'
    );
    const packagesAfterMismatch = await pool.query(
      'SELECT id FROM p1_content_packages WHERE workspace_id = $1',
      [workspaceId]
    );
    assert.equal(packagesAfterMismatch.rowCount, 0);
    const generationRow = await pool.query<{ state: Record<string, any> }>(
      `SELECT state FROM pro_studio_workspace_state
       WHERE namespace = 'generation' AND workspace_id = $1`,
      [workspaceId]
    );
    const generationState = generationRow.rows[0]?.state;
    if (!generationState) throw new Error('Generation state was not created.');
    generationState.jobs[0].origin.revisionId = revisionId;
    await pool.query(
      `UPDATE pro_studio_workspace_state SET state = $2, updated_at = now()
       WHERE namespace = 'generation' AND workspace_id = $1`,
      [workspaceId, generationState]
    );
    const created = await service.adopt(context, command);
    const replayed = await service.adopt(context, {
      ...command,
      idempotencyKey: 'another-key',
    });

    assert.deepEqual(replayed, created);
    assert.deepEqual(await service.listAdoptions(context, projectId), [created]);
    const adoptionState = await pool.query<{ state: Record<string, unknown> }>(
      `SELECT state FROM pro_studio_workspace_state
       WHERE namespace = 'adoption_v1' AND workspace_id = $1`,
      [workspaceId]
    );
    assert.equal('relations' in (adoptionState.rows[0]?.state ?? {}), false);
    const auditsAfterReplay = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pro_studio_audit_events
       WHERE workspace_id = $1 AND action = 'adopt_advanced_canvas_output'`,
      [workspaceId]
    );
    assert.equal(auditsAfterReplay.rows[0]?.count, '1');
    const stored = await pool.query<{ payload: Record<string, any> }>(
      'SELECT payload FROM p1_content_packages WHERE workspace_id = $1',
      [workspaceId]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0]?.payload.status, 'accepted');
    assert.deepEqual(stored.rows[0]?.payload.versions[0].orderedAssetIds, [
      assetId,
    ]);
    assert.deepEqual(
      stored.rows[0]?.payload.versions[0].sourceRef.advancedCanvas
        .orderedMediaNodeIds,
      ['image-1']
    );
    const nextRevisionId = `adoption-next-revision-${suffix}`;
    const nextAssetId = `adoption-next-asset-${suffix}`;
    const nextJobId = `adoption-next-job-${suffix}`;
    const nextGraph = {
      schemaVersion: 1,
      nodes: [
        { id: 'text-3', type: 'text', data: { text: 'Updated copy' } },
        {
          id: 'image-3',
          type: 'image',
          data: {
            assetId: nextAssetId,
            jobId: nextJobId,
            sourceAssetIds: [],
          },
        },
      ],
      edges: [],
    };
    await pool.query(
      `INSERT INTO advanced_canvas_revisions
       (workspace_id, project_id, id, graph, draft_version, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, 4, 'checkpoint', $5, now())`,
      [workspaceId, projectId, nextRevisionId, nextGraph, userId]
    );
    await pool.query(
      `INSERT INTO pro_studio_owned_assets
       (workspace_id, id, object_key, sha256, size_bytes, content_type, file_name, source, created_at)
       VALUES ($1, $2, $3, $4, 8, 'image/png', 'next.png', $5, now())`,
      [
        workspaceId,
        nextAssetId,
        `${workspaceId}/private/${nextAssetId}.png`,
        'c'.repeat(64),
        { kind: 'generation', jobId: nextJobId },
      ]
    );
    generationState.jobs.push({
      id: nextJobId,
      workspaceId,
      origin: {
        kind: 'advanced_canvas',
        id: projectId,
        revisionId: nextRevisionId,
      },
      operation: 'image.generate',
      modelId: 'recorded-image',
      prompt: 'test next',
      parameters: {},
      inputAssetIds: [],
      idempotencyKey: 'generation-next-key',
      quoteId: 'quote-next',
      status: 'completed',
      outputAssetId: nextAssetId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await pool.query(
      `UPDATE pro_studio_workspace_state SET state = $2, updated_at = now()
       WHERE namespace = 'generation' AND workspace_id = $1`,
      [workspaceId, generationState]
    );
    const existingTargetCommand = {
      idempotencyKey: 'adoption-existing-package',
      projectId,
      revisionRef: { kind: 'frozen' as const, revisionId: nextRevisionId },
      selection: {
        textNodeId: 'text-3',
        orderedMediaNodeIds: ['image-3'],
      },
      target: {
        kind: 'existing_package' as const,
        packageId: created.packageId,
        baseVersionId: created.versionId,
        expectedRevision: 0,
      },
    };
    await assert.rejects(
      service.adopt(context, {
        ...existingTargetCommand,
        idempotencyKey: 'adoption-existing-package-stale',
        target: { ...existingTargetCommand.target, expectedRevision: 99 },
      }),
      (error: unknown) =>
        error instanceof AdvancedCanvasAdoptionError &&
        error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT' &&
        error.status === 409 &&
        error.details?.currentRevision === 0 &&
        error.details?.expectedRevision === 99,
    );
    const conflictAudit = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM p1_operations_audit_events
        WHERE workspace_id = $1
          AND payload->>'action' = 'content_package.revision_conflict'
          AND payload->>'entityId' = $2`,
      [workspaceId, created.packageId],
    );
    assert.equal(conflictAudit.rows[0]?.count, '1');
    const nextVersion = await service.adopt(context, existingTargetCommand);
    const replayedNextVersion = await service.adopt(context, {
      ...existingTargetCommand,
      idempotencyKey: 'adoption-existing-package-replay',
    });
    assert.deepEqual(replayedNextVersion, nextVersion);
    const updatedPackageRow = await pool.query<{
      payload: Record<string, any>;
      revision: string;
    }>(
      `SELECT payload, revision::text AS revision FROM p1_content_packages
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, created.packageId]
    );
    assert.equal(updatedPackageRow.rows[0]?.revision, '1');
    assert.equal(updatedPackageRow.rows[0]?.payload.revision, 1);
    const childRuns = updatedPackageRow.rows[0]?.payload.generated.childRuns;
    assert.deepEqual(
      childRuns.map((run: { runId: string }) => run.runId),
      [jobId, nextJobId]
    );
    assert.deepEqual(
      childRuns[0],
      stored.rows[0]?.payload.generated.childRuns[0]
    );
    assert.deepEqual(childRuns[1], {
      runId: nextJobId,
      runType: 'model_job',
      status: 'succeeded',
      assetIds: [nextAssetId],
    });

    const duplicatedSelection = await service.adopt(context, {
      ...command,
      idempotencyKey: 'adoption-duplicated-selection',
      selection: {
        textNodeId: 'text-1',
        orderedMediaNodeIds: ['image-1', 'image-1'],
      },
    });
    assert.deepEqual(duplicatedSelection.orderedMediaNodeIds, [
      'image-1',
      'image-1',
    ]);
    const duplicatedPackage = await pool.query<{
      payload: Record<string, any>;
    }>(
      `SELECT payload FROM p1_content_packages
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, duplicatedSelection.packageId]
    );
    assert.deepEqual(
      duplicatedPackage.rows[0]?.payload.versions[0].orderedAssetIds,
      [assetId, assetId]
    );
    const finalAudits = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pro_studio_audit_events
       WHERE workspace_id = $1 AND action = 'adopt_advanced_canvas_output'`,
      [workspaceId]
    );
    assert.equal(finalAudits.rows[0]?.count, '3');

    await pool.query(
      `UPDATE p1_content_packages SET revision = revision + 1
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, created.packageId]
    );
    await assert.rejects(
      service.adopt(context, {
        ...command,
        idempotencyKey: 'adoption-revision-mismatch-read',
      }),
      /revision column does not match its payload/
    );
  }
);

test(
  'adopts p1 product assets only when the asset belongs to the workspace',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `adoption-product-workspace-${suffix}`;
    const otherWorkspaceId = `adoption-other-workspace-${suffix}`;
    const userId = `adoption-product-user-${suffix}`;
    const projectId = `adoption-product-project-${suffix}`;
    const productSourceRevisionId = `adoption-product-source-revision-${suffix}`;
    const productRevisionId = `adoption-product-revision-${suffix}`;
    const fallbackRevisionId = `adoption-fallback-revision-${suffix}`;
    const crossRevisionId = `adoption-cross-revision-${suffix}`;
    const unknownRevisionId = `adoption-unknown-revision-${suffix}`;
    const crossProjectRevisionId = `adoption-cross-project-revision-${suffix}`;
    const unknownOriginRevisionId = `adoption-unknown-origin-revision-${suffix}`;
    const productAssetId = `adoption-product-asset-${suffix}`;
    const crossAssetId = `adoption-cross-asset-${suffix}`;
    const unknownAssetId = `adoption-unknown-asset-${suffix}`;
    const productJobId = `adoption-product-job-${suffix}`;
    const fallbackJobId = `adoption-fallback-job-${suffix}`;
    const crossJobId = `adoption-cross-job-${suffix}`;
    const unknownJobId = `adoption-unknown-job-${suffix}`;
    const crossProjectJobId = `adoption-cross-project-job-${suffix}`;
    const unknownOriginJobId = `adoption-unknown-origin-job-${suffix}`;
    const productAttemptId = `adoption-product-attempt-${suffix}`;
    const crossAttemptId = `adoption-cross-attempt-${suffix}`;
    const productRouteSnapshotId = `adoption-product-route-${suffix}`;
    const crossRouteSnapshotId = `adoption-cross-route-${suffix}`;
    const foundation = new PostgresFoundationRepository(pool);
    const productGraph = imageGraph(productAssetId, productJobId);
    const fallbackGraph = imageGraph(productAssetId, fallbackJobId);
    const crossGraph = imageGraph(crossAssetId, crossJobId);
    const unknownGraph = imageGraph(unknownAssetId, unknownJobId);
    const crossProjectGraph = imageGraph(productAssetId, crossProjectJobId);
    const unknownOriginGraph = imageGraph(productAssetId, unknownOriginJobId);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS "user" (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        email_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        role text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS advanced_canvas_projects (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        name text NOT NULL,
        graph jsonb NOT NULL,
        draft_version bigint NOT NULL,
        created_by text NOT NULL REFERENCES "user"(id),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        deleted_at timestamptz,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS advanced_canvas_revisions (
        workspace_id text NOT NULL,
        project_id text NOT NULL,
        id text NOT NULL,
        graph jsonb NOT NULL,
        draft_version bigint NOT NULL,
        reason text NOT NULL,
        label text,
        created_by text NOT NULL REFERENCES "user"(id),
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        FOREIGN KEY (workspace_id, project_id)
          REFERENCES advanced_canvas_projects(workspace_id, id)
          ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS pro_studio_owned_assets (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        object_key text NOT NULL,
        legacy_storage_key text,
        sha256 text NOT NULL,
        size_bytes bigint NOT NULL,
        content_type text NOT NULL,
        file_name text NOT NULL,
        source jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_content_packages (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_operations_audit_events (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS pro_studio_audit_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id bigserial PRIMARY KEY,
        action text NOT NULL,
        project_id text,
        actor_id text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL
      )
    `);
    await migrateProStudioWorkspaceState(pool);
    await foundation.migrate();
    await new PostgresModelSupplyRepository(pool).migrate();
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Product adoption test'), ($2, 'Other workspace')`,
      [workspaceId, otherWorkspaceId]
    );
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, 'Product adoption user', $2)`,
      [userId, `${userId}@example.test`]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId]
    );
    await pool.query(
      `INSERT INTO advanced_canvas_projects
       (workspace_id, id, name, graph, draft_version, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Product adoption project', $3, 1, $4, now(), now())`,
      [workspaceId, projectId, productGraph, userId]
    );
    for (const [revisionId, graph] of [
      [productSourceRevisionId, productGraph],
      [productRevisionId, productGraph],
      [fallbackRevisionId, fallbackGraph],
      [crossRevisionId, crossGraph],
      [unknownRevisionId, unknownGraph],
      [crossProjectRevisionId, crossProjectGraph],
      [unknownOriginRevisionId, unknownOriginGraph],
    ] as const) {
      await pool.query(
        `INSERT INTO advanced_canvas_revisions
         (workspace_id, project_id, id, graph, draft_version, reason, created_by, created_at)
         VALUES ($1, $2, $3, $4, 1, 'checkpoint', $5, now())`,
        [workspaceId, projectId, revisionId, graph, userId]
      );
    }
    await seedP1OwnedAsset(foundation, pool, {
      workspaceId,
      actorId: userId,
      assetId: productAssetId,
      jobId: productJobId,
      attemptId: productAttemptId,
      routeSnapshotId: productRouteSnapshotId,
    });
    await seedP1OwnedAsset(foundation, pool, {
      workspaceId: otherWorkspaceId,
      actorId: userId,
      assetId: crossAssetId,
      jobId: crossJobId,
      attemptId: crossAttemptId,
      routeSnapshotId: crossRouteSnapshotId,
    });
    await pool.query(
      `INSERT INTO pro_studio_workspace_state
       (namespace, workspace_id, state, updated_at)
       VALUES ('generation', $1, $2, now())`,
      [workspaceId, generationStateForProductAdoption({
        workspaceId,
        projectId,
        productSourceRevisionId,
        productAssetId,
        productJobId,
        fallbackJobId,
        crossRevisionId,
        crossAssetId,
        crossJobId,
        unknownRevisionId,
        unknownAssetId,
        unknownJobId,
        crossProjectRevisionId,
        crossProjectJobId,
        unknownOriginRevisionId,
        unknownOriginJobId,
      })]
    );
    await pool.query(
      `INSERT INTO model_generation_jobs (workspace_id, job_id, status, result)
       VALUES ($1, $2, 'completed', $3::jsonb)`,
      [
        workspaceId,
        productJobId,
        {
          jobId: productJobId,
          operation: 'image.generate',
          status: 'completed',
          origin: {
            kind: 'advanced_canvas',
            projectId,
            revisionId: productSourceRevisionId,
          },
          asset: { id: productAssetId },
          snapshot: { actualCatalogModelId: 'adoption-p1-image' },
        },
      ]
    );
    await pool.query(
      `INSERT INTO model_generation_jobs (workspace_id, job_id, status, result)
       VALUES ($1, $2, 'completed', $3::jsonb),
              ($1, $4, 'completed', $5::jsonb)`,
      [
        workspaceId,
        crossProjectJobId,
        {
          jobId: crossProjectJobId,
          operation: 'image.generate',
          status: 'completed',
          origin: {
            kind: 'advanced_canvas',
            projectId: 'adoption-other-project',
            revisionId: productSourceRevisionId,
          },
          asset: { id: productAssetId },
        },
        unknownOriginJobId,
        {
          jobId: unknownOriginJobId,
          operation: 'image.generate',
          status: 'completed',
          origin: {
            kind: 'advanced_canvas',
            projectId,
            revisionId: 'adoption-missing-origin-revision',
          },
          asset: { id: productAssetId },
        },
      ]
    );
    t.after(async () => {
      await pool.query(
        'DELETE FROM model_generation_jobs WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM p1_content_packages WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM advanced_canvas_revisions WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM advanced_canvas_projects WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM workspaces WHERE id = ANY($1::text[])',
        [[workspaceId, otherWorkspaceId]]
      );
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const service = new PostgresAdvancedCanvasAdoptionService(pool);
    const context = {
      correlationId: 'adoption-product-postgres',
      userId,
      workspaceId,
    };
    const selection = {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1'],
    };
    const productAdoption = await service.adopt(context, {
      idempotencyKey: 'adoption-product-asset',
      projectId,
      revisionRef: { kind: 'frozen', revisionId: productRevisionId },
      selection,
      target: { kind: 'new_package' },
    });
    assert.deepEqual(productAdoption.orderedMediaNodeIds, ['image-1']);
    const productPackage = await pool.query<{ payload: Record<string, any> }>(
      `SELECT payload FROM p1_content_packages
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, productAdoption.packageId]
    );
    assert.deepEqual(
      productPackage.rows[0]?.payload.versions[0].orderedAssetIds,
      [productAssetId]
    );
    const fallbackAdoption = await service.adopt(context, {
      idempotencyKey: 'adoption-fallback-different-origin-revision',
      projectId,
      revisionRef: { kind: 'frozen', revisionId: fallbackRevisionId },
      selection,
      target: { kind: 'new_package' },
    });
    assert.deepEqual(fallbackAdoption.orderedMediaNodeIds, ['image-1']);
    await assert.rejects(
      service.adopt(context, {
        idempotencyKey: 'adoption-cross-project-origin',
        projectId,
        revisionRef: { kind: 'frozen', revisionId: crossProjectRevisionId },
        selection,
        target: { kind: 'new_package' },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'JOB_NOT_DELIVERED'
    );
    await assert.rejects(
      service.adopt(context, {
        idempotencyKey: 'adoption-unknown-origin-revision',
        projectId,
        revisionRef: { kind: 'frozen', revisionId: unknownOriginRevisionId },
        selection,
        target: { kind: 'new_package' },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'JOB_NOT_DELIVERED'
    );
    await assert.rejects(
      service.adopt(context, {
        idempotencyKey: 'adoption-cross-workspace-asset',
        projectId,
        revisionRef: { kind: 'frozen', revisionId: crossRevisionId },
        selection,
        target: { kind: 'new_package' },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'ASSET_NOT_OWNED'
    );
    await assert.rejects(
      service.adopt(context, {
        idempotencyKey: 'adoption-unknown-asset',
        projectId,
        revisionRef: { kind: 'frozen', revisionId: unknownRevisionId },
        selection,
        target: { kind: 'new_package' },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'ASSET_NOT_OWNED'
    );
  }
);

function imageGraph(assetId: string, jobId: string) {
  return {
    schemaVersion: 1 as const,
    nodes: [
      { id: 'text-1', type: 'text', data: { text: 'Product asset' } },
      { id: 'image-1', type: 'image', data: { assetId, jobId, sourceAssetIds: [] } },
    ],
    edges: [],
  };
}

function generationStateForProductAdoption(input: {
  workspaceId: string;
  projectId: string;
  productSourceRevisionId: string;
  productAssetId: string;
  productJobId: string;
  fallbackJobId: string;
  crossRevisionId: string;
  crossAssetId: string;
  crossJobId: string;
  unknownRevisionId: string;
  unknownAssetId: string;
  unknownJobId: string;
  crossProjectRevisionId: string;
  crossProjectJobId: string;
  unknownOriginRevisionId: string;
  unknownOriginJobId: string;
}) {
  const now = new Date().toISOString();
  const jobs = [
    [input.productJobId, input.productSourceRevisionId, input.productAssetId],
    [input.fallbackJobId, input.productSourceRevisionId, input.productAssetId],
    [input.crossJobId, input.crossRevisionId, input.crossAssetId],
    [input.unknownJobId, input.unknownRevisionId, input.unknownAssetId],
    [input.crossProjectJobId, input.crossProjectRevisionId, input.productAssetId],
    [input.unknownOriginJobId, input.unknownOriginRevisionId, input.productAssetId],
  ].map(([id, revisionId, outputAssetId]) => ({
    id,
    workspaceId: input.workspaceId,
    origin: {
      kind: 'advanced_canvas' as const,
      id: input.projectId,
      revisionId,
    },
    operation: 'image.generate',
    modelId: 'adoption-product-model',
    prompt: 'product asset',
    parameters: {},
    inputAssetIds: [],
    idempotencyKey: `adoption-product-generation-${id}`,
    quoteId: `adoption-product-quote-${id}`,
    status: 'completed' as const,
    outputAssetId,
    createdAt: now,
    updatedAt: now,
  }));
  return {
    quotes: [],
    jobs,
    reservations: [],
    attempts: [],
    providerCosts: [],
    outbox: [],
    assets: [],
    textDeliverables: [],
    receipts: [],
  };
}
