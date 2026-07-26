import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

type CanvasGraph = {
  edges: Array<Record<string, unknown>>;
  nodes: Array<{ data: Record<string, unknown>; id: string; type: string }>;
  schemaVersion: 1;
};

type CanvasProject = {
  draftVersion: number;
  graph: CanvasGraph;
  id: string;
  name: string;
};

type CanvasRevision = { id: string };

type GenerationInput = {
  inputAssets: Array<never>;
  operation: 'audio.sfx' | 'audio.speech' | 'image.generate';
  parameters: Record<string, boolean | number | string>;
  projectId: string;
  prompt: string;
  revisionId: string;
};

type GenerationJob = {
  deliverable: {
    asset: { contentType: string; id: string };
    kind: 'asset';
  } | null;
  failureCode?: string;
  jobId: string;
  status: string;
};

async function canvasCall<T>(
  page: Page,
  action: string,
  input: Record<string, unknown> = {},
  write = false
) {
  return page.evaluate(
    async ({
      action: requestAction,
      input: requestInput,
      write: requestWrite,
    }) => {
      const csrf = document.cookie
        .split(';')
        .map((part) => part.trim().split('='))
        .find(([name]) => name === '__Host-canvas-csrf')?.[1];
      const response = await fetch(`/api/canvas/${requestAction}`, {
        body: JSON.stringify(requestInput),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          ...(requestWrite ? { 'x-csrf-token': csrf ?? '' } : {}),
        },
        method: 'POST',
      });
      const payload = (await response.json()) as {
        data?: T;
        error?: { code?: string; message?: string };
      };
      if (!response.ok || payload.error || payload.data === undefined) {
        throw new Error(
          `${requestAction}: ${payload.error?.code ?? response.status} ${payload.error?.message ?? ''}`.trim()
        );
      }
      return payload.data as T;
    },
    { action, input, write }
  );
}

