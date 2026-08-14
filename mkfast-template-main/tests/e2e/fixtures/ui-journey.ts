import {
  expect,
  type Download,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

import { directionSettlementProof } from './direction-settlement';

export type JourneyModality = 'copy' | 'image_text' | 'video';

/**
 * Click the 成品交付卡 after clearing P1 sticky Composer overlay.
 * Product ships scroll-margin + clearance spacer; e2e still centers the card
 * so Playwright does not click through the stuck prompt bar.
 */
export async function clickComposerDeliveryCard(
  deliveryCard: Locator
): Promise<void> {
  await deliveryCard.evaluate((node) => {
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  await deliveryCard.click({ timeout: 15_000 });
}

export type JourneyContract = {
  deliveryTarget: 'wechat_moments' | 'xiaohongshu' | 'douyin' | 'video_account';
  modality: JourneyModality;
  workspace: 'copy' | 'image' | 'video';
  /** isTrusted Day-0 activations including the lens-capsule open click (L3-2). */
  expectedActivations: 2 | 3 | 4 | 5;
  packageFormat: 'text' | 'zip';
  packageButtonName: RegExp;
  packageFileName: RegExp;
  resultSurfaceTestId:
    | 'copy-image-text-worksurface'
    | 'image-worksurface'
    | 'video-worksurface';
};

export const JOURNEY_CONTRACTS: readonly JourneyContract[] = [
  {
    deliveryTarget: 'wechat_moments',
    modality: 'copy',
    workspace: 'copy',
    // L3-2: open lens capsule + select lens + submit.
    expectedActivations: 3,
    packageFormat: 'text',
    packageButtonName: /朋友圈分段包/u,
    // Production export may use zh "朋友圈分段" or en "moments-caption".
    packageFileName: /(?:朋友圈分段|moments-caption)\.txt$/u,
    resultSurfaceTestId: 'copy-image-text-worksurface',
  },
  {
    deliveryTarget: 'xiaohongshu',
    modality: 'image_text',
    workspace: 'image',
    // open lens capsule + select lens + submit + 图文方向 + P1-05 execution_confirm.
    // Note path reserves copy 1 + image notePageBound → must hold before generation.
    expectedActivations: 5,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（小红书）/u,
    // Fixture export may use content hash filename; zh/en product names also ok.
    packageFileName: /(?:小红书|xhs|xiaohongshu|[a-f0-9]{32,}).*\.zip$/iu,
    resultSurfaceTestId: 'image-worksurface',
  },
  {
    deliveryTarget: 'douyin',
    modality: 'video',
    workspace: 'video',
    // open lens capsule + select lens + submit + Brief confirm + D-164③ 确认执行.
    expectedActivations: 5,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（抖音）/u,
    packageFileName: /(?:抖音|douyin|[a-f0-9]{32,}).*\.zip$/iu,
    resultSurfaceTestId: 'video-worksurface',
  },
  {
    deliveryTarget: 'video_account',
    modality: 'video',
    workspace: 'video',
    // open lens capsule + select lens + submit + Brief confirm + D-164③ 确认执行.
    expectedActivations: 5,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（视频号）/u,
    packageFileName:
      /(?:视频号|video-account|video_account|[a-f0-9]{32,}).*\.zip$/iu,
    resultSurfaceTestId: 'video-worksurface',
  },
] as const;

/** Merchant-facing lens label echoed on the capsule face after selection. */
export const COMPOSER_LENS_FACE_LABEL: Record<JourneyModality, string> = {
  copy: '文案',
  image_text: '图文',
  video: '视频',
};

type ComposerCapsuleKind =
  | 'lens'
  | 'recipe'
  | 'destination'
  | 'attach'
  | 'mention'
  | 'credit';

function composerCapsulePanelTestId(kind: ComposerCapsuleKind): string {
  // Destination reuses the pre-capsule chips host id as the popover content.
  return kind === 'destination'
    ? 'composer-destination-chips'
    : `composer-capsule-${kind}-panel`;
}

const COMPOSER_CAPSULE_KINDS: readonly ComposerCapsuleKind[] = [
  'lens',
  'recipe',
  'destination',
  'attach',
  'mention',
  'credit',
] as const;

/**
 * Open a Composer bottom-capsule popover and wait for its panel.
 * Idempotent when the panel is already open. Closes any other capsule panel
 * first so Escape/open sequences stay stable under the single-popover UI.
 */
/** Expand Idle 「更多」so secondary capsules (lens/recipe/attach/@) mount. */
export async function ensureComposerSecondaryCapsules(
  page: Page
): Promise<void> {
  const more = page.getByTestId('composer-capsule-more');
  // Settle on the bar before judging it. Straight after a navigation the row
  // has not rendered yet, and 「no 更多设置 button on screen」 then reads as
  // 「already expanded」 — after which the caller waits out its whole timeout
  // for a capsule that is still folded away.
  await expect(page.getByTestId('composer-submit')).toBeVisible({
    timeout: 60_000,
  });
  if (!(await more.isVisible().catch(() => false))) return;
  if ((await more.getAttribute('aria-expanded')) === 'true') return;
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
}

export async function openComposerCapsule(
  page: Page,
  kind: ComposerCapsuleKind
): Promise<Locator> {
  const panel = page.getByTestId(composerCapsulePanelTestId(kind));
  if (await panel.isVisible().catch(() => false)) return panel;
  for (const other of COMPOSER_CAPSULE_KINDS) {
    if (other === kind) continue;
    const otherPanel = page.getByTestId(composerCapsulePanelTestId(other));
    if (await otherPanel.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(otherPanel).toBeHidden();
    }
  }
  // Idle-compact hides 素材/输出类型/配方/@ behind 「更多」until expanded.
  if (
    kind === 'attach' ||
    kind === 'lens' ||
    kind === 'recipe' ||
    kind === 'mention'
  ) {
    await ensureComposerSecondaryCapsules(page);
  }
  await page.getByTestId(`composer-capsule-${kind}`).click();
  await expect(panel).toBeVisible();
  return panel;
}

/** Close an open capsule panel via Escape and wait until it is gone. */
export async function closeComposerCapsule(
  page: Page,
  panel: Locator
): Promise<void> {
  if (!(await panel.isVisible().catch(() => false))) return;
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

/**
 * Select a creation lens through the capsule popover, assert radio state, then
 * close the panel and assert the capsule face echoes the lens label.
 */
export async function selectComposerLens(
  page: Page,
  modality: JourneyModality
): Promise<void> {
  const trigger = page.getByTestId('composer-capsule-lens');
  const moreFace = page.getByTestId('composer-capsule-more');
  const panel = await openComposerCapsule(page, 'lens');
  const lens = page.getByTestId(`composer-lens-option-${modality}`);
  await lens.click();
  // Picking the required lens can fold the idle-compact capsule row back
  // behind 「更多设置」 (D-C2: the capsule was only surfaced by
  // required-unmet), unmounting the radio and its trigger in the same
  // render. The selection then lives on the folded face's summary instead —
  // assert it on whichever face survived rather than the radio itself.
  const label = COMPOSER_LENS_FACE_LABEL[modality];
  await expect(async () => {
    if (await trigger.isVisible().catch(() => false)) {
      expect((await trigger.textContent()) ?? '').toContain(label);
      expect(await trigger.getAttribute('data-active')).toBe('true');
      return;
    }
    expect((await moreFace.textContent().catch(() => '')) ?? '').toContain(
      label
    );
    expect(await moreFace.getAttribute('data-active')).toBe('true');
  }).toPass({ timeout: 10_000 });
  if (await panel.isVisible().catch(() => false)) {
    await expect(lens).toBeChecked();
    await expect(lens).toHaveAttribute('data-state', 'checked');
    await closeComposerCapsule(page, panel);
  }
}

/**
 * Open the recipe capsule, click a recipe card, leave the panel open so apply
 * tip / patch preview assertions can run against the same popover.
 */
export async function openComposerRecipeCard(
  page: Page,
  cardTestId: string
): Promise<Locator> {
  const panel = await openComposerCapsule(page, 'recipe');
  await page.getByTestId(cardTestId).click();
  return panel;
}

export async function assertThreeModalDiscovery(page: Page) {
  await expect(page.getByTestId('composer-home')).toBeVisible();
  // L3-2: lens lives in a bottom capsule (Idle: behind 「更多」); cold required
  // state is visible on the trigger; required semantics stay on the radiogroup.
  await ensureComposerSecondaryCapsules(page);
  const lensCapsule = page.getByTestId('composer-capsule-lens');
  await expect(lensCapsule).toBeVisible();
  await expect(lensCapsule).not.toHaveAttribute('aria-required');

  const lensPanel = await openComposerCapsule(page, 'lens');
  await expect(page.getByTestId('composer-lens-radiogroup')).toHaveAttribute(
    'aria-required',
    'true'
  );
  for (const modality of ['copy', 'image_text', 'video'] as const) {
    // Native <input type="radio"> exposes checked via the property / data-state,
    // not necessarily an aria-checked attribute.
    await expect(
      page.getByTestId(`composer-lens-option-${modality}`)
    ).not.toBeChecked();
    await expect(
      page.getByTestId(`composer-lens-option-${modality}`)
    ).toHaveAttribute('data-state', 'unchecked');
  }
  await closeComposerCapsule(page, lensPanel);

  // D-164②: the cold catalog is a pill row inside the recipe capsule, not a
  // card grid below the quote line. Six cold entries, five pills — 旧内容换平台
  // is a reuse action rather than a marketing task and lives in the destination
  // capsule reuse chips, so it is not offered here. Three groups: 热点借势 and
  // 品牌与个人 IP have no recipe behind them and are absent rather than greyed out.
  const recipePanel = await openComposerCapsule(page, 'recipe');
  await expect(page.getByTestId('composer-recipe-pill-row')).toHaveAttribute(
    'data-group-count',
    '3'
  );
  for (const modality of ['copy', 'image_text', 'video'] as const) {
    await expect(
      page
        .locator(
          `[data-testid="composer-recipe-pill-row"] [data-card-lens="${modality}"]`
        )
        .first(),
      `cold Composer must expose a discoverable ${modality} recipe`
    ).toBeVisible();
  }
  await closeComposerCapsule(page, recipePanel);
}

/**
 * 图文's mid-run style choice (activation #3 of 4).
 *
 * The note plan compiles two directions and the harness marks that card
 * `unattended: 'hold'` (`apps/core/src/p1/harness/workflow-core.ts`
 * `noteStyleQuestion`) — it carries no default, so nothing releases it but a
 * merchant choice, and the run stays suspended until one lands. Answering it is
 * part of the 图文 mainline, not a test convenience.
 *
 * After the direction lands, P1-05 paid-media execution_confirm is activation
 * #4 (lens + submit + direction + 确认执行). This helper only covers the style
 * card; callers that finish generation must also accept the in-stream confirm
 * (see submitComposerJourney paid-media block).
 *
 * The old page-plan confirmation is not a merchant decision and must never
 * block this path. The style choice submits in its option click.
 *
 * Why the question is required rather than optional (V31-29)
 * ---------------------------------------------------------
 * This helper used to accept "the card never rendered" as an ending, on the
 * theory that a frozen route can pre-answer the question. Traced through Core,
 * that is not what pre-answers it. `workflow-core.ts` `noteStyleQuestion` is
 * skipped exactly when `activeRequest.decisionReferences` already carries a
 * `note_style` entry, and only two things put one there: a submission derived
 * from an existing note (`submission-coordinator.ts`, guarded on
 * `sourceNoteStyleId`) and a resumption replaying a merchant decision
 * (`task-admission.ts` `snapshotWorkflowInput`, from `snapshot.semanticDecision`).
 * Both are merchant-decision-derived; `MODEL_EXECUTION_MODE` has no say. Every
 * current caller reaches this helper straight after a fresh Composer submission
 * that carries neither, so the question is always asked, and `unattended:
 * 'hold'` (no default, 48h hold) means nothing but a merchant answer releases
 * it. The resume stage line therefore cannot appear before the click.
 *
 * So the card must become visible and must be clicked. Accepting the resume
 * line as an alternative made "the product skipped its one question" and "the
 * merchant answered it" the same result, which is precisely what §37.4 asks a
 * journey to tell apart. A caller that legitimately resumes a pre-answered run
 * needs its own explicit expectation, not a disjunction here.
 */
export async function chooseImageTextDirection(page: Page) {
  const planCard = page.getByTestId('ask-merchant-group-card').filter({
    hasText: '我会先整理整篇页级计划',
  });
  await expect(
    planCard,
    'the retired page-plan confirmation must not add a merchant activation'
  ).toHaveCount(0);

  // Ask-merchant group is the production renderer; legacy composer-question-card
  // remains as fallback when the interaction projection lags.
  const productionDirectionCard = page
    .getByTestId('ask-merchant-group-card')
    .filter({ hasText: /两种图文方向/u });
  const legacyDirectionCard = page
    .getByTestId('composer-question-card')
    .filter({ hasText: /两种图文方向/u });
  const directionCard = productionDirectionCard.or(legacyDirectionCard);
  const resumedLine = page
    .getByTestId('composer-stage-line')
    .filter({ hasText: '已按你选的方向继续准备整套图文' });
  await expect(
    directionCard.first(),
    'the run must ask its one 图文方向 question and wait for the merchant'
  ).toBeVisible({ timeout: 300_000 });

  // Prefer scrolling the interrupt host above the Composer before click.
  const interruptHost = page.getByTestId('composer-question-turn');
  if ((await interruptHost.count()) > 0) {
    await interruptHost
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
  }
  const productionRenderer = await productionDirectionCard
    .first()
    .isVisible()
    .catch(() => false);
  const activeDirectionCard = (
    productionRenderer ? productionDirectionCard : legacyDirectionCard
  ).first();
  await activeDirectionCard.scrollIntoViewIfNeeded().catch(() => undefined);
  const direction = activeDirectionCard
    .getByRole('button')
    .filter({ hasNotText: /暂未确定|继续|这次先跳过/u })
    .first();
  // A failed run is not a downstream state (V31-29). It used to be accepted as
  // one, which let a generation that produced nothing pass two required jobs.
  // Counted before the click because the report card is a conversation turn: a
  // journey that deliberately failed an earlier run in the same conversation
  // still has that card on screen, and only a *new* one belongs to this answer.
  const terminalFailure = page
    .getByTestId('composer-report-card')
    .or(
      page.locator(
        '[data-testid="composer-terminal-outcome"][data-outcome="failed"]'
      )
    );
  const failuresBeforeAnswer = await terminalFailure.count();
  // A fixture-speed run can race from the answered question straight to a
  // delivered candidate before the resumed stage line is ever painted; a NEW
  // delivery card is equally hard proof that the answer continued the run.
  // Counted before the click for the same reason as terminalFailure above.
  const deliveryCards = page.getByTestId('composer-delivery-card');
  const deliveriesBeforeAnswer = await deliveryCards.count();
  const settlementProof = directionSettlementProof(productionRenderer);
  const settlementSubject =
    settlementProof.target === 'direction' ? direction : activeDirectionCard;
  // Read the settlement state on both sides of the click. Without the "before",
  // an already-answered card would satisfy the "after" on arrival and the
  // merchant answer would prove nothing. Both reads are on the card in hand,
  // so a second round in the same conversation cannot confuse them the way a
  // transcript-wide locator would.
  await expect(
    settlementSubject,
    'the 图文方向 question must still be open when the merchant answers it'
  ).not.toHaveAttribute(settlementProof.attribute, settlementProof.value);
  // No fallback on a failed click: the question is held for the merchant, so
  // an unclickable option is the journey's own failure, not a lost race.
  await expect(direction).toBeEnabled();
  await direction.click({ timeout: 15_000 });
  await expect(settlementSubject).toHaveAttribute(
    settlementProof.attribute,
    settlementProof.value
  );
  const executionConfirmation = page.getByTestId(
    'execution-confirmation-interaction-card'
  );
  // Race the two endings instead of waiting out the whole budget and then
  // looking for a failure: a failed run has to be reported when it fails. Wait
  // first, inspect after, and the report is 60s late — and lost entirely when
  // the caller's own test timeout is shorter than that wait, which is how this
  // helper first reported a failed run as "nothing appeared" (measured).
  const outcome = await Promise.race([
    resumedLine
      .or(executionConfirmation)
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'continued' as const)
      .catch(() => null),
    expect(deliveryCards)
      .not.toHaveCount(deliveriesBeforeAnswer, { timeout: 60_000 })
      .then(() => 'continued' as const)
      .catch(() => null),
    expect(terminalFailure)
      .not.toHaveCount(failuresBeforeAnswer, { timeout: 60_000 })
      .then(() => 'failed' as const)
      .catch(() => null),
  ]);
  if (outcome === 'failed') {
    const report = await terminalFailure
      .last()
      .innerText({ timeout: 2_000 })
      .catch(() => '');
    throw new Error(
      'the answered direction reported a terminal failure instead of ' +
        `continuing the run:\n${report}`
    );
  }
  if (outcome === null) {
    throw new Error(
      'the answered direction reached neither a resumed run nor the execution ' +
        'confirmation within 60s, and reported no failure either'
    );
  }
}

/**
 * 确认本次创作 — a run that quotes a restricted source (customer case, before /
 * after, review) opens the Brief seal before anything is built, and the
 * submission POST fires on that confirmation rather than on 发送. Racing the
 * button against the response keeps this honest for runs that need no seal:
 * waiting for the button unconditionally would hang those, and waiting only
 * for the POST hangs the sealed ones.
 */
export async function settleComposerSubmission(
  page: Page,
  responsePromise: ReturnType<Page['waitForResponse']>
): Promise<Response> {
  const briefConfirm = page.getByRole('button', { name: '确认并开始' });
  const next = await Promise.race([
    briefConfirm
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const)
      .catch(() => 'submission' as const),
    responsePromise.then(() => 'submission' as const),
  ]);
  if (next === 'brief') {
    await expect(
      page.getByRole('heading', { name: '确认本次创作' })
    ).toBeVisible();
    await expect(briefConfirm).toBeEnabled();
    await briefConfirm.click();
  }
  return responsePromise;
}

export async function submitComposerJourney(
  page: Page,
  contract: JourneyContract,
  intent: string,
  options: {
    /**
     * Called once the 成品预览卡 is on screen and before it is clicked. Under
     * ADR-0014 submitting no longer navigates, so reaching Result Center costs
     * one more click than it used to — but that click is a navigation, not an
     * activation (same rule uiux-day0-contract states for the video path), so
     * a caller measuring a C6 click budget stops its counter here.
     */
    onDeliveryCardVisible?: () => void | Promise<void>;
    /** Called after the 202 response has passed all required-id checks. */
    onSubmissionAccepted?: (submission: {
      taskId: string;
      threadId: string;
      workId: string;
    }) => void | Promise<void>;
    /**
     * Called once the submission is accepted and the merchant is still in the
     * conversation, before the 成品预览卡 is awaited. This is where an
     * interruption is a real interruption, so the M-04 hard gate reloads here
     * to prove the run survives it (fixtures/ui-journey `assertJourneyRestored`
     * covers the other end, after delivery).
     */
    onRunStreaming?: () => void | Promise<void>;
    /**
     * Keep the delivered card in Composer so a test can exercise secondary
     * actions that live on that card. The default remains the canonical click
     * through to Result Center.
     */
    openResult?: boolean;
    /** Preserve a structured journey's existing Composer intent verbatim. */
    preserveIntent?: boolean;
  } = {}
) {
  await selectComposerLens(page, contract.modality);

  // Day-0 intent may omit a 美业 service category. D-043 keeps that path moving
  // in explicit generic mode; later semantic gaps that are required for the
  // requested result may still surface one question and resume on its answer.
  const intentInput = page.getByTestId('composer-intent-input');
  await expect(intentInput).toBeVisible({ timeout: 60_000 });
  if (options.preserveIntent) {
    await expect(intentInput).toHaveValue(intent);
  } else {
    await intentInput.fill(intent);
    await expect(intentInput).toHaveValue(intent);
  }
  await expect(
    page.getByTestId('composer-quote-line'),
    'submit must bind the server quote before creation'
  ).toBeVisible({ timeout: 60_000 });

  // OI-76 determinism. The send control is a HeroUI `PromptInput.Send` taking
  // `isDisabled`, and a click on a disabled one is swallowed silently — so a
  // click that lands one tick early produces no POST at all and the wait below
  // burns its whole budget on a request that was never going to exist (T46 saw
  // exactly that on main, and its mirror — a quote line that never appeared —
  // on fe2). `submitDisabled` in composer-home is the single condition under
  // which the click can create anything: it folds in the bound quote, upload
  // readiness (图文/视频 attach a source first), quota and the frozen phase.
  // Assert it here so a missing precondition is named at its own step instead
  // of surfacing as a submission timeout.
  const submit = page.getByTestId('composer-submit');
  await expect(
    submit,
    'the composer must be ready to submit before the journey clicks send'
  ).toBeEnabled({ timeout: 60_000 });
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');

  // T08 new seam. The client no longer emits the old two-command dance
  // (`operations.create_creative_work` then `operations.submit_creative_work`
  // on `/api/core/p1/commands`) — `composer/z1-cutover-retirement.static.test.ts`
  // asserts those actions are never emitted again — so waiting for them could
  // only ever time out. One POST now carries the whole submission.
  // M-04-RETIRED-ACTION-ALLOWED: naming the retired pair here is the record of
  // why the old wait was deleted, not a listener (src/lib/e2e-hard-gate-contract).
  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 60_000 }
  );
  await submit.click();

  if (contract.modality === 'video') {
    const brief = page.getByTestId('composer-brief-surface');
    await expect(brief).toBeVisible({ timeout: 30_000 });
    await expect(
      brief.getByTestId('composer-brief-trigger-any_video')
    ).toBeVisible();
    await expect(
      brief.getByTestId('composer-brief-video-confirm-checkbox'),
      'C6 permits one Brief confirmation activation, not a checkbox plus a confirm button'
    ).toHaveCount(0);
    const confirm = brief.getByTestId('composer-brief-confirm');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(
      page.getByTestId('execution-confirm-accept'),
      'the completed Brief confirmation must not stack another activation'
    ).toHaveCount(0);
  }

  // Customer-case / restricted-source runs open 「确认本次创作」 after 发送 and
  // only then POST /composer/submissions. Video Brief already confirmed above;
  // copy and unsealed image_text resolve on the POST alone.
  const submissionResponse = await settleComposerSubmission(
    page,
    submissionResponsePromise,
  );
  const submissionBody = await submissionResponse.text();
  // 202 is the honesty gate, and a stronger one than the old `job.status`:
  // the submission is fully built (task/work/package/snapshot/reservation) —
  // not merely a Job row. Since V31-56 a paid run stays `reserved` after the
  // 202; only the Living Plan strip's 开始制作 (startPrepared) starts the
  // harness, which the image_text branch below performs explicitly.
  expect(
    submissionResponse.status(),
    `composer submission must be accepted with 202; body=${submissionBody}`
  ).toBe(202);
  const submission = JSON.parse(submissionBody) as {
    data?: {
      contentPackage?: { id?: string };
      snapshot?: { id?: string };
      task?: { id?: string };
      threadId?: string;
      usageReservation?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  // The one response carries every id the old pair of responses used to split
  // between them; a blank in any of them is a half-built submission.
  for (const [field, value] of [
    ['task', submission.data?.task?.id],
    ['work', submission.data?.work?.id],
    ['contentPackage', submission.data?.contentPackage?.id],
    ['snapshot', submission.data?.snapshot?.id],
    ['thread', submission.data?.threadId],
    ['usageReservation', submission.data?.usageReservation?.id],
  ] as const) {
    expect(
      value,
      `the 202 must carry a real ${field} id; body=${submissionBody}`
    ).toBeTruthy();
  }
  const submittedWorkId = submission.data!.work!.id!;
  await options.onSubmissionAccepted?.({
    taskId: submission.data!.task!.id!,
    threadId: submission.data!.threadId!,
    workId: submittedWorkId,
  });

  // ADR-0014「提交后不跳转」. Submitting keeps the merchant in the conversation;
  // the run finishes as a 成品预览卡 and clicking that card is what opens the
  // Result Center. Assert all three: we did NOT navigate, the card appeared,
  // and the id it carries is the one the submission produced.
  await expect(
    page,
    'submitting must not navigate away from the Composer conversation'
  ).not.toHaveURL(/\/dashboard\/results\//u);

  if (contract.modality !== 'copy') {
    // V31-56 explicit start: submitting a paid run (image_text and video
    // alike) leaves the harness `reserved`. The Living Plan strip is the
    // billing consent surface (reserved credits + refund rule) and 开始制作
    // is the only `startPrepared` entry — it records the immutable
    // `living-plan-commit` decision and POSTs /composer/tasks/:id/start. The
    // pre-confirmed admission means no fresh in-stream execution_confirm card
    // on the happy path (D-164③'s quote-before-Make consent now lives on the
    // strip; a fresh card only comes back as a successor after drift,
    // §37.4-E). The 图文方向 question is an in-execution interrupt (V31-63),
    // so it cannot appear before this click; pure copy stays exempt (D-043).
    const startAction = page.getByTestId('agent-commit-strip-start');
    await expect(startAction).toBeEnabled({ timeout: 120_000 });
    const startResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(
          new URL(response.url()).pathname
        ),
      { timeout: 120_000 }
    );
    await startAction.click();
    expect(
      (await startResponse).ok(),
      'Living Plan 开始制作 must start the prepared paid run'
    ).toBeTruthy();
    if (contract.modality === 'image_text') {
      await chooseImageTextDirection(page);
    }
  }

  await options.onRunStreaming?.();

  const deliveryCard = page.locator(
    `[data-testid="composer-delivery-card"][data-work-id="${submittedWorkId}"]`
  );
  await expect(deliveryCard).toBeVisible({ timeout: 120_000 });
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);

  await options.onDeliveryCardVisible?.();
  if (options.openResult === false) return submittedWorkId;
  await clickComposerDeliveryCard(deliveryCard);
  await expect(page).toHaveURL(/\/dashboard\/results\/[^/?#]+(?:\?|$)/u, {
    timeout: 60_000,
  });
  const match = new URL(page.url()).pathname.match(
    /^\/dashboard\/results\/([^/]+)$/u
  );
  expect(
    match?.[1] ? decodeURIComponent(match[1]) : undefined,
    'result route must carry the exact workId the 202 returned'
  ).toBe(submittedWorkId);
  return submittedWorkId;
}

/**
 * Wait for Result Center to reach a usable merchant-ready state.
 *
 * Honesty contract (E-02):
 * - Prefer observing the user-visible generating state (and for copy/image_text, a real
 *   first token on `copy-stream-slot`) before `ready|delivered`.
 * - If the Job already completed by the time the shell mounts, record an
 *   auditable fast-path through ProductStatus — do not pretend
 *   we saw streaming when we did not.
 */
export async function waitForResultJourney(
  page: Page,
  contract: JourneyContract,
  workId: string
) {
  const shell = page.getByTestId('result-center-shell');
  await expect(page).toHaveURL(
    new RegExp(
      `/dashboard/results/${encodeURIComponent(workId)}(?:\\?|$)`,
      'u'
    ),
    {
      timeout: 60_000,
    }
  );
  await expect(shell).toBeVisible({
    timeout: 60_000,
  });
  const visibleResultText = await shell.innerText();
  expect(visibleResultText).not.toContain(workId);
  expect(visibleResultText).not.toMatch(
    /\b(?:running|ready|delivered|candidate_ready|needs_input|automatic_verified|assisted|unavailable)\b/iu
  );
  expect(visibleResultText).not.toMatch(
    /(?:provider|workId=|workspaceId=|assetId=|catalogModelId|seedance-2)/iu
  );
  const merchantStatus = page.getByTestId('result-merchant-status');
  await expect(
    merchantStatus,
    'Result must explain progress with merchant ProductStatus copy'
  ).toContainText(/生成中|可发布|已发布就绪/u, {
    timeout: 30_000,
  });

  const initialStatus = await merchantStatus.textContent();
  const observedRunning = initialStatus?.includes('生成中') ?? false;

  // copy.generate is the only job that feeds ADR-0007 copy token stream.
  // image_text submits image.generate — do not demand copy-stream slots.
  if (contract.modality === 'copy') {
    if (observedRunning) {
      // Intermediate path: require a real first token while still running.
      await expect(
        page
          .locator('[data-testid="copy-stream-slot"][data-has-token="true"]')
          .first(),
        'copy running path must render a real first token before ready'
      ).toBeVisible({ timeout: 120_000 });
    } else {
      // Fast-path: job already ready/delivered when shell mounted.
      await expect(
        page
          .getByTestId(contract.resultSurfaceTestId)
          .or(page.locator('[data-testid="copy-stream-slot"]').first()),
        `auditable fast-path: initial merchant status was "${initialStatus ?? ''}" without observed generating/token intermediate`
      ).toBeVisible({ timeout: 60_000 });
    }
  } else if (contract.modality === 'image_text') {
    if (observedRunning) {
      // V31-29: `.or(merchantStatus)` used to stand here. merchantStatus is
      // already asserted visible above, so the disjunction was satisfied before
      // it was evaluated and the worksurface was never required at all.
      await expect(
        page.getByTestId('image-worksurface'),
        'image_text generating path must keep Result visible until ready'
      ).toBeVisible({ timeout: 120_000 });
    } else {
      await expect(
        page.getByTestId(contract.resultSurfaceTestId),
        `auditable image_text fast-path: initial merchant status was "${initialStatus ?? ''}"`
      ).toBeVisible({ timeout: 60_000 });
    }
  }

  await expect(merchantStatus).toContainText(/可发布|已发布就绪/u, {
    timeout: 180_000,
  });
  await expect(page.getByTestId(contract.resultSurfaceTestId)).toBeVisible();
}

function mutationResponse(page: Page, actionPattern: RegExp) {
  return page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as { action?: unknown };
        return (
          typeof body.action === 'string' && actionPattern.test(body.action)
        );
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
}

export async function adjustResult(
  page: Page,
  modality: JourneyModality
): Promise<{ instruction: string; workId?: string }> {
  const instruction = `e2e-${modality}-adjust-${crypto.randomUUID()}`;
  if (modality === 'video') {
    const worksurface = page.getByTestId('video-worksurface');
    await expect(worksurface).toBeVisible();
    for (const testId of [
      'video-cover-panel',
      'video-subtitle-panel',
      'video-shot-regenerate',
      'video-full-recompose',
      'video-pro-studio-refine',
    ]) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
    await expect(page.getByText('继续调整', { exact: true })).toHaveCount(0);
    return { instruction };
  }

  const input = page.getByTestId('result-adjust-input').first();
  if (modality === 'copy' && (await input.isDisabled())) {
    // Composer Coordinator results are ContentPackage-backed and deliberately
    // have no legacy CreativeJob. Their quoted regeneration box therefore
    // stays unavailable, while the canonical package edit remains writable.
    const title = page.getByTestId('copy-field-title');
    const nextTitle = `${await title.inputValue()} · ${instruction}`;
    await title.fill(nextTitle);
    const editPromise = mutationResponse(
      page,
      /^edit_content_package_version$/u
    );
    await page.getByTestId('copy-save-hand-edit').click();
    const editResponse = await editPromise;
    expect(editResponse.ok(), await editResponse.text()).toBeTruthy();
    await expect(title).toHaveValue(nextTitle);
    await page.reload();
    await expect(page.getByTestId('copy-image-text-worksurface')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('copy-field-title')).toHaveValue(nextTitle);
    return { instruction };
  }
  await expect(
    input,
    'quoted adjustment requires a source CreativeJob'
  ).toBeEnabled({ timeout: 30_000 });
  await input.fill(instruction);
  const preparePromise = mutationResponse(
    page,
    /result_adjust_prepare|revise|adjust|regenerate|create_revision/u
  );
  await page.getByTestId('result-adjust-submit').first().click();
  const prepareResponse = await preparePromise;
  expect(prepareResponse.ok(), await prepareResponse.text()).toBeTruthy();

  // Quoted adjust path shows confirmation (quote + confirm) before submit.
  // D-164⑥ 决定 A: 就地纠偏 goes through the same execution confirm card as
  // first-time generation, so the button carries that card's label now.
  const confirm = page.getByTestId('execution-confirm-accept');
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  const previousResultUrl = page.url();
  const confirmPromise = mutationResponse(
    page,
    /result_adjust|revise|adjust|regenerate|create_revision/u
  );
  await confirm.click();
  const confirmResponse = await confirmPromise;
  const confirmBody = await confirmResponse.text();
  const confirmRequest = confirmResponse.request().postDataJSON();
  expect(
    confirmResponse.ok(),
    `${confirmBody}; request=${JSON.stringify(confirmRequest)}`
  ).toBeTruthy();
  await expect
    .poll(() => page.url(), {
      message: 'confirmed adjustment must leave the quoted Result route',
      timeout: 30_000,
    })
    .not.toBe(previousResultUrl);
  await expect(page.getByTestId('image-adjust-confirmation')).toHaveCount(0);

  await expect(page.getByTestId('result-adjust-input').first()).toHaveValue(
    '',
    {
      timeout: 30_000,
    }
  );
  const adjustedWorkId = new URL(page.url()).pathname.match(
    /^\/dashboard\/results\/([^/]+)$/u
  )?.[1];
  expect(
    adjustedWorkId,
    'confirmed adjustment must open its derived Work'
  ).toBeTruthy();
  return { instruction, workId: decodeURIComponent(adjustedWorkId!) };
}

/** The shell primary action's adopt label, per workspace (`result-shell-model`). */
const ADOPT_LABEL: Record<JourneyModality, string> = {
  copy: '采用此版本',
  image_text: '采用这组',
  video: '使用此成片',
};

function adoptLocator(page: Page, modality: JourneyModality): Locator {
  // 文案 and 图文 both adopt through the Result shell's canonical primary
  // action (`result-shell-model` `adopt_candidate`), which is the same control
  // the required assembly gate clicks. Each worksurface also carries its own
  // adopt control — `copy-adopt-action`, `image-role-primary` — but those render
  // only while the local lifecycle is still `candidate`, so waiting for one is
  // waiting for a state a delivered run has usually already left; that stale
  // locator is why the shared three-modal journey failed on its first case
  // (T37 / M-04). 图文's worksurface control is also the *visual set* adoption,
  // a different operation from taking the delivered version.
  if (modality === 'video') return page.getByTestId('video-adopt-action');
  return page.getByTestId('result-primary-action');
}

export async function adoptResult(page: Page, contract: JourneyContract) {
  const adopt = adoptLocator(page, contract.modality);
  await expect(adopt).toBeVisible();
  if (contract.modality !== 'video') {
    // The shell's primary action changes label with the lifecycle; adopting
    // means clicking it while it still offers 采用, never after it becomes 交付.
    await expect(adopt).toHaveText(ADOPT_LABEL[contract.modality]);
  }
  const responsePromise = mutationResponse(page, /adopt/u);
  await adopt.click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();

  if (contract.modality !== 'video') {
    await expect(page.getByTestId('result-shell-actions')).not.toHaveAttribute(
      'aria-busy',
      'true',
      { timeout: 60_000 }
    );
    // Adoption is what turns the one primary action from 采用 into 交付; 图文
    // additionally marks every adopted page on its own worksurface.
    await expect(page.getByTestId('result-primary-action')).toHaveText('交付', {
      timeout: 60_000,
    });
    if (contract.modality === 'image_text') {
      await expect(
        page.getByTestId('image-adopted-badge').first()
      ).toBeVisible();
    }
  } else {
    await expect(page.getByTestId('video-result-status')).toContainText(
      '已采用，待交付'
    );
  }
}

export async function openDeliveryPanel(page: Page, modality: JourneyModality) {
  const deliver =
    modality === 'video'
      ? page.getByTestId('video-deliver-action')
      : page.getByRole('button', { name: '交付', exact: true }).first();
  await expect(deliver).toBeEnabled();
  await deliver.click();
  await expect(page.getByTestId('delivery-panel')).toBeVisible();
  await expect(page.getByTestId('delivery-panel')).toHaveAttribute(
    'data-direct-publish-hidden',
    'true'
  );
}

export async function assertZipDownload(
  download: Download,
  contract: JourneyContract,
  expectedRevision?: number
) {
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(contract.packageFileName);
  const path = await download.path();
  expect(path, 'browser must persist a real downloaded ZIP').toBeTruthy();
  const bytes = await readFile(path!);
  expect(
    bytes.byteLength,
    'downloaded package must not be empty'
  ).toBeGreaterThan(22);
  const files = unzipSync(bytes);
  const manifestBytes = files['manifest.json'];
  const captionBytes = files['caption.txt'];
  const checklistBytes = files['platform-checklist.md'];
  expect(manifestBytes, 'ZIP must contain manifest.json').toBeTruthy();
  expect(captionBytes, 'ZIP must contain caption.txt').toBeTruthy();
  expect(
    checklistBytes,
    'ZIP must contain the platform compliance checklist'
  ).toBeTruthy();
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    files?: Array<{
      path?: string;
      role?: string;
      sizeBytes?: number;
    }>;
    kind?: string;
    platform?: string;
    contentPackageRevision?: number;
    rightsSummary?: {
      aigcLabelEnabled?: boolean;
      factSummary?: string;
      state?: string;
      watermarkEnabled?: boolean;
    };
    schema?: string;
  };
  expect(manifest.schema).toBe('beauty-delivery-manifest/v1');
  expect(manifest.kind).toBe(contract.modality);
  expect(manifest.platform).toBe(contract.deliveryTarget);
  if (expectedRevision !== undefined) {
    expect(manifest.contentPackageRevision).toBe(expectedRevision);
  }
  expect(manifest.rightsSummary).toEqual(
    expect.objectContaining({
      aigcLabelEnabled: expect.any(Boolean),
      state: expect.any(String),
      watermarkEnabled: expect.any(Boolean),
    })
  );
  expect(manifest.rightsSummary?.state?.trim().length ?? 0).toBeGreaterThan(0);
  expect(new TextDecoder().decode(captionBytes).trim().length).toBeGreaterThan(
    0
  );
  expect(
    new TextDecoder().decode(checklistBytes).trim().length
  ).toBeGreaterThan(0);
  expect(manifest.files?.length ?? 0).toBeGreaterThan(0);
  for (const entry of manifest.files ?? []) {
    expect(entry.path, 'every manifest file must have a path').toBeTruthy();
    const archived = files[entry.path!];
    expect(
      archived,
      `manifest path ${entry.path} must exist in ZIP`
    ).toBeTruthy();
    expect(archived?.byteLength).toBe(entry.sizeBytes);
  }
  const manifestPaths = new Set(
    (manifest.files ?? []).map(({ path }) => path).filter(Boolean)
  );
  expect(manifestPaths.has('caption.txt')).toBe(true);
  expect(manifestPaths.has('platform-checklist.md')).toBe(true);
  if (contract.modality === 'video') {
    expect(files['video.mp4']?.byteLength ?? 0).toBeGreaterThan(0);
    expect(manifestPaths.has('video.mp4')).toBe(true);
    // Cover and subtitles are the composed-video package's, and T23 retired
    // that chain: a native single-call 成片 carries neither unless the export
    // is handed one (`content-package-export-adapter.ts`, `nativeSingleCall`).
    // Demanding them demanded the pre-T23 shape. What must still hold is that
    // the archive and its manifest agree — declared means present, with real
    // bytes, under whichever name the mime type gave it
    // (`buildVideoFullDeliveryPackage`).
    for (const role of ['cover', 'subtitles'] as const) {
      const declared = (manifest.files ?? []).find(
        (entry) => entry.role === role
      );
      if (!declared) continue;
      expect(
        files[declared.path!]?.byteLength ?? 0,
        `a declared ${role} must carry real bytes`
      ).toBeGreaterThan(0);
    }
  } else {
    expect(Object.keys(files).some((name) => name.startsWith('images/'))).toBe(
      true
    );
  }
}

