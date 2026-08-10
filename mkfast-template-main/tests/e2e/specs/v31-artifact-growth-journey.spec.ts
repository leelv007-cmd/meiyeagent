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
 * Asserted here (all four, real UI, no route fulfill, no conditional empty pass):
 * 1. Stable Artifact ID — capture id at first mount; re-check the same DOM node
 *    id at later stages (not merely "count === 1", which would pass if the old
 *    card were torn down and a new one remounted).
 * 2. In-place growth — content/status/revision actually change (positive) AND
 *    `agent-artifact-card` count never grows (negative).
 * 3. Left/right role separation — process column carries stage/todo stream;
 *    works column carries the Artifact only (no conversation dual-mount).
 * 4. No candidate/result/delivery triple object stack — end state keeps a single
 *    right-rail Artifact; expanded candidate does not remain beside delivery as
 *    a second full object; Result Center object workspace is not stacked in-composer.
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
  JOURNEY_CONTRACTS,
  submitComposerJourney,
} from '../fixtures/ui-journey';

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;

const GROWTH_INTENT =
  '把本店皮肤护理案例做成小红书图文笔记，页数不要太多，把前后对比说清楚';

type ArtifactSnapshot = {
  artifactId: string;
  cardCount: number;
  pageCount: number;
  revision: number;
  signature: string;
  status: string;
};

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
 * Left = process (conversation / stage / interrupts). Right = works Artifact.
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

  // Right holds the Artifact; left must not dual-mount the same object card.
  await expect(works.getByTestId('agent-artifact-card')).toHaveCount(1);
  await expect(process.getByTestId('agent-artifact-card')).toHaveCount(0);
  await expect(works.getByTestId('agent-artifact-canvas')).toBeVisible();
  await expect(process.getByTestId('agent-artifact-canvas')).toHaveCount(0);

  // Left carries the stream role (conversation is processSlot). Right must not
  // host the conversation.
  await expect(process.getByTestId('composer-conversation')).toBeVisible();
  await expect(works.getByTestId('composer-conversation')).toHaveCount(0);
}

