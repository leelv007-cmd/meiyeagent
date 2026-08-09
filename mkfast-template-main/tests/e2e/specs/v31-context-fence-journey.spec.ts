import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productState,
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * V31-14 / V3.1 §37.4-E — Plan stale journey.
 *
 * §37.4-E original text: 确认前价格 revision 变化、显示 diff、旧确认不可提交、
 * 重新确认后执行. The drift is a real append-only store-fact write (not an
 * intent sentence hinting at one), and the three consequences are asserted
 * separately: the plan diff must render the changed section, the superseded
 * confirmation authority must refuse a second decision, and delivery may only
 * happen after a fresh confirmation request with a different requestId.
 *
 * §37.4-F moved to `v31-rights-revocation-journey.spec.ts` — its old form here
 * asserted the absence of the words「重复扣费」on the page, which is unrelated
 * to whether a second debit happened.
 *
 * Real browser run is owned by the merge controller. Do not run full e2e here.
 */

async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  // image_text submissions fail closed (400 INVALID_STATE) without a
  // case_image workspace source — seed one first, as the merchant would.
  const authorized = await seedComposerInlineAuthorize(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
  return authorized;
}

async function submitAndStartLivingPlan(page: Page) {
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });
  const submit = page.getByTestId('composer-submit');
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await submit.click();
  const submissionResponse = await submission;
  expect(submissionResponse.ok(), await submissionResponse.text()).toBeTruthy();

  await expect(
    page.getByTestId('agent-plan-section-deliverables')
  ).toContainText(/3\s*页/u, { timeout: 120_000 });
  const start = page.getByTestId('agent-commit-strip-start');
  await expect(start).toBeEnabled({ timeout: 120_000 });
  const startResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(
        new URL(response.url()).pathname
      ),
    { timeout: 120_000 }
  );
  await start.click();
  expect((await startResponse).ok()).toBeTruthy();
}