async function assertTextDownload(
  download: Download,
  expectedFileName: RegExp
) {
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(expectedFileName);
  const path = await download.path();
  expect(
    path,
    'browser must persist a real downloaded segments file'
  ).toBeTruthy();
  const text = await readFile(path!, 'utf8');
  const trimmed = text.trim();
  expect(
    trimmed.length,
    'downloaded segments must not be empty'
  ).toBeGreaterThan(20);
  // Fixture copy may omit explicit section headers; require multi-segment body.
  expect(
    trimmed.split(/\n+/u).filter((line) => line.trim().length > 0).length,
    'moments export must contain ordered publish segments'
  ).toBeGreaterThanOrEqual(2);
}

export async function downloadFullPackage(
  page: Page,
  contract: JourneyContract,
  expectedRevision?: number
) {
  const button = page.getByTestId('delivery-action-full_package');
  await expect(button).toHaveAccessibleName(contract.packageButtonName);
  await expect(
    button,
    'full package must be enabled after adopt has a downloadable revision'
  ).toBeEnabled({ timeout: 60_000 });
  const exportPromise =
    contract.packageFormat === 'zip'
      ? mutationResponse(page, /^result_export$/u)
      : null;
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await button.click();
  if (exportPromise) {
    const response = await exportPromise;
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const download = await downloadPromise;
  if (contract.packageFormat === 'zip') {
    await assertZipDownload(download, contract, expectedRevision);
  } else {
    await assertTextDownload(download, contract.packageFileName);
  }
  // Outcome is announced via live region; focus is best-effort (tabindex=-1).
  await expect(page.getByTestId('delivery-outcome-download-done')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByTestId('delivery-outcome-download-done')
  ).toHaveAttribute('data-outcome', 'download_done');
}

export async function assertJourneyRestored(
  page: Page,
  contract: JourneyContract,
  workId: string
) {
  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(
      `/dashboard/results/${encodeURIComponent(workId)}(?:\\?|$)`,
      'u'
    ),
    { timeout: 60_000 }
  );
  await expect(page.getByTestId(contract.resultSurfaceTestId)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('delivery-panel')).toBeVisible();

  if (contract.modality === 'copy') {
    // Adoption survived the reload. Assert what is invariant rather than one
    // label: after a delivery the shell moves on to 基于此再创作, so pinning 交付
    // here would fail on a journey that delivered. What must never come back is
    // the request to adopt. (Absence of `copy-adopt-action` alone proved
    // nothing — it is absent on an unadopted run too.)
    await expect(page.getByTestId('result-primary-action')).not.toHaveText(
      '采用此版本'
    );
    await expect(page.getByTestId('copy-adopt-action')).toHaveCount(0);
  } else if (contract.modality === 'image_text') {
    await expect(page.getByTestId('image-adopted-badge').first()).toBeVisible();
  } else {
    await expect(page.getByTestId('video-result-status')).toContainText(
      '已采用，待交付'
    );
  }
}
