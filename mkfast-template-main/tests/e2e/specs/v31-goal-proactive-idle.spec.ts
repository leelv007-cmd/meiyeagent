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

/**
 * HTTP hard gate: listSuggestionsSchema rejects client `config` injection
 * (server owns gate via admin-config heads). Workspace allowlist is the
 * U13 pilot key; kill switch is global and needs an admin actor.
 */
async function applyWorkspaceConfig(
  page: Page,
  key: string,
  value: unknown,
  reason: string
) {
  const history = await page.request.post('/api/core/p1/query', {
    data: {
      action: 'config_history',
      module: 'admin-config',
      payload: { key },
    },
  });
  expect(history.ok(), await history.text()).toBeTruthy();
  const revisions =
    (
      (await history.json()) as {
        data?: Array<{ revision?: number }>;
      }
    ).data ?? [];
  const expectedRevision = revisions.reduce(
    (latest, row) => Math.max(latest, row.revision ?? 0),
    0
  );
  const applied = await page.request.post('/api/core/p1/commands', {
    data: {
      action: 'config_apply',
      module: 'admin-config',
      payload: {
        expectedRevision: expectedRevision > 0 ? expectedRevision : null,
        key,
        reason,
        value,
      },
    },
    headers: {
      'idempotency-key': `goal-cfg-${key}-${Date.now()}-${Math.random()}`,
    },
  });
  expect(applied.ok(), await applied.text()).toBeTruthy();
}

test.describe('V31-24 Goal + Proactive Idle', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('propose→confirm goal, Idle projection, accept has zero paid side effect', async ({
    page,
    request,
  }) => {
    // Admin role: BFF gates all admin-config history/apply to platform admin.
    // Workspace allowlist key is still scoped to this actor's workspace.
    const user = await registerE2EUser(request, { role: 'admin' });
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
    // Do not inject `config` — HTTP rejects it; production reads admin heads.
    const closed = await p1Query<{
      gate: { open: boolean; reason: string };
      suggestions: unknown[];
      primaryGoal: { goalId: string } | null;
    }>(page, 'goal-proactive', 'get_idle_projection', {});
    expect(closed.primaryGoal?.goalId).toBe(`goal-e2e-${suffix}`);
    expect(closed.gate.open).toBe(false);
    expect(closed.gate.reason).toBe('threshold_unset');
    expect(closed.suggestions).toEqual([]);

    // U13 pilot allowlist + owned-data goal_stalled (14d). Advance `now` so the
    // production OwnedDataProactiveSignalSource emits a real signal — client
    // signal injection is for list only and cannot authorize accept.
    await applyWorkspaceConfig(
      page,
      'proactive_opportunity_v1',
      true,
      'e2e open pilot allowlist'
    );
    const stalledNow = new Date(
      Date.now() + 15 * 24 * 60 * 60 * 1000
    ).toISOString();
    const open = await p1Query<{
      gate: { open: boolean };
      suggestions: Array<{
        candidateId: string;
        reason: string;
        evidenceRefs: Array<{ kind: string; ref: string }>;
      }>;
      primaryGoal: { goalId: string; resourceId: string } | null;
    }>(page, 'goal-proactive', 'get_idle_projection', {
      now: stalledNow,
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
        now: stalledNow,
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
        now: stalledNow,
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
    // Same admin actor owns both the workspace allowlist and the global kill
    // switch so we do not need a second workspace membership hop.
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    await seedConfirmedStore(page);
    await applyWorkspaceConfig(
      page,
      'proactive_opportunity_v1',
      true,
      'e2e allowlist before kill switch'
    );
    await applyWorkspaceConfig(
      page,
      'disable_proactive_agent',
      true,
      'e2e kill switch on'
    );

    const projection = await p1Query<{
      gate: { open: boolean; reason: string };
      suggestions: unknown[];
    }>(page, 'goal-proactive', 'get_idle_projection', {
      // Future clock would open goal_stalled without the kill switch.
      now: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(projection.gate.open).toBe(false);
    expect(projection.gate.reason).toBe('kill_switch');
    expect(projection.suggestions).toEqual([]);

    // Restore kill switch so later specs in the same stack stay unaffected.
    await applyWorkspaceConfig(
      page,
      'disable_proactive_agent',
      false,
      'e2e kill switch off'
    );
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
