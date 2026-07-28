/**
 * #244 hard gate — a limited-time price stops being quoted when its window ends.
 *
 * The bug this pins: the wizard used to take a price and store it as "current,
 * never expires" without asking, so a promotion kept turning up in generated
 * content weeks after it ended. The journey walks the whole chain the merchant
 * actually walks — state the window in the wizard, generate inside it, move the
 * clock past it, generate again — and reads the answer off the frozen
 * ContextBundle, which is the thing generation actually quotes from.
 *
 * On the clock: the merchant's browser writes the window and the Core decides
 * whether it is still open, so "拨钟越过有效期" is staged by moving the browser's
 * own clock (`page.clock`) to a day well behind the server's. The window the
 * merchant states from there is a genuine, forward-looking window on their
 * calendar and a closed one on the server's — which is exactly the situation a
 * promotion is in the morning after it ends. No test-only server hook exists,
 * and none is added: the seam under test is the production
 * `listActive(at: now)` filter, untouched.
 *
 * Negative control: take the validity question out of the wizard and this spec
 * cannot even reach its first assertion — the save button never enables, so the
 * first `finalize_store_intake` never leaves the browser.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type {
  ContentPackage,
  ContextBundle,
  StoreFact,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productCommand, productState } from '../fixtures/product';
import {
  assertThreeModalDiscovery,
  JOURNEY_CONTRACTS,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const PROMOTION_PROJECT = {
  confirmed: true,
  durationMinutes: 60,
  id: 'promo-scalp-care',
  name: '头皮舒缓护理',
  price: 199,
} as const;

const PRICE_FACT_ID = `store-project:${PROMOTION_PROJECT.id}:price`;
const SERVICE_FACT_ID = `store-project:${PROMOTION_PROJECT.id}:service`;

/** A day the merchant would type, N days from whatever "today" the page sees. */
function dayFromPageNow(pageNow: number, offsetDays: number) {
  const date = new Date(pageNow + offsetDays * 86_400_000);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
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

/** Read the ledger at the *server's* present, not the page's staged one. */
function activeStoreFacts(page: Page, storeId: string, at: string) {
  return p1Query<StoreFact[]>(page, 'context', 'store_facts_active', {
    at,
    scope: { storeId },
  });
}

async function walkToConfirmStep(page: Page) {
  const wizard = page.getByTestId('store-intake-wizard-store');
  for (let index = 0; index < 5; index += 1) {
    const current = await wizard
      .locator('li[aria-current="step"]')
      .getAttribute('data-step');
    if (current === 'confirm_each') return wizard;
    await wizard.getByTestId('store-intake-next').click();
  }
  throw new Error('the confirm step was never reached');
}

/**
 * State the price and its window through the wizard, and return the request the
 * browser actually sent so the test reads the write rather than assuming it.
 */
async function statePriceWindow(page: Page, validUntilDay: string) {
  const finalizeRequest = page.waitForRequest(
    (outgoing) =>
      outgoing.method() === 'POST' &&
      outgoing.url().includes('/api/core/p1/commands') &&
      (() => {
        try {
          return (
            (outgoing.postDataJSON() as { action?: string }).action ===
            'finalize_store_intake'
          );
        } catch {
          return false;
        }
      })(),
    { timeout: 90_000 }
  );
  const finalizeResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/commands'),
    { timeout: 90_000 }
  );

  const wizard = await walkToConfirmStep(page);
  for (const field of ['projectName', 'projectPrice'] as const) {
    const confirm = wizard.getByTestId(`store-intake-confirm-${field}`);
    if (await confirm.isEnabled()) await confirm.click();
  }
  await wizard
    .getByTestId('store-intake-field-projectPriceValidity-until')
    .click();
  await wizard
    .getByTestId('store-intake-field-projectPriceValidity-date')
    .fill(validUntilDay);
  await wizard.getByTestId('store-intake-confirm-projectPriceValidity').click();

  await expect(wizard.getByTestId('store-intake-save')).toBeEnabled();
  await wizard.getByTestId('store-intake-save').click();
  const sent = await finalizeRequest;
  const settled = await finalizeResponse;
  expect(settled.ok(), await settled.text()).toBeTruthy();
  await expect(wizard.getByTestId('store-intake-saved')).toBeVisible({
    timeout: 60_000,
  });
  return sent.postDataJSON() as {
    payload: {
      batch: {
        candidates: Array<{
          candidateId: string;
          fact: { expiresAt: string | null; key: string };
        }>;
      };
      profilePatch: {
        projects?: { upsert?: Array<{ priceValidUntil?: string | null }> };
      };
    };
  };
}

/**
 * Run one customized copy journey and hand back its frozen ContextBundle.
 *
 * Each journey gets its own page, the way `m04-browser-hard-gate` runs repeat
 * submissions: a Composer session that has already delivered keeps its quote
 * bound to the sentence it priced, and a second send into it arms rather than
 * submits.
 */
