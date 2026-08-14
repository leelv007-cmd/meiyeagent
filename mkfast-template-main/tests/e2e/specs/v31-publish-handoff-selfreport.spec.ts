/**
 * V31-17 Publish Handoff + self-report journey (§37.4-K; write-only, master
 * runs with lane ports).
 *
 * Covers V3.1 §6.2–§6.3 / §37.4-K exit gates from ticket V31-17:
 * - Delivered → handoff materials (copy blocks / deterministic ZIP / QR)
 * - QR = MobilePublishHandoff merchant self-publish; driven publish rejected (A19)
 * - capability three-state honesty (no fake direct publish)
 * - 「我已发布」binds exact ContentPackage version (OCC revision)
 * - self-report frequency honesty: same-day skip (server clock; the ask
 *   window is a durable publish fact, not a client timestamp) /
 *   once-per-work / two-ignore store backoff. Next-day chips live in
 *   Core `publish-handoff.test.ts` (clock moved there).
 *
 * The Delivered ContentPackage is created by the real Composer fixture journey
 * (image_text contract → real Web → Core → Harness chain, only the model
 * boundary is fixture mode). No conditional assertions: the handoff panel is
 * anchored on the delivered package, so `if (isVisible)` empty runs are
 * impossible here. Real browser run is owned by the merge controller.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { attachComposerSourceViaLibrary } from '../fixtures/library-source';
import {
  seedConfirmedStore,
} from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  submitComposerJourney,
} from '../fixtures/ui-journey';

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;

type ContentPackagesEntry = {
  currentVersionId: string | null;
  id: string;
  revision: number;
  status: string;
  variants: Array<{
    currentVersionId: string;
    platform: string;
  }>;
};

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return page.evaluate(
    async ({ queryAction, queryModule, queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: queryModule,
          payload: queryPayload,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ??
            `${queryModule}.${queryAction} query failed`
        );
      }
      return envelope.data as T;
    },
    { queryAction: action, queryModule: module, queryPayload: payload }
  );
}

async function p1Command<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) {
  return page.evaluate(
    async ({ cmdAction, cmdModule, cmdPayload, key }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: cmdAction,
          module: cmdModule,
          payload: cmdPayload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { code?: string; message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ?? `${cmdModule}.${cmdAction} command failed`
        );
      }
      return envelope.data as T;
    },
    {
      cmdAction: action,
      cmdModule: module,
      cmdPayload: payload,
      key: idempotencyKey,
    }
  );
}

async function p1CommandExpectError(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) {
  return page.evaluate(
    async ({ cmdAction, cmdModule, cmdPayload, key }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: cmdAction,
          module: cmdModule,
          payload: cmdPayload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      return {
        code: envelope.error?.code ?? '',
        message: envelope.error?.message ?? '',
        status: response.status,
      };
    },
    {
      cmdAction: action,
      cmdModule: module,
      cmdPayload: payload,
      key: idempotencyKey,
    }
  );
}

/**
 * Deliver a real ContentPackage through the Composer fixture journey and stay
 * on the conversation (ADR-0014) so the Thread-root workbench hydrates the
 * publish handoff panel in the delivered phase.
 *
 * V31-54: image_text recipes require a `case_image` workspace source. Seed via
 * the real composer inline-authorize path before submit — do not relax the
 * submission-gate slot check.
 */
async function deliverViaComposer(
  page: Page,
  intent: string
): Promise<{ packageId: string; workId: string }> {
  await attachComposerSourceViaLibrary(page, {
    fileName: `v31-k-handoff-${crypto.randomUUID()}.png`,
  });
  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  const workId = await submitComposerJourney(page, imageTextContract, intent, {
    openResult: false,
  });
  const submissionResponse = await submissionResponsePromise;
  const submissionBody = JSON.parse(await submissionResponse.text()) as {
    data?: { contentPackage?: { id?: string } };
  };
  const packageId = submissionBody.data?.contentPackage?.id ?? '';
  expect(packageId).toBeTruthy();
  return { packageId, workId };
}

