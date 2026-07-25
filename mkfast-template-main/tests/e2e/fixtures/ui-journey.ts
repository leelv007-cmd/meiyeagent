import {
  expect,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

export type JourneyModality = 'copy' | 'image_text' | 'video';

export type JourneyContract = {
  deliveryTarget: 'wechat_moments' | 'xiaohongshu' | 'douyin' | 'video_account';
  modality: JourneyModality;
  workspace: 'copy' | 'image' | 'video';
  expectedActivations: 2 | 3;
  packageFormat: 'text' | 'zip';
  packageButtonName: RegExp;
  packageFileName: RegExp;
  resultSurfaceTestId:
    | 'copy-image-text-worksurface'
    | 'image-worksurface'
    | 'video-worksurface';
};

export const JOURNEY_CONTRACTS: readonly JourneyContract[] = [
  {
    deliveryTarget: 'wechat_moments',
    modality: 'copy',
    workspace: 'copy',
    expectedActivations: 2,
    packageFormat: 'text',
    packageButtonName: /朋友圈分段包/u,
    // Production export may use zh "朋友圈分段" or en "moments-caption".
    packageFileName: /(?:朋友圈分段|moments-caption)\.txt$/u,
    resultSurfaceTestId: 'copy-image-text-worksurface',
  },
  {
    deliveryTarget: 'xiaohongshu',
    modality: 'image_text',
    workspace: 'image',
    expectedActivations: 2,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（小红书）/u,
    // Fixture export may use content hash filename; zh/en product names also ok.
    packageFileName: /(?:小红书|xhs|xiaohongshu|[a-f0-9]{32,}).*\.zip$/iu,
    resultSurfaceTestId: 'image-worksurface',
  },
  {
    deliveryTarget: 'douyin',
    modality: 'video',
    workspace: 'video',
    expectedActivations: 3,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（抖音）/u,
    packageFileName: /(?:抖音|douyin|[a-f0-9]{32,}).*\.zip$/iu,
    resultSurfaceTestId: 'video-worksurface',
  },
  {
    deliveryTarget: 'video_account',
    modality: 'video',
    workspace: 'video',
    expectedActivations: 3,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（视频号）/u,
    packageFileName:
      /(?:视频号|video-account|video_account|[a-f0-9]{32,}).*\.zip$/iu,
    resultSurfaceTestId: 'video-worksurface',
  },
] as const;

export async function assertThreeModalDiscovery(page: Page) {
  await expect(page.getByTestId('composer-home')).toBeVisible();
  await expect(page.getByTestId('composer-lens-radiogroup')).toHaveAttribute(
    'aria-required',
    'true'
  );
  await expect(page.getByTestId('composer-recipe-card-grid')).toHaveAttribute(
    'data-card-count',
    '6'
  );

  for (const modality of ['copy', 'image_text', 'video'] as const) {
    await expect(
      page
        .locator(
          `[data-testid="composer-recipe-card-grid"] [data-card-lens="${modality}"]`
        )
        .first(),
      `cold Composer must expose a discoverable ${modality} recipe`
    ).toBeVisible();
    // Native <input type="radio"> exposes checked via the property / data-state,
    // not necessarily an aria-checked attribute.
    await expect(
      page.getByTestId(`composer-lens-option-${modality}`)
    ).not.toBeChecked();
    await expect(
      page.getByTestId(`composer-lens-option-${modality}`)
    ).toHaveAttribute('data-state', 'unchecked');
  }
}

export async function submitComposerJourney(
  page: Page,
  contract: JourneyContract,
  intent: string
) {
  const lens = page.getByTestId(`composer-lens-option-${contract.modality}`);
  await lens.click();
  await expect(lens).toBeChecked();
  await expect(lens).toHaveAttribute('data-state', 'checked');

  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(
    page.getByTestId('composer-quote-line'),
    'submit must bind the server quote before creation'
  ).toBeVisible({ timeout: 30_000 });
  // T08 new seam. The client no longer emits the old two-command dance
  // (`operations.create_creative_work` then `operations.submit_creative_work`
  // on `/api/core/p1/commands`) — `composer/z1-cutover-retirement.static.test.ts`
  // asserts those actions are never emitted again — so waiting for them could
  // only ever time out. One POST now carries the whole submission.
  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 60_000 }
  );
  await page.getByTestId('composer-submit').click();

  if (contract.modality === 'video') {
    const brief = page.getByTestId('composer-brief-surface');
    await expect(brief).toBeVisible({ timeout: 30_000 });
    await expect(
      brief.getByTestId('composer-brief-trigger-any_video')
    ).toBeVisible();
    await expect(
      brief.getByTestId('composer-brief-video-confirm-checkbox'),
      'C6 permits one Brief confirmation activation, not a checkbox plus a confirm button'
    ).toHaveCount(0);
    const confirm = brief.getByTestId('composer-brief-confirm');
    await expect(confirm).toBeEnabled();
    await confirm.click();
  }

  const submissionResponse = await submissionResponsePromise;
  const submissionBody = await submissionResponse.text();
  // 202 is the honesty gate, and a stronger one than the old `job.status`:
  // `CreationSubmissionCoordinator.submit` awaits `startHarness` before it
  // answers, so a 202 means the Harness workflow really started — not merely
  // that a Job row was written.
  expect(
    submissionResponse.status(),
    `composer submission must be accepted with 202; body=${submissionBody}`
  ).toBe(202);
  const submission = JSON.parse(submissionBody) as {
    data?: {
      contentPackage?: { id?: string };
      snapshot?: { id?: string };
      task?: { id?: string };
      usageReservation?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  // The one response carries every id the old pair of responses used to split
  // between them; a blank in any of them is a half-built submission.
  for (const [field, value] of [
    ['task', submission.data?.task?.id],
    ['work', submission.data?.work?.id],
    ['contentPackage', submission.data?.contentPackage?.id],
    ['snapshot', submission.data?.snapshot?.id],
    ['usageReservation', submission.data?.usageReservation?.id],
  ] as const) {
    expect(
      value,
      `the 202 must carry a real ${field} id; body=${submissionBody}`
    ).toBeTruthy();
  }
  const submittedWorkId = submission.data!.work!.id!;

  // ADR-0014「提交后不跳转」. Submitting keeps the merchant in the conversation;
  // the run finishes as a 成品预览卡 and clicking that card is what opens the
  // Result Center. Assert all three: we did NOT navigate, the card appeared,
  // and the id it carries is the one the submission produced.
  await expect(
    page,
    'submitting must not navigate away from the Composer conversation'
  ).not.toHaveURL(/\/dashboard\/results\//u);
  await answerComposerQuestions(page);
  const deliveryCard = page.getByTestId('composer-delivery-card');
  await expect(deliveryCard).toBeVisible({ timeout: 120_000 });
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);

  await deliveryCard.click();
  await expect(page).toHaveURL(/\/dashboard\/results\/[^/?#]+(?:\?|$)/u, {
    timeout: 60_000,
  });
  const match = new URL(page.url()).pathname.match(
    /^\/dashboard\/results\/([^/]+)$/u
  );
  expect(
    match?.[1] ? decodeURIComponent(match[1]) : undefined,
    'result route must carry the exact workId the 202 returned'
  ).toBe(submittedWorkId);
  return submittedWorkId;
}

/**
 * 只需确认一件事 — answer whatever the run asks, then hand back.
 *
 * A live run suspends on a Harness structured decision whenever D-111 cannot
 * infer a field from the intent (observed: `…:s1:industry_category`, free-text,
 * no options). Until it is answered the DBOS workflow stays PENDING, so no
 * token and no 成品预览卡 ever arrive — a journey that does not answer is not
 * slow, it is stuck. Whether a run asks at all depends on the intent, so this
 * tolerates zero questions and returns how many it actually answered.
 *
 * Not on the D-043 budget path: the counter stops at first token, and a run
 * that asks has not produced one yet. Journeys that assert an activation
 * budget must use an intent the router can resolve on its own.
 */
export async function answerComposerQuestions(
  page: Page,
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {}
): Promise<number> {
  const question = page.getByTestId('composer-question-card');
  const delivery = page.getByTestId('composer-delivery-card');
  const stream = page.getByTestId('composer-candidate-stream');
  const deadline = Date.now() + timeoutMs;
  let answered = 0;

  while (Date.now() < deadline) {
    if (await delivery.isVisible()) break;
    // The stream section only exists once the turn is on screen; asking for its
    // attribute before that would block on the default timeout instead of
    // falling through to the poll below.
    const streamed = (await stream.count())
      ? await stream.getAttribute('data-has-token')
      : null;
    if (streamed === 'true') break;
    if (!(await question.isVisible())) {
      await page.waitForTimeout(1_000);
      continue;
    }
    // Pin the id so a follow-up question is not mistaken for this one lingering.
    const questionId = await question.getAttribute('data-question-id');
    // Skip, never answer. `applyCurrentTaskDecision` (harness/workflow-core.ts)
    // returns the request untouched for `state === 'ignored'`, but throws
    // HarnessSnapshotDecisionError for any substantive answer once the run
    // carries an executionSnapshot — and `creation-stage-port.ts:54` sets one
    // on every Composer submission. So for Composer-originated runs skipping is
    // not the lazy path, it is the only one that does not kill the workflow.
    // Skipping routes to D-111 通用模式, which is what the pre-existing
    // intent-routing-http-sse spec exercises by ignoring the same question.
    await page.getByTestId('composer-question-skip').click();
    await expect(
      page.locator(`[data-question-id="${questionId}"]`),
      'the answered question must leave the conversation'
    ).toHaveCount(0, { timeout: 60_000 });
    answered += 1;
  }
  return answered;
}

/**
 * Wait for Result Center to reach a usable merchant-ready state.
 *
 * Honesty contract (E-02):
 * - Prefer observing the user-visible generating state (and for copy/image_text, a real
 *   first token on `copy-stream-slot`) before `ready|delivered`.
 * - If the Job already completed by the time the shell mounts, record an
 *   auditable fast-path through ProductStatus — do not pretend
 *   we saw streaming when we did not.
 */
export async function waitForResultJourney(
  page: Page,
  contract: JourneyContract,
  workId: string
) {
  const shell = page.getByTestId('result-center-shell');
  await expect(page).toHaveURL(
    new RegExp(
      `/dashboard/results/${encodeURIComponent(workId)}(?:\\?|$)`,
      'u'
    ),
    {
      timeout: 60_000,
    }
  );
  await expect(shell).toBeVisible({
    timeout: 60_000,
  });
  const visibleResultText = await shell.innerText();
  expect(visibleResultText).not.toContain(workId);
  expect(visibleResultText).not.toMatch(
    /\b(?:running|ready|delivered|candidate_ready|needs_input|automatic_verified|assisted|unavailable)\b/iu
  );
  expect(visibleResultText).not.toMatch(
    /(?:provider|workId=|workspaceId=|assetId=|catalogModelId|seedance-2)/iu
  );
  const merchantStatus = page.getByTestId('result-merchant-status');
  await expect(
    merchantStatus,
    'Result must explain progress with merchant ProductStatus copy'
  ).toContainText(/生成中|可发布|已发布就绪/u, {
    timeout: 30_000,
  });

  const initialStatus = await merchantStatus.textContent();
  const observedRunning = initialStatus?.includes('生成中') ?? false;

  // copy.generate is the only job that feeds ADR-0007 copy token stream.
  // image_text submits image.generate — do not demand copy-stream slots.
  if (contract.modality === 'copy') {
    if (observedRunning) {
      // Intermediate path: require a real first token while still running.
      await expect(
        page
          .locator('[data-testid="copy-stream-slot"][data-has-token="true"]')
          .first(),
        'copy running path must render a real first token before ready'
      ).toBeVisible({ timeout: 120_000 });
    } else {
      // Fast-path: job already ready/delivered when shell mounted.
      await expect(
        page
          .getByTestId(contract.resultSurfaceTestId)
          .or(page.locator('[data-testid="copy-stream-slot"]').first()),
        `auditable fast-path: initial merchant status was "${initialStatus ?? ''}" without observed generating/token intermediate`
      ).toBeVisible({ timeout: 60_000 });
    }
  } else if (contract.modality === 'image_text') {
    if (observedRunning) {
      await expect(
        page.getByTestId('image-worksurface').or(merchantStatus),
        'image_text generating path must keep Result visible until ready'
      ).toBeVisible({ timeout: 120_000 });
    } else {
      await expect(
        page.getByTestId(contract.resultSurfaceTestId),
        `auditable image_text fast-path: initial merchant status was "${initialStatus ?? ''}"`
      ).toBeVisible({ timeout: 60_000 });
    }
  }

  await expect(merchantStatus).toContainText(/可发布|已发布就绪/u, {
    timeout: 180_000,
  });
  await expect(page.getByTestId(contract.resultSurfaceTestId)).toBeVisible();
}

function mutationResponse(page: Page, actionPattern: RegExp) {
  return page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as { action?: unknown };
        return (
          typeof body.action === 'string' && actionPattern.test(body.action)
        );
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
}

type VideoRegenerationTask = {
  quoteId: string;
  scope: 'shot' | 'full_compose';
  shotId?: string;
  sourceRunId: string;
  status: 'dispatching' | 'running' | 'completed' | 'cancelled' | 'failed';
  taskId: string;
};

async function videoRegenerationTask(page: Page, taskId: string) {
  return page.evaluate(async (derivedTaskId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'get_task',
        module: 'video-regeneration',
        payload: { taskId: derivedTaskId },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: VideoRegenerationTask;
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Video regeneration task query failed'
      );
    }
    return envelope.data;
  }, taskId);
}

