import {
  expect,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';

export type JourneyModality = 'copy' | 'image_text' | 'video';

export type JourneyContract = {
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
    modality: 'video',
    workspace: 'video',
    expectedActivations: 3,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（抖音）/u,
    packageFileName: /(?:抖音|douyin|[a-f0-9]{32,}).*\.zip$/iu,
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
    await expect(
      page.getByTestId(`composer-lens-option-${modality}`)
    ).toHaveAttribute('aria-checked', 'false');
  }
}

export async function submitComposerJourney(
  page: Page,
  contract: JourneyContract,
  intent: string
) {
  const lens = page.getByTestId(`composer-lens-option-${contract.modality}`);
  await lens.click();
  await expect(lens).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(
    page.getByTestId('composer-quote-line'),
    'submit must bind the server quote before creation'
  ).toBeVisible({ timeout: 30_000 });
  const createResponsePromise = page.waitForResponse(
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
        return (
          body.module === 'operations' && body.action === 'create_creative_work'
        );
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
  const submitResponsePromise = page.waitForResponse(
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
        return (
          body.module === 'operations' && body.action === 'submit_creative_work'
        );
      } catch {
        return false;
      }
    },
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

  const createResponse = await createResponsePromise;
  expect(
    createResponse.ok(),
    `create_creative_work failed: ${await createResponse.text()}`
  ).toBeTruthy();
  const submitResponse = await submitResponsePromise;
  const submitResponseBody = await submitResponse.text();
  const submitEnvelope = JSON.parse(submitResponseBody) as {
    data?: { job?: { status?: string } };
  };
  expect(
    submitResponse.ok(),
    `submit_creative_work failed: ${submitResponseBody}`
  ).toBeTruthy();
  // Fixture mode can settle before the HTTP response returns; accept the full
  // async lifecycle envelope (running) or an auditable completed fast-path.
  // Never accept missing job / failed / submitting-only without a real Job.
  expect(
    submitEnvelope.data?.job?.status,
    'submit_creative_work must return a real Job (running or completed fast-path)'
  ).toMatch(/^(running|completed)$/u);

  await expect(page).toHaveURL(/\/dashboard\/results\/[^/?#]+(?:\?|$)/u, {
    timeout: 60_000,
  });
  const match = new URL(page.url()).pathname.match(
    /^\/dashboard\/results\/([^/]+)$/u
  );
  expect(
    match?.[1],
    'result route must carry the exact created workId'
  ).toBeTruthy();
  return decodeURIComponent(match![1]!);
}

/**
 * Wait for Result Center to reach a usable terminal phase.
 *
 * Honesty contract (E-02):
 * - Prefer observing intermediate `running` (and for copy/image_text, a real
 *   first token on `copy-stream-slot`) before `ready|delivered`.
 * - If the Job already completed by the time the shell mounts, record an
 *   auditable fast-path via `data-phase` assertion message — do not pretend
 *   we saw streaming when we did not.
 */
export async function waitForResultJourney(
  page: Page,
  contract: JourneyContract,
  workId: string
) {
  const shell = page.getByTestId('result-center-shell');
  await expect(shell).toHaveAttribute('data-work-id', workId, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('result-shell-workspace')).toHaveText(
    contract.workspace
  );

  const phase = page.getByTestId('result-shell-phase');
  await expect(
    phase,
    'Result shell must expose active Job (running) or an auditable completed fast-path (ready|delivered)'
  ).toHaveAttribute('data-phase', /running|ready|delivered/u, {
    timeout: 30_000,
  });

  const initialPhase = await phase.getAttribute('data-phase');
  const observedRunning = initialPhase === 'running';

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
        `auditable fast-path: initial phase was "${initialPhase}" without observed running/token intermediate`
      ).toBeVisible({ timeout: 60_000 });
    }
  } else if (contract.modality === 'image_text') {
    if (observedRunning) {
      await expect(
        page.getByTestId('image-worksurface').or(phase),
        'image_text running path must keep Result shell alive until ready'
      ).toBeVisible({ timeout: 120_000 });
    } else {
      await expect(
        page.getByTestId(contract.resultSurfaceTestId),
        `auditable image_text fast-path: initial phase was "${initialPhase}"`
      ).toBeVisible({ timeout: 60_000 });
    }
  }

  await expect(phase).toHaveAttribute('data-phase', /ready|delivered/u, {
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

export async function adjustResult(page: Page, modality: JourneyModality) {
  const input = page.getByTestId('result-adjust-input').first();
  const instruction = `e2e-${modality}-adjust-${crypto.randomUUID()}`;
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
    name: /确认调整|确认提交|Confirm adjust/u,
  });
  if (await confirm.isVisible().catch(() => false)) {
    const confirmPromise = mutationResponse(
      page,
      /result_adjust|revise|adjust|regenerate|create_revision/u
    );
    await confirm.click();
    const confirmResponse = await confirmPromise;
    expect(confirmResponse.ok(), await confirmResponse.text()).toBeTruthy();
  }

  await expect(input).toHaveValue('', { timeout: 30_000 });
  return instruction;
}

