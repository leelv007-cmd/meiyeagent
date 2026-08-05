import { expect, test, type Page, type Request } from '@playwright/test';
import type { ContentPackage, StoreFact } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productCommand,
  productState,
  seedComposerInlineAuthorize,
} from '../fixtures/product';
import {
  closeComposerCapsule,
  JOURNEY_CONTRACTS,
  openComposerRecipeCard,
  selectComposerLens,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const PRIMARY_PROJECT = {
  confirmed: true,
  durationMinutes: 75,
  id: 'legacy-project-primary',
  name: '透亮猫眼护理',
  price: 299,
} as const;

const SECONDARY_PROJECT = {
  confirmed: true,
  durationMinutes: 120,
  id: 'legacy-project-secondary',
  name: '手足深度护理',
  price: 499,
} as const;

const EXPECTED_PRICE = 329;
const SERVICE_FACT_ID = `store-project:${PRIMARY_PROJECT.id}:service`;
const PRICE_FACT_ID = `store-project:${PRIMARY_PROJECT.id}:price`;

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

function isStoreIntakeFinalization(request: Request) {
  const body = moduleRequest(request);
  return (
    body?.module === 'asset-memory' && body.action === 'finalize_store_intake'
  );
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

function contentPackages(page: Page) {
  return p1Query<ContentPackage[]>(page, 'operations', 'content_packages', {});
}

test.describe('W01 store intake fact wiring', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('one inline confirmation reaches the customized delivery context without erasing the store profile', async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [
          {
            homepageUrl: 'https://example.test/xhs',
            nickname: '青禾美甲小红书',
            platform: 'xiaohongshu',
            verificationStatus: 'verified',
          },
          {
            homepageUrl: 'https://example.test/douyin',
            nickname: '青禾美甲抖音',
            platform: 'douyin',
            verificationStatus: 'restricted',
          },
        ],
        address: '湖墅南路 88 号',
        booking: '提前一天私信预约',
        brandVoice: '专业、克制、像熟客推荐',
        city: '杭州',
        district: '拱墅区',
        name: '青禾美甲',
        prohibitions: ['不承诺疗效', '不虚构价格'],
        projects: [PRIMARY_PROJECT, SECONDARY_PROJECT],
        regulated: false,
      },
    });

    const before = await productState(page);
    expect(before.store).toMatchObject({
      accounts: [
        { nickname: '青禾美甲小红书', platform: 'xiaohongshu' },
        { nickname: '青禾美甲抖音', platform: 'douyin' },
      ],
      projects: [PRIMARY_PROJECT, SECONDARY_PROJECT],
      prohibitions: ['不承诺疗效', '不虚构价格'],
      regulated: false,
    });
    expect(await activeStoreFacts(page, before.workspaceId)).toEqual([]);

    const finalizationRequests: ModuleRequest[] = [];
    page.on('request', (outgoing) => {
      if (!isStoreIntakeFinalization(outgoing)) return;
      finalizationRequests.push(moduleRequest(outgoing)!);
    });

    await page.goto('/dashboard');
    const card = page.getByTestId('progressive-fact-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const input = card.getByTestId('progressive-fact-input');
    await expect(input).toHaveValue(PRIMARY_PROJECT.name);
    await card.getByTestId('progressive-fact-continue').click();

    await expect(input).toHaveValue(String(PRIMARY_PROJECT.price));
    await input.fill(String(EXPECTED_PRICE));
    await card.getByTestId('progressive-fact-continue').click();

    // #244 — the card asks how long the price runs before it will confirm
    // anything. The merchant here says it is a standing price.
    await expect(
      card.getByTestId('progressive-fact-price-validity')
    ).toBeVisible();
    await expect(card.getByTestId('progressive-fact-confirm')).toBeHidden();
    await card.getByTestId('progressive-fact-price-validity-long-term').click();
    await card.getByTestId('progressive-fact-continue').click();

    const finalizationResponse = page.waitForResponse(
      (response) => isStoreIntakeFinalization(response.request()),
      { timeout: 60_000 }
    );
    await card.getByTestId('progressive-fact-confirm').click();
    const finalized = await finalizationResponse;
    expect(finalized.ok(), await finalized.text()).toBeTruthy();
    await expect(card).toBeHidden({ timeout: 60_000 });
    expect(finalizationRequests).toHaveLength(1);

    const finalization = finalizationRequests[0]!;
    const intake = finalization.payload as {
      batch?: {
        candidates?: Array<{
          candidateId?: string;
          fact?: { source?: { referenceId?: string } };
        }>;
        source?: { referenceId?: string };
      };
      confirmations?: Array<{
        candidateId?: string;
        expectedFactRevision?: number;
        factId?: string;
      }>;
    };
    expect(intake.confirmations).toEqual([
      {
        candidateId: `${SERVICE_FACT_ID}:candidate`,
        expectedFactRevision: 0,
        factId: SERVICE_FACT_ID,
      },
      {
        candidateId: `${PRICE_FACT_ID}:candidate`,
        expectedFactRevision: 0,
        factId: PRICE_FACT_ID,
      },
    ]);
    expect(intake.batch?.candidates).toHaveLength(2);

    const after = await productState(page);
    expect(after.store).toMatchObject({
      accounts: before.store?.accounts,
      address: before.store?.address,
      booking: before.store?.booking,
      brandVoice: before.store?.brandVoice,
      city: before.store?.city,
      district: before.store?.district,
      name: before.store?.name,
      prohibitions: before.store?.prohibitions,
      regulated: before.store?.regulated,
    });
    expect(after.store?.projects).toEqual([
      { ...PRIMARY_PROJECT, price: EXPECTED_PRICE, priceValidUntil: null },
      SECONDARY_PROJECT,
    ]);

    const activeFacts = await activeStoreFacts(page, after.workspaceId);
    const serviceFact = activeFacts.find(
      (fact) => fact.factId === SERVICE_FACT_ID
    );
    const priceFact = activeFacts.find((fact) => fact.factId === PRICE_FACT_ID);
    const referenceId = intake.batch?.source?.referenceId;
    expect(referenceId).toBeTruthy();
    expect(serviceFact).toMatchObject({
      expiresAt: null,
      factId: SERVICE_FACT_ID,
      key: `service.${PRIMARY_PROJECT.id}.name`,
      kind: 'service',
      revision: 1,
      scope: { storeId: after.workspaceId },
      source: {
        kind: 'user_confirmation',
        referenceId,
      },
      value: { name: PRIMARY_PROJECT.name },
    });
    expect(priceFact).toMatchObject({
      expiresAt: null,
      factId: PRICE_FACT_ID,
      key: `service.${PRIMARY_PROJECT.id}.price`,
      kind: 'price',
      revision: 1,
      scope: { storeId: after.workspaceId },
      source: {
        kind: 'user_confirmation',
        referenceId,
      },
      value: { amount: EXPECTED_PRICE, currency: 'CNY' },
    });

    const submissionRequest = page.waitForRequest(
      (outgoing) =>
        outgoing.method() === 'POST' &&
        outgoing.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 60_000 }
    );
    const submissionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 60_000 }
    );
    const copyContract = JOURNEY_CONTRACTS.find(
      (contract) => contract.modality === 'copy'
    )!;
    const workId = await submitComposerJourney(
      page,
      copyContract,
      `为${PRIMARY_PROJECT.name}写一条真实克制的朋友圈项目介绍`
    );
    const submittedRequest = await submissionRequest;
    expect(submittedRequest.postDataJSON()).toMatchObject({
      creationMode: 'customized',
      recipe: { id: 'recipe.project_intro' },
    });
    const submittedResponse = await submissionResponse;
    const submittedEnvelope = (await submittedResponse.json()) as {
      data?: { contentPackage?: { id?: string } };
    };
    const packageId = submittedEnvelope.data?.contentPackage?.id;
    expect(packageId).toBeTruthy();

    await waitForResultJourney(page, copyContract, workId);

    let contentPackage: ContentPackage | undefined;
    await expect
      .poll(
        async () => {
          contentPackage = (await contentPackages(page)).find(
            (candidate) => candidate.id === packageId
          );
          return contentPackage?.marketing?.contextBundle;
        },
        { timeout: 60_000 }
      )
      .toMatchObject({
        bundleId: expect.any(String),
        hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        revision: expect.any(Number),
      });

    const exactFacts = [serviceFact!, priceFact!].sort((left, right) =>
      left.factId.localeCompare(right.factId)
    );

    const expectedFactReferences = exactFacts
      .map((fact) => `store_fact:${fact.factId}:${fact.revision}`)
      .sort();
    expect([...contentPackage!.marketing!.factRefs].sort()).toEqual(
      expectedFactReferences
    );
    expect(finalizationRequests).toHaveLength(1);

    const imageTextPage = await context.newPage();
    try {
      await imageTextPage.goto('/dashboard');
      await selectComposerLens(imageTextPage, 'image_text');
      const authorized = await seedComposerInlineAuthorize(imageTextPage, {
        fileName: 'confirmed-facts-case.png',
      });
      // reload unmounts every capsule — re-select the lens afterwards.
      await imageTextPage.reload();
      await selectComposerLens(imageTextPage, 'image_text');
      const recipePanel = await openComposerRecipeCard(
        imageTextPage,
        'composer-recipe-card-recipe.case_to_xhs_note'
      );
      const applyRecipe = imageTextPage.getByRole('button', {
        name: '套用并更新设置',
      });
      const recipeApplied = imageTextPage.getByTestId(
        'composer-recipe-apply-undo'
      );
      await expect(recipeApplied.or(applyRecipe)).toBeVisible();
      if (await applyRecipe.isVisible()) await applyRecipe.click();
      await expect(recipeApplied).toBeVisible();
      await closeComposerCapsule(imageTextPage, recipePanel);
      await seedComposerInlineAuthorize(imageTextPage, {
        expectedAssetId: authorized.id,
        fileName: 'confirmed-facts-case.png',
      });

      const imageTextSubmission = imageTextPage.waitForRequest(
        (outgoing) =>
          outgoing.method() === 'POST' &&
          outgoing.url().includes('/api/core/p1/composer/submissions'),
        { timeout: 60_000 }
      );
      const imageTextSubmissionResponse = imageTextPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/api/core/p1/composer/submissions'),
        { timeout: 60_000 }
      );
      const imageTextContract = JOURNEY_CONTRACTS.find(
        (contract) => contract.modality === 'image_text'
      )!;
      const imageTextWorkId = await submitComposerJourney(
        imageTextPage,
        imageTextContract,
        '把已授权的护理案例做成一条真实克制的小红书图文笔记',
        {
          onSubmissionAccepted: async () => {
            expect((await imageTextSubmission).postDataJSON()).toMatchObject({
              recipe: { id: 'recipe.case_to_xhs_note' },
            });
            // The note direction (click or frozen-route pre-answer) is
            // handled inside submitComposerJourney via
            // chooseImageTextDirection; this spec only proves fact wiring.
          },
        }
      );
      const imageTextSubmittedResponse = await imageTextSubmissionResponse;
      const imageTextSubmittedEnvelope =
        (await imageTextSubmittedResponse.json()) as {
          data?: { contentPackage?: { id?: string } };
        };
      const imageTextPackageId =
        imageTextSubmittedEnvelope.data?.contentPackage?.id;
      expect(imageTextPackageId).toBeTruthy();
      await waitForResultJourney(
        imageTextPage,
        imageTextContract,
        imageTextWorkId
      );
      await expect
        .poll(
          async () =>
            (await contentPackages(imageTextPage)).find(
              (candidate) => candidate.id === imageTextPackageId
            )?.marketing?.factRefs,
          { timeout: 60_000 }
        )
        .toEqual([]);
    } finally {
      await imageTextPage.close();
    }
  });
});