async function videoWorkflowStatus(page: Page, workflowId: string) {
  return page.evaluate(async (derivedWorkflowId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'video_workflow_public',
        module: 'model-supply',
        payload: { workflowId: derivedWorkflowId },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: { status?: string };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data?.status) {
      throw new Error(
        envelope.error?.message ?? 'Derived video workflow query failed'
      );
    }
    return envelope.data.status;
  }, workflowId);
}

export async function adjustResult(
  page: Page,
  modality: JourneyModality
): Promise<{ instruction: string; workId?: string }> {
  const instruction = `e2e-${modality}-adjust-${crypto.randomUUID()}`;
  if (modality === 'video') {
    const worksurface = page.getByTestId('video-worksurface');
    await expect(worksurface).toBeVisible();
    await expect(page.getByTestId('video-subtitle-save')).toBeDisabled();

    const quotePromise = mutationResponse(page, /^quote$/u);
    await page.getByTestId('video-full-recompose').click();
    const quoteResponse = await quotePromise;
    expect(quoteResponse.ok(), await quoteResponse.text()).toBeTruthy();
    const quoteRequest = quoteResponse.request().postDataJSON() as {
      module?: string;
      payload?: Record<string, unknown>;
    };
    expect(quoteRequest).toMatchObject({
      module: 'video-regeneration',
      payload: { scope: 'full_compose' },
    });
    const sourceRunId = quoteRequest.payload?.sourceRunId;
    expect(typeof sourceRunId).toBe('string');

    const confirm = page.getByTestId('video-regen-confirm-action');
    await expect(confirm).toBeEnabled();
    const confirmPromise = mutationResponse(page, /^confirm$/u);
    await confirm.click();
    const confirmResponse = await confirmPromise;
    expect(confirmResponse.ok(), await confirmResponse.text()).toBeTruthy();
    const confirmRequest = confirmResponse.request().postDataJSON() as {
      module?: string;
      payload?: { quoteId?: string; taskId?: string };
    };
    expect(confirmRequest.module).toBe('video-regeneration');
    expect(confirmRequest.payload?.quoteId).toBeTruthy();
    expect(confirmRequest.payload?.taskId).toMatch(/^video-regen-/u);
    const taskId = confirmRequest.payload!.taskId!;
    const confirmEnvelope = (await confirmResponse.json()) as {
      data?: { task?: VideoRegenerationTask };
    };
    expect(confirmEnvelope.data?.task).toMatchObject({
      quoteId: confirmRequest.payload!.quoteId,
      scope: 'full_compose',
      sourceRunId: sourceRunId!,
      taskId,
    });

    await expect
      .poll(async () => (await videoRegenerationTask(page, taskId)).status, {
        message: 'derived video regeneration task must recover to terminal',
        timeout: 180_000,
      })
      .toBe('completed');
    expect(await videoRegenerationTask(page, taskId)).toMatchObject({
      quoteId: confirmRequest.payload!.quoteId,
      scope: 'full_compose',
      sourceRunId: sourceRunId!,
      status: 'completed',
      taskId,
    });
    expect(await videoWorkflowStatus(page, taskId)).toBe('completed');

    await page.reload();
    const refreshed = page.getByTestId('video-worksurface');
    await expect(refreshed).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('video-result-status')).toContainText(
      '成片待确认',
      { timeout: 60_000 }
    );
    return { instruction };
  }

  const input = page.getByTestId('result-adjust-input').first();
  await input.fill(instruction);
  const preparePromise = mutationResponse(
    page,
    /result_adjust_prepare|revise|adjust|regenerate|create_revision/u
  );
  await page.getByTestId('result-adjust-submit').first().click();
  const prepareResponse = await preparePromise;
  expect(prepareResponse.ok(), await prepareResponse.text()).toBeTruthy();

  // Quoted adjust path shows confirmation (quote + confirm) before submit.
  const confirm = page.getByRole('button', {
    name: /确认调整|确认提交|确认并生成|Confirm adjust/u,
  });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  const previousResultUrl = page.url();
  const confirmPromise = mutationResponse(
    page,
    /result_adjust|revise|adjust|regenerate|create_revision/u
  );
  await confirm.click();
  const confirmResponse = await confirmPromise;
  expect(confirmResponse.ok(), await confirmResponse.text()).toBeTruthy();
  await expect
    .poll(() => page.url(), {
      message: 'confirmed adjustment must leave the quoted Result route',
      timeout: 30_000,
    })
    .not.toBe(previousResultUrl);
  await expect(page.getByTestId('image-adjust-confirmation')).toHaveCount(0);

  await expect(page.getByTestId('result-adjust-input').first()).toHaveValue(
    '',
    {
      timeout: 30_000,
    }
  );
  const adjustedWorkId = new URL(page.url()).pathname.match(
    /^\/dashboard\/results\/([^/]+)$/u
  )?.[1];
  expect(
    adjustedWorkId,
    'confirmed adjustment must open its derived Work'
  ).toBeTruthy();
  return { instruction, workId: decodeURIComponent(adjustedWorkId!) };
}

