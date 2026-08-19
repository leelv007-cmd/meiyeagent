import {
  DEFAULT_NOTE_STYLES,
  NOTE_PLAN_CONSISTENCY_DIMENSIONS,
} from '@meiye/contracts';
import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { postgresProcessEnv } from '../../../../scripts/dev/postgres-process.mjs';
import { resolve } from 'node:path';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productState,
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  assertZipDownload,
  closeComposerCapsule,
  JOURNEY_CONTRACTS,
  openComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

const IMAGE_TEXT_CONTRACT = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;
const EXPECTED_STAGES = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
] as const;
const STYLE_ANALYSIS_STAGE_MESSAGE =
  '正在分析参考图风格（七维），后续配图会按同一风格保持一致';
const AI_COVER_PRESETS = [
  'beauty_soft',
  'beauty_editorial',
  'before_after',
  'spa_minimal',
  'salon_photo',
] as const;
const AI_COVER_RATIOS = ['3:4', '1:1', '9:16'] as const;

type NotePage = {
  id: string;
  imageAssetId?: string;
  imageIntent: { exactText: Array<{ text: string }> };
  order: number;
  pagePurpose: string;
  pageRole: string;
  revision: number;
  textBlock: { body: string; exactText: string[]; title: string };
};

type ContentPackageProjection = {
  generated: {
    assetIds: string[];
    childRuns: Array<{ productUsage?: { quantity?: number; status?: string } }>;
    ownedAssets: Array<{ id?: string }>;
  };
  harnessSelection?: {
    adoptedCandidateId?: string;
    recommendedCandidateId: string;
  };
  id: string;
  kind: string;
  marketing?: {
    contextBundle?: { bundleId?: string; hash?: string; revision?: number };
    factRefs?: string[];
    promotionOffer?: { callToAction?: { label?: string } };
    rightsRefs?: string[];
  };
  revision: number;
  source: {
    creationExecutionSnapshot?: {
      id: string;
      revision: number;
      schemaVersion: 'creation-execution-snapshot/v1';
      modelSelection?: {
        source:
          | 'current_selection'
          | 'user_default'
          | 'workspace_default'
          | 'platform_default';
        catalogModelId: string;
        platformConfigRevision: string | null;
      };
    };
  };
  status: string;
  variants: Array<{
    currentVersionId?: string;
    platform: string;
    versions: Array<{ id: string; orderedAssetIds: string[] }>;
  }>;
  versions: Array<{
    body?: string;
    conversionHook?: string;
    harnessCandidateId?: string;
    id: string;
    note?: {
      evaluation: {
        dimensions: Array<{ dimension: string; passed: boolean }>;
        regenerationPageIds: string[];
      };
      plan: { pages: NotePage[]; themeAnchor: string };
      regenerationReceipts: Array<{
        imagePoints: number;
        pageId: string;
      }>;
    };
    orderedAssetIds: string[];
    title?: string;
  }>;
};

async function registerTrialNoteUser(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const merchant = await registerE2EUser(request);
  await loginByForm(page, merchant);
  return merchant;
}

async function queryImageModelPreferences(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'preferences',
        module: 'model-supply',
        payload: { operation: 'image.generate' },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: {
        platformDefault?: string;
        platformDefaultRevision?: string;
        provisionedPlatformDefault?: {
          catalogModelId: string;
          configRevision: string;
        };
        workspaceDefault?: string;
      };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Model preferences read failed'
      );
    }
    return envelope.data;
  });
}

