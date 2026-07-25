import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';

const EXPECTED_STAGES = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
] as const;

type ContentPackageProjection = {
  generated: {
    assetIds: string[];
    childRuns: Array<{
      productUsage?: { quantity?: number; status?: string };
      runId?: string;
      runType?: string;
      status?: string;
    }>;
    ownedAssets: Array<{ contentType?: string; id?: string }>;
  };
  harnessSelection?: {
    adoptedCandidateId?: string;
    recommendedCandidateId: string;
  };
  id: string;
  kind: string;
  marketing?: {
    contextBundle?: {
      bundleId?: string;
      hash?: string;
      revision?: number;
    };
    factRefs?: string[];
    rightsRefs?: string[];
  };
  revision: number;
  source: { workId?: string };
  status: string;
  variants: Array<{
    currentVersionId?: string;
    platform: string;
    versions: Array<{
      body?: string;
      conversionHook?: string;
      harnessCandidateId?: string;
      id: string;
      orderedAssetIds: string[];
      title?: string;
    }>;
  }>;
  versions: Array<{
    body?: string;
    conversionHook?: string;
    harnessCandidateId?: string;
    id: string;
    orderedAssetIds: string[];
    title?: string;
  }>;
};

async function queryOperations<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return page.evaluate(
    async ({ currentAction, currentPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: currentAction,
          module: 'operations',
          payload: currentPayload,
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
        throw new Error(envelope.error?.message ?? `${currentAction} failed`);
      }
      return envelope.data as T;
    },
    { currentAction: action, currentPayload: payload }
  );
}

async function submitVideoJourney(page: Page) {
  await page.goto('/dashboard');
  await seedConfirmedStore(page);
  await page.getByTestId('composer-lens-option-video').click();
  const authorized = await seedComposerInlineAuthorize(page, {
    fileName: 'video-native-reference.png',
  });
  await page.reload();
  await page.getByTestId('composer-lens-option-video').click();
  await page
    .getByTestId('composer-recipe-card-recipe.douyin_project_video')
    .click();
  await expect(page.getByTestId('composer-recipe-apply-undo')).toBeVisible();
  await seedComposerInlineAuthorize(page, {
    expectedAssetId: authorized.id,
    fileName: 'video-native-reference.png',
  });
  await page
    .getByTestId('composer-intent-input')
    .fill('把这张夏日护理案例图做成一条可直接发布的抖音项目成片');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });
  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const brief = page.getByTestId('composer-brief-surface');
  const nextStep = await Promise.race([
    brief
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const),
    submissionResponsePromise.then(() => 'submission' as const),
  ]);
  if (nextStep === 'brief') {
    const confirm = brief.getByTestId('composer-brief-confirm');
    await expect(confirm).toBeEnabled();
    await confirm.click();
  }
  const response = await submissionResponsePromise;
  const envelope = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      task?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.contentPackage?.id).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();
  expect(envelope.data?.work?.id).toBeTruthy();
  return {
    packageId: envelope.data!.contentPackage!.id!,
    taskId: envelope.data!.task!.id!,
    workId: envelope.data!.work!.id!,
  };
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
          reject(
            new Error('Video workflow SSE did not reach a terminal state.')
          );
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
        stream.onerror = () => {
          if (stream.readyState === EventSource.CLOSED) {
            window.clearTimeout(timeout);
            reject(
              new Error('Video workflow SSE closed before terminal state.')
            );
          }
        };
      }),
    taskId
  );
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
          'idempotency-key': `video-native-adopt:${packageId}:${expectedRevision}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ?? 'Harness candidate adoption failed'
        );
      }
      return envelope.data as ContentPackageProjection;
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
            platform: 'douyin',
          },
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `video-native-export:${packageId}:${expectedRevision}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: { downloadUrl?: string };
        error?: { message?: string };
      };
      if (!response.ok || !envelope.data?.downloadUrl) {
        throw new Error(
          envelope.error?.message ?? 'Video full package export failed'
        );
      }
      return envelope.data;
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
  }, exported.downloadUrl!);
  return downloadPromise;
}