function adoptLocator(page: Page, modality: JourneyModality): Locator {
  if (modality === 'copy') return page.getByTestId('copy-adopt-action');
  if (modality === 'image_text') return page.getByTestId('image-role-primary');
  return page.getByTestId('video-adopt-action');
}

export async function adoptResult(page: Page, contract: JourneyContract) {
  const adopt = adoptLocator(page, contract.modality);
  await expect(adopt).toBeVisible();
  const responsePromise = mutationResponse(page, /adopt/u);
  await adopt.click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();

  if (contract.modality === 'copy') {
    await expect(page.getByTestId('copy-adopt-action')).toHaveCount(0);
  } else if (contract.modality === 'image_text') {
    await expect(page.getByTestId('image-adopted-badge').first()).toBeVisible();
  } else {
    await expect(page.getByTestId('video-result-status')).toContainText(
      '已采用，待交付'
    );
  }
}

export async function openDeliveryPanel(page: Page, modality: JourneyModality) {
  const deliver =
    modality === 'video'
      ? page.getByTestId('video-deliver-action')
      : page.getByRole('button', { name: '交付', exact: true }).first();
  await expect(deliver).toBeEnabled();
  await deliver.click();
  await expect(page.getByTestId('delivery-panel')).toBeVisible();
  await expect(page.getByTestId('delivery-panel')).toHaveAttribute(
    'data-direct-publish-hidden',
    'true'
  );
}