async function submitNoteJourney(
  page: Page,
  expected:
    | 'accepted'
    | 'insufficient'
    | 'fresh_insufficient'
    | 'projection_unavailable'
    | 'missing_refund_policy' = 'accepted',
  authorizedAssetId?: string,
  drainWorkspaceId?: string
) {
  let submissionPostCount = 0;
  const countSubmissionPost = (request: Request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/api/core/p1/composer/submissions')
    ) {
      submissionPostCount += 1;
    }
  };
  if (expected !== 'accepted') {
    page.on('request', countSubmissionPost);
  }
  await page.goto('/dashboard');
  if (!authorizedAssetId) {
    await seedConfirmedStore(page);
  }
  await selectComposerLens(page, 'image_text');
  const preferences = await queryImageModelPreferences(page);
  expect(preferences.workspaceDefault).toBeUndefined();
  expect(preferences.provisionedPlatformDefault?.catalogModelId).toBe(
    'nano-banana-2'
  );
  // provision-test-db.sh seeds platform.defaultModel.* through admin-config CAS,
  // so the live revision is admin-config:N — not the runtime-default fallback.
  expect(preferences.provisionedPlatformDefault?.configRevision).toMatch(
    /^admin-config:\d+$/u
  );
  expect(preferences.platformDefault).toBe('nano-banana-2');
  expect(preferences.platformDefaultRevision).toMatch(/^admin-config:\d+$/u);
  const authorized = await seedComposerInlineAuthorize(page, {
    ...(authorizedAssetId ? { expectedAssetId: authorizedAssetId } : {}),
    fileName: 'note-case.png',
  });
  await page.reload();
  await selectComposerLens(page, 'image_text');
  const recipePanel = await openComposerRecipeCard(
    page,
    'composer-recipe-card-recipe.case_to_xhs_note'
  );
  const applyRecipe = page.getByRole('button', {
    name: '套用并更新设置',
  });
  const recipeApplied = page.getByTestId('composer-recipe-apply-undo');
  await expect(recipeApplied.or(applyRecipe)).toBeVisible();
  if (await applyRecipe.isVisible()) await applyRecipe.click();
  await expect(recipeApplied).toBeVisible();
  await closeComposerCapsule(page, recipePanel);
  await seedComposerInlineAuthorize(page, {
    expectedAssetId: authorized.id,
    fileName: 'note-case.png',
  });
  await openComposerCapsule(page, 'attach');
  const styleReference = page.getByTestId(
    `composer-style-reference-${authorized.id}`
  );
  await expect(styleReference).toBeVisible();
  await styleReference.click();
  await expect(styleReference).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('composer-style-analysis-stage')).toHaveText(
    STYLE_ANALYSIS_STAGE_MESSAGE
  );
  await closeComposerCapsule(
    page,
    page.getByTestId('composer-capsule-attach-panel')
  );
  const intent = '把这张美甲案例做成介绍本店夏日护理项目的小红书图文笔记';
  let refundPolicyRemoved = false;
  const removeRefundPolicy = async (route: Route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      action?: string;
      module?: string;
    } | null;
    if (body?.module !== 'product-billing' || body.action !== 'quote') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const envelope = (await response.json()) as {
      data?: Record<string, unknown>;
    };
    if (!envelope.data) {
      await route.fulfill({ response });
      return;
    }
    const quote = { ...envelope.data };
    delete quote.failureRefundsCredits;
    refundPolicyRemoved = true;
    await route.fulfill({
      json: { ...envelope, data: quote },
      response,
    });
  };
  if (expected === 'missing_refund_policy') {
    await page.route('**/api/core/p1/commands', removeRefundPolicy);
  }
  const submit = page.getByTestId('composer-submit');
  await page.getByTestId('composer-intent-input').fill(intent);

  if (expected === 'missing_refund_policy') {
    try {
      await expect(submit).toBeEnabled({ timeout: 30_000 });
      await submit.click();
      await expect(page.getByTestId('composer-intent-error')).toHaveText(
        '积分余额暂时无法确认，请重试。'
      );
      expect(refundPolicyRemoved).toBe(true);
      expect(submissionPostCount).toBe(0);
    } finally {
      await page.unroute('**/api/core/p1/commands', removeRefundPolicy);
      page.off('request', countSubmissionPost);
    }
    return {
      authorizedAssetId: authorized.id,
      errorCode: undefined,
      errorMessage: undefined,
      packageId: '',
      platformDefaultRevision: preferences.platformDefaultRevision ?? '',
      taskId: '',
    };
  }

  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });

  if (expected === 'projection_unavailable') {
    let projectionRequestRejected = false;
    const rejectFreshProjection = async (route: Route) => {
      const body = route.request().postDataJSON() as {
        action?: string;
        module?: string;
      } | null;
      if (body?.module !== 'entitlements' || body.action !== 'projection') {
        await route.continue();
        return;
      }
      projectionRequestRejected = true;
      await route.abort('failed');
    };
    await page.route('**/api/core/p1/query', rejectFreshProjection);
    try {
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page.getByTestId('composer-intent-error')).toHaveText(
        '积分余额暂时无法确认，请重试。'
      );
      expect(projectionRequestRejected).toBe(true);
      expect(submissionPostCount).toBe(0);
    } finally {
      await page.unroute('**/api/core/p1/query', rejectFreshProjection);
      page.off('request', countSubmissionPost);
    }
    return {
      authorizedAssetId: authorized.id,
      errorCode: undefined,
      errorMessage: undefined,
      packageId: '',
      platformDefaultRevision: preferences.platformDefaultRevision ?? '',
      taskId: '',
    };
  }

  if (expected === 'fresh_insufficient') {
    if (!drainWorkspaceId) {
      throw new Error(
        'A merchant workspace is required to drain fixture credits.'
      );
    }
    zeroRemainingCreditsForWorkspace(drainWorkspaceId);
    try {
      await expect(page.getByTestId('composer-submit')).toBeEnabled();
      await page.getByTestId('composer-submit').click();
      const shortfall = page.getByTestId('workbench-credit-shortfall-alert');
      await expect(shortfall).toBeVisible({ timeout: 30_000 });
      await expect(shortfall).toContainText(/还差\s*\d+\s*分/u);
      await expect(page.getByTestId('composer-submit')).toBeDisabled();
      expect(submissionPostCount).toBe(0);
    } finally {
      page.off('request', countSubmissionPost);
    }
    return {
      authorizedAssetId: authorized.id,
      errorCode: undefined,
      errorMessage: undefined,
      packageId: '',
      platformDefaultRevision: preferences.platformDefaultRevision ?? '',
      taskId: '',
    };
  }

  if (expected === 'insufficient') {
    // A known shortfall is blocked before admission. Core remains the reserve
    // authority for stale races, but the client must not submit an unaffordable
    // quote that it already knows cannot be covered.
    try {
      const shortfall = page.getByTestId('workbench-credit-shortfall-alert');
      await expect(shortfall).toBeVisible({ timeout: 30_000 });
      await expect(shortfall).toContainText(/还差\s*\d+\s*分/u);
      await expect(page.getByTestId('composer-submit')).toBeDisabled();
      expect(submissionPostCount).toBe(0);
    } finally {
      page.off('request', countSubmissionPost);
    }
    return {
      authorizedAssetId: authorized.id,
      errorCode: undefined,
      errorMessage: undefined,
      packageId: '',
      platformDefaultRevision: preferences.platformDefaultRevision ?? '',
      taskId: '',
    };
  }

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const response = await responsePromise;
  const submissionBody = response.request().postDataJSON() as {
    catalogModel?: { id?: string };
    sources?: { assets?: Array<{ id?: string; role?: string }> };
  };
  const envelope = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      replayed?: boolean;
      task?: { id?: string };
      work?: { id?: string };
    };
    error?: { code?: string; message?: string };
  };
  expect(submissionBody.catalogModel?.id).toBe('nano-banana-2');
  expect(submissionBody.sources?.assets).toContainEqual(
    expect.objectContaining({ id: authorized.id, role: 'style' })
  );
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.contentPackage?.id).toBeTruthy();
  expect(envelope.data?.replayed).toBe(false);
  expect(envelope.data?.task?.id).toBeTruthy();
  expect(envelope.data?.work?.id).toBeTruthy();
  return {
    authorizedAssetId: authorized.id,
    errorCode: envelope.error?.code,
    errorMessage: envelope.error?.message,
    packageId: envelope.data?.contentPackage?.id ?? '',
    platformDefaultRevision: preferences.platformDefaultRevision ?? '',
    taskId: envelope.data?.task?.id ?? '',
  };
}

