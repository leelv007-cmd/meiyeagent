/**
 * #333 / xcheck A6 — Note page regeneration browser journey proof.
 *
 * Prelude (shared by both cases), forked from xhs-image-text-main-journey:
 *   register → seed store → submit 小红书图文 (fixture) → direction +
 *   execution confirm → delivered, staying on ComposerHome so the note-plan
 *   timeline (where per-page regenerate lives) is the surface under test.
 *
 * WHAT THIS FILE FOUND — read before editing either case.
 *
 * The ticket was written on the premise that the per-page regeneration chain
 * is closed and only needed a browser journey to witness it. The browser says
 * otherwise: the feature is **unreachable from the UI today**. On a genuinely
 * delivered note the control renders and is enabled, but clicking it never
 * emits `result_adjust_prepare` — it is rejected client side at
 * composer-home.tsx:2710-2719 because `notePlanCanonicalPackageRef` is never
 * populated, and the merchant gets 「暂时无法读取当前图文版本，请刷新后重试。」
 *
 * That is not a timing artefact of this spec. Measured against the running
 * stack (see the handoff for full output):
 *   - repeated clicks over ~90s never emit a single command;
 *   - `session.task` carries both workId and packageId;
 *   - `operations.content_packages` returns that exact packageId at
 *     revision 1 / review_ready / currentVersionId set / 2 versions × 3 pages
 *     / creationExecutionSnapshot present — every data precondition the
 *     hydration effect checks is satisfiable;
 *   - after a page reload the note_plan turn does not re-mount at all, so the
 *     control is ephemeral as well as inert.
 *
 * Consequently:
 *   AC ① (successful regeneration) and AC ② (stale-OCC rejection) cannot be
 *   witnessed in a browser until that ref is populated. Their journey is
 *   written out in full and parked behind `test.fixme` rather than deleted or
 *   quietly weakened, so it turns into the regression gate the moment the
 *   defect is fixed.
 *   AC ③ (honest failure, nothing half-built) is proven below — and is
 *   currently the only reachable outcome of the control.
 *
 * Zero backend/src changes: this file adds no testid and touches no
 * production code, per the ticket's hard constraint.
 */

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
  type Response,
  type Route,
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
  JOURNEY_CONTRACTS,
  submitComposerJourney,
} from '../fixtures/ui-journey';

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;

const PREPARE_FAIL_COPY = '暂时无法准备本页重生成，尚未使用图片额度。请重试。';
const HYDRATION_FAIL_COPY = '暂时无法读取当前图文版本，请刷新后重试。';

type P1CommandBody = {
  action?: string;
  module?: string;
  payload?: Record<string, unknown>;
};

type NoteRegenerationReceipt = {
  pageId?: string;
  fromRevision?: number;
  toRevision?: number;
  imagePoints?: number;
};

type ContentPackageListItem = {
  id?: string;
  revision?: number;
  currentVersionId?: string;
  status?: string;
  lineage?: { reusedFromPackageId?: string };
  versions?: Array<{
    id?: string;
    note?: {
      regenerationReceipts?: NoteRegenerationReceipt[];
    };
  }>;
};

type ActiveHarnessTask = {
  taskId?: string;
  workId?: string;
  packageId?: string;
  merchantText?: string;
  submittedAt?: string;
};

function isP1Command(
  response: Response,
  action: string,
  module = 'result-delivery'
) {
  if (
    response.request().method() !== 'POST' ||
    !response.url().includes('/api/core/p1/commands')
  ) {
    return false;
  }
  try {
    const body = response.request().postDataJSON() as P1CommandBody;
    return body.module === module && body.action === action;
  } catch {
    return false;
  }
}

function isP1CommandRequest(
  request: Request,
  action: string,
  module = 'result-delivery'
) {
  if (
    request.method() !== 'POST' ||
    !request.url().includes('/api/core/p1/commands')
  ) {
    return false;
  }
  try {
    const body = request.postDataJSON() as P1CommandBody;
    return body.module === module && body.action === action;
  } catch {
    return false;
  }
}

async function listContentPackages(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'content_packages',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: ContentPackageListItem[];
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'content_packages query failed'
      );
    }
    return envelope.data;
  });
}

