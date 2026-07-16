import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

const REJECTION_AUDIT_OBJECT_KINDS = [
  'project',
  'revision',
  'asset',
  'job',
  'grant',
  'confirmation',
  'package',
] as const;
const REJECTION_AUDIT_ACTIONS = REJECTION_AUDIT_OBJECT_KINDS.map(
  (objectKind) => `${objectKind}_access_denied`
);

function databaseUrl() {
  return (
    process.env.DATABASE_URL ?? 'postgres://meiye:meiye@127.0.0.1:54329/meiye'
  );
}

type CanvasGraph = {
  edges: Array<Record<string, unknown>>;
  nodes: Array<{
    data: Record<string, unknown>;
    id: string;
    type: string;
  }>;
  schemaVersion: 1;
};

type CanvasProject = {
  draftVersion: number;
  graph: CanvasGraph;
  id: string;
  name: string;
};

type CanvasRevision = { id: string };

type GenerationInput = {
  inputAssets: [];
  operation: 'image.generate';
  parameters: Record<string, never>;
  projectId: string;
  prompt: string;
  revisionId: string;
};

type GenerationJob = {
  deliverable: { asset: { id: string }; kind: 'asset' } | null;
  failureCode?: string;
  jobId: string;
  status: string;
};

type CanvasEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

type CanvasResponse<T> = {
  body: CanvasEnvelope<T>;
  status: number;
};

type AgentPlan = { baseRevision: number; id: string };
type AgentConfirmation = { credentialId: string };
type WorkspaceContext = { userId: string; workspaceId: string };
type SecurityRejectionAuditEvent = {
  actorId: string;
  correlationId: string;
  createdAt: string;
  id: string;
  objectKind:
    | 'project'
    | 'revision'
    | 'asset'
    | 'job'
    | 'package'
    | 'grant'
    | 'confirmation';
  outcome: 'opaque_not_found';
  requestAction: string;
  targetDigest: string;
  workspaceId: string;
};

function canvasOrigin() {
  return `http://localhost:${process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'}`;
}

function mainOrigin() {
  return (
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://localhost:${process.env.PORT ?? '3000'}`
  );
}

async function canvasRequest<T>(
  page: Page,
  action: string,
  input: Record<string, unknown> = {},
  write = false
): Promise<CanvasResponse<T>> {
  const cookies = await page.context().cookies(canvasOrigin());
  const csrf = cookies.find(
    (cookie) => cookie.name === '__Host-canvas-csrf'
  )?.value;
  const response = await page.request.post(
    `${canvasOrigin()}/api/canvas/${action}`,
    {
      data: input,
      headers: {
        'content-type': 'application/json',
        cookie: cookies
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join('; '),
        'idempotency-key': randomUUID(),
        origin: canvasOrigin(),
        'sec-fetch-site': 'same-origin',
        ...(write ? { 'x-csrf-token': csrf ?? '' } : {}),
      },
    }
  );
  return {
    body: (await response.json()) as CanvasEnvelope<T>,
    status: response.status(),
  };
}

async function canvasData<T>(
  page: Page,
  action: string,
  input: Record<string, unknown> = {},
  write = false
) {
  const result = await canvasRequest<T>(page, action, input, write);
  expect(
    result.status,
    `${action}: ${result.body.error?.code ?? 'UNKNOWN'} ${result.body.error?.message ?? ''}`
  ).toBe(200);
  expect(result.body.data, `${action} returned no data`).toBeDefined();
  return result.body.data as T;
}

