/**
 * V31-15 / V31-62 / V3.1 §5.5 Artifact 原位生长 journey (required non-letter
 * gate item; write-only; master runs with lane ports).
 *
 * Authority:
 * - plan §5.5「Make：Artifact 原位生长」— left Workstream / right stable Artifact,
 *   no candidate+result+delivery triple stack, one stable object id
 * - plan §4.2 layout (left 62% process / right 38% works)
 * - plan §4.3 mobile 过程/作品 + Artifact fullscreen sheet
 * - plan §27.5 / §27.6 snapshot/delta + reconnect / needs_snapshot resync
 * - plan §38「Artifact 重复对象率 = 0」
 * - V31-49 §三 task book (four required assertions, positive+negative pairs)
 * - V31-15 AC2/3/4 + V31-62 evidence fill
 * - handoff `docs/handoff/v31-wave4-pause-handoff-2026-08-11.md` §5
 *
 * Sequence under test (production Intent → Plan → explicit start → Make):
 * `POST /p1/composer/submissions` freezes image_text as merchant_confirmed
 * (`makeReady: false`). Explicit `tasks/:taskId/start` admits Make. Living
 * Plan commit strip already records paid confirmation (decide → start), so
 * Core must not re-suspend on execution_confirmation; the note path still
 * asks its one 图文方向 merchant question as `agent-pending-interrupt`.
 * Artifact growth is observed on the right rail during Make.
 *
 * Cases:
 * 1. AC1 stable id + in-place growth + left/right roles + no triple stack
 * 2. AC2 SSE chaos (artifact-head-replay + artifact-gap-close) → reconnect,
 *    single card, ready recovery (delta gap → snapshot/resync path)
 * 3. AC3 mobile viewport Artifact fullscreen sheet open/close/content
 * 4. AC4 derived revision after page regen → version browser lookback
 *
 * Real Web → Core → Harness chain; only the model boundary is fixture mode.
 * No mocks on the critical chain, no test.skip/fixme, no isVisible empty pass.
 * e2eAgentFault only rewrites Core query params (real stack); never route.fulfill
 * of product success after product failure.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerCapsule,
  selectComposerLens,
} from '../fixtures/ui-journey';

const GROWTH_INTENT =
  '把本店皮肤护理案例做成小红书图文笔记，页数不要太多，把前后对比说清楚';

type SubmissionBinding = {
  taskId: string;
  threadId: string;
  workId: string;
};

type ArtifactSnapshot = {
  artifactId: string;
  cardCount: number;
  pageCount: number;
  revision: number;
  signature: string;
  status: string;
};

async function openCustomizedImageText(page: Page) {
  await page.goto('/dashboard');
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-artifact-growth-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
  // 图文 pins 小红书 as its lens default; chips toggle — assert, do not click.
  const destinationPanel = await openComposerCapsule(page, 'destination');
  await expect(
    page.getByTestId('composer-destination-option-xiaohongshu'),
    '图文 must arrive pre-bound to 小红书 before the plan is compiled'
  ).toHaveAttribute('aria-pressed', 'true');
  await closeComposerCapsule(page, destinationPanel);
}

async function submitPlanShapingTurn(page: Page): Promise<SubmissionBinding> {
  const intent = page.getByTestId('composer-intent-input');
  await intent.fill(GROWTH_INTENT);
  await expect(intent).toHaveValue(GROWTH_INTENT);
  await expect(
    page.getByTestId('composer-quote-line'),
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
  const submissionResponse = await submissionResponsePromise;
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
  const threadId = submission.data?.threadId ?? '';
  expect(taskId.length, `body=${submissionText}`).toBeGreaterThan(0);
  expect(workId.length, `body=${submissionText}`).toBeGreaterThan(0);
  expect(
    threadId.length,
    'the 202 must bind the Agent Thread the Intent turn ran on'
  ).toBeGreaterThan(0);
  expect(
    (submission.data?.runId ?? '').length,
    'the 202 must bind the Agent Run the Intent turn ran on'
  ).toBeGreaterThan(0);
  expect(
    submission.data?.makeReady,
    'a merchant-confirmed plan must not admit Make on submit'
  ).toBe(false);

  return { taskId, threadId, workId };
}

async function startPreparedPlan(page: Page, taskId: string) {
  const plan = page.getByTestId('agent-living-plan');
  await expect(plan, 'Intent turn must compile a plan revision').toBeVisible({
    timeout: 120_000,
  });
  await expect(plan).toHaveAttribute('data-revision', '1');
  const strip = page.getByTestId('agent-commit-strip');
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('data-start-disabled', 'false');
  const start = page.getByTestId('agent-commit-strip-start');
  await expect(start).toBeEnabled();

  const startResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response
        .url()
        .includes(
          `/api/core/p1/composer/tasks/${encodeURIComponent(taskId)}/start`
        ),
    { timeout: 120_000 }
  );
  await start.click();
  const startResponse = await startResponsePromise;
  const startText = await startResponse.text();
  expect(
    startResponse.status(),
    `explicit start must be accepted with 202; body=${startText}`
  ).toBe(202);
  expect(
    (JSON.parse(startText) as { data?: { makeReady?: boolean } }).data
      ?.makeReady,
    'explicit start is what admits Make'
  ).toBe(true);
}

/** Accepts a typed interrupt whose card text matches `hasText`. */
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

