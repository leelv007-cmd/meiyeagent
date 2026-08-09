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

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState } from '../fixtures/product';

type P1Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

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
    promptBindings: {},
    promptPackBindings: {},
    releaseId,
    rightsPolicyRevision: 'rights/1',
    schemaBindings: {},
    skillBindings: {},
    supervisorPolicyRef: { id: 'sup', revision: '1' },
    toolPolicyRevision: 'tool/1',
    version: 1,
    ...overrides,
  };
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
    await p1Command(
      page,
      'ops-console',
      'set_canary_allowlist',
      {
        releaseId: releaseA,
        reason: 'e2e canary allowlist',
        workspaceAllowlist: [workspaceId],
      },
      `canary-allowlist-a-${suffix}`
    );

    // ── candidate 试跑。
    await p1Command(
      page,
      'ops-console',
      'set_candidate_trial',
      {
        candidateReleaseId: releaseA,
        reason: 'e2e candidate trial',
        workspaceId,
      },
      `candidate-trial-${suffix}`
    );

    // ── 人工放量 (U12 human click)。
    await p1Command(
      page,
      'ops-console',
      'promote_to_production',
      { releaseId: releaseA, reason: 'e2e promote A' },
      `promote-a-${suffix}`
    );

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
      publishInput(releaseB, { version: 2 }),
      `publish-b-${suffix}`
    );
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
    await p1Command(
      page,
      'ops-console',
      'promote_to_production',
      { releaseId: releaseB, reason: 'e2e promote B' },
      `promote-b-${suffix}`
    );

    // ── diff 可读(放量前对照)。
    const diff = await p1Query<{ changes: unknown[] }>(
      page,
      'ops-console',
      'diff_releases',
      { leftReleaseId: releaseA, rightReleaseId: releaseB }
    );
    expect(diff.changes.length).toBeGreaterThan(0);

    // ── 一键 rollback 回 A，带 reason + evidence(强制留痕)。
    const rolled = await p1Command<{
      previousProduction: { releaseId: string } | null;
      production: { releaseId: string };
    }>(
      page,
      'ops-console',
      'rollback_production',
      {
        evidence: 'e2e rollback drill evidence link',
        reason: 'e2e rollback to A after B regression',
        toReleaseId: releaseA,
      },
      `rollback-${suffix}`
    );
    expect(rolled.production.releaseId).toBe(releaseA);
    expect(rolled.previousProduction?.releaseId).toBe(releaseB);

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
    expect(auditByTarget.get('record_rollback_drill')!.evidence).toMatch(
      /e2e drill/i
    );
    const rollbackTarget = auditByTarget.get('rollback_production')!.target;
    expect(rollbackTarget).toBe(releaseA);
  });
});
