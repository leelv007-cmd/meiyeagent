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
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
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
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);

    await page
      .getByTestId('composer-intent-input')
      .fill('帮我按确认方案做图文，稍后我会改价格事实。');
    await page.getByTestId('composer-submit').click();
    const creationConfirm = page.getByRole('button', { name: '确认并开始' });
    await expect(creationConfirm).toBeVisible({ timeout: 120_000 });
    await changeConfirmedPriceFact(page);
    await creationConfirm.click();

    const interrupt = page.getByTestId('agent-pending-interrupt');
    await expect(interrupt).toBeVisible({ timeout: 120_000 });
    await expect(interrupt).toContainText(/价格|事实|变化/);
    await expect(interrupt).toHaveAttribute(
      'data-interrupt-schema-version',
      'interrupt-payload/v1'
    );
  });

  test('§37.4-F rights revoke stops safely without double charge copy', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);

    await page
      .getByTestId('composer-intent-input')
      .fill('用门店授权素材做一组笔记配图。');
    await page.getByTestId('composer-submit').click();
    await page.getByRole('button', { name: '确认并开始' }).click();
    await expect(
      page.getByText(/授权已撤销|安全停止|不会重复扣费/).first()
    ).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText(/再次扣费|重复扣费/)).toHaveCount(0);
  });
});
