import type {
  CommandResult,
  ProductCommand,
  ProductState,
} from '@meiye/contracts';
import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PNG_FIXTURES = await Promise.all(
  [
    '../../../public/model-previews/image-beauty-preview.png',
    '../../../public/model-previews/copy-planning-preview.png',
  ].map((path) => readFile(new URL(path, import.meta.url)))
);

export async function productCommand(
  page: Page,
  command: ProductCommand,
  idempotencyKey = `e2e-product-${crypto.randomUUID()}`
) {
  return page.evaluate(
    async ({ command: input, idempotencyKey: key }) => {
      const response = await fetch('/api/core/product/commands', {
        body: JSON.stringify(input),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: CommandResult;
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? 'Product command failed');
      }
      return envelope.data;
    },
    { command, idempotencyKey }
  );
}

export async function productState(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/product/state', {
      credentials: 'same-origin',
    });
    const envelope = (await response.json()) as {
      data?: ProductState;
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Product state failed');
    }
    return envelope.data;
  });
}

/**
 * Confirm the Product store and its matching StoreFact revisions through the
 * public finalization command. Existing Composer journeys require both
 * projections; a ProductState-only seed is intentionally fact-incomplete.
 */
export async function seedConfirmedStore(page: Page) {
  await productCommand(page, {
    type: 'confirm_store',
    store: {
      accounts: [],
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '专业、克制、像熟客推荐',
      city: '杭州',
      district: '拱墅区',
      name: 'E2E 美业门店',
      prohibitions: ['不虚构价格'],
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-grounded-creation',
          name: '透亮猫眼',
          price: 299,
        },
      ],
      regulated: false,
    },
  });
  const state = await productState(page);
  const store = state.store;
  const project = store?.projects.find(
    ({ id }) => id === 'project-grounded-creation'
  );
  if (store?.revision === undefined || !project) {
    throw new Error('Confirmed store project is missing from ProductState');
  }
  const suffix = crypto.randomUUID();
  const capturedAt = new Date(Date.now() - 1_000).toISOString();
  const batchId = `seed-confirmed-store-${suffix}`;
  const serviceCandidateId = `${batchId}:service`;
  const priceCandidateId = `${batchId}:price`;
  const referenceId = `${batchId}:merchant-confirmation`;
  const result = (await page.evaluate(
    async (payload) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: 'finalize_store_intake',
          module: 'asset-memory',
          payload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `product-fixture:finalize_store_intake:${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ??
            'asset-memory.finalize_store_intake command failed'
        );
      }
      return envelope.data;
    },
    {
      batch: {
        batchId,
        candidates: [
          {
            candidateId: serviceCandidateId,
            fact: {
              effectiveFrom: capturedAt,
              expiresAt: null,
              key: `service.${project.id}.name`,
              kind: 'service',
              scope: { storeId: state.workspaceId },
              source: {
                capturedAt,
                kind: 'user_confirmation',
                referenceId,
              },
              value: { name: project.name },
            },
            objectKind: 'store_fact',
            status: 'pending',
          },
          {
            candidateId: priceCandidateId,
            fact: {
              effectiveFrom: capturedAt,
              expiresAt: null,
              key: `service.${project.id}.price`,
              kind: 'price',
              scope: { storeId: state.workspaceId },
              source: {
                capturedAt,
                kind: 'user_confirmation',
                referenceId,
              },
              value: { amount: project.price, currency: 'CNY' },
            },
            objectKind: 'store_fact',
            status: 'pending',
          },
        ],
        source: {
          capabilityStatus: 'assisted',
          capturedAt,
          example: false,
          kind: 'manual',
          referenceId,
          sourceId: `${batchId}:source`,
          sourceWorkspaceId: state.workspaceId,
        },
        summary: 'E2E confirmed store service and price facts.',
        taskId: `${batchId}:task`,
      },
      confirmations: [
        {
          candidateId: serviceCandidateId,
          expectedFactRevision: 0,
          factId: `store-project:${project.id}:service`,
        },
        {
          candidateId: priceCandidateId,
          expectedFactRevision: 0,
          factId: `store-project:${project.id}:price`,
        },
      ],
      profilePatch: {
        expectedRevision: store.revision,
        projects: {
          upsert: [
            { ...project, priceValidUntil: project.priceValidUntil ?? null },
          ],
        },
      },
    }
  )) as {
    facts: Array<{ factId: string; revision: number }>;
  };
  expect(result.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        factId: `store-project:${project.id}:service`,
        revision: 1,
      }),
      expect.objectContaining({
        factId: `store-project:${project.id}:price`,
        revision: 1,
      }),
    ])
  );
}

/**
 * State the store's industry the way the intake wizard does (D-174): one
 * finalize_store_intake batch that writes the profile field and its ledger fact
 * together, which is what the today-recommendation industry layer reads.
 *
 * Seed before running the task that should carry the industry whyNow — a fact
 * written afterwards bumps the fact revision and correctly marks the delivered
 * recommendation stale instead of relabelling it.
 */
export async function seedStoreIndustry(page: Page, industry: string) {
  const state = await productState(page);
  const storeRevision = state.store?.revision;
  if (storeRevision === undefined) {
    throw new Error('Confirmed store is missing from ProductState');
  }
  const suffix = crypto.randomUUID();
  const capturedAt = new Date(Date.now() - 1_000).toISOString();
  const batchId = `seed-store-industry-${suffix}`;
  const candidateId = `${batchId}:industry`;
  const referenceId = `${batchId}:merchant-confirmation`;
  const factId = 'store-profile:industry:other';
  const result = (await page.evaluate(
    async (payload) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: 'finalize_store_intake',
          module: 'asset-memory',
          payload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `product-fixture:finalize_store_intake:${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { code?: string; message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          `industry finalize_store_intake failed: ${JSON.stringify(envelope.error)}`
        );
      }
      return envelope.data;
    },
    {
      batch: {
        batchId,
        candidates: [
          {
            candidateId,
            fact: {
              effectiveFrom: capturedAt,
              expiresAt: null,
              key: 'store.profile.industry',
              kind: 'other',
              scope: { storeId: state.workspaceId },
              source: {
                capturedAt,
                kind: 'user_confirmation',
                referenceId,
              },
              value: { industry },
            },
            objectKind: 'store_fact',
            status: 'pending',
          },
        ],
        source: {
          capabilityStatus: 'assisted',
          capturedAt,
          example: false,
          kind: 'manual',
          referenceId,
          sourceId: `${batchId}:source`,
          sourceWorkspaceId: state.workspaceId,
        },
        summary: 'E2E merchant-stated store industry.',
        taskId: `${batchId}:task`,
      },
      confirmations: [{ candidateId, expectedFactRevision: 0, factId }],
      profilePatch: { expectedRevision: storeRevision, industry },
    }
  )) as { facts: Array<{ factId: string; revision: number }> };
  expect(result.facts).toEqual(
    expect.arrayContaining([expect.objectContaining({ factId, revision: 1 })])
  );
  // The profile is the industry layer's source of truth, so prove the write
  // landed there too rather than only on the ledger.
  expect((await productState(page)).store?.industry).toBe(industry);
}