async function changeConfirmedPriceFact(page: Page) {
  const state = await productState(page);
  const store = state.store;
  const project = store?.projects.find(
    ({ id }) => id === 'project-grounded-creation'
  );
  if (store?.revision === undefined || !project) {
    throw new Error('Confirmed store project is missing before price drift');
  }
  await page.evaluate(
    async ({ project: confirmedProject, storeRevision, workspaceId }) => {
      const capturedAt = new Date().toISOString();
      const batchId = `v31-price-drift-${crypto.randomUUID()}`;
      const candidateId = `${batchId}:price`;
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          module: 'asset-memory',
          action: 'finalize_store_intake',
          payload: {
            batch: {
              batchId,
              candidates: [
                {
                  candidateId,
                  fact: {
                    effectiveFrom: capturedAt,
                    expiresAt: null,
                    key: `service.${confirmedProject.id}.price`,
                    kind: 'price',
                    scope: { storeId: workspaceId },
                    source: {
                      capturedAt,
                      kind: 'user_confirmation',
                      referenceId: batchId,
                    },
                    value: { amount: 269, currency: 'CNY' },
                  },
                  objectKind: 'store_fact',
                  status: 'pending',
                },
              ],
              source: {
                capabilityStatus: 'assisted',
                capturedAt,
                example: false,
                kind: 'manual',
                referenceId: batchId,
                sourceId: `${batchId}:source`,
                sourceWorkspaceId: workspaceId,
              },
              summary: 'V31 price drift after creation confirmation.',
              taskId: `${batchId}:task`,
            },
            confirmations: [
              {
                candidateId,
                expectedFactRevision: 1,
                factId: `store-project:${confirmedProject.id}:price`,
              },
            ],
            profilePatch: {
              expectedRevision: storeRevision,
              projects: {
                upsert: [
                  {
                    ...confirmedProject,
                    price: 269,
                    priceValidUntil: confirmedProject.priceValidUntil ?? null,
                  },
                ],
              },
            },
          },
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `v31-price-drift-${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`Price drift injection failed: ${response.status}`);
      }
    },
    {
      project,
      storeRevision: store.revision,
      workspaceId: state.workspaceId,
    }
  );
}

test.describe('V31-14 Context Fence journey (§37.4-E)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('a price revision that lands before confirmation shows a diff, voids the old confirmation, and only executes after a fresh one', async ({
    page,
    request,
  }) => {
    test.setTimeout(480_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);

    await page
      .getByTestId('composer-intent-input')
      .fill('帮我按已确认的门店资料做三页图文。');
    await submitAndStartLivingPlan(page);

    const executionConfirmation = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(executionConfirmation).toBeVisible({ timeout: 120_000 });
    const staleRequestId =
      await executionConfirmation.getAttribute('data-request-id');
    expect(staleRequestId).toBeTruthy();
    const executionInterrupt = page
      .getByTestId('agent-pending-interrupt')
      .filter({ hasText: /是否按当前方案开始生成/u });
    await expect(executionInterrupt).toBeVisible({ timeout: 120_000 });

    // §37.4-E leg 1: the referenced price really changes before confirmation.
    await changeConfirmedPriceFact(page);
    await executionInterrupt.getByTestId('agent-interrupt-accept').click();

    // §37.4-E leg 2: the merchant sees what changed, in the section that
    // carries store facts (§5.3 五节: 事实与素材).
    const diff = page.getByTestId('agent-plan-diff');
    await expect(diff).toBeVisible({ timeout: 180_000 });
    const factsDiffEntry = diff.locator(
      '[data-testid="agent-plan-diff-entry"][data-section-key="facts_assets"]'
    );
    await expect(factsDiffEntry).toHaveCount(1);
    const fromRevision = Number(await diff.getAttribute('data-from-revision'));
    const toRevision = Number(await diff.getAttribute('data-to-revision'));
    expect(Number.isSafeInteger(fromRevision)).toBe(true);
    expect(toRevision).toBeGreaterThan(fromRevision);

    // §37.4-E leg 3: execution needs a *new* confirmation authority, and the
    // superseded one can no longer authorize anything.
    const freshConfirmation = page.locator(
      `[data-testid="execution-confirmation-interaction-card"]:not([data-request-id="${staleRequestId}"])`
    );
    await expect(freshConfirmation).toBeVisible({ timeout: 180_000 });
    const freshRequestId =
      await freshConfirmation.getAttribute('data-request-id');
    expect(freshRequestId).toBeTruthy();
    expect(freshRequestId).not.toBe(staleRequestId);
    await expect(page.getByTestId('composer-delivery-card')).toHaveCount(0);

    const staleDecision = await page.request.post(
      `/api/core/p1/confirmation-requests/${encodeURIComponent(
        staleRequestId!
      )}/decide`,
      {
        data: {
          decision: 'confirmed',
          decisionId: `stale-confirm:${staleRequestId}`,
        },
      }
    );
    expect(staleDecision.status(), await staleDecision.text()).toBe(409);

    // §37.4-E leg 4: 重新确认后执行.
    const freshInterrupt = page
      .getByTestId('agent-pending-interrupt')
      .filter({ hasText: /是否按当前方案开始生成/u });
    await expect(freshInterrupt).toBeVisible({ timeout: 180_000 });
    await expect(freshInterrupt).toHaveAttribute(
      'data-interrupt-schema-version',
      'interrupt-payload/v1'
    );
    const freshInterruptId =
      await freshInterrupt.getAttribute('data-interrupt-id');
    const freshInterruptRevision = await freshInterrupt.getAttribute(
      'data-interrupt-revision'
    );
    expect(freshInterruptRevision).toMatch(/^\d+$/u);
    await page.reload();
    await expect(freshInterrupt).toHaveAttribute(
      'data-interrupt-id',
      freshInterruptId!
    );
    await expect(freshInterrupt).toHaveAttribute(
      'data-interrupt-revision',
      freshInterruptRevision!
    );
    await freshInterrupt.getByTestId('agent-interrupt-accept').click();
    await expect(freshInterrupt).toHaveCount(0, { timeout: 180_000 });

    const noteStyleInterrupt = page
      .getByTestId('agent-pending-interrupt')
      .filter({ hasText: /两种图文方向/u });
    await expect(noteStyleInterrupt).toBeVisible({ timeout: 180_000 });
    await noteStyleInterrupt.getByTestId('agent-interrupt-accept').click();
    await expect(noteStyleInterrupt).toHaveCount(0, { timeout: 180_000 });

    await expect(page.getByTestId('composer-delivery-card')).toBeVisible({
      timeout: 420_000,
    });
  });
});
