import { expect, test, type Page } from '@playwright/test';

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

const IMAGE_CONTRACT = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;
const EXPECTED_STAGES = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
] as const;

type ImageOperation =
  | 'image.generate'
  | 'image.edit'
  | 'image.reference_transform';

type Journey = {
  intent: string;
  operation: ImageOperation;
  sourceCount: 0 | 1 | 2;
};

const JOURNEYS: readonly Journey[] = [
  {
    intent: '生成一张门店夏日护理海报',
    operation: 'image.generate',
    sourceCount: 0,
  },
  {
    intent: '修改这张真实美甲案例的背景和门店信息，保持甲面不变',
    operation: 'image.edit',
    sourceCount: 1,
  },
  {
    intent: '用这两张参考图合成一张门店护理海报',
    operation: 'image.reference_transform',
    sourceCount: 2,
  },
] as const;

type ContentPackageProjection = {
  generated: {
    assetIds: string[];
    childRuns: Array<{ kind?: string; status?: string }>;
    ownedAssets: Array<{ id?: string }>;
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
  payload: Record<string, unknown>
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

async function submitImageJourney(page: Page, journey: Journey) {
  await page.goto('/dashboard');
  await seedConfirmedStore(page);
  await page.getByTestId('composer-lens-option-image_text').click();
  const authorizedSources: Array<{ id: string }> = [];
  for (let index = 0; index < journey.sourceCount; index += 1) {
    authorizedSources.push(
      await seedComposerInlineAuthorize(page, {
        fileName: `${journey.operation}-${index + 1}.png`,
        fixtureIndex: index as 0 | 1,
      })
    );
  }
  if (authorizedSources.length > 0) {
    await page.reload();
    await page.getByTestId('composer-lens-option-image_text').click();
  }
  await page
    .getByTestId('composer-recipe-card-recipe.promotion_poster')
    .click();
  await expect(page.getByTestId('composer-recipe-apply-undo')).toBeVisible();
  for (const [index, source] of authorizedSources.entries()) {
    await seedComposerInlineAuthorize(page, {
      expectedAssetId: source.id,
      fileName: `${journey.operation}-${index + 1}.png`,
      fixtureIndex: index as 0 | 1,
    });
  }

  const intent = page.getByTestId('composer-intent-input');
  await intent.fill(journey.intent);
  await expect(intent).toHaveValue(journey.intent);
  await page
    .locator('#composer-setting-input-platform')
    .selectOption('xiaohongshu');
  await expect(
    page.getByTestId('composer-destination-capability')
  ).toBeVisible();
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const response = await responsePromise;
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
            new Error('Image workflow SSE did not reach a terminal state.')
          );
        }, 180_000);
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
              new Error('Image workflow SSE closed before terminal state.')
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
      const idempotencyKey = `image-intent-adopt:${packageId}:${expectedRevision}`;
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
          'idempotency-key': idempotencyKey,
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
            platform: 'xiaohongshu',
          },
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `image-intent-export:${packageId}:${expectedRevision}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: { downloadUrl?: string };
        error?: { message?: string };
      };
      if (!response.ok || !envelope.data?.downloadUrl) {
        throw new Error(
          envelope.error?.message ?? 'Image full package export failed'
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

test.describe
  .serial('ImageIntent v1 service journeys', () => {
    test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
    test.afterAll(async ({ request }) => cleanupE2EUsers(request));

    for (const journey of JOURNEYS) {
      test(`${journey.operation}: Composer HTTP + SSE + adoption + full package`, async ({
        page,
        request,
      }) => {
        test.setTimeout(360_000);
        const user = await registerE2EUser(request);
        await loginByForm(page, user);

        const submission = await submitImageJourney(page, journey);
        const stream = await collectWorkflowSse(page, submission.taskId);
        expect(stream.status).toBe('success');
        expect(
          stream.progress
            .filter(({ state }) => state === 'success')
            .map(({ stage }) => stage)
        ).toEqual(EXPECTED_STAGES);
        for (const frame of stream.progress) {
          expect(frame.message).toBeTruthy();
          expect(frame.message).not.toMatch(
            /workspace|provider|workflow|revision|candidate|schema|成本价|毛利/iu
          );
        }

        const contentPackage = await queryOperations<ContentPackageProjection>(
          page,
          'content_package',
          { packageId: submission.packageId }
        );
        expect(contentPackage.kind).toBe('image_text');
        expect(contentPackage.revision).toBeGreaterThan(0);
        expect(contentPackage.generated.assetIds).toHaveLength(1);
        expect(contentPackage.generated.ownedAssets).toHaveLength(1);
        expect(contentPackage.generated.childRuns).toHaveLength(1);
        expect(contentPackage.marketing?.contextBundle?.bundleId).toBeTruthy();
        expect(contentPackage.marketing?.contextBundle?.hash).toBeTruthy();
        expect(
          contentPackage.marketing?.contextBundle?.revision
        ).toBeGreaterThan(0);
        expect(contentPackage.marketing?.factRefs).toEqual(expect.any(Array));
        expect(
          contentPackage.marketing?.rightsRefs?.length ?? 0
        ).toBeGreaterThan(0);
        expect(
          contentPackage.variants.map(({ platform }) => platform).sort()
        ).toEqual(['douyin', 'video_account', 'xiaohongshu']);
        expect(contentPackage.variants).toHaveLength(3);
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

        const workbench = await queryOperations<{
          works: Array<{
            id: string;
            operation?: ImageOperation;
            sourceReferences: Array<{ id: string }>;
          }>;
        }>(page, 'creative_workbench', {});
        const work = workbench.works.find(({ id }) => id === submission.workId);
        expect(work?.operation).toBe(journey.operation);
        expect(work?.sourceReferences).toHaveLength(journey.sourceCount);

        const adopted = await adoptRecommendedCandidate(page, contentPackage);
        expect(adopted.revision).toBeGreaterThan(contentPackage.revision);
        expect(adopted.status).toBe('accepted');
        expect(adopted.harnessSelection?.adoptedCandidateId).toBe(
          contentPackage.harnessSelection?.recommendedCandidateId
        );

        const download = await exportFullPackage(page, adopted);
        await assertZipDownload(download, IMAGE_CONTRACT, adopted.revision);
      });
    }
  });