/**
 * Day-0 inline authorize seed via composer path (NOT library detail form).
 * Must complete before user-activation measurement begins.
 */
export async function seedComposerInlineAuthorize(
  page: Page,
  options: {
    expectedAssetId?: string;
    fileName?: string;
    fixtureIndex?: 0 | 1;
  } = {}
) {
  const fileName =
    options.fileName ?? `e2e-inline-auth-${crypto.randomUUID()}.png`;
  if (!page.url().includes('/dashboard')) {
    await page.goto('/dashboard');
  }
  const existingAssetIds = new Set(
    (await productState(page)).assets.map(({ id }) => id)
  );
  // L3-2: gallery input lives in the attach capsule popover (portal).
  const attachPanel = page.getByTestId('composer-capsule-attach-panel');
  if (!(await attachPanel.isVisible().catch(() => false))) {
    await page.getByTestId('composer-capsule-attach').click();
    await expect(attachPanel).toBeVisible({ timeout: 15_000 });
  }
  const galleryInput = page.locator('#composer-gallery-input');
  await expect(galleryInput).toBeAttached({ timeout: 30_000 });
  await galleryInput.setInputFiles({
    buffer: PNG_FIXTURES[options.fixtureIndex ?? 0]!,
    mimeType: 'image/png',
    name: fileName,
  });
  const oneClickYes = page.getByRole('button', {
    name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
  });
  await expect(oneClickYes).toBeVisible({ timeout: 30_000 });
  await oneClickYes.click();
  await expect(
    page.getByText(/已保存到素材库|素材信息已确认|Saved to assets/).first()
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const state = await productState(page);
        return state.assets.some(
          (asset) =>
            (options.expectedAssetId
              ? asset.id === options.expectedAssetId
              : !existingAssetIds.has(asset.id)) &&
            asset.consentScope === 'public_marketing' &&
            Boolean(asset.rightsEvidence?.trim())
        );
      },
      { timeout: 60_000 }
    )
    .toBe(true);
  const authorized = (await productState(page)).assets.find(
    (asset) =>
      (options.expectedAssetId
        ? asset.id === options.expectedAssetId
        : !existingAssetIds.has(asset.id)) &&
      asset.consentScope === 'public_marketing' &&
      Boolean(asset.rightsEvidence?.trim())
  );
  if (!authorized)
    throw new Error('Composer inline authorize produced no asset');
  // L3-2: leave the attach portal closed. An open capsule panel sits in a
  // base-ui portal that intercepts pointer events over in-stream cards
  // (viral sourcing "继续确认", journey submit, etc.).
  if (await attachPanel.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(attachPanel).toBeHidden({ timeout: 10_000 });
  }
  return authorized;
}