async function submitVideoBriefAfterFreshShortfall(
  page: Page,
  workspaceId: string
) {
  let submissionPostCount = 0;
  const countSubmissionPost = (request: Request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/api/core/p1/composer/submissions')
    ) {
      submissionPostCount += 1;
    }
  };
  page.on('request', countSubmissionPost);
  try {
    await page.goto('/dashboard');
    // Same D1=A gate as submitNoteJourney: a customized cold tenant only
    // offers 「先核对信息」 and never POSTs, so Brief never mounts.
    await seedConfirmedStore(page);
    await selectComposerLens(page, 'video');
    const authorized = await seedComposerInlineAuthorize(page, {
      fileName: 'credit-video-reference.png',
    });
    await page.reload();
    await selectComposerLens(page, 'video');
    const recipePanel = await openComposerRecipeCard(
      page,
      'composer-recipe-card-recipe.douyin_project_video'
    );
    const applyRecipe = page.getByRole('button', {
      name: '套用并更新设置',
    });
    const recipeApplied = page.getByTestId('composer-recipe-apply-undo');
    await expect(recipeApplied.or(applyRecipe)).toBeVisible();
    if (await applyRecipe.isVisible()) await applyRecipe.click();
    await closeComposerCapsule(page, recipePanel);
    await seedComposerInlineAuthorize(page, {
      expectedAssetId: authorized.id,
      fileName: 'credit-video-reference.png',
    });
    await page
      .getByTestId('composer-intent-input')
      .fill('把这张夏日护理案例图做成一条可直接发布的抖音项目成片');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('composer-submit')).toBeEnabled();
    await page.getByTestId('composer-submit').click();

    const brief = page.getByTestId('composer-brief-surface');
    await expect(brief).toBeVisible({ timeout: 60_000 });
    const confirm = brief.getByTestId('composer-brief-confirm');
    await expect(confirm).toBeEnabled();
    zeroRemainingCreditsForWorkspace(workspaceId);
    await confirm.click();

    const shortfall = page.getByTestId('workbench-credit-shortfall-alert');
    await expect(shortfall).toBeVisible({ timeout: 30_000 });
    await expect(shortfall).toContainText(/还差\s*\d+\s*分/u);
    expect(submissionPostCount).toBe(0);
  } finally {
    page.off('request', countSubmissionPost);
  }
}

