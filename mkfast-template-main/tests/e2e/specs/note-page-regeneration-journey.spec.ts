/**
 * #333 / xcheck A6 — Note page regeneration browser journey proof.
 * #338 — the regression gate this file was written to become.
 *
 * Prelude (shared by both cases), forked from xhs-image-text-main-journey:
 *   register → seed store → submit 小红书图文 (fixture) → direction +
 *   execution confirm → delivered, staying on ComposerHome so the note-plan
 *   timeline (where per-page regenerate lives) is the surface under test.
 *
 * HISTORY — read before editing either case.
 *
 * #333 wrote this file on the premise that the per-page regeneration chain was
 * closed and only needed a browser to witness it. The browser said otherwise:
 * the control rendered enabled on a delivered note but clicking it never
 * emitted `result_adjust_prepare`, because `notePlanCanonicalPackageRef` was
 * never populated. #338 found why. Every `operations.content_packages`
 * response was being rejected client side — the server's list projection puts a
 * derived `statusGroup` key on each package, and the strict contract schema the
 * transport had just started enforcing counted it as an unrecognised key. The
 * hydrate's empty `.catch` swallowed the rejection, so nothing anywhere said so
 * while the timeline kept rendering from the SSE projection (a different path).
 *
 * The journey is live again below, in three cases:
 *   1. a stale OCC token is rejected at prepare and derives nothing, then a
 *      confirmed regeneration mints its package, surfaces its derived task and
 *      starts the derived run — green, and the gate that fails first if the
 *      hydrate breaks again;
 *   2. what that derived run delivers — parked on #341, see its own note;
 *   3. when the hydrate genuinely cannot read the package, the merchant is told
 *      so on the timeline (the failure that hid for #333 can no longer be
 *      silent) and nothing half-built is produced.
 *
 * Case 3 needs fault injection now that hydration works; that injection is the
 * only route() in this file that touches the query channel, and it is torn down
 * before anything is measured through it.
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

const PREPARE_FAIL_COPY = '暂时无法准备本页重生成，尚未消耗积分。请重试。';
const HYDRATION_FAIL_COPY = '暂时无法读取当前图文版本，请刷新后重试。';
/** #338: what the timeline says on its own when the hydrate could not read the package. */
const HYDRATION_UNAVAILABLE_COPY =
  '本页配图暂不可重新生成：图文版本未能读取，请刷新后重试。';

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

  // #338 un-parked this: it was `test.fixme` for as long as the canonical
  // package ref never hydrated. Both halves depend on `result_adjust_prepare`
  // actually leaving the browser, so this is the gate that fails first if the
  // hydrate breaks again.
  test('stale OCC prepare is rejected then a confirmed page regen starts its derived run', async ({
    page,
    request,
  }) => {
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
    // The converse of AC ③, asserted here rather than earlier on purpose: a
    // prepare that reached the server proves the canonical package hydrated, so
    // by this line the honest signal has had its chance and must have stayed
    // silent. Asserted right after delivery it would pass on timing alone —
    // the #338 anti-fake run showed it green against a build with the hydrate
    // still broken, because the rejection had not landed yet.
    await expect(
      page.getByTestId('note-plan-hydration-error'),
      'a hydrate that demonstrably worked must not announce a failure'
    ).toHaveCount(0);
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
    // #338 corrected this. The parked draft expected a mounted-but-disabled
    // '重生中…' button and had never been executed: confirm rebinds the composer
    // to the derived task (bindComposerTask → phase 'running'), and
    // composer-conversation.tsx:676 passes `onRegeneratePage` only while the
    // phase is 'delivered'. The disabled labels belong to the window before
    // confirm; after it the control is withdrawn, by the same delivered-only
    // rule the running-phase interaction test pins. Either way the point holds:
    // no second regeneration can start on a page already 配图中.
    await expect(
      targetRow.getByTestId('note-plan-page-regenerate'),
      'regenerate is delivered-only, so the derived run withdraws it rather than disabling it'
    ).toHaveCount(0);

    // A page regeneration is confirmed twice, and #338 found this the hard way:
    // the DBOS trace of the derived run sat in PENDING at
    // `persist-pending-execution-confirmation` through a recv/sleep loop with 27
    // steps recorded and no 28th, while its package stayed revision 0 / draft.
    // The first confirm is the client-side cost preflight that emits
    // result_adjust; the derived run then raises its own in-stream
    // execution_confirm interrupt, exactly as D-164③ makes every paid
    // image_text generation do (ui-journey.ts answers the same card on the
    // first pass). Nothing is generated until a merchant answers this one.
    const derivedConfirmation = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(
      derivedConfirmation,
      'the derived run must raise its own paid-generation confirmation'
    ).toBeVisible({ timeout: 60_000 });
    await derivedConfirmation.getByRole('button', { name: '确认执行' }).click();
    await expect(derivedConfirmation).toBeHidden({ timeout: 60_000 });
  });

  /**
   * #341 — what the derived run does *after* a merchant confirms it.
   *
   * Split out of the case above rather than truncating it, because everything
   * up to the confirmation is a live gate in its own right. This half was
   * parked until #341: a single-page regeneration generates one image and
   * *inherits* the other pages' images from the parent, and the live-rights
   * exemption in `assertLiveDeliveredAssetRights` only covered this write's own
   * generation set — so inherited platform images were checked as if they were
   * merchant uploads, the rights resolver did not know them, and the delivery
   * was refused with CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE / 409 (DBOS
   * status ERROR, package left at revision 0 / draft).
   *
   * Witnesses #341 AC ③ and #333 AC ①. Assertions are the #333 originals,
   * unweakened.
   */
  test('the derived run delivers a regenerated page with its receipt', async ({
    page,
    request,
  }) => {
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

    const prepareResponsePromise = page.waitForResponse(
      (response) => isP1Command(response, 'result_adjust_prepare'),
      { timeout: 60_000 }
    );
    await targetRow.getByTestId('note-plan-page-regenerate').click();
    const prepareResponse = await prepareResponsePromise;
    expect(
      prepareResponse.ok(),
      `prepare must succeed; body=${await prepareResponse.text()}`
    ).toBeTruthy();

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
    const newPackageId = (
      JSON.parse(confirmBodyText) as {
        data?: { contentPackage?: { id?: string } };
      }
    ).data?.contentPackage?.id;
    expect(
      newPackageId,
      'confirm response must expose the newly minted content package id'
    ).toBeTruthy();

    // The derived run is a paid generation like any other (D-164③).
    const derivedConfirmation = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(derivedConfirmation).toBeVisible({ timeout: 60_000 });
    await derivedConfirmation.getByRole('button', { name: '确认执行' }).click();
    await expect(derivedConfirmation).toBeHidden({ timeout: 60_000 });

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
    const receiptOn = (version: (typeof versions)[number] | null | undefined) =>
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
  });

  /**
   * #333 AC ③ / #338 — the hydrate can still fail (the server can be down, the
   * package can be unreadable), and when it does the merchant must be told and
   * nothing may be half-built.
   *
   * Before #338 this case needed no injection: hydration failed on every run,
   * and the only thing the merchant ever saw was the click-time copy. That is
   * exactly what made the defect survive — a permanently broken control looked
   * like a designed failure mode. So this case now (a) forces the failure
   * instead of relying on it, and (b) asserts the timeline says so *before*
   * anyone clicks, which is the assertion whose absence hid #338.
   *
   * The injection fails only `operations.content_packages`, and only until the
   * signal has been read; the package-count assertion below runs against the
   * untouched channel.
   */
  test('an unreadable package is announced on the timeline and builds nothing', async ({
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

    // Armed for the whole delivery so the hydrate — which fires the moment the
    // run reaches delivered — is the thing that fails.
    let refuseContentPackages = true;
    const refuseHydration = async (route: Route) => {
      const req = route.request();
      let body: P1CommandBody | null = null;
      try {
        body = req.postDataJSON() as P1CommandBody;
      } catch {
        await route.continue();
        return;
      }
      if (
        !refuseContentPackages ||
        body?.module !== 'operations' ||
        body.action !== 'content_packages'
      ) {
        await route.continue();
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: 'CONTENT_PACKAGE_DELIVERY_UNAVAILABLE',
            message:
              'Injected by #338 AC ③: ContentPackage read is unavailable.',
          },
          meta: { correlationId: 'e2e-338-ac3' },
        }),
        contentType: 'application/json',
        status: 503,
      });
    };
    await page.route('**/api/core/p1/query', refuseHydration);

    try {
      const { readyRow } = await deliverNoteOnComposerHome(page, request);
      const pageId = await readyRow.getAttribute('data-page-id');
      expect(pageId, 'ready row must carry a stable data-page-id').toBeTruthy();

      // The assertion whose absence let #338 hide: a hydrate that cannot read
      // the package says so on the surface that owns the control, unprompted.
      const hydrationAlert = page.getByTestId('note-plan-hydration-error');
      await expect(
        hydrationAlert,
        'a failed hydrate must announce itself on the note-plan frame, not wait to be clicked'
      ).toBeVisible({ timeout: 60_000 });
      await expect(hydrationAlert).toHaveText(HYDRATION_UNAVAILABLE_COPY);
      expect(
        await hydrationAlert.getAttribute('data-reason'),
        'the cause must stay on the page for whoever diagnoses the next one'
      ).toBeTruthy();

      // Injection off from here: the hydrate has already failed and its effect
      // does not re-run, so the control stays inert while every measurement
      // below reads the real channel rather than a stub.
      refuseContentPackages = false;
      const packagesBefore = await listContentPackages(page);
      const packageIdsBefore = packagesBefore
        .map((item) => item.id)
        .filter(Boolean)
        .sort();

      page.on('request', trackCommands);

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
      refuseContentPackages = false;
      page.off('request', trackCommands);
      await page.unroute('**/api/core/p1/query', refuseHydration);
    }
  });
});
