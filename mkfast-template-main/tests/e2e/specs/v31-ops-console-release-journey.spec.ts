/**
 * V31-22 Ops Console release journey (AC4, write-only; master runs with lane
 * ports).
 *
 * Drives the real P1 ops-console module through the full rollout lifecycle the
 * ticket promised: 发布 → 圈 canary allowlist → candidate 试跑 → 人工放量 →
 * rollback → 审计留痕. Core service semantics are the authority
 * (`apps/core/src/p1/ops-console/ops-console-service.ts`):
 * - publish_release rejects unset control limits (U11 缺 pin 拒发)
 * - set_canary_allowlist / set_candidate_trial shape rollout + trial records
 * - promote_to_production is the human U12 click
 * - rollbackProduction re-pins a prior release; `resolveForRun` consults the
 *   production lifecycle for new runs, so the production pointer after
 *   rollback IS the "new runs go to the old release" observable
 * - every write appends an audit entry (operator/reason/evidence)
 *
 * No conditional assertions and no test.skip/fixme: every step either proves
 * the service semantics or fails red.
 */
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

type P1Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://meiye:meiye@127.0.0.1:54329/meiye';

const CONTROL_LIMITS = {
  maxDelegations: 2,
  maxLlmSteps: 6,
  maxMerchantQuestions: 1,
  maxReplans: 3,
  maxRetrievalCalls: 4,
  maxSchemaRepairs: 1,
  maxToolCalls: 8,
  maxContextTokens: 32_000,
};

const PROMPT_PACK_BINDINGS = {
  agentControl: [
    'intentNaming',
    'factSatisfaction',
    'factCriticality',
    'destinationMapping',
  ],
  copy: [
    'briefCompilation',
    'copyCandidate',
    'copyGeneration',
    'platformAdaptation',
  ],
  note: [
    'xhsOutline',
    'xhsContent',
    'xhsImagePrompt',
    'notePlan',
    'noteTextBlock',
    'noteConsistency',
    'xhsNoteGen',
  ],
  media: ['briefImage'],
  cover: ['xhsCoverPrompt', 'xhsStyleAnalysis'],
  viral: ['xhsViralRewrite', 'xhsViralImageVision'],
  video: ['briefVideo', 'textResponse'],
} as const;
const PROMPT_BINDINGS = Object.fromEntries(
  Object.values(PROMPT_PACK_BINDINGS)
    .flat()
    .map((key) => [key, { key, version: '1' }])
);

function publishInput(
  releaseId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    agentSessionHarnessVersion: 'session/1',
    budgetPolicyRevision: 'budget/1',
    contextCompilerRef: { id: 'ctx', revision: '1' },
    controlLimits: { ...CONTROL_LIMITS },
    evalSuiteRevision: 'eval/1',
    factPolicyRevision: 'fact/1',
    makeHarnessVersion: 'make/1',
    memoryPolicyRef: { id: 'mem', revision: '1' },
    middlewareBindings: [],
    modelPolicyRevision: 'model/1',
    planSchemaRevision: 'plan-schema/v1',
    promptBindings: PROMPT_BINDINGS,
    promptPackBindings: PROMPT_PACK_BINDINGS,
    releaseId,
    reason: 'e2e publish release',
    rightsPolicyRevision: 'rights/1',
    schemaBindings: {},
    skillBindings: {},
    supervisorPolicyRef: { id: 'sup', revision: '1' },
    toolPolicyRevision: 'tool/1',
    version: 1,
    ...overrides,
  };
}

async function seedPassedReleaseVerdict(releaseId: string, suffix: string) {
  const sql = postgres(TEST_DATABASE_URL);
  const createdAt = new Date().toISOString();
  const result = {
    schemaVersion: 'eval-layer-result/v1',
    resultId: `eval-${suffix}-${releaseId}`,
    layer: 'l1',
    harnessReleaseId: releaseId,
    evalSuiteRevision: 'eval/1',
    gates: ['fidelity', 'rights', 'redline'].map((kind) => ({
      id: `${kind}-${suffix}`,
      kind,
      passed: true,
    })),
    thresholds: [],
    verdict: 'passed',
    scoredBookkept: false,
    releasable: true,
    createdAt,
  };
  try {
    await sql`INSERT INTO p1_eval_layer_results
      (result_id, harness_release_id, layer, verdict, payload, created_at)
      VALUES (${result.resultId}, ${releaseId}, ${result.layer}, ${result.verdict}, ${sql.json(result)}, ${createdAt})`;
  } finally {
    await sql.end();
  }
}

