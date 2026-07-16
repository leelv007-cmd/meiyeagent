import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { CanvasAgentApplicationService } from './canvas-agent.js';
import {
  CanvasAgentGenerationConsumer,
  type CanvasAgentCanonicalGenerationPort,
} from './canvas-agent-generation-consumer.js';
import {
  AuthoritativeCanvasAgentAuthorizationAdapter,
  PostgresCanvasAgentAuthoritySource,
  type CanvasAgentGenerationAuthorityPort,
  type CanvasAgentQuotaQuotePort,
} from './canvas-agent-production.js';
import { PostgresCanvasAgentRepository } from './postgres-runtime-repositories.js';
import { migrateProStudioWorkspaceState } from './postgres-workspace-state.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'applies confirmed Agent operations to the canonical project in one Postgres transaction',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `agent-workspace-${suffix}`;
    const userId = `agent-user-${suffix}`;
    const projectId = `agent-project-${suffix}`;
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
				sha256 text NOT NULL,
				PRIMARY KEY (workspace_id, id)
			)
		`);
    await migrateProStudioWorkspaceState(pool);
    await pool.query(
      "INSERT INTO workspaces (id, name) VALUES ($1, 'Agent test')",
      [workspaceId]
    );
    await pool.query(
      'INSERT INTO "user" (id, name, email) VALUES ($1, \'Agent user\', $2)',
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
			 VALUES ($1, $2, 'Agent project', $3, 1, $4, now(), now())`,
      [
        workspaceId,
        projectId,
        {
          schemaVersion: 1,
          nodes: [{ id: 'text-1', type: 'text', data: { text: 'before' } }],
          edges: [],
        },
        userId,
      ]
    );
    t.after(async () => {
      await pool.query(
        'DELETE FROM advanced_canvas_revisions WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const authorization = new AuthoritativeCanvasAgentAuthorizationAdapter({
      authority: new PostgresCanvasAgentAuthoritySource(pool),
    });
    const service = new CanvasAgentApplicationService(
      new PostgresCanvasAgentRepository(pool, authorization),
      {
        authorization,
        nonce: () => 'nonce',
        planner: {
          async plan() {
            return [
              {
                tool: 'update_node' as const,
                nodeId: 'text-1',
                patch: { text: 'after' },
              },
            ];
          },
        },
      }
    );
    const context = {
      correlationId: 'agent-postgres',
      userId,
      workspaceId,
    };
    const plan = await service.plan(context, {
      intent: 'Update the copy',
      maxCostMicros: 0,
      maxGenerationCount: 0,
      projectId,
      sessionId: 'canvas-session',
    });
    const confirmation = await service.confirm(context, {
      planId: plan.id,
      sessionId: 'canvas-session',
    });
    const result = await service.apply(context, {
      credentialId: confirmation.credentialId,
      expectedRevision: 1,
      projectId,
      sessionId: 'canvas-session',
    });

    assert.deepEqual(result, { status: 'changed', revision: 2 });
    const stored = await pool.query<{
      draft_version: string;
      graph: { nodes: Array<{ data: { text: string } }> };
    }>(
      'SELECT draft_version, graph FROM advanced_canvas_projects WHERE workspace_id = $1 AND id = $2',
      [workspaceId, projectId]
    );
    assert.equal(stored.rows[0]?.draft_version, '2');
    assert.equal(stored.rows[0]?.graph.nodes[0]?.data.text, 'after');
    const revision = await pool.query<{
      created_by: string;
      draft_version: string;
      graph: { nodes: Array<{ data: { text: string } }> };
      reason: string;
    }>(
      `SELECT created_by, draft_version, graph, reason
         FROM advanced_canvas_revisions
        WHERE workspace_id = $1 AND project_id = $2`,
      [workspaceId, projectId]
    );
    assert.equal(revision.rowCount, 1);
    assert.equal(revision.rows[0]?.created_by, userId);
    assert.equal(revision.rows[0]?.draft_version, '2');
    assert.equal(revision.rows[0]?.graph.nodes[0]?.data.text, 'after');
    assert.equal(revision.rows[0]?.reason, 'agent');
  }
);

