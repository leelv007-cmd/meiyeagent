import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

import {
  SEED_HARNESS_RELEASE_ID,
  seedHarnessReleaseManifest,
} from '../../../../apps/core/src/p1/harness/seed-harness-release';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { attachComposerSourceViaLibrary } from '../fixtures/library-source';
import { seedConfirmedStore } from '../fixtures/product';
import {
  selectComposerLens,
  settleComposerSubmission,
} from '../fixtures/ui-journey';

const passingQuickCheckTrace = {
  toolCalls: [
    { toolName: 'read_context' },
    { toolName: 'generate' },
    { toolName: 'check' },
    { toolName: 'record' },
  ],
  tags: ['l0.5'],
};

async function workspaceIdFromProductApi(page: Page): Promise<string> {
  const response = await page.request.get('/api/core/product/state');
  expect(response.ok(), await response.text()).toBeTruthy();
  const envelope = (await response.json()) as {
    data?: { workspaceId?: string };
  };
  expect(envelope.data?.workspaceId).toBeTruthy();
  return envelope.data!.workspaceId!;
}

async function openConsole(page: Page) {
  await page.goto('/admin/ops-console');
  await expect(page.getByTestId('admin-ops-console')).toBeVisible();
}

async function publish(
  page: Page,
  releaseId: string,
  version: number,
  toolPolicy: string
) {
  const manifest = {
    ...seedHarnessReleaseManifest(),
    releaseId,
    version,
    toolPolicyRevision: toolPolicy,
    createdAt: new Date().toISOString(),
  };
  await page.getByTestId('admin-ops-console-publish-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-publish-version')
    .fill(String(version));
  await page
    .getByTestId('admin-ops-console-publish-tool-policy')
    .fill(toolPolicy);
  await page
    .getByTestId('admin-ops-console-publish-manifest')
    .fill(JSON.stringify(manifest));
  await page
    .getByTestId('admin-ops-console-publish-reason')
    .fill(`publish ${releaseId}`);
  await page.getByTestId('admin-ops-console-publish-submit').click();
  await expect(
    page.getByTestId(`admin-ops-console-release-${releaseId}`)
  ).toBeVisible();
}

async function transition(
  page: Page,
  releaseId: string,
  status: 'evaluating' | 'canary'
) {
  await page.getByTestId('admin-ops-console-advance-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-advance-status')
    .selectOption(status);
  await page
    .getByTestId('admin-ops-console-advance-reason')
    .fill(`advance ${status}`);
  await page.getByTestId('admin-ops-console-advance-submit').click();
  await expect(
    page.getByTestId(`admin-ops-console-release-${releaseId}`)
  ).toHaveAttribute('data-status', status);
}

async function evaluateAndRecordDrill(page: Page, releaseId: string) {
  await page.getByTestId('admin-ops-console-eval-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-eval-reason')
    .fill(`evaluate ${releaseId}`);
  await page
    .getByTestId('admin-ops-console-eval-trace')
    .fill(JSON.stringify(passingQuickCheckTrace));
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/commands')
  );
  await page.getByTestId('admin-ops-console-eval-submit').click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(
    page.getByTestId('admin-ops-console-eval-observation')
  ).toContainText(`${releaseId}: passed`);
  await page
    .getByTestId('admin-ops-console-drill-evidence')
    .fill(`runbook://${releaseId}`);
  await page.getByTestId('admin-ops-console-drill-submit').click();
  await expect(page.getByText('Rollback drill recorded')).toBeVisible();
}

async function promote(page: Page, releaseId: string) {
  await page.getByTestId('admin-ops-console-promote-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-promote-reason')
    .fill(`promote ${releaseId}`);
  await page.getByTestId('admin-ops-console-promote-submit').click();
  await expect(
    page.getByTestId(`admin-ops-console-release-${releaseId}`)
  ).toHaveAttribute('data-status', 'production');
}

async function startCopyRun(
  page: Page,
  intent: string
): Promise<{ response: Promise<Response> }> {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'copy');
  await page.getByTestId('composer-intent-input').fill(intent);
  // D1=A: customized copy never POSTs until the free door is taken.
  await expect(page.getByTestId('composer-creation-mode-host')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('composer-creation-mode-free').click();
  await expect(page.getByTestId('composer-free-creation-panel')).toBeVisible();
  const modelSelect = page.getByTestId('composer-free-model-select');
  await expect(modelSelect).toBeEnabled({ timeout: 30_000 });
  await modelSelect.click();
  const firstModel = page.getByRole('option').first();
  await expect(firstModel).toBeVisible();
  await firstModel.click();
  await expect(
    page
      .getByTestId('workbench-credit-quote')
      .or(page.getByTestId('composer-quote-line'))
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('composer-submit')).toBeEnabled({
    timeout: 30_000,
  });
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const brief = page.getByTestId('composer-brief-surface');
  if (await brief.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByTestId('composer-brief-confirm').click();
  }
  return { response: settleComposerSubmission(page, response) };
}