async function submitCopyRun(page: Page, intent: string) {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'copy');
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-submit')).toBeEnabled({
    timeout: 30_000,
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const brief = page.getByTestId('composer-brief-surface');
  if (await brief.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByTestId('composer-brief-confirm').click();
  }
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
}

async function latestWorkspaceRun(workspaceId: string) {
  const sql = postgres(TEST_DATABASE_URL);
  try {
    const result = await sql<{ run_id: string; harness_release_id: string }[]>`
      SELECT runs.run_id, runs.harness_release_id
       FROM p1_agent_runs runs
       JOIN p1_agent_threads threads ON threads.thread_id = runs.thread_id
       WHERE threads.resource_id = ${workspaceId}
       ORDER BY runs.started_at DESC LIMIT 1`;
    if (!result[0]) throw new Error(`No Agent Run found for ${workspaceId}`);
    return result[0];
  } finally {
    await sql.end();
  }
}

async function exactRunRelease(runId: string) {
  const sql = postgres(TEST_DATABASE_URL);
  try {
    const result = await sql<{ harness_release_id: string }[]>`
      SELECT harness_release_id FROM p1_agent_runs WHERE run_id = ${runId}`;
    return result[0]?.harness_release_id ?? null;
  } finally {
    await sql.end();
  }
}

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return page.evaluate(
    async ({ queryAction, queryModule, queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: queryModule,
          payload: queryPayload,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as P1Envelope<unknown>;
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ??
            `${queryModule}.${queryAction} query failed`
        );
      }
      return envelope.data as T;
    },
    { queryAction: action, queryModule: module, queryPayload: payload }
  );
}

async function p1Command<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) {
  return page.evaluate(
    async ({ cmdAction, cmdModule, cmdPayload, key }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: cmdAction,
          module: cmdModule,
          payload: cmdPayload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as P1Envelope<unknown>;
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ?? `${cmdModule}.${cmdAction} command failed`
        );
      }
      return envelope.data as T;
    },
    {
      cmdAction: action,
      cmdModule: module,
      cmdPayload: payload,
      key: idempotencyKey,
    }
  );
}

async function p1CommandExpectError(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) {
  return page.evaluate(
    async ({ cmdAction, cmdModule, cmdPayload, key }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: cmdAction,
          module: cmdModule,
          payload: cmdPayload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as P1Envelope<unknown>;
      return {
        code: envelope.error?.code ?? '',
        message: envelope.error?.message ?? '',
        status: response.status,
      };
    },
    {
      cmdAction: action,
      cmdModule: module,
      cmdPayload: payload,
      key: idempotencyKey,
    }
  );
}

type OpsReleaseList = {
  canary: string | null;
  draft: string[];
  items: Array<{
    approvedBy: string | null;
    createdAt: string;
    manifestHash: string;
    releaseId: string;
    status: string;
    updatedAt: string | null;
    version: number;
    workspaceAllowlist: string[];
  }>;
  production: string | null;
};

type OpsAuditEntry = {
  action: string;
  createdAt: string;
  detail: Record<string, unknown>;
  evidence: string | null;
  id: string;
  operatorId: string;
  reason: string;
  target: string;
};

