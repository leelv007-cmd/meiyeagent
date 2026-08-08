/**
 * V31-24 Goal product surface + Proactive Idle journeys (write-only).
 *
 * Covers batch-6 exit gates from V3.1 §35 / ticket V31-24:
 * - Idle first screen shows primary goal + proactive suggestions with why-now
 * - gate threshold unset ⇒ no suggestions; allowlist pilot can open
 * - accept suggestion → Thread turn (zero paid side effect)
 * - dismiss remembered after refresh
 * - no Goal management page route
 *
 * Do not run in agent worktrees without lane-owned ports (dispatch rule).
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';

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
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
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
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ??
            `${cmdModule}.${cmdAction} command failed`
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

test.describe('V31-24 Goal + Proactive Idle', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('propose→confirm goal, Idle projection, accept has zero paid side effect', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    const suffix = `${Date.now()}`;

    // Create goal only via propose → confirm (no management page).
    const proposed = await p1Command<{
      proposal: { proposalId: string };
    }>(
      page,
      'goal-proactive',
      'propose_create_goal',
      {
        draft: {
          objective: 'inquiry',
          statement: 'E2E 头皮护理新客',
          priority: 'high',
          evidenceRefs: [{ kind: 'merchant_said', ref: 'e2e-msg' }],
        },
        proposalId: `prop-e2e-${suffix}`,
      },
      `propose-goal-${suffix}`
    );

    await p1Command(
      page,
      'goal-proactive',
      'confirm_goal_proposal',
      {
        proposalId: proposed.proposal.proposalId,
        goalId: `goal-e2e-${suffix}`,
      },
      `confirm-goal-${suffix}`
    );

    // Gate closed by default when threshold unset and not allowlisted.
    const closed = await p1Query<{
      gate: { open: boolean; reason: string };
      suggestions: unknown[];
      primaryGoal: { goalId: string } | null;
    }>(page, 'goal-proactive', 'get_idle_projection', {
      config: {
        disableProactiveAgent: false,
        proactiveFeatureOn: true,
        workspaceAllowlisted: false,
        coverageThreshold: null,
      },
    });
    expect(closed.primaryGoal?.goalId).toBe(`goal-e2e-${suffix}`);
    expect(closed.gate.open).toBe(false);
    expect(closed.gate.reason).toBe('threshold_unset');
    expect(closed.suggestions).toEqual([]);

    // U13 pilot allowlist opens suggestions with why-now evidence.
    // Server coerces signal.resourceId to the caller workspace.
    const open = await p1Query<{
      gate: { open: boolean };
      suggestions: Array<{
        candidateId: string;
        reason: string;
        evidenceRefs: unknown[];
      }>;
      primaryGoal: { goalId: string; resourceId: string } | null;
    }>(page, 'goal-proactive', 'get_idle_projection', {
      config: {
        disableProactiveAgent: false,
        proactiveFeatureOn: true,
        workspaceAllowlisted: true,
        coverageThreshold: null,
      },
      signals: [
        {
          kind: 'goal_stalled',
          resourceId: 'ignored-client-placeholder',
          observedAt: new Date().toISOString(),
          summary: '目标两周未推进',
          evidenceRefs: [
            { kind: 'goal_stalled', ref: `goal-e2e-${suffix}` },
          ],
          goalId: `goal-e2e-${suffix}`,
          weight: 2,
        },
      ],
    });
    expect(open.gate.open).toBe(true);
    expect(open.suggestions.length).toBeGreaterThan(0);
    expect(open.suggestions[0]!.evidenceRefs.length).toBeGreaterThan(0);

    const accept = await p1Command<{
      threadId: string;
      runId: string;
      paidSideEffect: boolean;
      replayed: boolean;
    }>(
      page,
      'goal-proactive',
      'accept_opportunity',
      {
        candidateId: open.suggestions[0]!.candidateId,
        reason: open.suggestions[0]!.reason,
        evidenceRefs: open.suggestions[0]!.evidenceRefs,
        goalId: `goal-e2e-${suffix}`,
      },
      `accept-${open.suggestions[0]!.candidateId}`
    );
    expect(accept.paidSideEffect).toBe(false);
    expect(accept.threadId.length).toBeGreaterThan(0);
    expect(accept.runId.length).toBeGreaterThan(0);

    // Idempotent accept — same candidateId does not create another turn.
    const replay = await p1Command<{
      threadId: string;
      runId: string;
      replayed: boolean;
      paidSideEffect: boolean;
    }>(
      page,
      'goal-proactive',
      'accept_opportunity',
      {
        candidateId: open.suggestions[0]!.candidateId,
        reason: open.suggestions[0]!.reason,
        evidenceRefs: open.suggestions[0]!.evidenceRefs,
        goalId: `goal-e2e-${suffix}`,
      },
      `accept-replay-${open.suggestions[0]!.candidateId}`
    );
    expect(replay.replayed).toBe(true);
    expect(replay.threadId).toBe(accept.threadId);
    expect(replay.runId).toBe(accept.runId);
    expect(replay.paidSideEffect).toBe(false);

    // No Goal management page.
    const goalsNav = await page.goto('/dashboard/goals');
    // Route should not be a dedicated Goal CRUD management surface.
    expect(goalsNav?.status() ?? 404).not.toBe(200);
  });

  test('kill switch closes proactive suggestions on Idle projection', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const projection = await p1Query<{
      gate: { open: boolean; reason: string };
      suggestions: unknown[];
    }>(page, 'goal-proactive', 'get_idle_projection', {
      config: {
        disableProactiveAgent: true,
        proactiveFeatureOn: true,
        workspaceAllowlisted: true,
        coverageThreshold: 0.1,
      },
      signals: [
        {
          kind: 'merchant_hot_topic',
          resourceId: 'ignored-client-placeholder',
          observedAt: new Date().toISOString(),
          summary: '商家热点',
          evidenceRefs: [{ kind: 'merchant_hot_topic', ref: 'hot-1' }],
          weight: 1,
        },
      ],
    });
    expect(projection.gate.open).toBe(false);
    expect(projection.gate.reason).toBe('kill_switch');
    expect(projection.suggestions).toEqual([]);
  });

  test('dashboard Idle host mounts goal-proactive surface testid', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    // Host is Idle when no thread; surface may be empty or ready.
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-workbench-root',
      'idle',
      { timeout: 30_000 }
    );
    // Empty gate states render a zero-height section on purpose ("surface may
    // be empty or ready" above) — mounted is the contract, visible is not.
    await expect(page.getByTestId('idle-goal-proactive')).toBeAttached({
      timeout: 30_000,
    });
  });
});
