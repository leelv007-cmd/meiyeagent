import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { attachComposerSourceViaLibrary } from '../fixtures/library-source';
import { seedConfirmedStore } from '../fixtures/product';
import {
  chooseImageTextDirection,
  closeComposerCapsule,
  openComposerCapsule,
  selectComposerLens,
  settleComposerSubmission,
} from '../fixtures/ui-journey';

/**
 * V31-10 / V3.1 §37.4-C — Living Plan journey against the real production
 * sequence (no route mocks; only the model boundary is fixture mode).
 *
 * The sequence this file encodes is the one Core actually runs
 * (`apps/core/src/p1/agent-session/composer-plan-session.ts`,
 * `apps/core/src/composer-plan-route-registrar.ts`):
 *
 * 1. `POST /p1/composer/submissions` runs an Agent Session **Intent turn before
 *    the PlanCompiler** (`prepare()` → `runIntentTurn()` → `compile()`), so the
 *    202 already carries a compiled plan revision.
 * 2. Every non-copy lens freezes as `merchant_confirmed`, so that same 202
 *    answers `makeReady: false` — **Make does not start on submit**, and the
 *    AgentRun stays running/waiting rather than completing at compile time.
 *    Pure copy (`policy_exempt_copy`) is the only exemption and is covered by
 *    `v31-day0-free-creation-journey.spec.ts`.
 * 3. The commit strip is the merchant's command surface over three real Core
 *    commands — `tasks/:taskId/answer`, `tasks/:taskId/revise`,
 *    `tasks/:taskId/start` (`use-living-plan-controller.ts`). Only `start`
 *    admits Make.
 *
 * Every assertion below is unconditional: no `if (await x.isVisible())` around
 * the step under test, no `.or()` unions that pass on the wrong surface, no
 * step that can be skipped. Strict helpers are written inline rather than
 * borrowed, so a shared-fixture regression cannot soften this file.
 */

const CUSTOMIZED_INTENT =
  '明天下午还有两个空档，帮我发点奶油风美甲，不要太像广告。';
const REVISE_INSTRUCTION = '只做小红书，减到 4 页';

type SubmissionBinding = {
  taskId: string;
  workId: string;
};

/**
 * Bring the merchant to a submittable 小红书图文 draft.
 *
 * `image_text` submissions fail closed (400 INVALID_STATE) without a
 * `case_image` workspace source, so a real case photo is attached first — the
 * same contract the three-modal journey exercises.
 */
