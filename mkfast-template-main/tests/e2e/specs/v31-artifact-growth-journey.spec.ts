/**
 * V31-15 / V3.1 §5.5 Artifact 原位生长 journey (required non-letter gate item;
 * write-only; master runs with lane ports).
 *
 * Authority:
 * - plan §5.5「Make：Artifact 原位生长」— left Workstream / right stable Artifact,
 *   no candidate+result+delivery triple stack, one stable object id
 * - plan §4.2 layout (left 62% process / right 38% works)
 * - plan §38「Artifact 重复对象率 = 0」
 * - V31-49 §三 task book (four required assertions, positive+negative pairs)
 * - handoff `docs/handoff/v31-wave4-pause-handoff-2026-08-11.md` §5
 *
 * Sequence under test (production Intent → Plan → explicit start → Make):
 * `POST /p1/composer/submissions` freezes image_text as merchant_confirmed
 * (`makeReady: false`). Explicit `tasks/:taskId/start` admits Make; typed
 * interrupts for 确认执行 and 图文方向 land as `agent-pending-interrupt`.
 * Artifact growth is observed on the right rail during Make.
 *
 * Asserted here (all four, real UI, no route fulfill, no conditional empty pass):
 * 1. Stable Artifact ID — capture id at first mount; re-check the same DOM node
 *    id at later stages (not merely "count === 1").
 * 2. In-place growth — content/status/revision change (positive) AND
 *    `agent-artifact-card` count never grows (negative).
 * 3. Left/right role separation — process column carries conversation/plan;
 *    works column carries the Artifact only.
 * 4. No candidate/result/delivery triple object stack at delivery.
 *
 * Real Web → Core → Harness chain; only the model boundary is fixture mode.
 * No mocks on the critical chain, no test.skip/fixme, no isVisible empty pass.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

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
 * three object presentations for the same Work.
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

  const delivery = page.locator(
    `[data-testid="composer-delivery-card"][data-work-id="${workId}"]`
  );
  await expect(delivery).toBeVisible();

  await expect(
    page.getByTestId('composer-candidate-primary'),
    'delivery must collapse the expanded candidate object face'
  ).toHaveCount(0);

  await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
  await expect(page.getByTestId('result-image-text-workspace')).toHaveCount(0);
  await expect(page.getByTestId('result-center-shell')).toHaveCount(0);

  await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);
  await expect(page.getByTestId('agent-artifact-note')).toHaveCount(1);
}

test.describe('V31-15 Artifact 原位生长 (§5.5 / V31-49)', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('stable Artifact id grows in place on the right rail without triple object cards', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    // Desktop width forces dual-column process/works (§4.2).
    await page.setViewportSize({ width: 1440, height: 900 });

    const merchant = await registerE2EUser(request);
    await loginByForm(page, merchant);
    await seedConfirmedStore(page);

    await openCustomizedImageText(page);
    const binding = await submitPlanShapingTurn(page);

    // Plan is present; Make has not started — no Artifact yet, no delivery.
    await expect(page.getByTestId('agent-living-plan')).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'false'
    );
    await expect(
      page.locator(
        `[data-testid="composer-delivery-card"][data-work-id="${binding.workId}"]`
      )
    ).toHaveCount(0);

    await startPreparedPlan(page, binding.taskId);

    // Paid note path: execution confirm, then 图文方向 (same order as rights
    // recovery journey on this HEAD).
    await acceptInterrupt(page, /是否按当前方案开始生成/u);
    await acceptInterrupt(page, /两种图文方向/u);

    const host = page.getByTestId('agent-workbench-host');
    await expect(host).toBeVisible({ timeout: 60_000 });
    await expect(host).toHaveAttribute('data-thread-id', binding.threadId);

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
    await assertLeftRightRoleSeparation(page);

    const delivery = page.locator(
      `[data-testid="composer-delivery-card"][data-work-id="${binding.workId}"]`
    );
    await expect(delivery).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'true',
      { timeout: 60_000 }
    );

    await assertSameArtifactNode(page, firstSnapshot.artifactId, cards);
    const finalSnapshot = await readArtifactSnapshot(page);
    expect(finalSnapshot.artifactId).toBe(firstSnapshot.artifactId);
    expect(finalSnapshot.cardCount).toBe(1);
    expect(
      finalSnapshot.signature !== firstSnapshot.signature ||
        finalSnapshot.revision > firstSnapshot.revision ||
        finalSnapshot.revision >= 2,
      'delivery-time Artifact must still prove growth vs first mount'
    ).toBe(true);

    await assertLeftRightRoleSeparation(page);
    await assertNoCandidateResultDeliveryTriple(page, binding.workId);
  });
});