test(
  'holds authoritative membership locks until Agent apply commits',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const fixture = await createAgentFixture(t, 'authority-lock');
    const authorization = new AuthoritativeCanvasAgentAuthorizationAdapter({
      authority: new PostgresCanvasAgentAuthoritySource(fixture.pool),
    });
    let releaseAuthorization!: () => void;
    const authorizationRelease = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    let markAuthorizationLocked!: () => void;
    const authorizationLocked = new Promise<void>((resolve) => {
      markAuthorizationLocked = resolve;
    });
    const service = new CanvasAgentApplicationService(
      new PostgresCanvasAgentRepository(fixture.pool, {
        async resolveInTransaction(database, input) {
          const current = await authorization.resolveInTransaction(
            database,
            input,
          );
          markAuthorizationLocked();
          await authorizationRelease;
          return current;
        },
      }),
      {
        authorization,
        planner: {
          async plan() {
            return [
              {
                nodeId: 'text-1',
                patch: { text: 'committed under lock' },
                tool: 'update_node' as const,
              },
            ];
          },
        },
      },
    );
    const context = fixture.context('authority-lock');
    const plan = await service.plan(context, {
      intent: 'Update while role is stable',
      maxCostMicros: 0,
      maxGenerationCount: 0,
      projectId: fixture.projectId,
      sessionId: 'session-lock',
    });
    const confirmation = await service.confirm(context, {
      planId: plan.id,
      sessionId: 'session-lock',
    });
    const applying = service.apply(context, {
      credentialId: confirmation.credentialId,
      expectedRevision: 1,
      projectId: fixture.projectId,
      sessionId: 'session-lock',
    });
    await authorizationLocked;
    const roleUpdate = fixture.pool.query(
      `UPDATE workspace_memberships SET role = 'reviewer'
        WHERE workspace_id = $1 AND user_id = $2`,
      [fixture.workspaceId, fixture.userId],
    );
    const updateState = await Promise.race([
      roleUpdate.then(() => 'updated' as const),
      new Promise<'locked'>((resolve) =>
        setTimeout(() => resolve('locked'), 50),
      ),
    ]);
    assert.equal(updateState, 'locked');

    releaseAuthorization();
    assert.deepEqual(await applying, { revision: 2, status: 'changed' });
    await roleUpdate;
    const stored = await fixture.pool.query<{
      draft_version: string;
      role: string;
    }>(
      `SELECT project.draft_version, membership.role
         FROM advanced_canvas_projects AS project
         JOIN workspace_memberships AS membership
           ON membership.workspace_id = project.workspace_id
        WHERE project.workspace_id = $1 AND project.id = $2`,
      [fixture.workspaceId, fixture.projectId],
    );
    assert.equal(stored.rows[0]?.draft_version, '2');
    assert.equal(stored.rows[0]?.role, 'reviewer');
  },
);

