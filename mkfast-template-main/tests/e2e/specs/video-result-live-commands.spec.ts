import { expect, test, type Page, type Response } from '@playwright/test';
import postgres from 'postgres';

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
  waitForResultJourney,
} from '../fixtures/ui-journey';

function waitForP1Command(
  page: Page,
  module: string,
  action: string
): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as {
          action?: unknown;
          module?: unknown;
        };
        return body.module === module && body.action === action;
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
}

async function seedCanonicalVideoWorkflow(input: {
  email: string;
  workId: string;
}) {
  const sql = postgres(
    process.env.DATABASE_URL ?? 'postgres://meiye:meiye@127.0.0.1:54329/meiye',
    { max: 1 }
  );
  const workflowId = `video-workflow-e2e-${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  try {
    // Anchor on the Work, which is what the submission seam actually writes:
    // `PostgresCreationSubmissionPersistence.reserve` inserts p1_creative_works
    // + p1_content_tasks + execution_spine.creation_submissions and no
    // p1_creative_jobs row at all. The old anchor — "the originating job, the
    // one without a videoWorkflowId" — described the pre-ContentPackage shape
    // and can no longer match anything, so this helper failed before it seeded.
    const [owner] = await sql<Array<{ actorId: string; workspaceId: string }>>`
      SELECT u.id AS "actorId", works.workspace_id AS "workspaceId"
      FROM p1_creative_works works
      INNER JOIN workspace_memberships memberships
        ON memberships.workspace_id = works.workspace_id
      INNER JOIN "user" u ON u.id = memberships.user_id
      WHERE works.id = ${input.workId}
        AND u.email = ${input.email}
      ORDER BY works.updated_at DESC
      LIMIT 1
    `;
    expect(owner).toBeTruthy();
    const workspaceId = owner!.workspaceId;
    const actorId = owner!.actorId;
    const assets = [
      ['opening-a', 'video/mp4'],
      ['opening-b', 'video/mp4'],
      ['detail-a', 'video/mp4'],
    ] as const;
    const asset = (assetId: string) => ({
      contentType: 'video/mp4',
      createdAt: timestamp,
      dataClass: [],
      id: assetId,
      objectKey: `${workspaceId}/e2e/${assetId}.mp4`,
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      technicalValidation: {
        durationSeconds: 6,
        evidenceKind: 'measured',
        playable: true,
      },
      workspaceId,
    });
    const candidate = (index: number, assetId: string) => ({
      assetId,
      generationKey: `${workflowId}:${assetId}`,
      index,
      latencyMs: 1,
      prompt: 'E2E canonical video candidate',
      status: 'completed',
      technicalValidation: asset(assetId).technicalValidation,
    });
    const taskId = `video-task:${workflowId}`;
    const jobId = `video-job:${workflowId}`;
    const videoTask = {
      aigcLabelEnabled: true,
      catalogModelId: 'seedance-2',
      dataClass: [],
      kind: 'video.composed',
      shots: [
        {
          candidatesPerShot: 2,
          durationSeconds: 6,
          id: 'opening',
          prompt: '门店开场',
          selectedCandidateIndex: 0,
        },
        {
          candidatesPerShot: 1,
          durationSeconds: 6,
          id: 'detail',
          prompt: '护理细节',
          selectedCandidateIndex: 0,
        },
      ],
      storyboardRevision: 'e2e-storyboard-v1',
      storyboardVersion: 1,
      subtitleText: 'E2E 初始字幕',
    };
    const videoJob = {
      attempts: [],
      candidatesByShot: {
        detail: [candidate(0, 'detail-a')],
        opening: [candidate(0, 'opening-a'), candidate(1, 'opening-b')],
      },
      confirmed: true,
      createdAt: timestamp,
      revision: 0,
      status: 'awaiting_quality_review',
      updatedAt: timestamp,
    };
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO p1_content_tasks (workspace_id, id, payload, updated_at)
        VALUES (
          ${workspaceId},
          ${taskId},
          ${transaction.json({
            actorId,
            canonicalWorkId: input.workId,
            createdAt: timestamp,
            dueAt: timestamp,
            executable: true,
            id: taskId,
            relatedObject: { id: input.workId, kind: 'work' },
            risk: 'normal',
            source: 'manual',
            status: 'needs_review',
            title: `Video workflow ${workflowId}`,
            updatedAt: timestamp,
            videoTask,
            videoWorkflowId: workflowId,
            workspaceId,
          })},
          ${timestamp}
        )
      `;
      await transaction`
        INSERT INTO p1_creative_jobs (workspace_id, id, payload, updated_at)
        VALUES (
          ${workspaceId},
          ${jobId},
          ${transaction.json({
            actorId,
            createdAt: timestamp,
            // Every Job the runtime writes carries its execution contract, and
            // `CreativeJob.contract` is not optional — the Result route reads
            // `job.contract.operation` straight through
            // (`creative-job-observer.ts`), so a Job seeded without one takes
            // the whole page to its error boundary. Same fields the runtime
            // freezes at submission (`creativeExecutionContractSchema`), with
            // this seed's own storyboard totals.
            contract: {
              aigcLabelEnabled: true,
              aspectRatio: '9:16',
              catalogModelId: 'seedance-2',
              catalogRevision: 'e2e-catalog-v1',
              currency: 'CNY',
              dataClass: [],
              durationSeconds: 12,
              estimatedAmount: 0,
              operation: 'video.generate',
              outputCount: 1,
              outputLabel: '视频',
              quoteAcceptedAt: timestamp,
              quoteRevision: 'e2e-quote-v1',
              watermarkEnabled: false,
            },
            id: jobId,
            outputAssetIds: assets.map(([assetId]) => assetId),
            outputContentIds: [],
            productUsageQuantity: 1,
            // No `providerJobId`: the canonical store does not write one
            // (`storedJob`), so neither does this seed. The Result page binds
            // through `videoWorkflowId` below — which is exactly what this spec
            // guards, since seeding the old field would have hidden the unbind.
            status: 'recoverable',
            submissionKey: `video:${workflowId}`,
            taskId,
            updatedAt: timestamp,
            videoJob,
            videoWorkflowId: workflowId,
            workId: input.workId,
            workspaceId,
          })},
          ${timestamp}
        )
      `;
      for (const [assetId] of assets) {
        const ownedAsset = asset(assetId);
        await transaction`
          INSERT INTO p1_creative_assets (workspace_id, id, payload, updated_at)
          VALUES (
            ${workspaceId},
            ${`video-asset:${workflowId}:${assetId}`},
            ${transaction.json({
              asset: ownedAsset,
              assetId,
              createdAt: timestamp,
              id: `video-asset:${workflowId}:${assetId}`,
              objectKey: ownedAsset.objectKey,
              ownedAssetId: assetId,
              sha256: ownedAsset.sha256,
              sizeBytes: ownedAsset.sizeBytes,
              title: 'Video shot candidate',
              videoWorkflowId: workflowId,
              workId: input.workId,
              workspaceId,
            })},
            ${timestamp}
          )
        `;
      }
    });
    return workflowId;
  } finally {
    await sql.end();
  }
}