async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  await attachComposerSourceViaLibrary(page, {
    name: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();

  // 图文 pins 小红书 as its lens default (`composer-home` lensDefault), so the
  // destination is asserted rather than clicked: these chips are toggles, and a
  // click here would clear the platform the plan is about to be priced for.
  const destinationPanel = await openComposerCapsule(page, 'destination');
  await expect(
    page.getByTestId('composer-destination-option-xiaohongshu'),
    '图文 must arrive pre-bound to 小红书 before the plan is compiled'
  ).toHaveAttribute('aria-pressed', 'true');
  await closeComposerCapsule(page, destinationPanel);
}

/**
 * Submit the plan-shaping turn and return the ids the 202 minted.
 *
 * Asserts the whole submit contract inline: a bound server quote, then an
 * enabled send control (`composer-home` submitDisabled folds in the bound quote,
 * upload readiness, quota and the frozen phase — pressing a disabled send
 * produces no POST at all, so the response wait would burn its budget on a
 * request that was never going to exist), then the 202 itself — including
 * `makeReady: false`, which is the seam-level statement that Make was **not**
 * admitted.
 */
async function submitPlanShapingTurn(page: Page): Promise<SubmissionBinding> {
  const intent = page.getByTestId('composer-intent-input');
  await intent.fill(CUSTOMIZED_INTENT);
  await expect(intent).toHaveValue(CUSTOMIZED_INTENT);

  await expect(
    page
      .getByTestId('workbench-credit-quote')
      .or(page.getByTestId('composer-quote-line')),
    'submit must bind the server quote before creation'
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('composer-grounding-blocker')).toHaveCount(0);

  const submit = page.getByTestId('composer-submit');
  await expect(
    submit,
    'the composer must be ready to submit before the journey clicks send'
  ).toBeEnabled({ timeout: 60_000 });
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');

  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await submit.click();
  const submissionResponse = await settleComposerSubmission(
    page,
    submissionResponsePromise
  );
  const submissionText = await submissionResponse.text();
  const submission = JSON.parse(submissionText) as {
    data?: {
      makeReady?: boolean;
      runId?: string;
      task?: { id?: string };
      threadId?: string;
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(
    submissionResponse.status(),
    `composer submission must be accepted with 202; body=${submissionText}`
  ).toBe(202);
  const taskId = submission.data?.task?.id ?? '';
  const workId = submission.data?.work?.id ?? '';
  expect(
    taskId.length,
    `the 202 must carry a task id; body=${submissionText}`
  ).toBeGreaterThan(0);
  expect(
    workId.length,
    `the 202 must carry a work id; body=${submissionText}`
  ).toBeGreaterThan(0);
  expect(
    (submission.data?.threadId ?? '').length,
    'the 202 must bind the Agent Thread the Intent turn ran on'
  ).toBeGreaterThan(0);
  expect(
    (submission.data?.runId ?? '').length,
    'the 202 must bind the Agent Run the Intent turn ran on'
  ).toBeGreaterThan(0);
  // U9: 图文 freezes as merchant_confirmed, so the coordinator answers
  // makeReady:false and never calls startHarness on this request.
  expect(
    submission.data?.makeReady,
    'a merchant-confirmed plan must not admit Make on submit'
  ).toBe(false);

  return { taskId, workId };
}

/** The compiled plan (revision 1) as the merchant sees it, with Make idle. */
async function assertCompiledPlanWithoutMake(
  page: Page,
  binding: SubmissionBinding
) {
  const plan = page.getByTestId('agent-living-plan');
  await expect(
    plan,
    'the Intent turn must compile a plan revision'
  ).toBeVisible({ timeout: 120_000 });
  await expect(plan).toHaveAttribute('data-revision', '1');
  for (const section of [
    'goal',
    'deliverables',
    'expression',
    'facts_assets',
    'cost_duration',
  ] as const) {
    await expect(
      page.getByTestId(`agent-plan-section-${section}`),
      `the Living Plan document must carry its ${section} section`
    ).toBeVisible();
  }

  // Make is not running: no delivered work, and no 成品交付卡 for the submitted
  // Work. `data-delivered` is the Workstream's own statement about delivery.
  await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
    'data-delivered',
    'false'
  );
  await expect(
    page.locator(
      `[data-testid="composer-delivery-card"][data-work-id="${binding.workId}"]`
    ),
    'submit must not deliver a Work before the merchant starts the plan'
  ).toHaveCount(0);
  await expect(
    page,
    'submitting must not navigate away from the Composer conversation'
  ).not.toHaveURL(/\/dashboard\/results\//u);

  // Compact Plan / commit strip is the confirm surface: it must be present and
  // offer a start the merchant can actually press.
  const strip = page.getByTestId('agent-commit-strip');
  await expect(strip).toBeVisible();
  await expect(
    strip,
    'a ready plan must not disable its start (quote + rights + readiness)'
  ).toHaveAttribute('data-start-disabled', 'false');
  await expect(page.getByTestId('agent-commit-strip-start')).toBeEnabled();
}

/**
 * §21.4 question budget: the Intent phase admits at most one merchant question
 * (`maxMerchantQuestions: 1`, enforced by `session.question_budget`). Known
 * platform/lens/rights/quote fields are server-owned and must never be re-asked,
 * so a compiled plan must not leave a second question standing.
 *
 * This is a bound, not a branch: the count is read once and asserted.
 */
async function assertIntentQuestionBudget(page: Page) {
  const pendingQuestions = page.getByTestId('agent-pending-interrupt');
  expect(
    await pendingQuestions.count(),
    'the Intent phase may hold at most one merchant question at a time'
  ).toBeLessThanOrEqual(1);
}

/**
 * Accept a typed interrupt card whose copy matches `hasText`.
 * Same contract as the Artifact growth / rights recovery journeys: the
 * interrupt host is the production merchant surface after explicit start.
 */
async function acceptInterrupt(page: Page, hasText: RegExp) {
  const interrupt = page
    .getByTestId('agent-pending-interrupt')
    .filter({ hasText });
  await expect(interrupt).toBeVisible({ timeout: 180_000 });
  await expect(interrupt).toHaveAttribute(
    'data-interrupt-schema-version',
    'interrupt-payload/v1'
  );
  await interrupt.getByTestId('agent-interrupt-accept').click();
  await expect(interrupt).toHaveCount(0, { timeout: 120_000 });
}

test.describe('V31-10 Living Plan journey (§37.4-C)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('检索 → 一问 → Living Plan → 调整（前半段）', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);
    const binding = await submitPlanShapingTurn(page);
    await assertCompiledPlanWithoutMake(page, binding);
    await assertIntentQuestionBudget(page);

    const deliverables = page.getByTestId('agent-plan-section-deliverables');
    const revision1Deliverables = (await deliverables.innerText()).trim();
    expect(
      revision1Deliverables.length,
      'the compiled plan must state what it will produce'
    ).toBeGreaterThan(0);

    // 自然语言调整 → a NEW plan revision. The merchant's instruction reaches
    // Core through the real revise command, and the proof that it landed is the
    // plan itself (revision number + deliverable quantity), never a toast.
    const revisePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response
          .url()
          .includes(
            `/api/core/p1/composer/tasks/${encodeURIComponent(binding.taskId)}/revise`
          ),
      { timeout: 120_000 }
    );
    await page.getByTestId('agent-commit-strip-revise').click();
    // 返回修改 is only a real affordance if the box it focuses can be typed in
    // and sent: the plan command rides the same intent input
    // (`use-living-plan-controller.submitPlanCommand`).
    const intent = page.getByTestId('composer-intent-input');
    await expect(
      intent,
      '返回修改 must hand back an editable intent box for the plan command'
    ).toBeEnabled();
    await intent.fill(REVISE_INSTRUCTION);
    await expect(intent).toHaveValue(REVISE_INSTRUCTION);
    const reviseSubmit = page.getByTestId('composer-submit');
    await expect(
      reviseSubmit,
      'a waiting plan must let the merchant send the adjustment'
    ).toBeEnabled();
    await reviseSubmit.click();
    const reviseResponse = await revisePromise;
    expect(
      reviseResponse.status(),
      `plan revise must be accepted; body=${await reviseResponse.text()}`
    ).toBe(200);

    const plan = page.getByTestId('agent-living-plan');
    await expect(plan).toHaveAttribute('data-revision', '2', {
      timeout: 120_000,
    });
    await expect(
      deliverables,
      'the revision must carry the deliverable quantity the merchant asked for'
    ).toContainText('4 页');
    expect(
      (await deliverables.innerText()).trim(),
      'a revision that reads exactly like its predecessor changed nothing'
    ).not.toBe(revision1Deliverables);
    await expect(page.getByTestId('agent-plan-diff')).toBeVisible();
    await expect(page.getByTestId('agent-plan-diff')).toHaveAttribute(
      'data-to-revision',
      '2'
    );
    await expect(page.getByTestId('agent-plan-diff-adjustment')).toContainText(
      REVISE_INSTRUCTION
    );
    // The revised turn must not leave a question standing behind it.
    await assertIntentQuestionBudget(page);

    // Append-only history: the previous revision stays browsable and still
    // reads as it did — going back is a view change, never a rewrite.
    const revision1 = page.getByTestId('agent-living-plan-revision-1');
    await expect(revision1).toBeVisible();
    await revision1.click();
    await expect(plan).toHaveAttribute('data-revision', '1');
    expect(
      (await deliverables.innerText()).trim(),
      'the earlier revision must still read as it did before the adjustment'
    ).toBe(revision1Deliverables);
    const revision2 = page.getByTestId('agent-living-plan-revision-2');
    await revision2.click();
    await expect(plan).toHaveAttribute('data-revision', '2');
  });

  test('提交不启动 Make，显式开始才启动（commit strip start）', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);
    const binding = await submitPlanShapingTurn(page);
    await assertCompiledPlanWithoutMake(page, binding);

    // Explicit start is the only admission: it carries the exact plan revision
    // the merchant is looking at, and Core rejects anything else
    // (`completeExplicitStart` compares against the durable latest freeze).
    const startPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response
          .url()
          .includes(
            `/api/core/p1/composer/tasks/${encodeURIComponent(binding.taskId)}/start`
          ),
      { timeout: 120_000 }
    );
    await page.getByTestId('agent-commit-strip-start').click();
    const startResponse = await startPromise;
    const startText = await startResponse.text();
    expect(
      JSON.parse(startResponse.request().postData() ?? '{}'),
      'start must name the plan revision it is confirming'
    ).toEqual({ planRevision: 1 });
    expect(
      startResponse.status(),
      `explicit start must be accepted with 202; body=${startText}`
    ).toBe(202);
    expect(
      (JSON.parse(startText) as { data?: { makeReady?: boolean } }).data
        ?.makeReady,
      'explicit start is what admits Make'
    ).toBe(true);

    // Living Plan commit strip already recorded the paid confirmation decision
    // before /start (decide → start). Core must not re-suspend on that same
    // execution_confirmation (V31-56 delivery projection). The note path still
    // asks its one 图文方向 merchant question before spend — accept it on the
    // typed interrupt surface (same order as Artifact growth / rights journeys).
    await chooseImageTextDirection(page);

    // Execution really begins only now. The delivered Work is the one signal no
    // pre-start state can fake: it exists only because Make ran, and it carries
    // the workId the submission minted (so the prepared attempt's events must
    // also reach this conversation).
    await expect(
      page.locator(
        `[data-testid="composer-delivery-card"][data-work-id="${binding.workId}"]`
      ),
      'the started plan must deliver the Work the submission minted'
    ).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'true'
    );
  });
});