test.describe('V31-22 Ops Console release journey (AC4)', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('发布 → 圈 canary → 试跑 → 放量 → 回滚 → 审计留痕', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    await page.goto('/dashboard');
    const workspaceId = (await productState(page)).workspaceId;
    expect(workspaceId.length).toBeGreaterThan(0);

    const suffix = `${Date.now()}`;
    const releaseA = `release-e2e-a-${suffix}`;
    const releaseB = `release-e2e-b-${suffix}`;
    const releaseBadPin = `release-e2e-badpin-${suffix}`;

    // ── 缺 pin 拒发 (U11): unset control limit must reject publish.
    const rejected = await p1CommandExpectError(
      page,
      'ops-console',
      'publish_release',
      publishInput(releaseBadPin, {
        controlLimits: { ...CONTROL_LIMITS, maxLlmSteps: null },
      }),
      `publish-badpin-${suffix}`
    );
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(rejected.code).toBe('INVALID_STATE');
    expect(rejected.message).toMatch(/U11|unset/iu);
    const afterReject = await p1Query<OpsReleaseList>(
      page,
      'ops-console',
      'list_releases',
      {}
    );
    expect(afterReject.items.map(({ releaseId }) => releaseId)).not.toContain(
      releaseBadPin
    );

    // ── 发布 release A (draft).
    const publishedA = await p1Command<{ artifact: { version: number } }>(
      page,
      'ops-console',
      'publish_release',
      publishInput(releaseA),
      `publish-a-${suffix}`
    );
    expect(publishedA.artifact.version).toBe(1);

    // ── 走合法生命周期 draft→evaluating→canary，圈 canary allowlist。
    for (const toStatus of ['evaluating', 'canary'] as const) {
      await p1Command(
        page,
        'ops-console',
        'transition_lifecycle',
        {
          releaseId: releaseA,
          reason: `e2e transition to ${toStatus}`,
          toStatus,
        },
        `transition-a-${toStatus}-${suffix}`
      );
    }
    await page.goto('/admin/ops-console');
    await expect(page.getByTestId('admin-ops-console')).toBeVisible();
    await page
      .getByTestId('admin-ops-console-allowlist-release')
      .fill(releaseA);
    await page
      .getByTestId('admin-ops-console-allowlist-workspaces')
      .fill(workspaceId);
    await page
      .getByTestId('admin-ops-console-allowlist-reason')
      .fill('e2e canary allowlist');
    await page.getByTestId('admin-ops-console-allowlist-submit').click();
    await expect
      .poll(
        async () =>
          (
            await p1Query<OpsReleaseList>(page, 'ops-console', 'list_releases')
          ).items.find((item) => item.releaseId === releaseA)
            ?.workspaceAllowlist
      )
      .toEqual([workspaceId]);

    // ── 人工放量 (U12 human click)。
    await seedPassedReleaseVerdict(releaseA, `a-${suffix}`);
    await p1Command(
      page,
      'ops-console',
      'record_rollback_drill',
      {
        releaseId: releaseA,
        result: 'passed',
        reason: 'e2e readiness A',
        evidence: 'e2e readiness A',
      },
      `readiness-a-${suffix}`
    );
    await page.getByTestId('admin-ops-console-promote-release').fill(releaseA);
    await page
      .getByTestId('admin-ops-console-promote-reason')
      .fill('e2e promote A');
    await page.getByTestId('admin-ops-console-promote-submit').click();
    await expect
      .poll(
        async () =>
          (await p1Query<OpsReleaseList>(page, 'ops-console', 'list_releases'))
            .production
      )
      .toBe(releaseA);

    const afterPromoteA = await p1Query<OpsReleaseList>(
      page,
      'ops-console',
      'list_releases',
      {}
    );
    expect(afterPromoteA.production).toBe(releaseA);
    const itemA = afterPromoteA.items.find(
      ({ releaseId }) => releaseId === releaseA
    );
    expect(itemA?.status).toBe('production');
    expect(itemA?.workspaceAllowlist).toEqual([workspaceId]);

    // ── 第二个 release B: 发布 → canary → 放量，替换生产。
    await p1Command(
      page,
      'ops-console',
      'publish_release',
      publishInput(releaseB, { version: 2, toolPolicyRevision: 'tool/2' }),
      `publish-b-${suffix}`
    );
    await page.goto('/admin/ops-console');
    await page
      .getByTestId('admin-ops-console-trial-workspace')
      .fill(workspaceId);
    await page.getByTestId('admin-ops-console-trial-release').fill(releaseB);
    await page
      .getByTestId('admin-ops-console-trial-reason')
      .fill('e2e one-run candidate trial');
    await page.getByTestId('admin-ops-console-trial-submit').click();
    await submitCopyRun(page, `candidate release B ${suffix}`);
    const candidateRun = await latestWorkspaceRun(workspaceId);
    expect(candidateRun.harness_release_id).toBe(releaseB);
    await submitCopyRun(page, `non-canary production release A ${suffix}`);
    const productionRun = await latestWorkspaceRun(workspaceId);
    expect(productionRun.run_id).not.toBe(candidateRun.run_id);
    expect(productionRun.harness_release_id).toBe(releaseA);

    for (const toStatus of ['evaluating', 'canary'] as const) {
      await p1Command(
        page,
        'ops-console',
        'transition_lifecycle',
        {
          releaseId: releaseB,
          reason: `e2e transition to ${toStatus}`,
          toStatus,
        },
        `transition-b-${toStatus}-${suffix}`
      );
    }
    await p1Command(
      page,
      'ops-console',
      'set_canary_allowlist',
      {
        releaseId: releaseB,
        reason: 'e2e canary allowlist B',
        workspaceAllowlist: [workspaceId],
      },
      `canary-allowlist-b-${suffix}`
    );
    await page.goto('/admin/ops-console');
    await seedPassedReleaseVerdict(releaseB, `b-${suffix}`);
    await p1Command(
      page,
      'ops-console',
      'record_rollback_drill',
      {
        releaseId: releaseB,
        result: 'passed',
        reason: 'e2e readiness B',
        evidence: 'e2e readiness B',
      },
      `readiness-b-${suffix}`
    );
    await page.getByTestId('admin-ops-console-promote-release').fill(releaseB);
    await page
      .getByTestId('admin-ops-console-promote-reason')
      .fill('e2e promote B');
    await page.getByTestId('admin-ops-console-promote-submit').click();
    await expect
      .poll(
        async () =>
          (await p1Query<OpsReleaseList>(page, 'ops-console', 'list_releases'))
            .production
      )
      .toBe(releaseB);

    // ── diff 可读(放量前对照)。
    const diff = await p1Query<{ changes: unknown[] }>(
      page,
      'ops-console',
      'diff_releases',
      { leftReleaseId: releaseA, rightReleaseId: releaseB }
    );
    expect(diff.changes.length).toBeGreaterThan(0);

    // ── 一键 rollback 回 A，带 reason + evidence(强制留痕)。
    await page.getByTestId('admin-ops-console-rollback-target').fill(releaseA);
    await page
      .getByTestId('admin-ops-console-rollback-reason')
      .fill('e2e rollback to A after B regression');
    await page
      .getByTestId('admin-ops-console-rollback-evidence')
      .fill('e2e rollback drill evidence link');
    await page.getByTestId('admin-ops-console-rollback-submit').click();
    await expect
      .poll(
        async () =>
          (await p1Query<OpsReleaseList>(page, 'ops-console', 'list_releases'))
            .production
      )
      .toBe(releaseA);

    // ── rollback 后新任务走旧 release: resolveForRun 只读 production
    // lifecycle,production 指针即新任务的解析结果。
    const afterRollback = await p1Query<OpsReleaseList>(
      page,
      'ops-console',
      'list_releases',
      {}
    );
    expect(afterRollback.production).toBe(releaseA);
    expect(afterRollback.canary).toBeNull();
    const itemBAfter = afterRollback.items.find(
      ({ releaseId }) => releaseId === releaseB
    );
    expect(itemBAfter?.status).toBe('retired');
    const itemAAfter = afterRollback.items.find(
      ({ releaseId }) => releaseId === releaseA
    );
    expect(itemAAfter?.status).toBe('production');
    expect(await exactRunRelease(candidateRun.run_id)).toBe(releaseB);
    await submitCopyRun(page, `post rollback production release A ${suffix}`);
    expect((await latestWorkspaceRun(workspaceId)).harness_release_id).toBe(
      releaseA
    );
    await page.goto('/admin/ops-console');

    // ── 回滚演练留痕。
    const drill = await p1Command<{ drill: { id: string; result: string } }>(
      page,
      'ops-console',
      'record_rollback_drill',
      {
        evidence: 'e2e drill evidence',
        notes: 'fixture drill',
        reason: 'e2e pre-release rollback drill',
        releaseId: releaseA,
        result: 'passed',
      },
      `drill-${suffix}`
    );
    expect(drill.drill.result).toBe('passed');
    const drills = await p1Query<{ items: Array<{ releaseId: string }> }>(
      page,
      'ops-console',
      'list_rollback_drills',
      {}
    );
    expect(drills.items.some((row) => row.releaseId === releaseA)).toBe(true);

    // ── 审计留痕:每个写操作都有条目(operator/reason/evidence 非空)。
    const audit = await p1Query<{ items: OpsAuditEntry[] }>(
      page,
      'ops-console',
      'list_audit',
      { limit: 100 }
    );
    const actions = audit.items.map(({ action }) => action);
    for (const expected of [
      'publish_release',
      'transition_lifecycle',
      'set_canary_allowlist',
      'set_candidate_trial',
      'promote_to_production',
      'rollback_production',
      'record_rollback_drill',
    ]) {
      expect(actions, `audit must contain ${expected}`).toContain(expected);
    }
    const auditByTarget = new Map(
      audit.items.map((entry) => [entry.action, entry] as const)
    );
    for (const action of [
      'publish_release',
      'set_canary_allowlist',
      'promote_to_production',
      'rollback_production',
      'record_rollback_drill',
    ]) {
      const entry = auditByTarget.get(action);
      expect(entry, `audit entry ${action}`).toBeTruthy();
      expect(entry!.reason.trim().length).toBeGreaterThan(0);
      expect(entry!.operatorId).toBeTruthy();
      expect(entry!.createdAt).toBeTruthy();
    }
    expect(auditByTarget.get('rollback_production')!.evidence).toMatch(
      /e2e rollback/i
    );
    expect(
      audit.items.some(
        (entry) =>
          entry.action === 'record_rollback_drill' &&
          /e2e drill/i.test(entry.evidence ?? '')
      )
    ).toBe(true);
    expect(
      audit.items.some(
        (entry) =>
          entry.action === 'rollback_production' && entry.target === releaseA
      )
    ).toBe(true);
  });
});