async function generateAndFreezeBundle(
  context: BrowserContext,
  prompt: string
) {
  const copyContract = JOURNEY_CONTRACTS.find(
    (contract) => contract.modality === 'copy'
  )!;
  const page = await context.newPage();
  try {
    await page.goto('/dashboard');
    await assertThreeModalDiscovery(page);

    const submissionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    const workId = await submitComposerJourney(page, copyContract, prompt);
    const packageId = (
      (await (await submissionResponse).json()) as {
        data?: { contentPackage?: { id?: string } };
      }
    ).data?.contentPackage?.id;
    expect(packageId).toBeTruthy();
    await waitForResultJourney(page, copyContract, workId);

    let reference: ContentPackage['marketing'] | undefined;
    await expect
      .poll(
        async () => {
          const packages = await p1Query<ContentPackage[]>(
            page,
            'operations',
            'content_packages',
            {}
          );
          reference = packages.find(
            (candidate) => candidate.id === packageId
          )?.marketing;
          return reference?.contextBundle;
        },
        { timeout: 90_000 }
      )
      .toMatchObject({ bundleId: expect.any(String) });

    const bundle = await p1Query<ContextBundle | null>(
      page,
      'context',
      'context_bundle_get',
      {
        bundleId: reference!.contextBundle.bundleId,
        revision: reference!.contextBundle.revision,
      }
    );
    expect(bundle).not.toBeNull();
    return { bundle: bundle!, marketing: reference! };
  } finally {
    await page.close();
  }
}

function quotesPrice(bundle: ContextBundle) {
  return bundle.referencedFactRevisions.some(
    (reference) => reference.factId === PRICE_FACT_ID
  );
}

test.describe('#244 price validity window', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('a limited-time price is quoted inside its window and dropped once the clock passes it', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
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
        name: '青禾头疗',
        prohibitions: ['不虚构价格'],
        projects: [PROMOTION_PROJECT],
        regulated: false,
      },
    });
    const { workspaceId } = await productState(page);
    const serverNow = () => new Date().toISOString();

    /* ---- inside the window --------------------------------------------- */

    await page.goto('/dashboard/store');
    await expect(page.getByTestId('store-intake-wizard-store')).toBeVisible({
      timeout: 60_000,
    });
    const openWindow = await statePriceWindow(
      page,
      dayFromPageNow(Date.now(), 30)
    );
    const statedExpiry = openWindow.payload.batch.candidates.find(
      (candidate) =>
        candidate.fact.key === `service.${PROMOTION_PROJECT.id}.price`
    )?.fact.expiresAt;
    // The window is a merchant statement, not a system default: it rides on the
    // fact and is repeated on the profile side, and the two must agree.
    expect(statedExpiry).toBeTruthy();
    expect(
      openWindow.payload.profilePatch.projects?.upsert?.[0]?.priceValidUntil
    ).toBe(statedExpiry);
    expect(Date.parse(statedExpiry!)).toBeGreaterThan(Date.now());

    const openFacts = await activeStoreFacts(page, workspaceId, serverNow());
    expect(
      openFacts.find((fact) => fact.factId === PRICE_FACT_ID)
    ).toMatchObject({ expiresAt: statedExpiry, revision: 1 });

    const inside = await generateAndFreezeBundle(
      page.context(),
      `为${PROMOTION_PROJECT.name}写一条真实克制的朋友圈项目介绍`
    );
    expect(quotesPrice(inside.bundle)).toBe(true);
    expect(inside.marketing!.factRefs).toContain(
      `store_fact:${PRICE_FACT_ID}:1`
    );

    /* ---- 拨钟：the window closes --------------------------------------- */

    // The merchant's calendar is moved to a day the server has long passed, so
    // the window they state next is open to them and closed to the ledger. It
    // runs on a throwaway page in the same session: a frozen clock stays frozen
    // for the page that installed it, and the Composer measures elapsed time,
    // so the staging must not leak into the journey that follows.
    const lapsedNow = Date.now() - 60 * 86_400_000;
    const lapsedPage = await page.context().newPage();
    await lapsedPage.clock.setFixedTime(new Date(lapsedNow));
    await lapsedPage.goto('/dashboard/store');
    await expect(
      lapsedPage.getByTestId('store-intake-wizard-store')
    ).toBeVisible({ timeout: 60_000 });
    const closedWindow = await statePriceWindow(
      lapsedPage,
      dayFromPageNow(lapsedNow, 7)
    );
    const lapsedExpiry = closedWindow.payload.batch.candidates.find(
      (candidate) =>
        candidate.fact.key === `service.${PROMOTION_PROJECT.id}.price`
    )?.fact.expiresAt;
    expect(Date.parse(lapsedExpiry!)).toBeLessThan(Date.now());
    await lapsedPage.close();

    // The ledger still holds the price — nothing was deleted — it simply no
    // longer answers "what is current".
    const lapsedHistory = await p1Query<StoreFact[]>(
      page,
      'context',
      'store_fact_history',
      { factId: PRICE_FACT_ID }
    );
    expect(lapsedHistory.at(-1)).toMatchObject({
      expiresAt: lapsedExpiry,
      revision: 2,
    });
    const closedFacts = await activeStoreFacts(page, workspaceId, serverNow());
    expect(closedFacts.some((fact) => fact.factId === PRICE_FACT_ID)).toBe(
      false
    );
    // The service name never carried a window, so it is untouched — the price
    // lapsing must not take the rest of the project with it.
    expect(closedFacts.some((fact) => fact.factId === SERVICE_FACT_ID)).toBe(
      true
    );

    const outside = await generateAndFreezeBundle(
      page.context(),
      `再为${PROMOTION_PROJECT.name}写一条真实克制的朋友圈项目介绍`
    );
    expect(quotesPrice(outside.bundle)).toBe(false);
    // The service name never carried a window, so it is still quoted — whatever
    // revision it now stands at. Only the price fell out.
    expect(
      outside.marketing!.factRefs.filter((reference) =>
        reference.startsWith(`store_fact:${SERVICE_FACT_ID}:`)
      )
    ).toHaveLength(1);
    expect(
      outside.marketing!.factRefs.filter((reference) =>
        reference.startsWith(`store_fact:${PRICE_FACT_ID}:`)
      )
    ).toEqual([]);
  });
});