/**
 * Grounded creation seed: a confirmed store with one confirmed project, plus a
 * real, publicly authorized image already attached to this run as its source.
 *
 * This used to walk the library path — upload on `/dashboard/assets`, authorize
 * on the detail form, then pick the asset back up on the creation entry behind
 * its 「更多」→「素材来源」 strip. That strip left with the retired creation
 * entry when the Composer became the primary surface (`f9c2e5a4`), so the
 * helper had been waiting 30s for a button no build renders since. The
 * Composer's own gallery input is now the only way an asset becomes a run
 * source, and it writes the same authorized library asset; the detail-form
 * authorization keeps its own coverage in `product-asset-upload.spec.ts`.
 */
export async function seedAuthorizedGrounding(page: Page) {
  await productCommand(page, {
    type: 'confirm_store',
    store: {
      accounts: [],
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '专业、克制、像熟客推荐',
      city: '杭州',
      district: '拱墅区',
      name: 'E2E 美业门店',
      prohibitions: ['不虚构价格'],
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-grounded-creation',
          name: '透亮猫眼',
          price: 299,
        },
      ],
      regulated: false,
    },
  });

  // The library path reloaded the Composer on its way back from the asset
  // detail page; keep that, so the surface mounts against the store this seed
  // just confirmed instead of the cold state it was rendered with.
  await page.goto('/dashboard');
  const authorized = await seedComposerInlineAuthorize(page, {
    fileName: `e2e-grounding-${crypto.randomUUID()}.png`,
  });
  return authorized.id;
}

export async function seedAcceptedProductContent(page: Page, prefix: string) {
  const projectId = `project-${prefix}`;
  const assetId = `asset-${prefix}`;
  const confirmed = await productCommand(page, {
    type: 'confirm_store',
    store: {
      name: 'E2E 美业门店',
      city: '杭州',
      district: '拱墅区',
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '专业、克制、像熟客推荐',
      prohibitions: ['不承诺疗效', '不虚构价格'],
      accounts: [{ platform: 'xiaohongshu', nickname: 'E2E 美业门店小红书' }],
      projects: [
        {
          id: projectId,
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
        },
      ],
      regulated: false,
    },
  });
  await productCommand(page, {
    type: 'add_asset',
    asset: {
      id: assetId,
      objectKey: `${confirmed.state.workspaceId}/assets/${assetId}.png`,
      mediaType: 'image',
      sourceType: 'real',
      tags: ['猫眼', '显白'],
      rightsOwner: 'E2E 美业门店',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
    },
  });
  await productCommand(page, {
    type: 'authorize_asset',
    assetId,
    consentScope: 'public_marketing',
    rightsEvidence: 'e2e-owner-confirmed',
  });
  const generated = await productCommand(page, {
    type: 'generate_copy',
    brief: {
      assetIds: [assetId],
      conversionGoal: '预约到店',
      hook: '阴天也透亮的猫眼',
      platform: 'xiaohongshu',
      projectId,
      scenario: '项目种草',
      tone: '口语、克制',
    },
  });
  const contentId = generated.output.candidateIds?.[0];
  if (!contentId) throw new Error('Product candidate was not generated');
  await productCommand(page, { type: 'select_content', contentId });
  return { assetId, contentId, projectId };
}