async function collectWorkflowSse(page: Page, taskId: string) {
  return page.evaluate(
    (currentTaskId) =>
      new Promise<{
        progress: Array<{ message?: string; stage: string; state: string }>;
        status: string;
      }>((resolve, reject) => {
        const progress: Array<{
          message?: string;
          stage: string;
          state: string;
        }> = [];
        const stream = new EventSource(
          `/api/core/p1/workflows/${encodeURIComponent(currentTaskId)}/events`
        );
        const timeout = window.setTimeout(() => {
          stream.close();
          reject(new Error('Image-text note workflow did not finish.'));
          // The fixture deliberately holds every structured copy chunk for ten
          // seconds. A complete three-page dual-style note can exceed six
          // minutes before the terminal event without being stalled.
        }, 540_000);
        stream.addEventListener('workflow.progress', (event) => {
          progress.push(
            JSON.parse((event as MessageEvent<string>).data) as {
              message?: string;
              stage: string;
              state: string;
            }
          );
        });
        stream.addEventListener('workflow.state', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as {
            status: string;
          };
          if (data.status === 'success' || data.status === 'failed') {
            window.clearTimeout(timeout);
            stream.close();
            resolve({ progress, status: data.status });
          }
        });
      }),
    taskId
  );
}

async function queryContentPackage(page: Page, packageId: string) {
  return page.evaluate(async (currentPackageId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'content_package',
        module: 'operations',
        payload: { packageId: currentPackageId },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: ContentPackageProjection;
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'ContentPackage read failed');
    }
    return envelope.data;
  }, packageId);
}

async function queryProductUsage(page: Page, taskId: string) {
  return page.evaluate(async (currentTaskId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'get_usage',
        module: 'product-billing',
        payload: { taskId: currentTaskId },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: {
        refundedCredits?: number;
        refundedUnits?: Array<{ quantity: number; resource: string }>;
        reservedCredits?: number;
        reservedUnits?: Array<{ quantity: number; resource: string }>;
        settledCredits?: number;
        settledUnits?: Array<{ quantity: number; resource: string }>;
        status?: string;
      };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Product usage read failed');
    }
    return envelope.data;
  }, taskId);
}

async function queryAvailableCredits(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'projection',
        module: 'entitlements',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: { credits?: { availableCredits?: number } };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data?.credits) {
      throw new Error(
        envelope.error?.message ?? 'Entitlements credits projection failed'
      );
    }
    return Number(envelope.data.credits.availableCredits);
  });
}

/**
 * Credit-era trial grants 100 credits; zero the authenticated merchant's lots
 * so final browser admission reads a real insufficient projection.
 */
function zeroRemainingCreditsForWorkspace(workspaceId: string) {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required to drain trial credits');
  }
  const sql = `
    UPDATE p1_credit_grant_lots
    SET remaining_credits = 0, revision = revision + 1
    WHERE workspace_id = '${workspaceId.replace(/'/g, "''")}'
    AND remaining_credits > 0;
  `;
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
    env: postgresProcessEnv(databaseUrl),
  });
}