async function readArtifactSnapshot(page: Page): Promise<ArtifactSnapshot> {
  const cards = page.getByTestId('agent-artifact-card');
  const cardCount = await cards.count();
  expect(
    cardCount,
    'right-rail must surface exactly one Artifact card while growing'
  ).toBe(1);
  const card = cards.first();
  await expect(card).toBeVisible();
  const artifactId = (await card.getAttribute('data-artifact-id')) ?? '';
  expect(
    artifactId.length,
    'Artifact must carry a stable data-artifact-id'
  ).toBeGreaterThan(0);
  const note = page.getByTestId('agent-artifact-note');
  await expect(note).toBeVisible();
  const status = (await note.getAttribute('data-artifact-status')) ?? '';
  const revision = Number((await note.getAttribute('data-revision')) ?? '0');
  expect(Number.isFinite(revision)).toBe(true);
  const pages = page.getByTestId('agent-artifact-note-page');
  const pageCount = await pages.count();
  const pageBits: string[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const row = pages.nth(index);
    const stage = (await row.getAttribute('data-page-stage')) ?? '';
    const text = ((await row.innerText()) ?? '').replace(/\s+/gu, ' ').trim();
    pageBits.push(`${stage}:${text.slice(0, 80)}`);
  }
  return {
    artifactId,
    cardCount,
    pageCount,
    revision,
    signature: `${status}|r${revision}|p${pageCount}|${pageBits.join('||')}`,
    status,
  };
}

async function assertSameArtifactNode(
  page: Page,
  expectedId: string,
  cards: Locator
) {
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute('data-artifact-id', expectedId);
  const canvas = page.getByTestId('agent-artifact-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-artifact-count', '1');
}

/**
 * §5.5 left/right roles on a real desktop workbench.
 * Left = process (conversation / plan / stage). Right = works Artifact.
 */
async function assertLeftRightRoleSeparation(page: Page) {
  const process = page.getByTestId('agent-workstream-process');
  const works = page.getByTestId('agent-workstream-works');
  await expect(
    process,
    'desktop left process column must mount for §4.2 dual-column layout'
  ).toBeVisible();
  await expect(
    works,
    'desktop right works column must mount for §4.2 dual-column layout'
  ).toBeVisible();

  await expect(works.getByTestId('agent-artifact-card')).toHaveCount(1);
  await expect(process.getByTestId('agent-artifact-card')).toHaveCount(0);
  await expect(works.getByTestId('agent-artifact-canvas')).toBeVisible();
  await expect(process.getByTestId('agent-artifact-canvas')).toHaveCount(0);

  // Left carries the stream/plan role. Right must not host the conversation.
  const leftHasProcessSurface =
    (await process.getByTestId('composer-conversation').count()) > 0 ||
    (await process.getByTestId('agent-living-plan').count()) > 0 ||
    (await process.getByTestId('agent-narrative-line').count()) > 0 ||
    (await process.getByTestId('agent-activity-line').count()) > 0;
  expect(
    leftHasProcessSurface,
    'left process column must carry conversation, plan, or workstream lines'
  ).toBe(true);
  await expect(works.getByTestId('composer-conversation')).toHaveCount(0);
}

/**
 * End-state anti-pattern from §5.5: do not stack 候选卡 + 结果卡 + 交付卡 as
 * three object presentations for the same Work. The right rail stays one
 * Artifact. Delivery may be absent when the package write fails closed (refund
 * path); the contract under test is still "no triple object stack".
 */