async function submitCopyRun(page: Page, intent: string) {
  const started = await startCopyRun(page, intent);
  const response = await started.response;
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function prepareImageTextRun(page: Page, intent: string) {
  await page.goto('/dashboard');
  await attachComposerSourceViaLibrary(page, {
    fileName: `rollback-inflight-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-submit')).toBeEnabled({
    timeout: 30_000,
  });
}

async function startPreparedRun(page: Page) {
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const brief = page.getByTestId('composer-brief-surface');
  if (await brief.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByTestId('composer-brief-confirm').click();
  }
  return { response: settleComposerSubmission(page, response) };
}

function runPinsFor(page: Page, releaseId: string) {
  return page
    .getByTestId('admin-ops-console-run-pin')
    .filter({ hasText: releaseId });
}

/**
 * V31-105 §5: the pins panel reads a shared Core, whose recent window is filled
 * by whatever else ran on this database. Every inspection names its release so
 * the read is scoped server-side; `runPinsFor` stays as the client-side check.
 */
function runPinsScopeOf(request: Request): string | null {
  const body = request.postDataJSON() as {
    module?: string;
    action?: string;
    payload?: { releaseId?: unknown };
  } | null;
  if (!body || body.module !== 'ops-console') return null;
  if (body.action !== 'list_recent_run_pins') return null;
  const releaseId = body.payload?.releaseId;
  return typeof releaseId === 'string' ? releaseId : null;
}

async function scopeRunPins(page: Page, releaseId: string) {
  const scopeInput = page.getByTestId('admin-ops-console-run-pins-release');
  await expect(scopeInput).toBeVisible();
  const alreadyScoped = (await scopeInput.inputValue()) === releaseId;
  const scoped = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().includes('/api/core/p1/query') &&
      runPinsScopeOf(item.request()) === releaseId
  );
  if (alreadyScoped) {
    // Re-filling an unchanged value issues no request; ask for a refetch of the
    // scope that is already in place instead of waiting for one that never runs.
    await page.getByTestId('admin-ops-console-refresh-run-pins').click();
  } else {
    await scopeInput.fill(releaseId);
  }
  const response = await scoped;
  expect(
    response.ok(),
    `run pins scope ${releaseId} answered ${response.status()}`
  ).toBeTruthy();
}

async function waitForNewRunPin(
  page: Page,
  releaseId: string,
  previousCount: number,
  expectedStatus?: 'active' | 'running'
) {
  await scopeRunPins(page, releaseId);
  await expect
    .poll(
      async () => {
        await page.getByTestId('admin-ops-console-refresh-run-pins').click();
        const pins = runPinsFor(page, releaseId);
        if ((await pins.count()) <= previousCount) {
          return 'missing:';
        }
        const newest = pins.first();
        const status = expectedStatus
          ? await newest.getAttribute('data-run-status')
          : 'observed';
        return `${status}:${(await newest.getAttribute('data-run-id')) ?? ''}`;
      },
      { timeout: 60_000 }
    )
    .toMatch(
      new RegExp(
        `^${expectedStatus === 'active' ? '(?:running|waiting)' : (expectedStatus ?? 'observed')}:.+`,
        'u'
      )
    );
  const observedRunId =
    (await runPinsFor(page, releaseId).first().getAttribute('data-run-id')) ??
    '';
  expect(observedRunId).toBeTruthy();
  return observedRunId;
}

test.describe('V31 Ops Console real release journey', () => {
  test.afterEach(async ({ request }) => cleanupE2EUsers(request));

  test('UI publish → canary routing → trial → promote → in-flight rollback → new task pin', async ({
    browser,
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const admin = await registerE2EUser(request, { role: 'admin' });
    const outsider = await registerE2EUser(request);
    const runner = await registerE2EUser(request);
    await loginByForm(page, admin);
    await seedConfirmedStore(page);
    const workspaceId = await workspaceIdFromProductApi(page);
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await loginByForm(outsiderPage, outsider);
    await seedConfirmedStore(outsiderPage);
    const outsiderWorkspaceId = await workspaceIdFromProductApi(outsiderPage);
    expect(outsiderWorkspaceId).not.toBe(workspaceId);
    const runnerContext = await browser.newContext();
    const runningPage = await runnerContext.newPage();
    await loginByForm(runningPage, runner);
    await seedConfirmedStore(runningPage);

    const suffix = Date.now();
    const releaseA = `release-ui-a-${suffix}`;
    const releaseB = `release-ui-b-${suffix}`;

    try {
      await openConsole(page);
      await publish(page, releaseA, 101, 'tool/ui-a');
      await transition(page, releaseA, 'evaluating');
      await transition(page, releaseA, 'canary');
      await page
        .getByTestId('admin-ops-console-allowlist-release')
        .fill(releaseA);
      await page
        .getByTestId('admin-ops-console-allowlist-workspaces')
        .fill(workspaceId);
      await page
        .getByTestId('admin-ops-console-allowlist-reason')
        .fill('UI canary allowlist');
      await page.getByTestId('admin-ops-console-allowlist-submit').click();

      await submitCopyRun(page, `allowlisted candidate A ${suffix}`);
      await submitCopyRun(outsiderPage, `nonallowlisted production ${suffix}`);
      await openConsole(page);
      await page.getByTestId('admin-ops-console-refresh').click();
      await scopeRunPins(page, releaseA);
      await expect(runPinsFor(page, releaseA).first()).toBeVisible();
      await scopeRunPins(page, SEED_HARNESS_RELEASE_ID);
      await expect(
        runPinsFor(page, SEED_HARNESS_RELEASE_ID).first()
      ).toBeVisible();

      await evaluateAndRecordDrill(page, releaseA);
      await promote(page, releaseA);

      await publish(page, releaseB, 102, 'tool/ui-b');
      await page
        .getByTestId('admin-ops-console-trial-workspace')
        .fill(workspaceId);
      await page.getByTestId('admin-ops-console-trial-release').fill(releaseB);
      await page
        .getByTestId('admin-ops-console-trial-reason')
        .fill('one run UI trial');
      await page.getByTestId('admin-ops-console-trial-submit').click();

      await submitCopyRun(page, `candidate B ${suffix}`);
      await openConsole(page);
      await page.getByTestId('admin-ops-console-refresh').click();
      await expect(
        page.getByTestId(`admin-ops-console-trial-observation-${releaseB}`)
      ).not.toContainText('pending');
      await scopeRunPins(page, releaseB);
      await expect(runPinsFor(page, releaseB).first()).toBeVisible();

      await submitCopyRun(page, `production A ${suffix}`);
      await openConsole(page);
      await page.getByTestId('admin-ops-console-refresh').click();
      await scopeRunPins(page, releaseA);
      await expect(runPinsFor(page, releaseA).first()).toBeVisible();

      await transition(page, releaseB, 'evaluating');
      await transition(page, releaseB, 'canary');
      await evaluateAndRecordDrill(page, releaseB);
      await promote(page, releaseB);

      await prepareImageTextRun(
        runningPage,
        `use the authorized image for an inflight xiaohongshu note ${suffix}`
      );
      await scopeRunPins(page, releaseB);
      const previousBCount = await runPinsFor(page, releaseB).count();
      const [running, frozenRunId] = await Promise.all([
        startPreparedRun(runningPage),
        waitForNewRunPin(page, releaseB, previousBCount, 'active'),
      ]);

      await page
        .getByTestId('admin-ops-console-rollback-target')
        .fill(releaseA);
      await page
        .getByTestId('admin-ops-console-rollback-reason')
        .fill('UI rollback incident');
      await page
        .getByTestId('admin-ops-console-rollback-evidence')
        .fill('incident://ui-e2e');
      await page.getByTestId('admin-ops-console-rollback-submit').click();
      await expect(
        page.getByTestId(`admin-ops-console-release-${releaseA}`)
      ).toHaveAttribute('data-status', 'production');
      await page.getByTestId('admin-ops-console-refresh').click();
      // The frozen run keeps its releaseB pin across the rollback to A.
      await scopeRunPins(page, releaseB);
      await expect(
        page.getByTestId('admin-ops-console-run-pin').filter({
          hasText: frozenRunId,
        })
      ).toBeVisible();
      await expect(
        page
          .getByTestId('admin-ops-console-audit-row')
          .filter({ hasText: 'rollback_production' })
          .first()
      ).toContainText(frozenRunId);
      expect((await running.response).ok()).toBeTruthy();

      await scopeRunPins(page, releaseA);
      const previousACount = await runPinsFor(page, releaseA).count();
      // The post-rollback task comes from the outsider merchant, not the runner:
      // the runner workspace still holds the frozen run this leg just used as
      // evidence, and U6 allows one active write turn per workspace
      // (p1_agent_runs_active_turn_idx), so its composer offers no submit control
      // until that run ends. The outsider resolves through production, which the
      // rollback just pinned back to releaseA — the same claim, unraced.
      const postRollback = await startCopyRun(
        outsiderPage,
        `post rollback A ${suffix}`
      );
      // Start first, then watch: the pin cannot exist before the run does, so
      // racing the 60s poll against the composer flow only shortens the budget.
      await waitForNewRunPin(page, releaseA, previousACount);
      void postRollback.response.catch(() => undefined);
    } finally {
      await runnerContext.close();
      await outsiderContext.close();
    }
  });
});