export async function assertZipDownload(
  download: Download,
  contract: JourneyContract,
  expectedRevision?: number
) {
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(contract.packageFileName);
  const path = await download.path();
  expect(path, 'browser must persist a real downloaded ZIP').toBeTruthy();
  const bytes = await readFile(path!);
  expect(
    bytes.byteLength,
    'downloaded package must not be empty'
  ).toBeGreaterThan(22);
  const files = unzipSync(bytes);
  const manifestBytes = files['manifest.json'];
  const captionBytes = files['caption.txt'];
  const checklistBytes = files['platform-checklist.md'];
  expect(manifestBytes, 'ZIP must contain manifest.json').toBeTruthy();
  expect(captionBytes, 'ZIP must contain caption.txt').toBeTruthy();
  expect(
    checklistBytes,
    'ZIP must contain the platform compliance checklist'
  ).toBeTruthy();
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    files?: Array<{
      path?: string;
      role?: string;
      sizeBytes?: number;
    }>;
    kind?: string;
    platform?: string;
    contentPackageRevision?: number;
    rightsSummary?: {
      aigcLabelEnabled?: boolean;
      factSummary?: string;
      state?: string;
      watermarkEnabled?: boolean;
    };
    schema?: string;
  };
  expect(manifest.schema).toBe('beauty-delivery-manifest/v1');
  expect(manifest.kind).toBe(contract.modality);
  expect(manifest.platform).toBe(contract.deliveryTarget);
  if (expectedRevision !== undefined) {
    expect(manifest.contentPackageRevision).toBe(expectedRevision);
  }
  expect(manifest.rightsSummary).toEqual(
    expect.objectContaining({
      aigcLabelEnabled: expect.any(Boolean),
      state: expect.any(String),
      watermarkEnabled: expect.any(Boolean),
    })
  );
  expect(manifest.rightsSummary?.state?.trim().length ?? 0).toBeGreaterThan(0);
  expect(new TextDecoder().decode(captionBytes).trim().length).toBeGreaterThan(
    0
  );
  expect(
    new TextDecoder().decode(checklistBytes).trim().length
  ).toBeGreaterThan(0);
  expect(manifest.files?.length ?? 0).toBeGreaterThan(0);
  for (const entry of manifest.files ?? []) {
    expect(entry.path, 'every manifest file must have a path').toBeTruthy();
    const archived = files[entry.path!];
    expect(
      archived,
      `manifest path ${entry.path} must exist in ZIP`
    ).toBeTruthy();
    expect(archived?.byteLength).toBe(entry.sizeBytes);
  }
  const manifestPaths = new Set(
    (manifest.files ?? []).map(({ path }) => path).filter(Boolean)
  );
  expect(manifestPaths.has('caption.txt')).toBe(true);
  expect(manifestPaths.has('platform-checklist.md')).toBe(true);
  if (contract.modality === 'video') {
    expect(files['video.mp4']?.byteLength ?? 0).toBeGreaterThan(0);
    expect(files['cover.jpg']?.byteLength ?? 0).toBeGreaterThan(0);
    const subtitlePath = files['subtitles.srt']
      ? 'subtitles.srt'
      : files['subtitles.vtt']
        ? 'subtitles.vtt'
        : undefined;
    expect(
      subtitlePath,
      'video ZIP must contain SRT or VTT subtitles'
    ).toBeTruthy();
    expect(files[subtitlePath!]?.byteLength ?? 0).toBeGreaterThan(0);
    expect(manifestPaths.has('video.mp4')).toBe(true);
    expect(manifestPaths.has('cover.jpg')).toBe(true);
    expect(manifestPaths.has(subtitlePath!)).toBe(true);
  } else {
    expect(Object.keys(files).some((name) => name.startsWith('images/'))).toBe(
      true
    );
  }
}