async function assertNoCandidateResultDeliveryTriple(
  page: Page,
  workId: string
) {
  await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);
  await expect(page.getByTestId('agent-artifact-canvas')).toHaveAttribute(
    'data-artifact-count',
    '1'
  );
  await expect(page.getByTestId('agent-artifact-note')).toHaveCount(1);

  // Stay on Composer — Result Center is a navigation surface, not a stacked card.
  await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
  await expect(page.getByTestId('result-image-text-workspace')).toHaveCount(0);
  await expect(page.getByTestId('result-center-shell')).toHaveCount(0);

  const deliveryCount = await page
    .locator(`[data-testid="composer-delivery-card"][data-work-id="${workId}"]`)
    .count();
  const expandedCandidateCount = await page
    .getByTestId('composer-candidate-primary')
    .count();
  // Expanded candidate and delivery must not co-exist as two full object faces
  // for the same Work; Result Center is already zero above — that is the triple.
  expect(
    expandedCandidateCount * deliveryCount,
    'expanded candidate and delivery must not stack as parallel object faces'
  ).toBe(0);
  expect(deliveryCount).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);
}

function isResultDeliveryResponse(response: Response, action: string) {
  if (
    response.request().method() !== 'POST' ||
    !response.url().includes('/api/core/p1/commands')
  ) {
    return false;
  }
  try {
    const body = response.request().postDataJSON() as {
      action?: string;
      module?: string;
    };
    return body.module === 'result-delivery' && body.action === action;
  } catch {
    return false;
  }
}

/**
 * Shared Intent → Plan → start → direction interrupt → Make admits.
 * Leaves the page on the workbench host with Make in flight / growing.
 */
async function driveToMakeGrowth(
  page: Page,
  request: APIRequestContext,
  options?: { viewport?: { width: number; height: number } }
): Promise<SubmissionBinding> {
  await page.setViewportSize(options?.viewport ?? { width: 1440, height: 900 });
  const merchant = await registerE2EUser(request);
  await loginByForm(page, merchant);
  await seedConfirmedStore(page);
  await openCustomizedImageText(page);
  const binding = await submitPlanShapingTurn(page);
  await expect(page.getByTestId('agent-living-plan')).toBeVisible({
    timeout: 120_000,
  });
  await startPreparedPlan(page, binding.taskId);
  await acceptInterrupt(page, /两种图文方向/u);
  const host = page.getByTestId('agent-workbench-host');
  await expect(host).toBeVisible({ timeout: 60_000 });
  await expect(host).toHaveAttribute('data-thread-id', binding.threadId);
  return binding;
}

async function waitArtifactReadyOnStableId(
  page: Page,
  expectedId?: string
): Promise<ArtifactSnapshot> {
  const cards = page.getByTestId('agent-artifact-card');
  await expect(cards.first()).toBeVisible({ timeout: 180_000 });
  const first = await readArtifactSnapshot(page);
  if (expectedId) {
    expect(first.artifactId).toBe(expectedId);
  }
  await expect
    .poll(
      async () => {
        const current = await readArtifactSnapshot(page);
        await assertSameArtifactNode(page, first.artifactId, cards);
        return current.status;
      },
      {
        message: 'Artifact must reach ready on one stable id',
        timeout: 240_000,
      }
    )
    .toBe('ready');
  const ready = await readArtifactSnapshot(page);
  expect(ready.artifactId).toBe(first.artifactId);
  expect(ready.cardCount).toBe(1);
  return ready;
}

