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
    packageFileName: /朋友圈分段\.txt$/u,
    resultSurfaceTestId: 'copy-image-text-worksurface',
  },
  {
    modality: 'image_text',
    workspace: 'image',
    expectedActivations: 2,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（小红书）/u,
    packageFileName: /小红书.*\.zip$/u,
    resultSurfaceTestId: 'image-worksurface',
  },
  {
    modality: 'video',
    workspace: 'video',
    expectedActivations: 3,
    packageFormat: 'zip',
    packageButtonName: /完整发布包（抖音）/u,
    packageFileName: /抖音.*\.zip$/u,
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
  expect(
    submitEnvelope.data?.job?.status,
    'submit_creative_work must return the canonical asynchronous Job state'
  ).toBe('running');

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

  await expect(
    page.getByTestId('result-shell-phase'),
    'the Result shell must expose either the active Job or its already completed fast-path'
  ).toHaveAttribute('data-phase', /running|ready|delivered/u, {
    timeout: 30_000,
  });

  if (contract.modality !== 'video') {
    await expect(
      page
        .locator('[data-testid="copy-stream-slot"][data-has-token="true"]')
        .first(),
      'copy/image_text must render a real first token before the ready result'
    ).toBeVisible({ timeout: 120_000 });
  }

  await expect(page.getByTestId('result-shell-phase')).toHaveAttribute(
    'data-phase',
    /ready|delivered/u,
    { timeout: 180_000 }
  );
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
  const responsePromise = mutationResponse(
    page,
    /revise|adjust|regenerate|create_revision/u
  );
  await page.getByTestId('result-adjust-submit').first().click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(input).toHaveValue('');
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
  expect(
    text.trim().length,
    'downloaded segments must not be empty'
  ).toBeGreaterThan(0);
  expect(text, 'moments export must contain ordered publish segments').toMatch(
    /标题|正文|素材|朋友圈/u
  );
}

export async function downloadFullPackage(
  page: Page,
  contract: JourneyContract
) {
  const button = page.getByTestId('delivery-action-full_package');
  await expect(button).toHaveAccessibleName(contract.packageButtonName);
  await expect(button).toBeEnabled();
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await button.click();
  const download = await downloadPromise;
  if (contract.packageFormat === 'zip') {
    await assertZipDownload(download, contract.packageFileName);
  } else {
    await assertTextDownload(download, contract.packageFileName);
  }
  await expect(
    page.getByTestId('delivery-outcome-download-done')
  ).toBeFocused();
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
