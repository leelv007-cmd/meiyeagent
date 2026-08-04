/**
 * #333 / xcheck A6 — Note page regeneration browser journey proof.
 *
 * Journey:
 *   register → seed store → submit 小红书图文 (fixture)
 *   → direction + execution confirm → delivered on ComposerHome
 *   → note-plan timeline hydrate → 单页重生
 *     ① stale OCC prepare rejected (honest copy, zero half-built)
 *     ② unroute → successful prepare + confirm (OCC only on prepare)
 *     ③ (separate case) hydration gap: package without snapshot → honest copy
 *
 * Why a dedicated file: production chain for per-page regenerate is already
 * closed; this file is pure browser proof with zero backend/src changes.
 * Forks the cheap delivered-note prelude from xhs-image-text-main-journey.
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

const PREPARE_FAIL_COPY =
  '暂时无法准备本页重生成，尚未使用图片额度。请重试。';
const HYDRATION_FAIL_COPY =
  '暂时无法读取当前图文版本，请刷新后重试。';

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
    .poll(
      async () => rows.count(),
      {
        message: 'note plan should list multiple pages after fixture delivery',
        timeout: 30_000,
      }
    )
    .toBeGreaterThan(0);
  // Prefer a ready page so regenerate control is enabled.
  const readyRow = page.locator(
    '[data-testid="note-plan-page-row"][data-image-status="ready"]'
  ).first();
  await expect(
    readyRow,
    'at least one page must be image-ready before regenerate'
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    readyRow.getByTestId('note-plan-page-regenerate'),
    'regenerate control is delivered-only and requires a ready page image'
  ).toBeVisible();
  await expect(
    readyRow.getByTestId('note-plan-page-regenerate')
  ).toBeEnabled();
  await expect(
    readyRow.getByTestId('note-plan-page-regenerate')
  ).toHaveText('重新生成此页配图');
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

  test('stale OCC prepare is rejected then successful page regen reaches new task/package', async ({
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
        packagesAfterStale.map((item) => item.id).filter(Boolean).sort(),
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
    const prepareRequest = prepareResponse.request().postDataJSON() as P1CommandBody;
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
    const confirmRequest = confirmResponse.request().postDataJSON() as P1CommandBody;
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
    expect(newTaskId, 'confirm response must expose the new derived task id').toBeTruthy();
    expect(
      newPackageId,
      'confirm response must expose the newly minted content package id'
    ).toBeTruthy();
    expect(newWorkId, 'confirm response must expose the new derived work id').toBeTruthy();
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
      versions.find((version) => version.id === deliveredPackage!.currentVersionId) ??
      null;
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

  test('package without creationExecutionSnapshot shows honest prepare failure and emits no prepare', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    /**
     * Preferred path for negative ② (ticket 4.3):
     * Return a package that still has note.plan.pages (timeline mounts + button
     * visible) but strips source.creationExecutionSnapshot so client-side
     * resultAdjustSourceForResult fails before result_adjust_prepare is sent.
     *
     * Observed product shape: the catch in composer-home prepare collapses this
     * into copy (a) PREPARE_FAIL_COPY, not hydration copy (b). Documented as G2
     * / product gap — we assert the real honest surface, not the ideal (b).
     */
    let stripActive = false;
    const stripSnapshot = async (route: Route) => {
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
        !stripActive ||
        body?.module !== 'operations' ||
        body.action !== 'content_packages'
      ) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const envelope = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
      };
      if (!Array.isArray(envelope.data)) {
        await route.fulfill({ response });
        return;
      }
      const data = envelope.data.map((pkg) => {
        const source = pkg.source;
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
          return pkg;
        }
        const nextSource = { ...(source as Record<string, unknown>) };
        delete nextSource.creationExecutionSnapshot;
        return { ...pkg, source: nextSource };
      });
      await route.fulfill({
        json: { ...envelope, data },
        response,
      });
    };

    await page.route('**/api/core/p1/query', stripSnapshot);
    try {
      // Deliver first with real packages so the timeline + button can mount,
      // then flip the strip so the next content_packages read (and the ref
      // already set from first hydrate) — we need the ref to hold stripped
      // data. The ref is set once from first successful hydrate. To force a
      // stripped canonical package into the ref we must strip during the
      // initial hydrate instead.
      stripActive = true;

      const merchant = await registerE2EUser(request);
      await loginByForm(page, merchant);
      await seedConfirmedStore(page);
      await page.goto('/dashboard');
      await seedComposerInlineAuthorize(page, {
        fileName: 'note-page-regen-hydrate-gap.png',
      });
      await submitComposerJourney(
        page,
        imageTextContract,
        '把本店皮肤护理案例做成小红书图文笔记',
        { openResult: false }
      );

      await expect(
        page.getByTestId('composer-note-plan-turn'),
        'timeline still mounts when pages exist even if snapshot is stripped'
      ).toBeVisible({ timeout: 60_000 });

      const readyRow = page
        .locator(
          '[data-testid="note-plan-page-row"][data-image-status="ready"]'
        )
        .first();
      await expect(readyRow).toBeVisible({ timeout: 60_000 });
      const regenerate = readyRow.getByTestId('note-plan-page-regenerate');
      await expect(regenerate).toBeVisible();
      await expect(regenerate).toBeEnabled();

      // Read real package ids with strip off so the zero-side-effect check is honest.
      stripActive = false;
      const packagesBeforeReal = await listContentPackages(page);
      stripActive = true;

      const prepareRequests: string[] = [];
      const trackPrepare = (req: Request) => {
        if (isP1CommandRequest(req, 'result_adjust_prepare')) {
          prepareRequests.push('result_adjust_prepare');
        }
        if (isP1CommandRequest(req, 'result_adjust')) {
          prepareRequests.push('result_adjust');
        }
      };
      page.on('request', trackPrepare);

      await regenerate.click();

      // Client fails inside prepareComposerNotePlanPageRegeneration after the
      // workbench query; message is (a) because catch swallows the reason.
      await expect(
        readyRow.getByRole('alert'),
        'missing snapshot collapses to prepare-failure copy (a), not hydration (b) — see G2'
      ).toHaveText(PREPARE_FAIL_COPY, { timeout: 30_000 });
      // Prove we did not get the ideal hydration copy either as a false positive.
      await expect(page.getByText(HYDRATION_FAIL_COPY)).toHaveCount(0);

      expect(
        prepareRequests,
        'no result_adjust_prepare / result_adjust must leave the browser when snapshot is missing'
      ).toEqual([]);
      await expect(page.getByTestId('execution-confirm-card')).toHaveCount(0);
      await expect(
        readyRow,
        'image status must remain ready with zero half-built work'
      ).toHaveAttribute('data-image-status', 'ready');
      await expect(regenerate).toBeEnabled();
      await expect(regenerate).toHaveText('重新生成此页配图');

      stripActive = false;
      const packagesAfter = await listContentPackages(page);
      expect(
        packagesAfter.map((item) => item.id).filter(Boolean).sort(),
        'hydration-gap click must not create derived packages'
      ).toEqual(
        packagesBeforeReal.map((item) => item.id).filter(Boolean).sort()
      );

      page.off('request', trackPrepare);
    } finally {
      await page.unroute('**/api/core/p1/query', stripSnapshot);
    }
  });
});
