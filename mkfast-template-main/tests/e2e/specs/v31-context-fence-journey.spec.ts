import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { attachComposerSourceViaLibrary } from '../fixtures/library-source';
import { productState, seedConfirmedStore } from '../fixtures/product';
import {
  chooseImageTextDirection,
  selectComposerLens,
  settleComposerSubmission,
} from '../fixtures/ui-journey';

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
  const authorized = await attachComposerSourceViaLibrary(page, {
    name: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
  return authorized;
}

async function submitLivingPlan(page: Page) {
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
  const submissionResponse = await settleComposerSubmission(page, submission);
  expect(submissionResponse.ok(), await submissionResponse.text()).toBeTruthy();

  await expect(
    page.getByTestId('agent-plan-section-deliverables')
  ).toContainText(/3\s*页/u, { timeout: 120_000 });
}

/**
 * Press 开始制作 and return the confirmation request id the strip consumed.
 * The strip records the immutable `living-plan-commit` decision by POSTing
 * /confirmation-requests/<id>/decide before /start, so the id of the original
 * (soon superseded) authority is read off that request — no product surface
 * needs to expose it.
 */
async function startLivingPlan(page: Page): Promise<string> {
  const start = page.getByTestId('agent-commit-strip-start');
  await expect(start).toBeEnabled({ timeout: 120_000 });
  const decideRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      /\/api\/core\/p1\/confirmation-requests\/[^/]+\/decide$/u.test(
        new URL(request.url()).pathname
      ),
    { timeout: 120_000 }
  );
  const startResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(
        new URL(response.url()).pathname
      ),
    { timeout: 120_000 }
  );
  await start.click();
  const decideUrl = new URL((await decideRequest).url());
  const staleRequestId = decodeURIComponent(
    decideUrl.pathname.match(/\/confirmation-requests\/([^/]+)\/decide$/u)![1]!
  );
  expect(staleRequestId).toBeTruthy();
  expect((await startResponse).ok()).toBeTruthy();
  return staleRequestId;
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
    await submitLivingPlan(page);

    // §37.4-E leg 1: the referenced price really changes after the plan froze
    // its quote and before the merchant confirms. V31-56 makes the Living
    // Plan strip's 开始制作 the confirmation, so the drift lands between the
    // submission freeze and that click; admission then detects the stale
    // snapshot and the run comes back as a repriced successor (V31-63) — the
    // pre-confirmed happy path itself never shows a fresh in-stream card.
    await changeConfirmedPriceFact(page);
    const staleRequestId = await startLivingPlan(page);

    // §37.4-E leg 2: the merchant sees what changed, in the section that
    // carries store facts (§5.3 五节: 事实与素材).
    // `PlanDiff` returns null unless a section body really changed, so its
    // visibility already means the refreshed revision differs from the frozen
    // one. The section pair below is not a weak either/or over two product
    // states: both are the same state — 「the changed price is on screen」 —
    // and which of the two carries it depends only on whether the refreshed
    // fact ref moved 事实与素材's body or the requote moved 预计积分与时长's.
    // Every other section is excluded.
    const diff = page.getByTestId('agent-plan-diff');
    await expect(diff).toBeVisible({ timeout: 180_000 });
    const changedSectionKeys = await diff
      .locator('[data-testid="agent-plan-diff-entry"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-section-key'))
      );
    expect(
      changedSectionKeys,
      'the drifted price must be readable in the facts or the cost section'
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(?:facts_assets|cost_duration)$/u),
      ])
    );
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
        staleRequestId
      )}/decide`,
      {
        data: {
          decision: 'confirmed',
          decisionId: `stale-confirm:${staleRequestId}`,
        },
      }
    );
    expect(staleDecision.status(), await staleDecision.text()).toBe(409);

    // §37.4-E leg 4: 重新确认后执行. The successor card is a durable server
    // projection, so a reload must bring the same request back before the
    // merchant decides (typed-interrupt surface wiring for successors is a
    // recorded V31-63 open item; the card is the authority surface today).
    await page.reload();
    await expect(freshConfirmation).toBeVisible({ timeout: 120_000 });
    await expect(freshConfirmation).toHaveAttribute(
      'data-request-id',
      freshRequestId!
    );
    await freshConfirmation.getByRole('button', { name: '确认执行' }).click();
    await expect(freshConfirmation).toBeHidden({ timeout: 180_000 });

    // The successor executes as a fresh prepared run: its one 图文方向
    // question follows (V31-63 in-execution interrupt), then delivery.
    await chooseImageTextDirection(page);
    await expect(page.getByTestId('composer-delivery-card')).toBeVisible({
      timeout: 420_000,
    });
  });
});