async function enterCanvas(page: Page) {
  await page.goto('/pro-studio');
  await expect(page.getByRole('button', { name: '一键进入' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: '一键进入' }).click();
  await expect(page).toHaveURL(
    (url) => url.origin === canvasOrigin() && url.pathname === '/',
    { timeout: 20_000 }
  );
  await expect(page.getByText('Pro Studio', { exact: true })).toBeVisible();
}

async function createCanvasFixture(
  page: Page,
  name: string,
  includeGeneration = true
) {
  const textNodeId = `text-${randomUUID()}`;
  const project = await canvasData<CanvasProject>(
    page,
    'createProject',
    {
      graph: {
        edges: [],
        nodes: [
          { data: { text: '隔离验收锚点' }, id: textNodeId, type: 'text' },
        ],
        schemaVersion: 1,
      } satisfies CanvasGraph,
      name,
    },
    true
  );
  const checkpoint = await canvasData<CanvasRevision>(
    page,
    'createCheckpoint',
    {
      expectedDraftVersion: project.draftVersion,
      label: `${name} checkpoint`,
      projectId: project.id,
    },
    true
  );
  if (!includeGeneration) {
    return { checkpoint, project, textNodeId };
  }

  const input: GenerationInput = {
    inputAssets: [],
    operation: 'image.generate',
    parameters: {},
    projectId: project.id,
    prompt: `安全边界 fixture ${name}`,
    revisionId: checkpoint.id,
  };
  const quote = await canvasData<{ quoteId: string }>(
    page,
    'quoteGeneration',
    input,
    true
  );
  const submitted = await canvasData<{ jobId: string }>(
    page,
    'submitGeneration',
    { input, quoteId: quote.quoteId },
    true
  );
  let completed: GenerationJob | undefined;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await canvasData<GenerationJob>(page, 'getGenerationJob', {
      jobId: submitted.jobId,
      projectId: project.id,
    });
    if (current.status === 'completed' && current.deliverable?.asset.id) {
      completed = current;
      break;
    }
    if (['failed', 'cancelled'].includes(current.status)) {
      throw new Error(
        `${name} fixture generation ended ${current.status}: ${current.failureCode ?? 'unknown'}`
      );
    }
    await page.waitForTimeout(1_000);
  }
  expect(completed, `${name} fixture generation should complete`).toBeDefined();

  const loaded = await canvasData<CanvasProject>(page, 'loadProject', {
    projectId: project.id,
  });
  const generatedNodeId = `generated-${randomUUID()}`;
  const saved = await canvasData<CanvasProject>(
    page,
    'saveProjectDraft',
    {
      expectedDraftVersion: loaded.draftVersion,
      graph: {
        ...loaded.graph,
        nodes: [
          ...loaded.graph.nodes,
          {
            data: {
              assetId: completed!.deliverable!.asset.id,
              jobId: completed!.jobId,
            },
            id: generatedNodeId,
            type: 'image',
          },
        ],
      },
      projectId: project.id,
    },
    true
  );
  return {
    assetId: completed!.deliverable!.asset.id,
    checkpoint,
    generatedNodeId,
    jobId: completed!.jobId,
    project: saved,
    textNodeId,
  };
}

async function adoptFixture(
  page: Page,
  fixture: Awaited<ReturnType<typeof createCanvasFixture>>
) {
  if (!('assetId' in fixture))
    throw new Error('Adoption fixture needs media output');
  return canvasData<{ packageId: string; versionId: string }>(
    page,
    'adoptAdvancedCanvasOutput',
    {
      projectId: fixture.project.id,
      revisionRef: {
        expectedDraftVersion: fixture.project.draftVersion,
        kind: 'freeze_current_draft',
      },
      selection: {
        orderedMediaNodeIds: [fixture.generatedNodeId],
        textNodeId: fixture.textNodeId,
      },
      target: { kind: 'new_package' },
    },
    true
  );
}

async function agentConfirmation(page: Page, projectId: string) {
  const plan = await canvasData<AgentPlan>(
    page,
    'planAgent',
    {
      intent: '加入一个可检查的文本节点',
      maxCostMicros: 0,
      maxGenerationCount: 0,
      projectId,
    },
    true
  );
  return {
    plan,
    confirmation: await canvasData<AgentConfirmation>(
      page,
      'confirmAgent',
      {
        planId: plan.id,
      },
      true
    ),
  };
}

function expectForeignObjectRejected<T>(
  result: CanvasResponse<T>,
  foreignId: string
) {
  expect(result.status, 'foreign object must be opaque').toBe(404);
  expect(result.body.data).toBeUndefined();
  expect(result.body.error).toEqual({
    code: 'NOT_FOUND',
    message: 'Canvas object was not found.',
  });
  expect(result.body.error?.message ?? '').not.toContain(foreignId);
}

async function signOut(page: Page) {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/auth/sign-out', {
      credentials: 'same-origin',
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    return { body: await result.text(), ok: result.ok };
  });
  expect(response.ok, response.body).toBeTruthy();
}