async function assertNativeVideoZip(
  download: Download,
  expectedRevision: number
) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  const files = unzipSync(await readFile(path!));
  expect(files['video.mp4']?.byteLength ?? 0).toBeGreaterThan(0);
  const manifestBytes = files['manifest.json'];
  expect(manifestBytes).toBeTruthy();
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    contentPackageRevision?: number;
    files?: Array<{ path?: string; sizeBytes?: number }>;
    kind?: string;
    rightsSummary?: { state?: string };
    schema?: string;
  };
  expect(manifest.schema).toBe('beauty-delivery-manifest/v1');
  expect(manifest.kind).toBe('video');
  expect(manifest.contentPackageRevision).toBe(expectedRevision);
  expect(manifest.files?.length ?? 0).toBeGreaterThan(0);
  expect(manifest.rightsSummary?.state?.trim()).toBeTruthy();
  for (const entry of manifest.files ?? []) {
    expect(entry.path).toBeTruthy();
    expect(files[entry.path!]?.byteLength).toBe(entry.sizeBytes);
  }
}

test.describe
  .serial('T21 video-native compiler', () => {
    test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
    test.afterAll(async ({ request }) => cleanupE2EUsers(request));

    test('Composer → storyboard → one native call → revision → refresh → export', async ({
      page,
      request,
    }) => {
      test.setTimeout(480_000);
      const user = await registerE2EUser(request);
      await loginByForm(page, user);

      const submission = await submitVideoJourney(page);
      const stream = await collectWorkflowSse(page, submission.taskId);
      expect(stream.status).toBe('success');
      expect(
        stream.progress
          .filter(({ state }) => state === 'success')
          .map(({ stage }) => stage)
      ).toEqual(EXPECTED_STAGES);

      const contentPackage = await queryOperations<ContentPackageProjection>(
        page,
        'content_package',
        { packageId: submission.packageId }
      );
      expect(contentPackage.kind).toBe('video');
      expect(contentPackage.generated.assetIds).toHaveLength(1);
      expect(contentPackage.generated.ownedAssets).toHaveLength(1);
      expect(contentPackage.generated.ownedAssets[0]?.contentType).toBe(
        'video/mp4'
      );
      expect(contentPackage.generated.childRuns).toHaveLength(1);
      expect(contentPackage.generated.childRuns[0]).toMatchObject({
        productUsage: { quantity: 0, status: 'committed' },
        runId: expect.any(String),
        runType: 'model_job',
        status: 'succeeded',
      });
      expect(contentPackage.marketing?.contextBundle?.bundleId).toBeTruthy();
      expect(contentPackage.marketing?.contextBundle?.hash).toBeTruthy();
      expect(contentPackage.marketing?.contextBundle?.revision).toBeGreaterThan(
        0
      );
      expect(contentPackage.marketing?.factRefs).toEqual(expect.any(Array));
      expect(contentPackage.marketing?.rightsRefs?.length ?? 0).toBeGreaterThan(
        0
      );
      expect(
        contentPackage.variants.map(({ platform }) => platform).sort()
      ).toEqual(['douyin', 'video_account', 'xiaohongshu']);
      const primary = contentPackage.versions[0];
      expect(primary?.title?.trim()).toBeTruthy();
      expect(primary?.body?.trim()).toBeTruthy();
      expect(primary?.conversionHook?.trim()).toBeTruthy();
      expect(primary?.orderedAssetIds).toEqual(
        contentPackage.generated.assetIds
      );
      expect(primary?.harnessCandidateId).toBe(
        contentPackage.harnessSelection?.recommendedCandidateId
      );

      await page.goto(
        `/dashboard/results/${encodeURIComponent(submission.workId)}`
      );
      await expect(page.getByTestId('result-center-shell')).toBeVisible({
        timeout: 60_000,
      });
      await page.reload();
      await expect(page.getByTestId('video-worksurface')).toBeVisible({
        timeout: 60_000,
      });

      const adopted = await adoptRecommendedCandidate(page, contentPackage);
      expect(adopted.status).toBe('accepted');
      expect(adopted.harnessSelection?.adoptedCandidateId).toBe(
        contentPackage.harnessSelection?.recommendedCandidateId
      );
      const download = await exportFullPackage(page, adopted);
      await assertNativeVideoZip(download, adopted.revision);
    });
  });