async function adoptRecommendedCandidate(
  page: Page,
  contentPackage: ContentPackageProjection
) {
  const candidateId = contentPackage.harnessSelection?.recommendedCandidateId;
  expect(candidateId).toBeTruthy();
  return page.evaluate(
    async ({ currentCandidateId, expectedRevision, packageId }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: 'adopt_harness_candidate',
          module: 'operations',
          payload: {
            candidateId: currentCandidateId,
            expectedRevision,
            packageId,
          },
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `note-adopt:${packageId}:${expectedRevision}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: ContentPackageProjection;
        error?: { message?: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? 'Note adoption failed');
      }
      return envelope.data;
    },
    {
      currentCandidateId: candidateId!,
      expectedRevision: contentPackage.revision,
      packageId: contentPackage.id,
    }
  );
}

async function exportFullPackage(
  page: Page,
  contentPackage: ContentPackageProjection
) {
  const exported = await page.evaluate(
    async ({ expectedRevision, packageId }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: 'result_export',
          module: 'result-delivery',
          payload: {
            expectedRevision,
            packageId,
            platform: 'xiaohongshu',
          },
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `note-export:${packageId}:${expectedRevision}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: { downloadUrl?: string };
        error?: { message?: string };
      };
      if (!response.ok || !envelope.data?.downloadUrl) {
        throw new Error(envelope.error?.message ?? 'Note export failed');
      }
      return envelope.data.downloadUrl;
    },
    {
      expectedRevision: contentPackage.revision,
      packageId: contentPackage.id,
    }
  );
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.evaluate((downloadUrl) => {
    const anchor = document.createElement('a');
    anchor.href = `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}download=1`;
    anchor.download = '';
    anchor.click();
  }, exported);
  return downloadPromise;
}