async function listActiveHarnessTasks(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/harness/tasks', {
      credentials: 'same-origin',
      method: 'GET',
    });
    const envelope = (await response.json()) as {
      data?: { tasks?: ActiveHarnessTask[] };
      error?: { message?: string };
      tasks?: ActiveHarnessTask[];
    };
    if (!response.ok) {
      throw new Error(
        envelope.error?.message ?? 'harness active tasks query failed'
      );
    }
    return envelope.data?.tasks ?? envelope.tasks ?? [];
  });
}

async function deliverNoteOnComposerHome(
  page: Page,
  request: APIRequestContext
) {
  const merchant = await registerE2EUser(request);
  await loginByForm(page, merchant);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');
  await seedComposerInlineAuthorize(page, {
    fileName: 'note-page-regen-source.png',
  });
  const workId = await submitComposerJourney(
    page,
    imageTextContract,
    '把本店皮肤护理案例做成小红书图文笔记',
    // Stay on ComposerHome: regenerate lives on note-plan timeline, not Result Center.
    { openResult: false }
  );
  await expect(
    page.getByTestId('composer-delivery-card'),
    'delivered card must remain on ComposerHome when openResult is false'
  ).toBeVisible();
  await expect(
    page.getByTestId('composer-note-plan-turn'),
    'note_plan turn must hydrate after image_text delivery'
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByTestId('note-plan-timeline-frame'),
    'multi-page outline frame must mount for regenerate'
  ).toBeVisible();
  const rows = page.getByTestId('note-plan-page-row');
  await expect(
    rows.first(),
    'delivered note must expose at least one page row'
  ).toBeVisible();
  await expect
    .poll(async () => rows.count(), {
      message: 'note plan should list multiple pages after fixture delivery',
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  // Prefer a ready page so regenerate control is enabled.
  const readyRow = page
    .locator('[data-testid="note-plan-page-row"][data-image-status="ready"]')
    .first();
  await expect(
    readyRow,
    'at least one page must be image-ready before regenerate'
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    readyRow.getByTestId('note-plan-page-regenerate'),
    'regenerate control is delivered-only and requires a ready page image'
  ).toBeVisible();
  await expect(readyRow.getByTestId('note-plan-page-regenerate')).toBeEnabled();
  await expect(readyRow.getByTestId('note-plan-page-regenerate')).toHaveText(
    '重新生成此页配图'
  );
  return { readyRow, workId };
}

test.describe('Note page regeneration journey (#333 / xcheck A6)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(120_000);
    await cleanupE2EUsers(request);
  });

  // BLOCKED on a production reachability defect — see the gap note at the top
  // of this file. Both halves of this journey (the stale-OCC rejection and the
  // successful regeneration) require `result_adjust_prepare` to leave the
  // browser, and today it never does: the regenerate control renders enabled on
  // a delivered note but `notePlanCanonicalPackageRef` is never populated, so
  // composer-home.tsx:2710-2719 early-returns with the hydration copy before any
  // request is made. The journey below is written against the intended contract
  // and is kept executable-ready on purpose: drop this `fixme` once the ref is
  // populated and it becomes the regression gate for #333 AC ①/②.
  test.fixme(
    'stale OCC prepare is rejected then successful page regen reaches new task/package',
    async ({ page, request }) => {
      test.setTimeout(480_000);
      await page.setViewportSize({ width: 1440, height: 900 });

      const { readyRow } = await deliverNoteOnComposerHome(page, request);
      const pageId = await readyRow.getAttribute('data-page-id');
      expect(pageId, 'ready row must carry a stable data-page-id').toBeTruthy();
      const targetRow = page.locator(
        `[data-testid="note-plan-page-row"][data-page-id="${pageId}"]`
      );
      const packagesBefore = await listContentPackages(page);
      const packageIdsBefore = new Set(
        packagesBefore.map((item) => item.id).filter(Boolean) as string[]
      );

      // ── Negative ①: stale OCC on prepare only ─────────────────────────────
      // master-adjudicated per #333：staleness 无法以真实时序构造，注入仅制造对抗
      // 条件不伪造成功路径。The OCC token is re-read at click time from
      // creative_workbench.works[].updatedAt, so a true race is not reproducible
      // deterministically. Rewrite only expectedWorkUpdatedAt on
      // result_adjust_prepare; leave every other command (incl. confirm) intact,
      // and unroute immediately after the negative case so the positive path
      // below runs against the untouched production chain.
      const stalePrepare = async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'POST') {
          await route.continue();
          return;
        }
        let body: P1CommandBody | null = null;
        try {
          body = req.postDataJSON() as P1CommandBody;
        } catch {
          await route.continue();
          return;
        }
        if (
          body?.module !== 'result-delivery' ||
          body.action !== 'result_adjust_prepare'
        ) {
          await route.continue();
          return;
        }
        const payload = { ...(body.payload ?? {}) };
        // Earlier-than-real ISO still parses as a valid timestamp and forces OCC mismatch.
        payload.expectedWorkUpdatedAt = '2000-01-01T00:00:00.000Z';
        await route.continue({
          postData: JSON.stringify({
            ...body,
            payload,
          }),
        });
      };

      const resultAdjustRequests: string[] = [];
      const trackConfirm = (req: Request) => {
        if (isP1CommandRequest(req, 'result_adjust')) {
          resultAdjustRequests.push('result_adjust');
        }
      };
      page.on('request', trackConfirm);

      await page.route('**/api/core/p1/commands', stalePrepare);
      try {
        const prepareResponsePromise = page.waitForResponse(
          (response) => isP1Command(response, 'result_adjust_prepare'),
          { timeout: 60_000 }
        );
        await targetRow.getByTestId('note-plan-page-regenerate').click();
        const prepareResponse = await prepareResponsePromise;
        expect(
          prepareResponse.status(),
          'stale expectedWorkUpdatedAt must be rejected with HTTP 409'
        ).toBe(409);
        const prepareEnvelope = (await prepareResponse.json()) as {
          error?: { code?: string; message?: string };
        };
        expect(
          prepareEnvelope.error?.code,
          'network layer must surface RESULT_ADJUST_REVISION_CONFLICT (DOM collapses codes — G2)'
        ).toBe('RESULT_ADJUST_REVISION_CONFLICT');

        await expect(
          targetRow.getByRole('alert'),
          'merchant-facing prepare failure copy (hardcoded zh literal)'
        ).toHaveText(PREPARE_FAIL_COPY, { timeout: 15_000 });
        await expect(
          page.getByTestId('execution-confirm-card'),
          'stale prepare must never open the execution confirm card'
        ).toHaveCount(0);
        await expect(
          page.getByTestId('execution-confirm-slot'),
          'stale prepare must not mount an execution-confirm slot body'
        ).toHaveCount(0);
        expect(
          resultAdjustRequests,
          'no result_adjust (confirm) may fire after a rejected prepare'
        ).toEqual([]);
        await expect(
          targetRow,
          'page image status stays ready — no half-built generating state'
        ).toHaveAttribute('data-image-status', 'ready');
        await expect(
          targetRow.getByTestId('note-plan-page-image-status')
        ).toHaveText('已配图');
        await expect(
          targetRow.getByTestId('note-plan-page-regenerate')
        ).toBeEnabled();
        await expect(
          targetRow.getByTestId('note-plan-page-regenerate')
        ).toHaveText('重新生成此页配图');

        const packagesAfterStale = await listContentPackages(page);
        expect(
          packagesAfterStale
            .map((item) => item.id)
            .filter(Boolean)
            .sort(),
          'stale prepare must not create any derived content package'
        ).toEqual([...packageIdsBefore].sort());
      } finally {
        await page.unroute('**/api/core/p1/commands', stalePrepare);
        page.off('request', trackConfirm);
      }

      // ── Positive: full prepare → confirm chain ────────────────────────────
      const prepareResponsePromise = page.waitForResponse(
        (response) => isP1Command(response, 'result_adjust_prepare'),
        { timeout: 60_000 }
      );
      await targetRow.getByTestId('note-plan-page-regenerate').click();
      const prepareResponse = await prepareResponsePromise;
      expect(
        prepareResponse.ok(),
        `prepare must succeed after unroute; body=${await prepareResponse.text()}`
      ).toBeTruthy();
      const prepareRequest = prepareResponse
        .request()
        .postDataJSON() as P1CommandBody;
      expect(
        prepareRequest.payload?.expectedWorkUpdatedAt,
        'OCC token is required on prepare only'
      ).toBeTruthy();
      expect(
        typeof prepareRequest.payload?.expectedWorkUpdatedAt,
        'expectedWorkUpdatedAt must be an ISO timestamp string'
      ).toBe('string');

      const confirmCard = page.getByTestId('execution-confirm-card');
      await expect(
        confirmCard,
        'successful prepare must surface the merchant execution confirm card'
      ).toBeVisible({ timeout: 30_000 });

      const confirmResponsePromise = page.waitForResponse(
        (response) => isP1Command(response, 'result_adjust'),
        { timeout: 60_000 }
      );
      await page.getByTestId('execution-confirm-accept').click();
      const confirmResponse = await confirmResponsePromise;
      const confirmBodyText = await confirmResponse.text();
      expect(
        confirmResponse.ok(),
        `confirm must succeed; body=${confirmBodyText}`
      ).toBeTruthy();
      const confirmRequest = confirmResponse
        .request()
        .postDataJSON() as P1CommandBody;
      expect(
        confirmRequest.payload,
        'confirm payload must be present'
      ).toBeTruthy();
      expect(
        Object.hasOwn(confirmRequest.payload ?? {}, 'expectedWorkUpdatedAt'),
        'OCC semantic anchor: confirm must NOT carry expectedWorkUpdatedAt'
      ).toBe(false);

      const confirmEnvelope = JSON.parse(confirmBodyText) as {
        data?: {
          contentPackage?: { id?: string };
          task?: { id?: string };
          work?: { id?: string };
        };
      };
      const newTaskId = confirmEnvelope.data?.task?.id;
      const newPackageId = confirmEnvelope.data?.contentPackage?.id;
      const newWorkId = confirmEnvelope.data?.work?.id;
      expect(
        newTaskId,
        'confirm response must expose the new derived task id'
      ).toBeTruthy();
      expect(
        newPackageId,
        'confirm response must expose the newly minted content package id'
      ).toBeTruthy();
      expect(
        newWorkId,
        'confirm response must expose the new derived work id'
      ).toBeTruthy();
      // Production always mints a new package id; the source package stays
      // revision-pinned read-only (submission-coordinator + source-content-package-resolver).
      expect(
        packageIdsBefore.has(newPackageId!),
        'derived package id must be newly minted, not the parent note package'
      ).toBe(false);

      // Harness active-task list excludes package_delivered runs — assert before
      // waiting for worker delivery, or this becomes a guaranteed false negative.
      await expect
        .poll(
          async () => {
            const tasks = await listActiveHarnessTasks(page);
            return tasks.some((task) => task.taskId === newTaskId);
          },
          {
            message:
              'confirm must surface the derived task on GET /api/core/p1/harness/tasks before delivery completes',
            timeout: 30_000,
          }
        )
        .toBe(true);

      await expect(
        targetRow,
        'accepted regenerate marks the page generating in the timeline'
      ).toHaveAttribute('data-image-status', 'generating', { timeout: 15_000 });
      await expect(
        targetRow.getByTestId('note-plan-page-image-status')
      ).toHaveText('配图中');
      // Button stays mounted but disabled while generating / waiting.
      await expect(
        targetRow.getByTestId('note-plan-page-regenerate')
      ).toBeDisabled();
      await expect(
        targetRow.getByTestId('note-plan-page-regenerate')
      ).toHaveText(/重生中…|等待确认…/u);

      // Wait for worker delivery of the *specific* minted package — not "any new
      // id appears" (confirm inserts a draft shell with revision 0 / empty
      // versions immediately; that is not page-regeneration completion).
      let deliveredPackage: ContentPackageListItem | undefined;
      await expect
        .poll(
          async () => {
            const packages = await listContentPackages(page);
            const pkg = packages.find((item) => item.id === newPackageId);
            deliveredPackage = pkg;
            return Boolean(
              pkg &&
                (pkg.revision ?? 0) >= 1 &&
                typeof pkg.currentVersionId === 'string' &&
                pkg.currentVersionId.length > 0
            );
          },
          {
            message:
              'worker must deliver the derived package to revision>=1 with a currentVersionId',
            timeout: 120_000,
          }
        )
        .toBe(true);

      expect(
        deliveredPackage,
        'delivered package snapshot must be captured after poll'
      ).toBeTruthy();
      const lineageSource = deliveredPackage!.lineage?.reusedFromPackageId;
      expect(
        lineageSource,
        'derived package lineage.reusedFromPackageId must point at a parent package'
      ).toBeTruthy();
      expect(
        packageIdsBefore.has(lineageSource!),
        'lineage must reuse one of the merchant packages that existed before regenerate'
      ).toBe(true);

      const versions = deliveredPackage!.versions ?? [];
      const currentVersion =
        versions.find(
          (version) => version.id === deliveredPackage!.currentVersionId
        ) ?? null;
      const receiptOn = (
        version: (typeof versions)[number] | null | undefined
      ) =>
        (version?.note?.regenerationReceipts ?? []).find(
          (receipt) =>
            receipt.pageId === pageId &&
            typeof receipt.fromRevision === 'number' &&
            receipt.toRevision === (receipt.fromRevision as number) + 1 &&
            receipt.imagePoints === 1
        );
      const pageReceipt =
        receiptOn(currentVersion) ??
        versions.map((version) => receiptOn(version)).find(Boolean);
      expect(
        pageReceipt,
        `some version must carry a regeneration receipt for page ${pageId} with toRevision=fromRevision+1 and imagePoints=1`
      ).toBeTruthy();
    }
  );

  /**
   * #333 AC ③ — honest failure when the canonical package / workId cannot be
   * read for the page the merchant asked to regenerate.
   *
   * No fault injection. On the current build this is the *only* reachable
   * outcome of the control: a delivered note renders an enabled
   * 「重新生成此页配图」 button, every server-side precondition is satisfiable
   * (session task carries workId + packageId, and operations.content_packages
   * returns that exact package at revision 1 / review_ready / currentVersionId
   * set / creationExecutionSnapshot present), yet the click is rejected client
   * side by composer-home.tsx:2710-2719 because notePlanCanonicalPackageRef is
   * never populated.
   *
   * An earlier draft of this case injected a stripped
   * `source.creationExecutionSnapshot` to force the failure. That injection was
   * removed deliberately: the identical copy appears without it, so the strip
   * proved nothing and the assertion would have been green for the wrong
   * reason. What is asserted here is the unmodified production behaviour —
   * honest merchant copy, and provably zero half-built state.
   */
  test('regenerate on a delivered note fails honestly and builds nothing', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const commands: string[] = [];
    const trackCommands = (req: Request) => {
      if (isP1CommandRequest(req, 'result_adjust_prepare')) {
        commands.push('result_adjust_prepare');
      }
      if (isP1CommandRequest(req, 'result_adjust')) {
        commands.push('result_adjust');
      }
    };

    const { readyRow } = await deliverNoteOnComposerHome(page, request);
    const pageId = await readyRow.getAttribute('data-page-id');
    expect(pageId, 'ready row must carry a stable data-page-id').toBeTruthy();

    const packagesBefore = await listContentPackages(page);
    const packageIdsBefore = packagesBefore
      .map((item) => item.id)
      .filter(Boolean)
      .sort();

    page.on('request', trackCommands);
    try {
      await readyRow.getByTestId('note-plan-page-regenerate').click();

      // Honest, merchant-readable, and specific about what to do next.
      await expect(
        readyRow.getByRole('alert'),
        'merchant must get the hydration failure copy, not a silent no-op'
      ).toHaveText(HYDRATION_FAIL_COPY, { timeout: 30_000 });

      // Not the prepare-layer copy: the two failures are different products of
      // different layers and must not be conflated.
      await expect(page.getByText(PREPARE_FAIL_COPY)).toHaveCount(0);

      // Zero half-built state: no command left the browser at all, so there is
      // nothing to reconcile server side.
      expect(
        commands,
        'a failed hydration must not emit prepare or confirm'
      ).toEqual([]);
      await expect(
        page.getByTestId('execution-confirm-card'),
        'no execution confirm card may open'
      ).toHaveCount(0);
      await expect(
        page.getByTestId('execution-confirm-slot'),
        'no execution confirm slot may mount'
      ).toHaveCount(0);

      // The page itself is untouched and the control stays retryable.
      await expect(
        readyRow,
        'target page must stay ready — never a half-built generating state'
      ).toHaveAttribute('data-image-status', 'ready');
      await expect(
        readyRow.getByTestId('note-plan-page-image-status')
      ).toHaveText('已配图');
      await expect(
        readyRow.getByTestId('note-plan-page-regenerate')
      ).toBeEnabled();
      await expect(
        readyRow.getByTestId('note-plan-page-regenerate')
      ).toHaveText('重新生成此页配图');

      const packagesAfter = await listContentPackages(page);
      expect(
        packagesAfter
          .map((item) => item.id)
          .filter(Boolean)
          .sort(),
        'a failed regenerate must not create any derived content package'
      ).toEqual(packageIdsBefore);
    } finally {
      page.off('request', trackCommands);
    }
  });
});