test(
  'two Postgres sessions create one generation outbox item and one Agent revision',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const fixture = await createAgentFixture(t, 'generation-race');
    const generation: CanvasAgentGenerationAuthorityPort = {
      async assertCanGenerate() {
        return {
          allowedInputAssetRoles: ['reference_image'],
          revision: 'image-generate-live-v1',
        };
      },
      async assertCanGenerateInTransaction() {
        return {
          allowedInputAssetRoles: ['reference_image'],
          revision: 'image-generate-live-v1',
        };
      },
    };
    const quote = (input: {
      maxCostMicros: number;
      maxGenerationCount: number;
      operationHash: string;
    }) => ({
      id: `canonical-agent-quote-${input.operationHash}`,
      maxCostMicros: input.maxCostMicros,
      maxGenerationCount: input.maxGenerationCount,
      operationHash: input.operationHash,
      revision: 'canonical-agent-quote-v1',
    });
    const quota: CanvasAgentQuotaQuotePort = {
      async quote(input) {
        return quote(input);
      },
      async quoteInTransaction(_database, input) {
        return quote(input);
      },
    };
    const authorization = new AuthoritativeCanvasAgentAuthorizationAdapter({
      authority: new PostgresCanvasAgentAuthoritySource(fixture.pool),
      generation,
      quota,
    });
    const createService = () =>
      new CanvasAgentApplicationService(
        new PostgresCanvasAgentRepository(fixture.pool, authorization),
        {
          authorization,
          generationOutbox: {
            revisions: { 'image.generate': 'canonical-generation-v1' },
          },
          planner: {
            async plan() {
              return [
                {
                  inputAssets: [],
                  operation: 'image.generate' as const,
                  prompt: 'Create one manicure image',
                  tool: 'run_generation' as const,
                },
              ];
            },
          },
        },
      );
    const first = createService();
    const second = createService();
    const context = fixture.context('generation-race');
    const planA = await first.plan(context, {
      intent: 'Session A generation',
      maxCostMicros: 900_000,
      maxGenerationCount: 1,
      projectId: fixture.projectId,
      sessionId: 'session-a',
    });
    const planB = await second.plan(context, {
      intent: 'Session B generation',
      maxCostMicros: 900_000,
      maxGenerationCount: 1,
      projectId: fixture.projectId,
      sessionId: 'session-b',
    });
    const confirmationA = await first.confirm(context, {
      planId: planA.id,
      sessionId: 'session-a',
    });
    const confirmationB = await second.confirm(context, {
      planId: planB.id,
      sessionId: 'session-b',
    });
    const results = await Promise.allSettled([
      first.apply(context, {
        credentialId: confirmationA.credentialId,
        expectedRevision: 1,
        projectId: fixture.projectId,
        sessionId: 'session-a',
      }),
      second.apply(context, {
        credentialId: confirmationB.credentialId,
        expectedRevision: 1,
        projectId: fixture.projectId,
        sessionId: 'session-b',
      }),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.equal(rejected.reason?.code, 'REVISION_CONFLICT');

    const state = await fixture.pool.query<{
      state: {
        confirmations: Array<{ id: string; usedAt?: string }>;
        outbox: Array<{ status: string }>;
      };
    }>(
      `SELECT state FROM pro_studio_workspace_state
        WHERE namespace = 'agent' AND workspace_id = $1`,
      [fixture.workspaceId],
    );
    assert.equal(state.rows[0]?.state.outbox.length, 1);
    assert.equal(state.rows[0]?.state.outbox[0]?.status, 'pending');
    assert.equal(
      state.rows[0]?.state.confirmations.filter((item) => item.usedAt).length,
      1,
    );
    const revisions = await fixture.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM advanced_canvas_revisions
        WHERE workspace_id = $1 AND project_id = $2 AND reason = 'agent'`,
      [fixture.workspaceId, fixture.projectId],
    );
    assert.equal(revisions.rows[0]?.count, '1');

    let quoteCalls = 0;
    let readSetValidationCalls = 0;
    let submitCalls = 0;
    const canonical: CanvasAgentCanonicalGenerationPort = {
      async validateReadSet(_context, input) {
        readSetValidationCalls += 1;
        return {
          assetGrantRevisions: input.assetGrantRevisions,
          assetVersions: input.assetVersions,
        };
      },
      async quote(_context, input) {
        quoteCalls += 1;
        return {
          capabilityRevision: input.capabilityRevision,
          costMicros: 500_000,
          dispatchRevision: input.dispatchRevision,
          generationCount: 1,
          quoteId: 'core-quote-generation-race',
          quotaQuoteId: input.quotaQuote.id,
          quotaQuoteRevision: input.quotaQuote.revision,
        };
      },
      async submit() {
        submitCalls += 1;
        return { jobId: 'core-job-generation-race' };
      },
    };
    const consumeA = new CanvasAgentGenerationConsumer(
      new PostgresCanvasAgentRepository(fixture.pool, authorization),
      canonical,
      { claimToken: () => 'claim-a' },
    );
    const consumeB = new CanvasAgentGenerationConsumer(
      new PostgresCanvasAgentRepository(fixture.pool, authorization),
      canonical,
      { claimToken: () => 'claim-b' },
    );
    const consumed = await Promise.all([
      consumeA.runOnce(fixture.workspaceId),
      consumeB.runOnce(fixture.workspaceId),
    ]);
    assert.equal(
      consumed.filter((result) => result.status === 'submitted').length,
      1,
    );
    assert.equal(consumed.filter((result) => result.status === 'idle').length, 1);
    assert.equal(quoteCalls, 1);
    assert.equal(readSetValidationCalls, 1);
    assert.equal(submitCalls, 1);
    const consumedState = await fixture.pool.query<{
      state: {
        outbox: Array<{
          assetGrantRevisions: Record<string, string>;
          assetVersions: Record<string, string>;
          attemptEvents: Array<{ attemptNo: number; outcome: string }>;
          canonicalJobId?: string;
          status: string;
        }>;
      };
    }>(
      `SELECT state FROM pro_studio_workspace_state
        WHERE namespace = 'agent' AND workspace_id = $1`,
      [fixture.workspaceId],
    );
    assert.equal(consumedState.rows[0]?.state.outbox[0]?.status, 'submitted');
    assert.deepEqual(
      consumedState.rows[0]?.state.outbox[0]?.assetGrantRevisions,
      {},
    );
    assert.deepEqual(
      consumedState.rows[0]?.state.outbox[0]?.assetVersions,
      {},
    );
    const attemptEvents =
      consumedState.rows[0]?.state.outbox[0]?.attemptEvents ?? [];
    assert.equal(attemptEvents.length, 1);
    assert.equal(attemptEvents[0]?.attemptNo, 1);
    assert.equal(attemptEvents[0]?.outcome, 'submitted');
    assert.equal(
      consumedState.rows[0]?.state.outbox[0]?.canonicalJobId,
      'core-job-generation-race',
    );
  },
);

async function createAgentFixture(
  t: test.TestContext,
  label: string,
) {
  const pool = new Pool({ connectionString });
  const suffix = randomUUID();
  const workspaceId = `agent-${label}-workspace-${suffix}`;
  const userId = `agent-${label}-user-${suffix}`;
  const projectId = `agent-${label}-project-${suffix}`;
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
      sha256 text NOT NULL,
      PRIMARY KEY (workspace_id, id)
    )
  `);
  await migrateProStudioWorkspaceState(pool);
  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, $2)`,
    [workspaceId, `Agent ${label}`],
  );
  await pool.query(
    `INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`,
    [userId, `Agent ${label}`, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [workspaceId, userId],
  );
  await pool.query(
    `INSERT INTO advanced_canvas_projects
     (workspace_id, id, name, graph, draft_version, created_by, created_at, updated_at)
     VALUES ($1, $2, 'Agent project', $3, 1, $4, now(), now())`,
    [
      workspaceId,
      projectId,
      {
        edges: [],
        nodes: [{ data: { text: 'before' }, id: 'text-1', type: 'text' }],
        schemaVersion: 1,
      },
      userId,
    ],
  );
  t.after(async () => {
    await pool.query(
      'DELETE FROM advanced_canvas_revisions WHERE workspace_id = $1',
      [workspaceId],
    );
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
    await pool.end();
  });
  return {
    context: (correlationId: string) => ({ correlationId, userId, workspaceId }),
    pool,
    projectId,
    userId,
    workspaceId,
  };
}
