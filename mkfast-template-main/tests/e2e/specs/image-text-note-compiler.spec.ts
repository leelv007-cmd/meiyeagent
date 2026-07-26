import { expect, test, type Page } from '@playwright/test';
import type { QuestionCard } from '@meiye/contracts';
import { randomUUID } from 'node:crypto';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { assertZipDownload, JOURNEY_CONTRACTS } from '../fixtures/ui-journey';

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

async function registerFundedNoteUser(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const codes = [0, 1].map(
    () => `NOTE-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`
  );
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);
  await page.goto('/admin/redemptions');
  for (const code of codes) {
    await page.locator('#redeem-copy').fill('5');
    await page.locator('#redeem-image').fill('5');
    await page.locator('#redeem-video').fill('0');
    await page.locator('#redeem-audio').fill('0');
    await page.locator('#redeem-code').fill(code);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands')
    );
    await page
      .getByRole('button', { name: /录入兑换码|record code/iu })
      .click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await page.evaluate(async () => {
    await fetch('/api/auth/sign-out', {
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  });

  const merchant = await registerE2EUser(request);
  await loginByForm(page, merchant);
  await page.goto('/settings/account');
  for (const code of codes) {
    await page.locator('#workspace-redemption-code').fill(code);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands')
    );
    await page.getByRole('button', { name: /兑换|redeem/iu }).click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  return merchant;
}

async function submitNoteJourney(page: Page) {
  await page.goto('/dashboard');
  await seedConfirmedStore(page);
  await page.getByTestId('composer-lens-option-image_text').click();
  const authorized = await seedComposerInlineAuthorize(page, {
    fileName: 'note-case.png',
  });
  await page.reload();
  await page.getByTestId('composer-lens-option-image_text').click();
  await page
    .getByTestId('composer-recipe-card-recipe.case_to_xhs_note')
    .click();
  const applyRecipe = page.getByRole('button', {
    name: '套用并更新设置',
  });
  const recipeApplied = page.getByTestId('composer-recipe-apply-undo');
  await expect(recipeApplied.or(applyRecipe)).toBeVisible();
  if (await applyRecipe.isVisible()) await applyRecipe.click();
  await expect(recipeApplied).toBeVisible();
  await seedComposerInlineAuthorize(page, {
    expectedAssetId: authorized.id,
    fileName: 'note-case.png',
  });
  const intent = '把这张美甲案例做成介绍本店夏日护理项目的小红书图文笔记';
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });

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
  };
  const envelope = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      task?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(submissionBody.catalogModel?.id).toBe('seedream-5-pro');
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.contentPackage?.id).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();
  expect(envelope.data?.work?.id).toBeTruthy();
  return {
    packageId: envelope.data!.contentPackage!.id!,
    taskId: envelope.data!.task!.id!,
  };
}

async function readPendingQuestion(page: Page, taskId: string) {
  return page.evaluate(async (currentTaskId) => {
    const response = await fetch(
      `/api/core/p1/harness/tasks/${encodeURIComponent(currentTaskId)}/decision`,
      { credentials: 'same-origin' }
    );
    const envelope = (await response.json()) as {
      data?: { question?: QuestionCard | null };
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(
        envelope.error?.message ?? 'Pending question read failed'
      );
    }
    return envelope.data?.question ?? null;
  }, taskId);
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
        }, 240_000);
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
        refundedUnits?: Array<{ quantity: number; resource: string }>;
        reservedUnits?: Array<{ quantity: number; resource: string }>;
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

    test('Composer confirmation → dual styles → selected pages → full revision and manifest', async ({
      page,
      request,
    }) => {
      test.setTimeout(480_000);
      await registerFundedNoteUser(page, request);

      const submission = await submitNoteJourney(page);
      const streamPromise = collectWorkflowSse(page, submission.taskId);

      await expect
        .poll(
          async () =>
            (await readPendingQuestion(page, submission.taskId))?.response
              .field,
          { timeout: 30_000 }
        )
        .toBe('note_plan_confirmation');
      const confirmation = await readPendingQuestion(page, submission.taskId);
      expect(confirmation?.options.map(({ id }) => id)).toContain(
        'continue_default'
      );
      await expect(page.getByTestId('composer-question-card')).toBeVisible();
      await page
        .getByTestId('composer-question-option-continue_default')
        .click();

      await expect
        .poll(
          async () =>
            (await readPendingQuestion(page, submission.taskId))?.response
              .field,
          { timeout: 90_000 }
        )
        .toBe('note_style');
      const styleQuestion = await readPendingQuestion(page, submission.taskId);
      expect(styleQuestion?.options).toHaveLength(2);
      expect(styleQuestion?.options.map(({ id }) => id)).toEqual([
        'practical_guide',
        'story_recommendation',
      ]);
      await page
        .getByTestId('composer-question-option-story_recommendation')
        .click();

      const stream = await streamPromise;
      expect(stream.status).toBe('success');
      expect(
        Array.from(
          new Set(
            stream.progress
              .filter(({ state }) => state === 'success')
              .map(({ stage }) => stage)
          )
        )
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
      expect(
        selected?.note?.evaluation.dimensions.map(({ dimension }) => dimension)
      ).toEqual([
        'theme_continuity',
        'visual_consistency',
        'non_repetition',
        'role_coverage',
        'image_text_cross_reference',
      ]);
      expect(
        selected?.note?.evaluation.dimensions.every(({ passed }) => passed)
      ).toBe(true);
      const usage = await queryProductUsage(page, submission.taskId);
      expect(usage).toMatchObject({
        reservedUnits: [
          { resource: 'copy', quantity: 2 },
          { resource: 'image', quantity: 3 },
        ],
        settledUnits: [
          { resource: 'copy', quantity: 2 },
          {
            resource: 'image',
            quantity: selected?.note?.plan.pages.length,
          },
        ],
        refundedUnits: [],
        status: 'committed',
      });
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

      const adopted = await adoptRecommendedCandidate(page, contentPackage);
      expect(adopted.harnessSelection?.adoptedCandidateId).toBe(
        'story_recommendation'
      );
      const download = await exportFullPackage(page, adopted);
      await assertZipDownload(download, IMAGE_TEXT_CONTRACT, adopted.revision);
    });

  });
