import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type Request } from '@playwright/test';
import { VISUAL_ASSET_SLOTS } from '@meiye/contracts';
import type { AssetDraftView, StoreFact } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productCommand, productState } from '../fixtures/product';

const PRICE_LIST_PHOTO = await readFile(
  new URL(
    '../../../public/model-previews/image-beauty-preview.png',
    import.meta.url
  )
);

const LEGACY_PROJECT = {
  confirmed: true,
  durationMinutes: 75,
  id: 'w02-legacy-project',
  name: '头皮护理',
  price: 199,
} as const;

/** The fixture parser reads "头皮护理 239 元" out of any price-list source. */
const PHOTO_PRICE = '239';

type ModuleRequest = {
  action?: string;
  module?: string;
  payload?: Record<string, unknown>;
};

function moduleRequest(request: Request): ModuleRequest | null {
  if (
    request.method() !== 'POST' ||
    !request.url().includes('/api/core/p1/commands')
  ) {
    return null;
  }
  try {
    return request.postDataJSON() as ModuleRequest;
  } catch {
    return null;
  }
}

function isAction(request: Request, action: string) {
  return moduleRequest(request)?.action === action;
}

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown>
) {
  return page.evaluate(
    async (input) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify(input),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: T;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(envelope.error?.message ?? 'P1 query failed');
      }
      return envelope.data;
    },
    { action, module, payload }
  );
}

function activeStoreFacts(page: Page, storeId: string) {
  return p1Query<StoreFact[]>(page, 'context', 'store_facts_active', {
    at: new Date().toISOString(),
    scope: { storeId },
  });
}

async function walkToStep(page: Page, step: string) {
  const wizard = page.getByTestId('store-intake-wizard-store');
  for (let index = 0; index < 5; index += 1) {
    const current = await wizard
      .locator('li[aria-current="step"]')
      .getAttribute('data-step');
    if (current === step) return;
    await wizard.getByTestId('store-intake-next').click();
  }
  throw new Error(`step ${step} was never reached`);
}