async function deliveredPackage(page: Page, packageId: string) {
  const packages = await p1Query<ContentPackagesEntry[]>(
    page,
    'operations',
    'content_packages',
    {}
  );
  const matched = packages.find((entry) => entry.id === packageId);
  expect(matched, 'the submitted ContentPackage must be listed').toBeTruthy();
  const variantVersionId =
    matched!.variants.find((row) => row.platform === 'xiaohongshu')
      ?.currentVersionId ?? matched!.currentVersionId;
  expect(
    variantVersionId,
    'the delivered package must expose a xiaohongshu variant version'
  ).toBeTruthy();
  return {
    ...matched!,
    variantVersionId: variantVersionId!,
  };
}

test.describe('V31-17 publish handoff + self-report journey', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('Delivered handoff anchors: copy blocks, ZIP name, QR merchant-self, no direct publish', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const { packageId } = await deliverViaComposer(
      page,
      '把本店透亮猫眼项目做成小红书图文笔记'
    );

    await expect(page.getByTestId('agent-workbench-host')).toBeVisible({
      timeout: 30_000,
    });

    // The panel must anchor on the real delivered package — this is the
    // unconditional §37.4-K assertion the old if(isVisible) guard skipped.
    const panel = page.getByTestId('publish-handoff-panel');
    await expect(panel, 'handoff panel must anchor after delivery').toBeVisible(
      { timeout: 90_000 }
    );
    await expect(panel).toHaveAttribute('data-show-direct-publish', 'false');
    await expect(
      page.getByTestId('publish-handoff-no-direct-publish')
    ).toBeVisible();
    await expect(page.getByTestId('publish-handoff-copy-blocks')).toBeVisible();
    await expect(
      page.getByTestId('publish-handoff-copy-block').first()
    ).toBeVisible();
    const copyBlockCount = await page
      .getByTestId('publish-handoff-copy-block')
      .count();
    expect(
      copyBlockCount,
      'handoff copy blocks must cover title/body/topics/CTA'
    ).toBeGreaterThanOrEqual(3);

    // Deterministic ZIP name is projected (revision + store + platform).
    await expect(page.getByTestId('publish-handoff-zip')).toBeVisible();
    await expect(page.getByTestId('publish-handoff-zip-name')).toHaveText(/\S/);

    // MobilePublishHandoff: merchant self-publish only.
    const mobile = page.getByTestId('mobile-publish-handoff');
    await expect(mobile).toBeVisible();
    await expect(mobile).toHaveAttribute('data-system-driven-allowed', 'false');
    await expect(mobile).toHaveAttribute(
      'data-publish-actor',
      'merchant_self_publish'
    );

    // A19 fail-closed seam: the attempt control is sr-only (never a merchant
    // CTA). Playwright's pointer click misses it; dispatch the DOM click.
    // Server-side A19 reject is the next test.
    await page
      .getByTestId('mobile-publish-handoff-driven-attempt')
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(
      page.getByTestId('mobile-publish-handoff-driven-reject')
    ).toBeVisible({ timeout: 10_000 });

    // 「我已发布」 binds the exact package revision.
    const bindingRevision = await page
      .getByTestId('publish-handoff-i-published')
      .getAttribute('data-binding-revision');
    expect(bindingRevision).toMatch(/^\d+$/u);
    const delivered = await deliveredPackage(page, packageId);
    expect(Number(bindingRevision)).toBe(delivered.revision);

    // Same-day「我已发布」 is recorded and the panel stays honest: the
    // next-day self-report ask is skipped (not_yet_next_day) — no fabricated
    // chips strip on the same day.
    await page.getByTestId('publish-handoff-confirm-published').click();
    await expect(page.getByTestId('publish-handoff-message')).toContainText(
      '已记录发布',
      { timeout: 30_000 }
    );
    await expect(page.getByTestId('self-report-journey')).toHaveCount(0);
  });

  test('A19 attempt_publish_from_handoff rejects driven intents via P1', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const rejection = await p1CommandExpectError(
      page,
      'operations',
      'attempt_publish_from_handoff',
      {
        handoffToken: 'e2e-token',
        intent: 'system_driven_publish',
      },
      `a19-reject-${Date.now()}`
    );

    expect(rejection.status).toBe(403);
    expect(rejection.code).toBe('DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED');
  });

  test('self-report journey: next-day chips, once-per-work, two-ignore backoff', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const { packageId, workId } = await deliverViaComposer(
      page,
      '把本店透亮猫眼项目做成小红书图文笔记'
    );
    const initial = await deliveredPackage(page, packageId);

    // Merchant publishes through the same service the「我已发布」button calls.
    await p1Command(
      page,
      'operations',
      'record_merchant_published',
      {
        packageId,
        expectedRevision: initial.revision,
        platform: 'xiaohongshu',
        variantVersionId: initial.variantVersionId,
        workId,
      },
      `merchant-published:${packageId}:${Date.now()}`
    );
    const published = await deliveredPackage(page, packageId);
    const askQuery = {
      workId,
      contentPackageId: packageId,
      platform: 'xiaohongshu',
      variantVersionId: published.variantVersionId,
    };

    // Frequency honesty: same calendar day never asks. The ask window is
    // resolved from the durable publish event + server clock — a client
    // cannot smuggle publishHandoffCompletedAt to fabricate next-day chips.
    const sameDay = await p1Query<{ kind: string; reason?: string }>(
      page,
      'operations',
      'self_report_ask',
      askQuery
    );
    expect(sameDay.kind).toBe('skip');
    expect(sameDay.reason).toBe('not_yet_next_day');

    // Once-per-work (U2 maxAsksPerWork=1): the second ask is a conflict.
    const askOne = await p1Command<{ askId: string }>(
      page,
      'operations',
      'record_self_report_ask',
      {
        workId,
        contentPackageId: packageId,
        contentPackageRevision: published.revision,
        action: 'mark_asked',
      },
      `self-report-ask:${workId}:${Date.now()}`
    );
    expect(askOne.askId.length).toBeGreaterThan(0);
    const secondAsk = await p1CommandExpectError(
      page,
      'operations',
      'record_self_report_ask',
      {
        workId,
        contentPackageId: packageId,
        contentPackageRevision: published.revision,
        action: 'mark_asked',
      },
      `self-report-ask-2:${workId}:${Date.now()}`
    );
    expect(secondAsk.status).toBe(409);
    expect(secondAsk.code).toBe('SELF_REPORT_ASK_CONFLICT');

    // OutcomeEvidence write path (V31-19): chip answer lands as a
    // merchant_recorded result signal and answers the ask.
    await p1Command(
      page,
      'operations',
      'record_content_package_result_signal',
      {
        packageId,
        expectedRevision: published.revision,
        kind: 'inquiry',
        sourceRef: `chip:inquiry:${Date.now()}`,
        workId,
      },
      `self-report-signal:${packageId}:${Date.now()}`
    );
    // Same two-step write as usePublishHandoff: signal then mark_answered.
    await p1Command(
      page,
      'operations',
      'record_self_report_ask',
      {
        workId,
        contentPackageId: packageId,
        contentPackageRevision: published.revision,
        action: 'mark_answered',
        askId: askOne.askId,
      },
      `self-report-answered:${workId}:${Date.now()}`
    );
    const results = await p1Query<{
      signals: {
        merchant: Array<{ kind: string; source: string }>;
      };
    }>(page, 'operations', 'content_package_results', { packageId });
    expect(
      results.signals.merchant.some(
        (signal) =>
          signal.kind === 'inquiry' && signal.source === 'merchant_recorded'
      )
    ).toBe(true);

    // After an answer the work is never asked again.
    const answered = await p1Query<{ kind: string; reason?: string }>(
      page,
      'operations',
      'self_report_ask',
      askQuery
    );
    expect(answered.kind).toBe('skip');
    expect(answered.reason).toBe('already_answered');

    // Two consecutive ignores across works switch the store to backoff
    // (evaluated before the next-day window).
    for (const ignoredWork of [
      `w-ignore-${Date.now()}-1`,
      `w-ignore-${Date.now()}-2`,
    ]) {
      await p1Command(
        page,
        'operations',
        'record_self_report_ask',
        {
          workId: ignoredWork,
          contentPackageId: packageId,
          contentPackageRevision: published.revision,
          action: 'mark_asked',
        },
        `ignore-ask:${ignoredWork}:${Date.now()}`
      );
      await p1Command(
        page,
        'operations',
        'record_self_report_ask',
        {
          workId: ignoredWork,
          contentPackageId: packageId,
          contentPackageRevision: published.revision,
          action: 'mark_ignored',
        },
        `ignore-mark:${ignoredWork}:${Date.now()}`
      );
    }
    const backoff = await p1Query<{ kind: string; reason?: string }>(
      page,
      'operations',
      'self_report_ask',
      askQuery
    );
    expect(backoff.kind).toBe('skip');
    expect(backoff.reason).toBe('store_backoff');
  });
});