test.describe('video Result canonical live commands', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('persists edits and executes server quote → confirm → derived task', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const contract = JOURNEY_CONTRACTS.find(
      (candidate) => candidate.modality === 'video'
    )!;
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await page.getByTestId('composer-lens-option-video').click();
    const authorized = await seedComposerInlineAuthorize(page, {
      fileName: 'video-live-commands-reference.png',
    });
    await page.reload();
    await page.getByTestId('composer-lens-option-video').click();
    await seedComposerInlineAuthorize(page, {
      expectedAssetId: authorized.id,
      fileName: 'video-live-commands-reference.png',
    });
    const workId = await submitComposerJourney(
      page,
      contract,
      `皮肤护理 video-live-commands-${crypto.randomUUID()}`
    );
    await waitForResultJourney(page, contract, workId);
    await seedCanonicalVideoWorkflow({ email: user.email, workId });
    await page.reload();

    const candidate = page
      .locator('[data-testid="video-shot-candidate"][aria-pressed="false"]')
      .first();
    await expect(candidate).toBeVisible();
    const candidatePosition = await candidate.evaluate((element) =>
      Array.from(
        document.querySelectorAll('[data-testid="video-shot-candidate"]')
      ).indexOf(element)
    );
    const selectResponsePromise = waitForP1Command(
      page,
      'model-supply',
      'video_workflow_edit'
    );
    await candidate.click();
    const selectResponse = await selectResponsePromise;
    expect(selectResponse.ok(), await selectResponse.text()).toBeTruthy();
    await page.reload();
    await expect(
      page.getByTestId('video-shot-candidate').nth(candidatePosition)
    ).toHaveAttribute('aria-pressed', 'true');

    const firstShotBefore = await page
      .getByTestId('video-shot')
      .first()
      .innerText();
    const reorderResponsePromise = waitForP1Command(
      page,
      'model-supply',
      'video_workflow_edit'
    );
    await page.getByLabel('后移镜头 1').click();
    const reorderResponse = await reorderResponsePromise;
    expect(reorderResponse.ok(), await reorderResponse.text()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('video-shot').first()).not.toHaveText(
      firstShotBefore
    );

    const subtitle = `已持久化字幕-${crypto.randomUUID()}`;
    await page.getByTestId('video-subtitle-input').fill(subtitle);
    const subtitleResponsePromise = waitForP1Command(
      page,
      'model-supply',
      'video_workflow_edit'
    );
    await page.getByTestId('video-subtitle-save').click();
    const subtitleResponse = await subtitleResponsePromise;
    expect(subtitleResponse.ok(), await subtitleResponse.text()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('video-subtitle-input')).toHaveValue(
      subtitle
    );

    const quoteResponsePromise = waitForP1Command(
      page,
      'video-regeneration',
      'quote'
    );
    await page.getByTestId('video-shot-regenerate').first().click();
    const quoteResponse = await quoteResponsePromise;
    expect(quoteResponse.ok(), await quoteResponse.text()).toBeTruthy();
    const quoteRequest = quoteResponse.request().postDataJSON() as {
      payload: Record<string, unknown>;
    };
    expect(Object.keys(quoteRequest.payload).sort()).toEqual([
      'scope',
      'shotId',
      'sourceRunId',
    ]);
    expect(quoteRequest.payload).not.toHaveProperty('unitRate');
    expect(quoteRequest.payload).not.toHaveProperty('targetSeconds');
    await expect(page.getByTestId('video-regen-confirm')).toContainText('预估');

    const confirmResponsePromise = waitForP1Command(
      page,
      'video-regeneration',
      'confirm'
    );
    await page.getByTestId('video-regen-confirm-action').click();
    const confirmResponse = await confirmResponsePromise;
    expect(confirmResponse.ok()).toBeFalsy();
    const confirmRequest = confirmResponse.request().postDataJSON() as {
      payload: { quoteId?: string; taskId?: string };
    };
    expect(confirmRequest.payload.quoteId).toBeTruthy();
    expect(confirmRequest.payload.taskId).toMatch(/^video-regen-/u);
    await expect(
      page.getByText('视频重生成能力升级中，本次未产生扣费。')
    ).toBeVisible({ timeout: 60_000 });
  });
});