async function completeGeneration(
  page: Page,
  projectId: string,
  input: GenerationInput
) {
  const quote = await canvasCall<{ quoteId: string }>(
    page,
    'quoteGeneration',
    input,
    true
  );
  const submitted = await canvasCall<{ jobId: string }>(
    page,
    'submitGeneration',
    { input, quoteId: quote.quoteId },
    true
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await canvasCall<GenerationJob>(page, 'getGenerationJob', {
      jobId: submitted.jobId,
      projectId,
    });
    if (current.status === 'completed' && current.deliverable?.asset.id) {
      return current;
    }
    if (['failed', 'cancelled'].includes(current.status)) {
      throw new Error(
        `fixture generation ended ${current.status}: ${current.failureCode ?? 'unknown'}`
      );
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`fixture generation timed out for ${input.operation}`);
}

test.describe('Pro Studio cross-service smoke', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('login → Canvas generation → adoption → Main content library', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pro-studio');
    await unlockProStudio(page);
    await page.reload();
    await page.getByRole('button', { name: '一键进入' }).click();

    const canvasOrigin = `http://localhost:${
      process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'
    }`;
    await expect(page).toHaveURL(
      (url) => url.origin === canvasOrigin && url.pathname === '/',
      { timeout: 20_000 }
    );
    await expect(page.getByText('Pro Studio', { exact: true })).toBeVisible();

    const project = await canvasCall<CanvasProject>(
      page,
      'createProject',
      {
        graph: {
          edges: [],
          nodes: [
            {
              data: { text: '跨服务 smoke 文案' },
              id: 'smoke-copy',
              type: 'text',
            },
          ],
          schemaVersion: 1,
        } satisfies CanvasGraph,
        name: `cross-service-smoke-${randomUUID().slice(0, 8)}`,
      },
      true
    );
    await page.reload();
    const projectCard = page
      .locator('.project-card')
      .filter({ hasText: project.name });
    await expect(projectCard).toBeVisible();
    await projectCard.locator('.project-card-open').click();

    const checkpoint = await canvasCall<CanvasRevision>(
      page,
      'createCheckpoint',
      {
        expectedDraftVersion: project.draftVersion,
        label: 'cross-service smoke checkpoint',
        projectId: project.id,
      },
      true
    );
    const input: GenerationInput = {
      inputAssets: [],
      operation: 'image.generate',
      parameters: {},
      projectId: project.id,
      prompt: '一张简洁的美业产品主视觉，暖白背景',
      revisionId: checkpoint.id,
    };
    const completed = await completeGeneration(page, project.id, input);
    const audioInputs: GenerationInput[] = [
      {
        inputAssets: [],
        operation: 'audio.speech' as const,
        parameters: {
          format: 'wav',
          language: 'zh-CN',
          maxDurationSeconds: 30,
          speed: 1,
          tone: 'natural',
          voice: 'default',
        },
        projectId: project.id,
        prompt: '欢迎体验本次门店服务。',
        revisionId: checkpoint.id,
      },
      {
        inputAssets: [],
        operation: 'audio.sfx' as const,
        parameters: { durationSeconds: 3, format: 'wav' },
        projectId: project.id,
        prompt: 'A soft spa chime with a short natural decay.',
        revisionId: checkpoint.id,
      },
    ];
    const audioJobs = await Promise.all(
      audioInputs.map((audioInput) =>
        completeGeneration(page, project.id, audioInput)
      )
    );
    expect(audioJobs.map((job) => job.deliverable?.asset.contentType)).toEqual([
      'audio/wav',
      'audio/wav',
    ]);

    const loaded = await canvasCall<CanvasProject>(page, 'loadProject', {
      projectId: project.id,
    });
    const generatedNodeId = `generated-${randomUUID()}`;
    const saved = await canvasCall<{ draftVersion: number }>(
      page,
      'saveProjectDraft',
      {
        expectedDraftVersion: loaded.draftVersion,
        graph: {
          ...loaded.graph,
          nodes: [
            ...loaded.graph.nodes,
            {
              data: {
                assetId: completed.deliverable!.asset.id,
                jobId: completed.jobId,
              },
              id: generatedNodeId,
              type: 'image',
            },
            ...audioJobs.map((job, index) => ({
              data: {
                assetId: job.deliverable!.asset.id,
                jobId: job.jobId,
              },
              id: `generated-audio-${index + 1}-${randomUUID()}`,
              type: 'audio',
            })),
          ],
        },
        projectId: project.id,
      },
      true
    );
    await page.reload();
    await page
      .locator('.project-card')
      .filter({ hasText: project.name })
      .locator('.project-card-open')
      .click();
    await expect(page.locator('audio')).toHaveCount(2);
    const audioSources = await page
      .locator('audio')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAudioElement).src)
      );
    const audioDelivery = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { range: 'bytes=0-31' } });
      return {
        cacheControl: response.headers.get('cache-control'),
        contentType: response.headers.get('content-type'),
        nosniff: response.headers.get('x-content-type-options'),
        size: (await response.arrayBuffer()).byteLength,
        status: response.status,
      };
    }, audioSources[0]);
    expect(audioDelivery).toEqual({
      cacheControl: 'private, no-store',
      contentType: 'audio/wav',
      nosniff: 'nosniff',
      size: 32,
      status: 206,
    });
    const downloadHref = await page
      .getByRole('link', { name: '下载音频' })
      .first()
      .getAttribute('href');
    expect(downloadHref).toContain('download=1');
    const download = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return {
        disposition: response.headers.get('content-disposition'),
        status: response.status,
      };
    }, downloadHref!);
    expect(download.status).toBe(200);
    expect(download.disposition).toMatch(/^attachment; filename=/u);
    const adoption = await canvasCall<{ packageId: string }>(
      page,
      'adoptAdvancedCanvasOutput',
      {
        projectId: project.id,
        revisionRef: {
          expectedDraftVersion: saved.draftVersion,
          kind: 'freeze_current_draft',
        },
        selection: {
          orderedMediaNodeIds: [generatedNodeId],
          textNodeId: 'smoke-copy',
        },
        target: { kind: 'new_package' },
      },
      true
    );
    expect(adoption.packageId).toMatch(/^content-package-/u);

    const mainOrigin =
      process.env.PLAYWRIGHT_AUTH_BASE_URL ?? 'http://localhost:3000';
    await page.goto(
      `${mainOrigin}/dashboard/content?packageId=${encodeURIComponent(adoption.packageId)}`
    );
    // T34 / #228: the address forwards to the reshelled content detail, which
    // identifies the package by the revision it is bound to.
    await expect(page.getByTestId('works-detail-surface')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator(`[data-package-id="${adoption.packageId}"]`)
    ).toBeVisible({ timeout: 20_000 });
    console.log(`[pro-studio-cross-service] packageId=${adoption.packageId}`);
    await page.screenshot({
      fullPage: true,
      path: resolve(
        process.cwd(),
        '..',
        'docs/evidence/pro-studio/ticket25-cross-service-smoke.png'
      ),
    });
  });
});