test.describe('Ticket 25 security boundaries', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('real Main + Canvas + Core + Postgres reject foreign workspace objects', async ({
    browser,
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const ownerA = await registerE2EUser(request);
    const ownerB = await registerE2EUser(request);
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
      await loginByForm(page, ownerA);
      await page.goto('/pro-studio');
      await unlockProStudio(page);
      await page.reload();
      await enterCanvas(page);

      await loginByForm(pageB, ownerB);
      await pageB.goto('/pro-studio');
      await unlockProStudio(pageB);
      await pageB.reload();
      await enterCanvas(pageB);
      const attackerContext = await canvasData<WorkspaceContext>(
        pageB,
        'getSessionContext'
      );

      const fixtureA = await createCanvasFixture(
        page,
        `security-foreign-a-${randomUUID().slice(0, 8)}`
      );
      const fixtureB = await createCanvasFixture(
        pageB,
        `security-foreign-b-${randomUUID().slice(0, 8)}`
      );
      if (!('assetId' in fixtureA)) {
        throw new Error('A security fixture should include a generated asset');
      }
      const assetAId = fixtureA.assetId;
      const jobAId = fixtureA.jobId;
      if (typeof assetAId !== 'string' || typeof jobAId !== 'string') {
        throw new Error('A security fixture should include asset and job IDs');
      }
      const packageA = await adoptFixture(page, fixtureA);
      const agentA = await agentConfirmation(page, fixtureA.project.id);

      const before = {
        adoptions: await canvasData<unknown[]>(pageB, 'listAdoptions', {
          projectId: fixtureB.project.id,
        }),
        assets: await canvasData<unknown[]>(pageB, 'listAssets'),
        generations: await canvasData<unknown[]>(
          pageB,
          'listProjectGenerations',
          { projectId: fixtureB.project.id }
        ),
        project: await canvasData<CanvasProject>(pageB, 'loadProject', {
          projectId: fixtureB.project.id,
        }),
        projects: await canvasData<CanvasProject[]>(pageB, 'listProjects'),
      };

      expectForeignObjectRejected(
        await canvasRequest(pageB, 'loadProject', {
          projectId: fixtureA.project.id,
        }),
        fixtureA.project.id
      );
      expectForeignObjectRejected(
        await canvasRequest(pageB, 'getRevision', {
          projectId: fixtureB.project.id,
          revisionId: fixtureA.checkpoint.id,
        }),
        fixtureA.checkpoint.id
      );
      expectForeignObjectRejected(
        await canvasRequest(pageB, 'getAsset', { assetId: assetAId }),
        assetAId
      );
      expectForeignObjectRejected(
        await canvasRequest(pageB, 'getGenerationJob', {
          jobId: jobAId,
          projectId: fixtureB.project.id,
        }),
        jobAId
      );
      const foreignAudit = await canvasRequest<unknown[]>(
        pageB,
        'listAgentAudit',
        {
          projectId: fixtureA.project.id,
        }
      );
      expect(foreignAudit.status).toBe(200);
      expect(foreignAudit.body.data).toEqual([]);
      expectForeignObjectRejected(
        await canvasRequest(pageB, 'getProviderReferenceGrant', {
          grantId: 'provider-reference-grant-foreign',
        }),
        'provider-reference-grant-foreign'
      );
      expectForeignObjectRejected(
        await canvasRequest(
          pageB,
          'applyAgentOps',
          {
            credentialId: agentA.confirmation.credentialId,
            expectedRevision: fixtureB.project.draftVersion,
            projectId: fixtureB.project.id,
          },
          true
        ),
        agentA.confirmation.credentialId
      );
      const afterForeignConfirmation = await canvasData<CanvasProject>(
        pageB,
        'loadProject',
        { projectId: fixtureB.project.id }
      );
      expect(afterForeignConfirmation.draftVersion).toBe(
        fixtureB.project.draftVersion
      );

      expectForeignObjectRejected(
        await canvasRequest(
          pageB,
          'adoptAdvancedCanvasOutput',
          {
            projectId: fixtureB.project.id,
            revisionRef: {
              expectedDraftVersion: fixtureB.project.draftVersion,
              kind: 'freeze_current_draft',
            },
            selection: {
              orderedMediaNodeIds: [fixtureB.generatedNodeId],
              textNodeId: fixtureB.textNodeId,
            },
            target: {
              baseVersionId: packageA.versionId,
              kind: 'existing_package',
              packageId: packageA.packageId,
            },
          },
          true
        ),
        packageA.packageId
      );

      const after = {
        adoptions: await canvasData<unknown[]>(pageB, 'listAdoptions', {
          projectId: fixtureB.project.id,
        }),
        assets: await canvasData<unknown[]>(pageB, 'listAssets'),
        generations: await canvasData<unknown[]>(
          pageB,
          'listProjectGenerations',
          { projectId: fixtureB.project.id }
        ),
        project: await canvasData<CanvasProject>(pageB, 'loadProject', {
          projectId: fixtureB.project.id,
        }),
        projects: await canvasData<CanvasProject[]>(pageB, 'listProjects'),
      };
      expect(after).toEqual(before);
      const confirmationAudit = await canvasData<
        Array<{ errorCode?: string; outcome: string }>
      >(pageB, 'listAgentAudit', { projectId: fixtureB.project.id });
      expect(confirmationAudit).toHaveLength(1);
      expect(confirmationAudit[0]).toMatchObject({
        errorCode: 'CONFIRMATION_NOT_FOUND',
        outcome: 'error',
      });

      const rejectionAudit = await canvasData<SecurityRejectionAuditEvent[]>(
        pageB,
        'listSecurityRejectionAudit'
      );
      expect(rejectionAudit.map((event) => event.objectKind)).toEqual([
        ...REJECTION_AUDIT_OBJECT_KINDS,
      ]);
      expect(
        rejectionAudit.every(
          (event) =>
            event.actorId === attackerContext.userId &&
            event.workspaceId === attackerContext.workspaceId &&
            event.outcome === 'opaque_not_found' &&
            /^[a-f0-9]{64}$/u.test(event.targetDigest)
        )
      ).toBeTruthy();
      const foreignIds = [
        fixtureA.project.id,
        fixtureA.checkpoint.id,
        assetAId,
        jobAId,
        packageA.packageId,
        agentA.confirmation.credentialId,
        'provider-reference-grant-foreign',
      ];
      const serializedAudit = JSON.stringify(rejectionAudit);
      for (const foreignId of foreignIds) {
        expect(serializedAudit).not.toContain(foreignId);
      }
      expect(
        await canvasData<SecurityRejectionAuditEvent[]>(
          pageB,
          'listSecurityRejectionAudit'
        )
      ).toEqual(rejectionAudit);

      // Durable store proof: read pro_studio_audit_events via DATABASE_URL so
      // the fixture drill does not rely only on the Canvas list API surface.
      const sql = postgres(databaseUrl(), { max: 1 });
      try {
        const durableRows = await sql<{
          action: string;
          actor_id: string;
          detail: SecurityRejectionAuditEvent;
          workspace_id: string;
        }[]>`
          SELECT action, actor_id, workspace_id, detail
            FROM pro_studio_audit_events
           WHERE workspace_id = ${attackerContext.workspaceId}
             AND actor_id = ${attackerContext.userId}
             AND action = ANY(${REJECTION_AUDIT_ACTIONS})
             AND detail->>'outcome' = 'opaque_not_found'
             AND detail ? 'targetDigest'
           ORDER BY created_at, id
        `;
        expect(durableRows.map((row) => row.action)).toEqual(
          REJECTION_AUDIT_ACTIONS
        );
        expect(durableRows.map((row) => row.detail.objectKind)).toEqual([
          ...REJECTION_AUDIT_OBJECT_KINDS,
        ]);
        expect(
          durableRows.every(
            (row) =>
              row.workspace_id === attackerContext.workspaceId &&
              row.actor_id === attackerContext.userId &&
              row.action === `${row.detail.objectKind}_access_denied` &&
              row.detail.outcome === 'opaque_not_found' &&
              row.detail.workspaceId === attackerContext.workspaceId &&
              row.detail.actorId === attackerContext.userId &&
              /^[a-f0-9]{64}$/u.test(row.detail.targetDigest)
          )
        ).toBeTruthy();
        const serializedDurable = JSON.stringify(durableRows);
        for (const foreignId of foreignIds) {
          expect(serializedDurable).not.toContain(foreignId);
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await contextB.close();
    }
  });

  test('two Canvas sessions preserve CAS zero-write and recover after a conflict', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const owner = await registerE2EUser(request);
    const pageB = await page.context().newPage();
    try {
      await loginByForm(page, owner);
      await page.goto('/pro-studio');
      await unlockProStudio(page);
      await page.reload();
      await enterCanvas(page);
      await pageB.goto(canvasOrigin());
      await expect(
        pageB.getByText('Pro Studio', { exact: true })
      ).toBeVisible();

      const fixture = await createCanvasFixture(
        page,
        `security-cas-${randomUUID().slice(0, 8)}`,
        false
      );
      const planA = await agentConfirmation(page, fixture.project.id);
      const planB = await agentConfirmation(pageB, fixture.project.id);
      expect(planA.plan.baseRevision).toBe(planB.plan.baseRevision);

      const appliedA = await canvasData<{ revision: number; status: string }>(
        page,
        'applyAgentOps',
        {
          credentialId: planA.confirmation.credentialId,
          expectedRevision: planA.plan.baseRevision,
          projectId: fixture.project.id,
        },
        true
      );
      expect(appliedA.status).toBe('changed');
      const afterA = await canvasData<CanvasProject>(page, 'loadProject', {
        projectId: fixture.project.id,
      });

      const staleB = await canvasRequest(
        pageB,
        'applyAgentOps',
        {
          credentialId: planB.confirmation.credentialId,
          expectedRevision: planB.plan.baseRevision,
          projectId: fixture.project.id,
        },
        true
      );
      expect(staleB.status).toBe(409);
      expect(staleB.body.error?.code).toBe('REVISION_CONFLICT');
      const afterStaleB = await canvasData<CanvasProject>(
        pageB,
        'loadProject',
        {
          projectId: fixture.project.id,
        }
      );
      expect(afterStaleB.draftVersion).toBe(afterA.draftVersion);
      expect(afterStaleB.graph.nodes).toEqual(afterA.graph.nodes);

      const rereadPlan = await agentConfirmation(pageB, fixture.project.id);
      expect(rereadPlan.plan.baseRevision).toBe(afterA.draftVersion);
      const appliedB = await canvasData<{ revision: number; status: string }>(
        pageB,
        'applyAgentOps',
        {
          credentialId: rereadPlan.confirmation.credentialId,
          expectedRevision: rereadPlan.plan.baseRevision,
          projectId: fixture.project.id,
        },
        true
      );
      expect(appliedB.status).toBe('changed');
      const afterB = await canvasData<CanvasProject>(page, 'loadProject', {
        projectId: fixture.project.id,
      });
      expect(afterB.draftVersion).toBe(afterA.draftVersion + 1);
      expect(afterB.graph.nodes.length).toBe(afterA.graph.nodes.length + 1);
    } finally {
      await pageB.close();
    }
  });

  test('identity switch clears Canvas caches and fences a delayed response', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const ownerA = await registerE2EUser(request);
    const ownerB = await registerE2EUser(request);
    await loginByForm(page, ownerA);
    await unlockProStudio(page);
    await page.reload();
    await enterCanvas(page);
    const fixtureA = await createCanvasFixture(
      page,
      `security-cache-a-${randomUUID().slice(0, 8)}`,
      false
    );
    const contextA = await canvasData<WorkspaceContext>(
      page,
      'getSessionContext'
    );
    await page.evaluate(async () => {
      window.localStorage.setItem('canvas-local-draft', 'foreign-local-secret');
      window.sessionStorage.setItem(
        'canvas-local-draft',
        'foreign-session-secret'
      );
      const cache = await caches.open('canvas:foreign-workspace');
      await cache.put('/foreign', new Response('foreign-cache-secret'));
    });

    let delayed = false;
    let releaseDelayed!: () => void;
    const delay = new Promise<void>((resolve) => {
      releaseDelayed = resolve;
    });
    await page.route('**/api/canvas/listProjects', async (route) => {
      if (delayed) {
        await route.continue();
        return;
      }
      delayed = true;
      await delay;
      try {
        await route.continue();
      } catch {
        // Navigation intentionally aborts this stale request.
      }
    });
    const reload = page.reload().catch(() => undefined);
    await expect.poll(() => delayed).toBeTruthy();

    await page.goto(mainOrigin());
    await signOut(page);
    await loginByForm(page, ownerB);
    await page.goto('/pro-studio');
    await unlockProStudio(page);
    await page.reload();
    await enterCanvas(page);
    const contextB = await canvasData<WorkspaceContext>(
      page,
      'getSessionContext'
    );
    releaseDelayed();
    await reload;
    await page.waitForTimeout(500);

    expect(contextB.userId).not.toBe(contextA.userId);
    expect(contextB.workspaceId).not.toBe(contextA.workspaceId);
    const storage = await page.evaluate(async () => ({
      cacheKeys: await caches.keys(),
      localDraft: window.localStorage.getItem('canvas-local-draft'),
      namespace: window.sessionStorage.getItem('canvas-cache-namespace'),
      sessionDraft: window.sessionStorage.getItem('canvas-local-draft'),
    }));
    expect(storage.localDraft).toBeNull();
    expect(storage.sessionDraft).toBeNull();
    expect(storage.cacheKeys).not.toContain('canvas:foreign-workspace');
    expect(storage.namespace).toBe(
      `canvas:v1:${contextB.userId}:${contextB.workspaceId}`
    );
    await expect(
      page.getByRole('button', { name: fixtureA.project.name })
    ).toHaveCount(0);
    await page.unroute('**/api/canvas/listProjects');
  });
});