test.describe
  .serial('T20 ImageTextNote compiler', () => {
    test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
    test.afterAll(async ({ request }) => cleanupE2EUsers(request));

    test('Composer style reference → full note revision → AI-cover prefill', async ({
      page,
      request,
    }) => {
      test.setTimeout(660_000);
      await registerTrialNoteUser(page, request);
      const { workspaceId } = await productState(page);

      const submission = await submitNoteJourney(page);
      const streamPromise = collectWorkflowSse(page, submission.taskId);

      // D-164 / V31-56: paid work remains prepared until the merchant commits
      // the Living Plan. The strip records the confirmation and starts Make;
      // only then can the workflow emit its note_style question.
      const startAction = page.getByTestId('agent-commit-strip-start');
      await expect(startAction).toBeEnabled({ timeout: 90_000 });
      const startResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(
            new URL(response.url()).pathname
          ),
        { timeout: 90_000 }
      );
      await startAction.click();
      expect((await startResponse).ok()).toBeTruthy();

      // The note_style question rides the interaction channel; the retired
      // decision endpoint deliberately returns null for it. Comparison cards
      // render full positioning (writingGuide) so the merchant is not half-blind.
      const comparison = page.getByTestId('ask-merchant-option-comparison');
      await expect(comparison).toBeVisible({ timeout: 90_000 });
      await expect(comparison).toHaveAttribute(
        'data-option-count',
        String(DEFAULT_NOTE_STYLES.styles.length)
      );

      const styleCards = page.getByTestId('ask-merchant-option-card');
      await expect(styleCards).toHaveCount(2);
      await expect(styleCards.nth(0)).toBeVisible();
      await expect(styleCards.nth(1)).toBeVisible();

      const positioningTexts: string[] = [];
      for (const style of DEFAULT_NOTE_STYLES.styles) {
        const card = page.locator(
          `[data-testid="ask-merchant-option-card"][data-option-label="${style.name}"]`
        );
        await expect(card).toBeVisible();
        const positioning = card.getByTestId('ask-merchant-option-positioning');
        await expect(positioning).toHaveText(style.writingGuide);
        positioningTexts.push(await positioning.innerText());
      }
      expect(positioningTexts[0]).not.toBe(positioningTexts[1]);

      await page
        .locator(
          '[data-testid="ask-merchant-option-card"][data-option-label="种草叙事版"]'
        )
        .click();

      const stream = await streamPromise;
      expect(stream.status).toBe('success');
      expect(stream.progress).toContainEqual(
        expect.objectContaining({
          message: STYLE_ANALYSIS_STAGE_MESSAGE,
          stage: 'brief_compilation',
          state: 'running',
        })
      );
      const successfulStages = stream.progress
        .filter(({ state }) => state === 'success')
        .map(({ stage }) => stage);
      const workflowStart = successfulStages.indexOf('intent_naming');
      expect(workflowStart).toBeGreaterThanOrEqual(0);
      // Living Plan commit emits a pre-Make execution_selection event. The
      // workflow's fixed five-stage order begins at its first intent frame.
      expect(
        Array.from(new Set(successfulStages.slice(workflowStart)))
      ).toEqual(EXPECTED_STAGES);
      for (const frame of stream.progress) {
        expect(frame.message).toBeTruthy();
        expect(frame.message).not.toMatch(
          /workspace|provider|workflow|revision|candidate|schema|成本价|毛利/iu
        );
      }

      const contentPackage = await queryContentPackage(
        page,
        submission.packageId
      );
      expect(
        contentPackage.source.creationExecutionSnapshot?.modelSelection
      ).toEqual({
        source: 'platform_default',
        catalogModelId: 'nano-banana-2',
        platformConfigRevision: submission.platformDefaultRevision,
      });
      expect(contentPackage.kind).toBe('image_text');
      expect(contentPackage.versions).toHaveLength(2);
      expect(
        contentPackage.versions.map(
          ({ harnessCandidateId }) => harnessCandidateId
        )
      ).toEqual(['story_recommendation', 'practical_guide']);
      const selected = contentPackage.versions[0];
      expect(selected?.note?.plan.themeAnchor).toContain('小红书图文笔记');
      expect(selected?.note?.plan.pages.length).toBeGreaterThan(1);
      expect(selected?.note?.plan.pages.map(({ order }) => order)).toEqual(
        Array.from(
          { length: selected?.note?.plan.pages.length ?? 0 },
          (_, index) => index + 1
        )
      );
      for (const notePage of selected?.note?.plan.pages ?? []) {
        expect(notePage.pageRole).toBeTruthy();
        expect(notePage.pagePurpose).toBeTruthy();
        expect(notePage.textBlock.title.trim()).toBeTruthy();
        expect(notePage.textBlock.body.trim()).toBeTruthy();
        expect(notePage.imageAssetId).toBeTruthy();
        expect(notePage.imageIntent.exactText.map(({ text }) => text)).toEqual(
          notePage.textBlock.exactText
        );
      }
      expect(selected?.orderedAssetIds).toEqual(
        selected?.note?.plan.pages.map(({ imageAssetId }) => imageAssetId)
      );
      expect(contentPackage.generated.assetIds).toEqual(
        selected?.orderedAssetIds
      );
      expect(contentPackage.generated.ownedAssets).toHaveLength(
        selected?.note?.plan.pages.length ?? 0
      );
      expect(contentPackage.generated.childRuns).toHaveLength(
        selected?.note?.plan.pages.length ?? 0
      );
      // APP_ENV=e2e intentionally exercises the configured deterministic
      // judge, so the delivered package must carry all five passing results.
      expect(
        selected?.note?.evaluation.dimensions.map(({ dimension }) => dimension)
      ).toEqual(NOTE_PLAN_CONSISTENCY_DIMENSIONS);
      expect(
        selected?.note?.evaluation.dimensions.every(({ passed }) => passed)
      ).toBe(true);
      expect(selected?.note?.evaluation.regenerationPageIds).toEqual([]);
      // Credit-era (#298 / D-172): reservation carries credits with empty
      // legacy bucket units. After delivery the reserved credits must commit
      // (not remain reserved). Bucket copy/image units are retired.
      const usage = await queryProductUsage(page, submission.taskId);
      expect(usage).toMatchObject({
        reservedUnits: [],
        settledUnits: [],
        refundedUnits: [],
        status: 'committed',
      });
      expect(
        usage.reservedCredits,
        'credit reservation must freeze a positive credit amount'
      ).toEqual(expect.any(Number));
      expect(usage.reservedCredits!).toBeGreaterThan(0);
      expect(usage.settledCredits).toBe(usage.reservedCredits);
      expect(usage.refundedCredits ?? 0).toBe(0);
      // Merchant-facing credit balance must reflect the committed debit.
      const availableAfterDelivery = await queryAvailableCredits(page);
      expect(availableAfterDelivery).toBeLessThan(100);
      expect(availableAfterDelivery).toBe(
        100 - (usage.settledCredits as number)
      );
      await expect(
        page.getByTestId('workbench-credit-topbar-balance')
      ).toContainText(String(availableAfterDelivery));
      expect(contentPackage.marketing?.contextBundle?.bundleId).toBeTruthy();
      expect(contentPackage.marketing?.factRefs).toEqual(expect.any(Array));
      expect(contentPackage.marketing?.rightsRefs?.length ?? 0).toBeGreaterThan(
        0
      );
      expect(selected?.conversionHook?.trim()).toBeTruthy();
      expect(
        contentPackage.variants.map(({ platform }) => platform).sort()
      ).toEqual(['douyin', 'video_account', 'xiaohongshu']);
      expect(
        contentPackage.variants.every(
          ({ currentVersionId, platform, versions }) =>
            currentVersionId === `${selected?.id}-${platform}` &&
            versions.some(({ id }) => id === currentVersionId)
        )
      ).toBe(true);

      const aiCoverToggle = page.getByTestId(
        'composer-delivery-ai-cover-toggle'
      );
      await expect(aiCoverToggle).toBeVisible({ timeout: 30_000 });
      await aiCoverToggle.click();
      for (const preset of AI_COVER_PRESETS) {
        await expect(
          page.getByTestId(`composer-delivery-ai-cover-preset-${preset}`)
        ).toBeVisible();
      }
      for (const ratio of AI_COVER_RATIOS) {
        await expect(
          page.getByTestId(
            `composer-delivery-ai-cover-ratio-${ratio.replace(':', '-')}`
          )
        ).toBeVisible();
      }
      const salonPreset = page.getByTestId(
        'composer-delivery-ai-cover-preset-salon_photo'
      );
      await salonPreset.click();
      await expect(salonPreset).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('composer-delivery-ai-cover-ratio-9-16').click();
      await expect(page.getByTestId('composer-intent-input')).toHaveValue(
        /门店实拍感.*9:16.*1152x2048/u
      );

      const adopted = await adoptRecommendedCandidate(page, contentPackage);
      expect(adopted.harnessSelection?.adoptedCandidateId).toBe(
        'story_recommendation'
      );
      const download = await exportFullPackage(page, adopted);
      await assertZipDownload(download, IMAGE_TEXT_CONTRACT, adopted.revision);

      await page.evaluate(() => sessionStorage.clear());
      // Trial is 100 credits; one note leaves a residual balance. Load the
      // next Composer while that cached projection is still sufficient, then
      // drain its lots immediately before the final admission. This must be a
      // client-side zero-POST shortfall, not a server rejection.
      await submitNoteJourney(
        page,
        'fresh_insufficient',
        submission.authorizedAssetId,
        workspaceId
      );
      const shortfall = page.getByTestId('workbench-credit-shortfall-alert');
      await expect(shortfall).toBeVisible();
      await expect(shortfall).toContainText(/还差\s*\d+\s*分/u);
      await expect(
        shortfall.getByTestId('workbench-credit-buy-booster')
      ).toHaveAttribute('href', '/pricing#credit-boosters');
      await expect(
        shortfall.getByTestId('workbench-credit-upgrade')
      ).toHaveAttribute('href', '/pricing#subscription-plans');
      await page.screenshot({
        fullPage: true,
        path: resolve(
          import.meta.dirname,
          '../../../../.scratch/orca-run-2026-07-25/t20-r2-credit-shortfall.png'
        ),
      });
    });

    test('Video Brief acceptance rechecks a drained projection before admission', async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await registerTrialNoteUser(page, request);
      const { workspaceId } = await productState(page);
      await page.evaluate(() => sessionStorage.clear());
      await submitVideoBriefAfterFreshShortfall(page, workspaceId);
    });

    test('Composer blocks an unavailable fresh credit projection before submission', async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await registerTrialNoteUser(page, request);
      await submitNoteJourney(page, 'projection_unavailable');
    });

    test('Composer blocks a quote missing its refund policy before submission', async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await registerTrialNoteUser(page, request);
      await submitNoteJourney(page, 'missing_refund_policy');
    });
  });