test.describe('V31-15 Artifact 原位生长 (§5.5 / V31-49 / V31-62)', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('AC1: stable Artifact id grows in place on the right rail without triple object cards', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    // Desktop width forces dual-column process/works (§4.2).
    const binding = await driveToMakeGrowth(page, request);

    // Plan is present; Make has started after direction interrupt.
    await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'false'
    );
    await expect(
      page.locator(
        `[data-testid="composer-delivery-card"][data-work-id="${binding.workId}"]`
      )
    ).toHaveCount(0);

    const cards = page.getByTestId('agent-artifact-card');
    await expect(cards.first()).toBeVisible({ timeout: 180_000 });
    const firstSnapshot = await readArtifactSnapshot(page);
    const signatureTrail: string[] = [firstSnapshot.signature];
    await assertSameArtifactNode(page, firstSnapshot.artifactId, cards);
    await assertLeftRightRoleSeparation(page);

    // Positive growth: signature change and/or multi-revision ready on one id.
    // Negative: card count stays 1 and id never changes on every sample.
    await expect
      .poll(
        async () => {
          const current = await readArtifactSnapshot(page);
          await assertSameArtifactNode(page, firstSnapshot.artifactId, cards);
          if (signatureTrail[signatureTrail.length - 1] !== current.signature) {
            signatureTrail.push(current.signature);
          }
          if (
            signatureTrail.length >= 2 ||
            (current.status === 'ready' && current.revision >= 2)
          ) {
            return 'grown';
          }
          return `${current.status}:r${current.revision}:sigs${signatureTrail.length}`;
        },
        {
          message:
            'Artifact must grow in place: distinct UI signatures or multi-revision ready on one id',
          timeout: 240_000,
        }
      )
      .toBe('grown');

    const mid = await readArtifactSnapshot(page);
    expect(mid.artifactId).toBe(firstSnapshot.artifactId);
    expect(mid.cardCount).toBe(1);
    expect(
      mid.signature !== firstSnapshot.signature ||
        mid.revision > firstSnapshot.revision ||
        (mid.status === 'ready' && mid.revision >= 2),
      `positive growth required; first=${firstSnapshot.signature} mid=${mid.signature} trail=${signatureTrail.length}`
    ).toBe(true);

    await expect
      .poll(
        async () => {
          const current = await readArtifactSnapshot(page);
          await assertSameArtifactNode(page, firstSnapshot.artifactId, cards);
          if (signatureTrail[signatureTrail.length - 1] !== current.signature) {
            signatureTrail.push(current.signature);
          }
          return current.status;
        },
        {
          message: 'in-place growth should reach ready on the same Artifact id',
          timeout: 240_000,
        }
      )
      .toBe('ready');

    const readySnapshot = await readArtifactSnapshot(page);
    expect(readySnapshot.artifactId).toBe(firstSnapshot.artifactId);
    expect(readySnapshot.cardCount).toBe(1);
    expect(readySnapshot.revision).toBeGreaterThanOrEqual(
      firstSnapshot.revision
    );
    expect(
      readySnapshot.signature !== firstSnapshot.signature ||
        readySnapshot.revision > firstSnapshot.revision ||
        readySnapshot.revision >= 2
    ).toBe(true);
    // Ready head should carry in-page growth (skeleton→copy→image lands as
    // image stage with copy body on at least one page when fixture succeeds).
    const readyPages = page.getByTestId('agent-artifact-note-page');
    expect(await readyPages.count()).toBeGreaterThan(0);
    await expect(readyPages.first()).toHaveAttribute(
      'data-page-stage',
      /copy|image/u
    );

    // §5.5 end bound: ready Artifact on the right rail is the growth contract.
    // Delivery card is a separate package-write surface (observed fail-closed
    // refund still leaves one Artifact) and is not required to prove growth.
    await assertLeftRightRoleSeparation(page);
    await assertSameArtifactNode(page, firstSnapshot.artifactId, cards);
    await assertNoCandidateResultDeliveryTriple(page, binding.workId);
    await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-artifact-status',
      'ready'
    );
  });

  test('AC2: SSE gap-close + head-replay reconnect keeps one Artifact and recovers ready', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    // V31-15 AC2 browser axis: production Core e2e fault injection only
    // (artifact-head-replay truncates cold replay; artifact-gap-close drops one
    // live artifact.revised then closes). Host must reconnect via §27.6 path;
    // client never splits into a second card. Unit axis covers out-of-order /
    // duplicate / skip→needs_snapshot / delta bootstrap independently.
    let replayCalls = 0;
    let eventCalls = 0;
    let replayFaultApplied = false;
    let streamFaultApplied = false;
    const agentResponses: Response[] = [];
    page.on('response', (response) => {
      if (!response.url().includes('/api/core/p1/agent-threads/')) return;
      agentResponses.push(response);
      void response
        .headerValue('x-meiye-e2e-agent-fault-applied')
        .then((fault) => {
          if (fault === 'artifact-head-replay') replayFaultApplied = true;
          if (fault === 'artifact-gap-close') streamFaultApplied = true;
        });
    });
    await page.route(
      '**/api/core/p1/agent-threads/*/replay**',
      async (route) => {
        replayCalls += 1;
        if (!replayFaultApplied) {
          const faultUrl = new URL(route.request().url());
          faultUrl.searchParams.set('e2eAgentFault', 'artifact-head-replay');
          await route.continue({ url: faultUrl.toString() });
          return;
        }
        await route.continue();
      }
    );
    await page.route(
      '**/api/core/p1/agent-threads/*/events**',
      async (route) => {
        eventCalls += 1;
        if (eventCalls === 1) {
          const faultUrl = new URL(route.request().url());
          faultUrl.searchParams.set('e2eAgentFault', 'artifact-gap-close');
          await route.continue({ url: faultUrl.toString() });
          return;
        }
        await route.continue();
      }
    );

    const binding = await driveToMakeGrowth(page, request);
    const cards = page.getByTestId('agent-artifact-card');
    await expect(cards.first()).toBeVisible({ timeout: 180_000 });
    const first = await readArtifactSnapshot(page);
    await assertSameArtifactNode(page, first.artifactId, cards);

    // Host auto-reconnects after Core closes the gapped stream; never reload.
    await expect
      .poll(() => streamFaultApplied, {
        message:
          'Core must apply artifact-gap-close on the first events stream',
        timeout: 180_000,
      })
      .toBe(true);
    await expect
      .poll(() => replayFaultApplied, {
        message: 'Core must apply artifact-head-replay on cold/resync replay',
        timeout: 180_000,
      })
      .toBe(true);
    await expect
      .poll(() => replayCalls, {
        message: '§27.6 reconnect must re-fetch replay at least twice',
        timeout: 180_000,
      })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => eventCalls, {
        message: 'host must open a second events subscription after gap-close',
        timeout: 180_000,
      })
      .toBeGreaterThanOrEqual(2);

    await expect
      .poll(
        async () => {
          const current = await readArtifactSnapshot(page);
          await assertSameArtifactNode(page, first.artifactId, cards);
          return current.status;
        },
        {
          message:
            'after gap-close + head-replay resync, Artifact recovers to ready on same id',
          timeout: 240_000,
        }
      )
      .toBe('ready');

    const ready = await readArtifactSnapshot(page);
    expect(ready.artifactId).toBe(first.artifactId);
    expect(ready.cardCount).toBe(1);
    expect(ready.revision).toBeGreaterThan(0);

    const appliedFaults = (
      await Promise.all(
        agentResponses.map((response) =>
          response.headerValue('x-meiye-e2e-agent-fault-applied')
        )
      )
    ).filter((value): value is string => value !== null);
    expect(appliedFaults).toContain('artifact-head-replay');
    expect(appliedFaults).toContain('artifact-gap-close');
    await assertSameArtifactNode(page, first.artifactId, cards);
    await assertNoCandidateResultDeliveryTriple(page, binding.workId);
  });

  test('AC3: mobile viewport Artifact fullscreen sheet open/close/content', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    // 390 CSS px → useIsMobile + single-column workbench (viewportKind=mobile).
    const binding = await driveToMakeGrowth(page, request, {
      viewport: { width: 390, height: 844 },
    });

    const workstream = page.getByTestId('agent-workstream');
    await expect(workstream).toBeVisible({ timeout: 60_000 });
    await expect(workstream).toHaveAttribute('data-viewport', 'mobile');
    await expect(
      page.getByTestId('agent-mobile-process-works-switch')
    ).toBeVisible();
    // Default pane = process; sheet closed.
    await expect(page.getByTestId('agent-artifact-mobile-sheet')).toHaveCount(
      0
    );
    await expect(page.getByTestId('agent-workstream-process')).toBeVisible();

    // Wait until Make has projected at least one Artifact (process pane alone
    // does not mount the canvas; open works when ready).
    await expect
      .poll(
        async () => {
          // Switch to works, sample, then leave open if present.
          const sheetOpen =
            (await page.getByTestId('agent-artifact-mobile-sheet').count()) > 0;
          if (!sheetOpen) {
            await page.getByTestId('agent-mobile-pane-works').click();
          }
          const cards = await page.getByTestId('agent-artifact-card').count();
          return cards;
        },
        {
          message: 'mobile works sheet must surface Artifact card during Make',
          timeout: 180_000,
        }
      )
      .toBeGreaterThan(0);

    const sheet = page.getByTestId('agent-artifact-mobile-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('role', 'dialog');
    // Process column is hidden while works sheet is open.
    await expect(page.getByTestId('agent-workstream-process')).toHaveCount(0);
    await expect(page.getByTestId('agent-workstream-works')).toBeVisible();

    const first = await readArtifactSnapshot(page);
    expect(first.cardCount).toBe(1);
    await expect(page.getByTestId('agent-artifact-canvas')).toHaveAttribute(
      'data-viewport',
      'mobile'
    );
    const pageTextWhileOpen = (
      (await page.getByTestId('agent-artifact-note').innerText()) ?? ''
    )
      .replace(/\s+/gu, ' ')
      .trim();
    expect(pageTextWhileOpen.length).toBeGreaterThan(0);

    // Close → process pane; sheet gone.
    await page.getByTestId('agent-artifact-mobile-sheet-close').click();
    await expect(page.getByTestId('agent-artifact-mobile-sheet')).toHaveCount(
      0
    );
    await expect(page.getByTestId('agent-workstream-process')).toBeVisible();
    await expect(
      page.getByTestId('agent-mobile-process-works-switch')
    ).toBeVisible();

    // Re-open works: same stable id + content still consistent (no second card).
    await page.getByTestId('agent-mobile-pane-works').click();
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    const reopened = await readArtifactSnapshot(page);
    expect(reopened.artifactId).toBe(first.artifactId);
    expect(reopened.cardCount).toBe(1);
    // Content may have grown while closed (in-place); status/revision non-regress.
    expect(reopened.revision).toBeGreaterThanOrEqual(first.revision);

    await expect
      .poll(
        async () => {
          const current = await readArtifactSnapshot(page);
          expect(current.artifactId).toBe(first.artifactId);
          expect(current.cardCount).toBe(1);
          return current.status;
        },
        {
          message: 'mobile sheet keeps one Artifact through ready',
          timeout: 240_000,
        }
      )
      .toBe('ready');

    const ready = await readArtifactSnapshot(page);
    expect(ready.artifactId).toBe(first.artifactId);
    await expect(
      page.getByTestId('agent-artifact-note-page').first()
    ).toBeVisible();
    // Close again after ready — sheet contract still holds.
    await page.getByTestId('agent-artifact-mobile-sheet-close').click();
    await expect(page.getByTestId('agent-artifact-mobile-sheet')).toHaveCount(
      0
    );
    await expect(page.getByTestId('agent-workstream-process')).toBeVisible();
    // workId retained for residual diagnostics only.
    expect(binding.workId.length).toBeGreaterThan(0);
  });

  test('AC4: derived revision after page regen enables version lookback without overwrite', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    await driveToMakeGrowth(page, request);
    const ready = await waitArtifactReadyOnStableId(page);
    const readyBody = (
      (await page.getByTestId('agent-artifact-note').innerText()) ?? ''
    )
      .replace(/\s+/gu, ' ')
      .trim();
    expect(readyBody.length).toBeGreaterThan(0);
    // First ready has no derived lineage yet — version browser absent.
    await expect(
      page.getByTestId('agent-artifact-version-browser')
    ).toHaveCount(0);

    // Page regen is the production path that emits parentRevision after ready
    // (note-page-execution-frame derivedParentRevision). Timeline row lives in
    // the process column (left), same Composer session.
    //
    // #333 / #338 chain: prepare → execution-confirm-accept (result_adjust) →
    // derived task rebinds Composer → Living Plan / interrupt / paid
    // execution_confirmation must be answered before Make emits successor
    // artifact.revised. Skipping those admissions leaves revision frozen.
    const readyRow = page
      .locator('[data-testid="note-plan-page-row"][data-image-status="ready"]')
      .first();
    await expect(readyRow).toBeVisible({ timeout: 60_000 });
    const regenerate = readyRow.getByTestId('note-plan-page-regenerate');
    await expect(regenerate).toBeEnabled({ timeout: 60_000 });

    const prepareResponsePromise = page.waitForResponse(
      (response) => isResultDeliveryResponse(response, 'result_adjust_prepare'),
      { timeout: 60_000 }
    );
    await regenerate.click();
    expect((await prepareResponsePromise).ok()).toBe(true);

    // Preflight cost card (client-side), not the in-stream interrupt card.
    const costCard = page.getByTestId('execution-confirm-card');
    await expect(costCard).toBeVisible({ timeout: 30_000 });
    const confirmResponsePromise = page.waitForResponse(
      (response) => isResultDeliveryResponse(response, 'result_adjust'),
      { timeout: 60_000 }
    );
    await page.getByTestId('execution-confirm-accept').click();
    const confirmResponse = await confirmResponsePromise;
    expect(confirmResponse.ok()).toBe(true);
    const confirmText = await confirmResponse.text();
    const confirmEnvelope = JSON.parse(confirmText) as {
      data?: { task?: { id?: string } };
    };
    expect(
      (confirmEnvelope.data?.task?.id ?? '').length,
      `result_adjust must mint a derived task; body=${confirmText}`
    ).toBeGreaterThan(0);

    // #338: result_adjust rebinds Composer to the derived task and the harness
    // run raises its own in-stream paid execution_confirmation. Do NOT click
    // Living Plan 开始制作 here — that targets plan-start on a task that is
    // already mid-run and returns COMPOSER_PLAN_START_FAILED 409.
    //
    // Growth journey may leave residual confirmation cards from the parent
    // run; clear every visible interaction card by newest-first, then any
    // typed agent-pending-interrupt that still blocks Make.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const cards = page.getByTestId('execution-confirmation-interaction-card');
      const cardCount = await cards.count();
      if (cardCount === 0) break;
      const target = cards.nth(cardCount - 1);
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeVisible({ timeout: 60_000 });
      await target.getByRole('button', { name: '确认执行' }).click();
      await expect
        .poll(async () => cards.count(), {
          message: `paid confirmation card #${attempt + 1} must dismiss`,
          timeout: 60_000,
        })
        .toBeLessThan(cardCount);
    }
    await expect(
      page.getByTestId('execution-confirmation-interaction-card')
    ).toHaveCount(0, { timeout: 30_000 });

    const residualInterrupt = page.getByTestId('agent-pending-interrupt');
    if ((await residualInterrupt.count()) > 0) {
      await residualInterrupt
        .first()
        .getByTestId('agent-interrupt-accept')
        .click();
      await expect(residualInterrupt).toHaveCount(0, { timeout: 120_000 });
    }

    // Successor revisions land on the same artifactId with parentRevision lineage.
    await expect
      .poll(
        async () => {
          const current = await readArtifactSnapshot(page);
          expect(current.artifactId).toBe(ready.artifactId);
          expect(current.cardCount).toBe(1);
          return current.revision;
        },
        {
          message:
            'derived Make must advance Artifact revision on the same stable id',
          timeout: 240_000,
        }
      )
      .toBeGreaterThan(ready.revision);

    // Version browser becomes reachable once ready head is archived.
    await expect(
      page.getByTestId('agent-artifact-version-browser')
    ).toBeVisible({ timeout: 180_000 });
    const chips = page.getByTestId('agent-artifact-version-chip');
    await expect
      .poll(async () => chips.count(), {
        message: 'derived lineage must expose at least live + one archived rev',
        timeout: 60_000,
      })
      .toBeGreaterThanOrEqual(2);

    const liveRevision = Number(
      (await page
        .getByTestId('agent-artifact-note')
        .getAttribute('data-revision')) ?? '0'
    );
    expect(liveRevision).toBeGreaterThan(ready.revision);

    // Look back at the earliest archived revision chip (not · 当前).
    const historicalChip = chips.filter({ hasNotText: '当前' }).first();
    await expect(historicalChip).toBeVisible();
    const historicalRev = Number(
      (await historicalChip.getAttribute('data-revision')) ?? '0'
    );
    expect(historicalRev).toBeGreaterThan(0);
    expect(historicalRev).toBeLessThan(liveRevision);
    await historicalChip.click();

    await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-viewing-revision',
      String(historicalRev),
      { timeout: 15_000 }
    );
    // Live head revision attribute stays at max; only viewingRevision changes.
    await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-revision',
      String(liveRevision)
    );
    await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);

    // Return to live head via the current chip.
    const liveChip = chips.filter({ hasText: '当前' }).first();
    await liveChip.click();
    await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-viewing-revision',
      String(liveRevision),
      { timeout: 15_000 }
    );
    await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);
    // Live head body is still the derived surface (not wiped by lookback).
    await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
      'data-artifact-status',
      /ready|partial/u
    );
  });
});