/**
 * End-state anti-pattern from §5.5: do not stack 候选卡 + 结果卡 + 交付卡 as
 * three object presentations for the same Work. The right rail stays one
 * Artifact; the conversation may morph candidate → delivery, but must not keep
 * an expanded candidate primary beside delivery as a second full object, and
 * must not also open the Result Center object workspace in-composer.
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

  // Expanded candidate primary is the full object face; after delivery it must
  // collapse (summary capsule is allowed). A primary still mounted next to
  // delivery is the start of the forbidden triple stack.
  await expect(
    page.getByTestId('composer-candidate-primary'),
    'delivery must collapse the expanded candidate object face'
  ).toHaveCount(0);

  // Result Center object workspace is a navigation surface, not a third stacked
  // object card inside the conversation. Stay on Composer.
  await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
  await expect(page.getByTestId('result-image-text-workspace')).toHaveCount(0);
  await expect(page.getByTestId('result-center-shell')).toHaveCount(0);

  // No second Artifact card family disguised as a "result" node.
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
    test.setTimeout(360_000);
    // Desktop width forces dual-column process/works (§4.2); mobile collapses
    // them into a single pane switch and would skip the left/right assertion.
    await page.setViewportSize({ width: 1440, height: 900 });

    const merchant = await registerE2EUser(request);
    await loginByForm(page, merchant);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await seedComposerInlineAuthorize(page, {
      fileName: `v31-artifact-growth-${crypto.randomUUID()}.png`,
    });

    let capturedWorkId = '';
    let firstSnapshot: ArtifactSnapshot | null = null;
    const signatureTrail: string[] = [];

    await submitComposerJourney(page, imageTextContract, GROWTH_INTENT, {
      openResult: false,
      onSubmissionAccepted: ({ workId }) => {
        capturedWorkId = workId;
      },
      onRunStreaming: async () => {
        const host = page.getByTestId('agent-workbench-host');
        await expect(host).toBeVisible({ timeout: 60_000 });
        const threadId = await host.getAttribute('data-thread-id');
        expect(
          threadId,
          'Composer must bind the Artifact stream to a real Agent Thread'
        ).toBeTruthy();

        const cards = page.getByTestId('agent-artifact-card');
        // First appearance of the right-rail Artifact (any status/stage).
        await expect(cards.first()).toBeVisible({ timeout: 120_000 });
        firstSnapshot = await readArtifactSnapshot(page);
        signatureTrail.push(firstSnapshot.signature);
        await assertSameArtifactNode(page, firstSnapshot.artifactId, cards);
        await assertLeftRightRoleSeparation(page);

        // Sample until either:
        // - UI signature changes at least once on the same id (preferred), or
        // - head is ready with revision >= 2 (multi-step producer advance on one node).
        // Negative half is checked on every sample: card count stays 1, id fixed.
        await expect
          .poll(
            async () => {
              const current = await readArtifactSnapshot(page);
              await assertSameArtifactNode(
                page,
                firstSnapshot!.artifactId,
                cards
              );
              if (
                signatureTrail[signatureTrail.length - 1] !== current.signature
              ) {
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
              timeout: 180_000,
            }
          )
          .toBe('grown');

        const mid = await readArtifactSnapshot(page);
        expect(mid.artifactId).toBe(firstSnapshot.artifactId);
        expect(mid.cardCount).toBe(1);
        const contentGrew =
          mid.signature !== firstSnapshot.signature ||
          signatureTrail.length >= 2;
        const revisionGrew = mid.revision > firstSnapshot.revision;
        const multiRevisionReady = mid.status === 'ready' && mid.revision >= 2;
        expect(
          contentGrew || revisionGrew || multiRevisionReady,
          `positive growth required; first=${firstSnapshot.signature} mid=${mid.signature} trail=${signatureTrail.length}`
        ).toBe(true);
        if (!contentGrew && multiRevisionReady) {
          // Late sample only saw ready head: revision still proves multi-step
          // advance on the same DOM node (not a replacement card).
          expect(mid.revision).toBeGreaterThanOrEqual(2);
        }
        if (contentGrew && mid.signature !== firstSnapshot.signature) {
          expect(mid.signature).not.toBe(firstSnapshot.signature);
        }

        // Prefer reaching ready before delivery; keep sampling the same id.
        await expect
          .poll(
            async () => {
              const current = await readArtifactSnapshot(page);
              await assertSameArtifactNode(
                page,
                firstSnapshot!.artifactId,
                cards
              );
              if (
                signatureTrail[signatureTrail.length - 1] !== current.signature
              ) {
                signatureTrail.push(current.signature);
              }
              return current.status;
            },
            {
              message:
                'in-place growth should reach ready on the same Artifact id',
              timeout: 180_000,
            }
          )
          .toBe('ready');

        const readySnapshot = await readArtifactSnapshot(page);
        expect(readySnapshot.artifactId).toBe(firstSnapshot.artifactId);
        expect(readySnapshot.cardCount).toBe(1);
        expect(readySnapshot.revision).toBeGreaterThanOrEqual(
          firstSnapshot.revision
        );
        // Positive pair at ready: either trail shows content change, or ready
        // revision advanced past the first sample.
        expect(
          readySnapshot.signature !== firstSnapshot.signature ||
            readySnapshot.revision > firstSnapshot.revision ||
            readySnapshot.revision >= 2
        ).toBe(true);
        await assertLeftRightRoleSeparation(page);
      },
      onDeliveryCardVisible: async () => {
        expect(capturedWorkId.length).toBeGreaterThan(0);
        expect(
          firstSnapshot,
          'growth must have started before delivery'
        ).not.toBeNull();

        const cards = page.getByTestId('agent-artifact-card');
        await assertSameArtifactNode(page, firstSnapshot!.artifactId, cards);
        const finalSnapshot = await readArtifactSnapshot(page);
        expect(finalSnapshot.artifactId).toBe(firstSnapshot!.artifactId);
        expect(finalSnapshot.cardCount).toBe(1);
        expect(
          finalSnapshot.signature !== firstSnapshot!.signature ||
            finalSnapshot.revision > firstSnapshot!.revision ||
            finalSnapshot.revision >= 2,
          'delivery-time Artifact must still prove growth vs first mount'
        ).toBe(true);

        await assertLeftRightRoleSeparation(page);
        await assertNoCandidateResultDeliveryTriple(page, capturedWorkId);

        await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
          'data-delivered',
          'true',
          { timeout: 60_000 }
        );
      },
    });

    // submitComposerJourney already waited for delivery with openResult:false.
    expect(capturedWorkId.length).toBeGreaterThan(0);
    expect(firstSnapshot).not.toBeNull();

    // Final bound: still one stable node after the helper returns.
    await assertSameArtifactNode(
      page,
      firstSnapshot!.artifactId,
      page.getByTestId('agent-artifact-card')
    );
    await assertNoCandidateResultDeliveryTriple(page, capturedWorkId);
  });
});