test.describe('W02 five-step store intake', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('a price-list photo becomes a confirmed store fact, and its origin is never hidden', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '湖墅南路 88 号',
        booking: '提前一天私信预约',
        brandVoice: '真实、克制',
        city: '杭州',
        district: '拱墅区',
        name: 'W02 五步录入门店',
        prohibitions: ['不虚构价格'],
        projects: [LEGACY_PROJECT],
        regulated: false,
      },
    });
    const before = await productState(page);
    expect(await activeStoreFacts(page, before.workspaceId)).toEqual([]);

    const finalizations: ModuleRequest[] = [];
    page.on('request', (outgoing) => {
      if (!isAction(outgoing, 'finalize_store_intake')) return;
      finalizations.push(moduleRequest(outgoing)!);
    });

    await page.goto('/dashboard/store');
    const wizard = page.getByTestId('store-intake-wizard-store');
    await expect(wizard).toBeVisible({ timeout: 60_000 });

    // Step 1 — the platform sample is labelled as a sample and can be swapped.
    await expect(wizard.getByTestId('store-intake-example')).toBeVisible();
    await wizard.getByTestId('store-intake-example-rotate').click();

    // Step 3 — one photo, uploaded straight into the Core asset space.
    await walkToStep(page, 'say_or_upload');
    await wizard.getByTestId('store-intake-photo').setInputFiles({
      buffer: PRICE_LIST_PHOTO,
      mimeType: 'image/png',
      name: 'w02-price-list.png',
    });
    await expect(wizard.getByTestId('store-intake-photo-error')).toBeHidden();

    // Step 4 — the server reads it; the draft appears without being confirmed.
    await walkToStep(page, 'ai_arrange');
    const parseResponse = page.waitForResponse(
      (response) =>
        isAction(response.request(), 'parse_single_asset') &&
        response.status() < 400,
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-arrange-run').click();
    const parsed = await parseResponse;
    const parsedBody = (await parsed.json()) as {
      data: { draft: AssetDraftView };
    };
    // 资产入库且 provenance=photo_extract — asserted on the server's own draft,
    // not on anything the browser made up.
    expect(parsedBody.data.draft.origin).toBe('parsed');
    expect(
      parsedBody.data.draft.fields.map((field) => field.provenance)
    ).toContain('photo_extract');
    await expect(
      wizard.getByTestId('store-intake-arrange-result')
    ).toBeVisible();

    // Step 5 — the extracted price is prefilled, badged, and still pending.
    await walkToStep(page, 'confirm_each');
    const price = wizard.getByTestId('store-intake-field-projectPrice');
    await expect(price).toHaveValue(PHOTO_PRICE);
    await expect(
      wizard.getByTestId('store-intake-provenance-projectPrice')
    ).toHaveText('照片识别');
    await expect(
      wizard.getByTestId('store-intake-unconfirmed-projectPrice')
    ).toBeVisible();
    await expect(
      wizard.getByTestId('store-intake-confirmed-projectPrice')
    ).toBeHidden();

    for (const field of ['name', 'city', 'projectName', 'projectPrice']) {
      await wizard.getByTestId(`store-intake-confirm-${field}`).click();
    }
    await expect(
      wizard.getByTestId('store-intake-confirmed-projectPrice')
    ).toBeVisible();

    // #244 — the photo read a number; it cannot read how long the merchant
    // means it to hold. Until that is answered the save button stays shut.
    await expect(
      wizard.getByTestId('store-intake-price-validity-unanswered')
    ).toBeVisible();
    await expect(wizard.getByTestId('store-intake-save')).toBeDisabled();
    await wizard
      .getByTestId('store-intake-field-projectPriceValidity-long-term')
      .click();
    await wizard
      .getByTestId('store-intake-confirm-projectPriceValidity')
      .click();
    await expect(
      wizard.getByTestId('store-intake-price-validity-unanswered')
    ).toBeHidden();
    await expect(wizard.getByTestId('store-intake-save')).toBeEnabled();

    const finalizeResponse = page.waitForResponse(
      (response) => isAction(response.request(), 'finalize_store_intake'),
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-save').click();
    const finalized = await finalizeResponse;
    expect(finalized.ok(), await finalized.text()).toBeTruthy();
    await expect(wizard.getByTestId('store-intake-saved')).toBeVisible({
      timeout: 60_000,
    });

    // One write, through the one channel.
    expect(finalizations).toHaveLength(1);
    expect(finalizations[0]!.module).toBe('asset-memory');

    const after = await productState(page);
    expect(after.store?.projects).toEqual([
      {
        ...LEGACY_PROJECT,
        price: Number(PHOTO_PRICE),
        // The merchant said "it stands" — stated, not defaulted.
        priceValidUntil: null,
      },
    ]);
    expect(after.store?.address).toBe(before.store?.address);
    expect(after.store?.booking).toBe(before.store?.booking);

    const facts = await activeStoreFacts(page, after.workspaceId);
    const priceFact = facts.find(
      (fact) => fact.factId === `store-project:${LEGACY_PROJECT.id}:price`
    );
    expect(priceFact).toMatchObject({
      expiresAt: null,
      key: `service.${LEGACY_PROJECT.id}.price`,
      kind: 'price',
      revision: 1,
      value: { amount: Number(PHOTO_PRICE), currency: 'CNY' },
    });
    expect(
      facts.find((fact) => fact.factId === 'store-profile:name:other')?.value
    ).toEqual({ name: 'W02 五步录入门店' });
  });

  test('a failed read hands the merchant the same schema to type in', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '湖墅南路 88 号',
        booking: '提前一天私信预约',
        brandVoice: '真实、克制',
        city: '杭州',
        district: '拱墅区',
        name: 'W02 解析失败门店',
        prohibitions: [],
        projects: [LEGACY_PROJECT],
        regulated: false,
      },
    });

    // Fault injection on the parse leg only — every other command still hits
    // the real backend, and the manual fallback below is a real round trip.
    let failedOnce = false;
    await page.route('**/api/core/p1/commands', async (route) => {
      const body = route.request().postDataJSON() as ModuleRequest;
      if (body?.action === 'parse_single_asset' && !failedOnce) {
        failedOnce = true;
        await route.fulfill({
          body: JSON.stringify({
            error: { code: 'PARSE_FAILED', message: 'injected parse failure' },
          }),
          contentType: 'application/json',
          status: 502,
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/dashboard/store');
    const wizard = page.getByTestId('store-intake-wizard-store');
    await expect(wizard).toBeVisible({ timeout: 60_000 });

    await walkToStep(page, 'say_or_upload');
    await wizard.getByTestId('store-intake-sentence').fill('头皮护理 239 元');
    await wizard.getByTestId('store-intake-photo').setInputFiles({
      buffer: PRICE_LIST_PHOTO,
      mimeType: 'image/png',
      name: 'w02-unreadable.png',
    });

    await walkToStep(page, 'ai_arrange');
    await wizard.getByTestId('store-intake-arrange-run').click();
    await expect(wizard.getByTestId('store-intake-arrange-failed')).toBeVisible(
      {
        timeout: 90_000,
      }
    );

    const manualResponse = page.waitForResponse(
      (response) =>
        isAction(response.request(), 'prepare_manual_asset_draft') &&
        response.status() < 400,
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-arrange-manual').click();
    const manual = await manualResponse;
    const manualBody = (await manual.json()) as { data: AssetDraftView };
    expect(manualBody.data.origin).toBe('manual');
    // 同 schema: the same profile/service keys the parse lane maps from.
    expect(manualBody.data.fields.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        'store.profile.name',
        'store.profile.city',
        'service.name',
        'service.price',
      ])
    );
    for (const field of manualBody.data.fields) {
      expect(field.provenance).toBe('user');
      expect(field.status).toBe('unconfirmed');
    }
  });

  test('a work photo is classified into one of the four contract slots, with a rights reminder that does not block', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '湖墅南路 88 号',
        booking: '提前一天私信预约',
        brandVoice: '真实、克制',
        city: '杭州',
        district: '拱墅区',
        name: 'W02 素材门店',
        prohibitions: [],
        projects: [LEGACY_PROJECT],
        regulated: false,
      },
    });

    await page.goto('/dashboard/store');
    const wizard = page.getByTestId('store-intake-wizard-store');
    await expect(wizard).toBeVisible({ timeout: 60_000 });

    await walkToStep(page, 'say_or_upload');
    await wizard
      .getByTestId('store-intake-target')
      .selectOption('visual_asset');
    await wizard.getByTestId('store-intake-photo').setInputFiles({
      buffer: PRICE_LIST_PHOTO,
      mimeType: 'image/png',
      name: 'w02-work-case.png',
    });
    // The rights prompt is left unanswered on purpose — the contract calls it
    // `blocking: false`, so intake has to continue without it.
    await expect(wizard.getByTestId('store-intake-rights')).not.toBeChecked();

    await walkToStep(page, 'ai_arrange');
    const parseResponse = page.waitForResponse(
      (response) =>
        isAction(response.request(), 'parse_single_asset') &&
        response.status() < 400,
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-arrange-run').click();
    const parsed = await parseResponse;
    const body = (await parsed.json()) as { data: { draft: AssetDraftView } };
    const classification = body.data.draft.visualClassification;
    expect(VISUAL_ASSET_SLOTS).toContain(classification?.slot);
    expect(classification?.rightsPrompt.blocking).toBe(false);
    expect(body.data.draft.fields.map((field) => field.key)).toContain(
      'asset.slot'
    );

    await expect(wizard.getByTestId('store-intake-slot-badge')).toBeVisible();
    await expect(wizard.getByTestId('store-intake-slot-rights')).toBeVisible();
    // Classification is not a fact: nothing was written to the ledger.
    const state = await productState(page);
    expect(await activeStoreFacts(page, state.workspaceId)).toEqual([]);
  });

  test('the upload channel only accepts an object that names its own bytes', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard/store');
    await expect(page.getByTestId('store-intake-wizard-store')).toBeVisible({
      timeout: 60_000,
    });
    const { workspaceId } = await productState(page);

    const results = await page.evaluate(
      async (input) => {
        const bytes = Uint8Array.from(atob(input.png), (character) =>
          character.charCodeAt(0)
        );
        const digest = [
          ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        ]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        const put = async (objectKey: string) => {
          const response = await fetch(
            `/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`,
            {
              body: bytes,
              credentials: 'same-origin',
              headers: { 'content-type': 'image/png' },
              method: 'PUT',
            }
          );
          return response.status;
        };
        return {
          crossWorkspace: await put(
            `other-workspace/canvas/assets/intake-${digest}.png`
          ),
          // The readable allowlist admits this key; the write channel does not.
          freeName: await put(`${input.workspaceId}/canvas/assets/cover.png`),
          honest: await put(
            `${input.workspaceId}/canvas/assets/intake-${digest}.png`
          ),
          lyingDigest: await put(
            `${input.workspaceId}/canvas/assets/intake-${'a'.repeat(64)}.png`
          ),
        };
      },
      { png: PRICE_LIST_PHOTO.toString('base64'), workspaceId }
    );

    expect(results.honest).toBeLessThan(300);
    expect(results.freeName).toBe(403);
    expect(results.crossWorkspace).toBe(403);
    expect(results.lyingDigest).toBe(400);
  });

  test('details entered before the ledger existed are staged for confirmation, never promoted', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '湖墅南路 88 号',
        booking: '提前一天私信预约',
        brandVoice: '真实、克制',
        city: '杭州',
        district: '拱墅区',
        name: 'W02 存量门店',
        prohibitions: [],
        projects: [
          LEGACY_PROJECT,
          {
            confirmed: true,
            durationMinutes: 120,
            id: 'w02-legacy-second',
            name: '手足深度护理',
            price: 499,
          },
        ],
        regulated: false,
      },
    });
    const before = await productState(page);
    expect(await activeStoreFacts(page, before.workspaceId)).toEqual([]);

    await page.goto('/dashboard/store');
    const panel = page.getByTestId('store-intake-import');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    // D-151③: the second project is staged too — the progressive card only ever
    // reached projects[0], which is exactly the gap this closes.
    const secondProject = panel.getByTestId(
      'store-intake-import-project:w02-legacy-second'
    );
    await expect(secondProject).toBeVisible();

    // Staging alone promotes nothing.
    expect(await activeStoreFacts(page, before.workspaceId)).toEqual([]);

    await panel.getByTestId('store-intake-import-confirm').click();
    await expect
      .poll(
        async () => (await activeStoreFacts(page, before.workspaceId)).length,
        {
          timeout: 90_000,
        }
      )
      .toBeGreaterThan(0);

    const facts = await activeStoreFacts(page, before.workspaceId);
    const secondPrice = facts.find(
      (fact) => fact.factId === 'store-project:w02-legacy-second:price'
    );
    expect(secondPrice).toMatchObject({
      revision: 1,
      value: { amount: 499, currency: 'CNY' },
    });
    // The provenance says where the value really came from.
    expect(secondPrice?.source.kind).toBe('import');
    expect(
      facts.find((fact) => fact.factId === 'store-profile:booking:fulfillment')
        ?.value
    ).toEqual({ booking: '提前一天私信预约' });
  });

  test('batch parse: multi-file upload shows Core progress, fixture label, and finalizes once', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '湖墅南路 88 号',
        booking: '提前一天私信预约',
        brandVoice: '真实、克制',
        city: '杭州',
        district: '拱墅区',
        name: 'W02 批量解析门店',
        prohibitions: ['不虚构价格'],
        projects: [LEGACY_PROJECT],
        regulated: false,
      },
    });
    const before = await productState(page);
    expect(await activeStoreFacts(page, before.workspaceId)).toEqual([]);

    const finalizations: ModuleRequest[] = [];
    page.on('request', (outgoing) => {
      if (!isAction(outgoing, 'finalize_store_intake')) return;
      finalizations.push(moduleRequest(outgoing)!);
    });

    await page.goto('/dashboard/store');
    const wizard = page.getByTestId('store-intake-wizard-store');
    await expect(wizard).toBeVisible({ timeout: 60_000 });

    // Capture step: single-file input remains, multi-file is available, and
    // the Core-supplied fixture demo label is DOM-visible (not tooltip-only).
    await walkToStep(page, 'say_or_upload');
    await expect(wizard.getByTestId('store-intake-photo')).toBeVisible();
    await expect(wizard.getByTestId('store-intake-photos')).toBeVisible();
    await expect(
      wizard.getByTestId('store-intake-fixture-label')
    ).toBeVisible();
    await expect(
      wizard.getByTestId('store-intake-fixture-label')
    ).toContainText('演示档');
    await expect(wizard.getByTestId('store-intake-parse-closed')).toBeHidden();

    await wizard.getByTestId('store-intake-photos').setInputFiles([
      {
        buffer: PRICE_LIST_PHOTO,
        mimeType: 'image/png',
        name: 'w02-batch-a.png',
      },
      {
        buffer: PRICE_LIST_PHOTO,
        mimeType: 'image/png',
        name: 'w02-batch-b.png',
      },
    ]);
    await expect(wizard.getByTestId('store-intake-photo-error')).toBeHidden();
    await expect(wizard.getByText(/已上传 2 份/u)).toBeVisible({
      timeout: 60_000,
    });

    // Arrange: fixture label still visible; batch run posts start_parse_asset_batch
    // and surfaces Core merchant progress until drafts land.
    await walkToStep(page, 'ai_arrange');
    await expect(
      wizard.getByTestId('store-intake-fixture-label')
    ).toBeVisible();
    await expect(
      wizard.getByTestId('store-intake-fixture-label')
    ).toContainText('演示档');
    await expect(wizard.getByTestId('store-intake-batch-run')).toBeVisible();

    const batchStart = page.waitForResponse(
      (response) =>
        isAction(response.request(), 'start_parse_asset_batch') &&
        response.status() < 400,
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-batch-run').click();
    const started = await batchStart;
    expect(started.ok(), await started.text()).toBeTruthy();

    await expect(wizard.getByTestId('store-intake-batch-progress')).toBeVisible(
      {
        timeout: 90_000,
      }
    );
    await expect(
      wizard.getByTestId('store-intake-batch-progress')
    ).toContainText(/正在整理|已完成/u);
    await expect(wizard.getByTestId('store-intake-batch-failed')).toBeHidden();
    await expect(wizard.getByTestId('store-intake-arrange-result')).toBeVisible(
      { timeout: 120_000 }
    );

    // Confirm each + finalize single rail (no confirm_asset_intake_fact).
    await walkToStep(page, 'confirm_each');
    const price = wizard.getByTestId('store-intake-field-projectPrice');
    await expect(price).toHaveValue(PHOTO_PRICE);
    await expect(
      wizard.getByTestId('store-intake-provenance-projectPrice')
    ).toHaveText('照片识别');

    for (const field of ['name', 'city', 'projectName', 'projectPrice']) {
      await wizard.getByTestId(`store-intake-confirm-${field}`).click();
    }
    await wizard
      .getByTestId('store-intake-field-projectPriceValidity-long-term')
      .click();
    await wizard
      .getByTestId('store-intake-confirm-projectPriceValidity')
      .click();
    await expect(wizard.getByTestId('store-intake-save')).toBeEnabled();

    const finalizeResponse = page.waitForResponse(
      (response) => isAction(response.request(), 'finalize_store_intake'),
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-save').click();
    const finalized = await finalizeResponse;
    expect(finalized.ok(), await finalized.text()).toBeTruthy();
    await expect(wizard.getByTestId('store-intake-saved')).toBeVisible({
      timeout: 60_000,
    });

    expect(finalizations).toHaveLength(1);
    expect(finalizations[0]!.module).toBe('asset-memory');
    expect(finalizations[0]!.action).toBe('finalize_store_intake');

    const after = await productState(page);
    const facts = await activeStoreFacts(page, after.workspaceId);
    const priceFact = facts.find(
      (fact) => fact.factId === `store-project:${LEGACY_PROJECT.id}:price`
    );
    expect(priceFact).toMatchObject({
      expiresAt: null,
      kind: 'price',
      revision: 1,
      value: { amount: Number(PHOTO_PRICE), currency: 'CNY' },
    });
  });
});