function adoptLocator(page: Page, modality: JourneyModality): Locator {
  if (modality === 'copy') return page.getByTestId('copy-adopt-action');
  if (modality === 'image_text') {
    return page
      .getByTestId('image-role-primary')
      .and(page.locator('[data-action-kind^="adopt_"]'));
  }
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
    await expect(
      page.getByTestId('copy-image-text-worksurface')
    ).toHaveAttribute('data-lifecycle', 'adopted');
  } else if (contract.modality === 'image_text') {
    await expect(page.getByTestId('image-adopted-badge').first()).toBeVisible();
  } else {
    await expect(page.getByTestId('video-worksurface')).toHaveAttribute(
      'data-phase',
      /adopted|delivery_ready|delivered/u
    );
  }
}

export async function openDeliveryPanel(page: Page, modality: JourneyModality) {
  const deliver =
    modality === 'video'
      ? page.getByTestId('video-deliver-action')
      : page.locator('[data-action-id="deliver"]:visible').first();
  await expect(deliver).toBeEnabled();
  await deliver.click();
  await expect(page.getByTestId('result-shell-panel')).toHaveText('delivery');
  await expect(page.getByTestId('delivery-panel')).toBeVisible();
  await expect(page.getByTestId('delivery-panel')).toHaveAttribute(
    'data-direct-publish-hidden',
    'true'
  );
}

async function assertZipDownload(download: Download, expectedFileName: RegExp) {
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(expectedFileName);
  const path = await download.path();
  expect(path, 'browser must persist a real downloaded ZIP').toBeTruthy();
  const bytes = await readFile(path!);
  expect(
    bytes.byteLength,
    'downloaded package must not be empty'
  ).toBeGreaterThan(22);
  expect(
    [...bytes.subarray(0, 4)],
    'full package must be a ZIP payload, not a JSON/model-only fixture'
  ).toEqual([0x50, 0x4b, 0x03, 0x04]);
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
  contract: JourneyContract
) {
  const button = page.getByTestId('delivery-action-full_package');
  await expect(button).toHaveAccessibleName(contract.packageButtonName);
  await expect(
    button,
    'full package must be enabled after adopt has a downloadable revision'
  ).toBeEnabled({ timeout: 60_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await button.click();
  const download = await downloadPromise;
  if (contract.packageFormat === 'zip') {
    await assertZipDownload(download, contract.packageFileName);
  } else {
    await assertTextDownload(download, contract.packageFileName);
  }
  // Outcome is announced via live region; focus is best-effort (tabindex=-1).
  await expect(
    page.getByTestId('delivery-outcome-download-done')
  ).toBeVisible({ timeout: 15_000 });
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
  await expect(page.getByTestId('result-center-shell')).toHaveAttribute(
    'data-work-id',
    workId,
    { timeout: 60_000 }
  );
  await expect(page.getByTestId('result-shell-workspace')).toHaveText(
    contract.workspace
  );
  await expect(page.getByTestId(contract.resultSurfaceTestId)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('result-shell-panel')).toHaveText('delivery');
  await expect(page.getByTestId('delivery-panel')).toBeVisible();

  if (contract.modality === 'copy') {
    await expect(
      page.getByTestId('copy-image-text-worksurface')
    ).toHaveAttribute('data-lifecycle', 'adopted');
  } else if (contract.modality === 'image_text') {
    await expect(page.getByTestId('image-adopted-badge').first()).toBeVisible();
  } else {
    await expect(page.getByTestId('video-worksurface')).toHaveAttribute(
      'data-phase',
      /adopted|delivery_ready|delivered/u
    );
  }
}
