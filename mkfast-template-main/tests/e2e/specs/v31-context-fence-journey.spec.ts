import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productCommand,
  productState,
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * V31-14 / V3.1 §37.4-E/F — Context Fence journeys (spec only).
 *
 * - §37.4-E Plan stale after confirm (fact/rights/cost drift → reconfirm)
 * - §37.4-F material rights revoke mid-execution → safe stop, no double charge
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
  expect(
    submissionResponse.ok(),
    await submissionResponse.text()
  ).toBeTruthy();

  await expect(page.getByTestId('agent-plan-section-deliverables')).toContainText(
    /3\s*页/u,
    { timeout: 120_000 }
  );
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

test.describe('V31-14 Context Fence journeys (§37.4-E/F)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('§37.4-E plan stale shows reconfirm surface (not silent continue)', async ({
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
      .fill('帮我按已确认的门店资料做三页图文，稍后核对事实。');
    await submitAndStartLivingPlan(page);

    const executionConfirmation = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(executionConfirmation).toBeVisible({ timeout: 120_000 });
    const executionInterrupt = page
      .getByTestId('agent-pending-interrupt')
      .filter({ hasText: /是否按当前方案开始生成/u });
    await expect(executionInterrupt).toBeVisible({ timeout: 120_000 });
    const executionInterruptId = await executionInterrupt.getAttribute(
      'data-interrupt-id'
    );
    expect(executionInterruptId).toBeTruthy();
    await changeConfirmedPriceFact(page);
    await executionInterrupt.getByTestId('agent-interrupt-accept').click();

    const noteStyleInterrupt = page
      .getByTestId('agent-pending-interrupt')
      .filter({ hasText: /两种图文方向/u });
    await expect(noteStyleInterrupt).toBeVisible({ timeout: 120_000 });
    await expect(noteStyleInterrupt).toHaveAttribute(
      'data-interrupt-schema-version',
      'interrupt-payload/v1'
    );
    await noteStyleInterrupt.getByTestId('agent-interrupt-accept').click();
    await expect(noteStyleInterrupt).toHaveCount(0, { timeout: 120_000 });

    const interrupt = page
      .getByTestId('agent-pending-interrupt')
      .filter({ hasText: /价格|事实|变化/u });
    await expect(interrupt).toBeVisible({ timeout: 120_000 });
    await expect(interrupt).toHaveAttribute(
      'data-interrupt-schema-version',
      'interrupt-payload/v1'
    );
    const interruptId = await interrupt.getAttribute('data-interrupt-id');
    const revision = await interrupt.getAttribute('data-interrupt-revision');
    expect(interruptId).toBeTruthy();
    expect(interruptId).not.toBe(executionInterruptId);
    expect(revision).toMatch(/^\d+$/u);

    await page.reload();
    await expect(interrupt).toHaveAttribute('data-interrupt-id', interruptId!);
    await expect(interrupt).toHaveAttribute(
      'data-interrupt-revision',
      revision!
    );
    await page.getByTestId('agent-interrupt-accept').click();
    await expect(interrupt).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId('composer-delivery-card')).toBeVisible({
      timeout: 420_000,
    });
  });

  test('§37.4-F rights revoke stops safely without double charge copy', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    const authorized = await openCustomizedCreate(page);

    await page
      .getByTestId('composer-intent-input')
      .fill('用门店授权素材做三页笔记配图。');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('composer-submit')).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByTestId('composer-submit').click();
    const start = page.getByTestId('agent-commit-strip-start');
    await expect(start).toBeEnabled({ timeout: 120_000 });
    await productCommand(page, {
      type: 'withdraw_asset',
      assetId: authorized.id,
    });
    await start.click();
    await expect(
      page.getByText(/授权已撤销|安全停止|不会重复扣费/).first()
    ).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/再次扣费|重复扣费/)).toHaveCount(0);
  });
});