async function assertTextDownload(
  download: Download,
  expectedFileName: RegExp
) {
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(expectedFileName);
  const path = await download.path();
  expect(
    path,
    'browser must persist a real downloaded segments file'
  ).toBeTruthy();
  const text = await readFile(path!, 'utf8');
  const trimmed = text.trim();
  expect(
    trimmed.length,
    'downloaded segments must not be empty'
  ).toBeGreaterThan(20);
  // Fixture copy may omit explicit section headers; require multi-segment body.
  expect(
    trimmed.split(/\n+/u).filter((line) => line.trim().length > 0).length,
    'moments export must contain ordered publish segments'
  ).toBeGreaterThanOrEqual(2);
}

export async function downloadFullPackage(
  page: Page,
  contract: JourneyContract,
  expectedRevision?: number
) {
  const button = page.getByTestId('delivery-action-full_package');
  await expect(button).toHaveAccessibleName(contract.packageButtonName);
  await expect(
    button,
    'full package must be enabled after adopt has a downloadable revision'
  ).toBeEnabled({ timeout: 60_000 });
  const exportPromise =
    contract.packageFormat === 'zip'
      ? mutationResponse(page, /^result_export$/u)
      : null;
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await button.click();
  if (exportPromise) {
    const response = await exportPromise;
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const download = await downloadPromise;
  if (contract.packageFormat === 'zip') {
    await assertZipDownload(download, contract, expectedRevision);
  } else {
    await assertTextDownload(download, contract.packageFileName);
  }
  // Outcome is announced via live region; focus is best-effort (tabindex=-1).
  await expect(page.getByTestId('delivery-outcome-download-done')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByTestId('delivery-outcome-download-done')
  ).toHaveAttribute('data-outcome', 'download_done');
}

export async function assertJourneyRestored(
  page: Page,
  contract: JourneyContract,
  workId: string
) {
  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(
      `/dashboard/results/${encodeURIComponent(workId)}(?:\\?|$)`,
      'u'
    ),
    { timeout: 60_000 }
  );
  await expect(page.getByTestId(contract.resultSurfaceTestId)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('delivery-panel')).toBeVisible();

  if (contract.modality === 'copy') {
    await expect(page.getByTestId('copy-adopt-action')).toHaveCount(0);
  } else if (contract.modality === 'image_text') {
    await expect(page.getByTestId('image-adopted-badge').first()).toBeVisible();
  } else {
    await expect(page.getByTestId('video-result-status')).toContainText(
      '已采用，待交付'
    );
  }
}
