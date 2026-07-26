import { expect, test, type Page } from '@playwright/test';

import { cleanupE2EUsers } from '../fixtures/auth';
import { setTheme, type ThemeMode } from '../fixtures/page-health';
import {
  productState,
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { createE2EUser } from '../fixtures/test-data';
import {
  adoptResult,
  assertJourneyRestored,
  assertThreeModalDiscovery,
  downloadFullPackage,
  JOURNEY_CONTRACTS,
  openDeliveryPanel,
  submitComposerJourney,
  waitForResultJourney,
  type JourneyContract,
} from '../fixtures/ui-journey';

/**
 * T39 (#233) — the R-gate closeout journey matrix.
 *
 * One new store owner's whole life on the shipped seam, once per output:
 *
 *   注册 (real /auth/register → /api/auth/sign-up/email)
 *     → Day-0 冷态 (三行业只读示例店；浏览/换行业/刷新零写入)
 *     → 首次出活 (Composer 提交 → 流式 → 成品预览卡 → Result Center)
 *     → 采用
 *     → 三路交付 (取文件 / 协办交接 / 发布确认)
 *     → 计费对账 (三桶各自扣减、预估=回执、视频按条)
 *     → 刷新恢复
 *
 * Deliberately **not** in the required PR set. The required browser position is
 * M-04's `m04-browser-hard-gate.spec.ts` (T37); this matrix is wider and slower,
 * so it rides the label-gated RC path (`run-release-candidate-quality.sh` runs
 * the whole suite) plus the closeout lane run. `run-pr-production-journey.sh`
 * and its mirror assertion in `scripts/ci/quality-gates.test.mjs` are untouched.
 *
 * Theme and viewport are looped **inside** the spec rather than expressed as
 * playwright projects: the config ships exactly one chromium project at
 * 1440x900 with `workers: 1, fullyParallel: false`, so a project matrix would
 * multiply the wall clock of every job that runs the suite. `p1-f2-acceptance`
 * already sets that convention.
 *
 * D-133: the native 视频 result has no editing or regeneration surface — this
 * matrix never asks one to exist. 视频 legs go 采用 → 交付 → 恢复.
 */

type MatrixLeg = {
  contract: JourneyContract;
  intent: string;
  label: string;
  theme: ThemeMode;
  viewport: { width: number; height: number };
};

const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 375, height: 812 } as const;

function contractFor(deliveryTarget: JourneyContract['deliveryTarget']) {
  const contract = JOURNEY_CONTRACTS.find(
    (candidate) => candidate.deliveryTarget === deliveryTarget
  );
  if (!contract) {
    // Loud on purpose: a shrunken contract table must break the matrix rather
    // than quietly deliver fewer outputs than the R-01 row names.
    throw new Error(
      `T39 matrix requires a ${deliveryTarget} journey contract; JOURNEY_CONTRACTS carries ${JOURNEY_CONTRACTS.map(
        (candidate) => candidate.deliveryTarget
      ).join('/')}`
    );
  }
  return contract;
}

/**
 * Four outputs × theme × viewport, one leg each.
 *
 * The Composer ships three lenses (`launch-seeds.ts`: copy / image_text /
 * video), so the fourth output is the second 视频 distribution target rather
 * than a fourth lens. The 图文 leg is the ImageTextNote 全包 R-01 names — its
 * contract asks for 完整发布包（小红书）and the ZIP assertion checks the
 * manifest, caption, checklist and every declared file.
 */
const MATRIX_LEGS: readonly MatrixLeg[] = [
  {
    contract: contractFor('wechat_moments'),
    intent: '皮肤护理 朋友圈项目介绍',
    label: '文案 · 亮色 · 桌面',
    theme: 'light',
    viewport: DESKTOP,
  },
  {
    contract: contractFor('xiaohongshu'),
    intent: '皮肤护理 小红书套图',
    label: '图文全包 · 暗色 · 桌面',
    theme: 'dark',
    viewport: DESKTOP,
  },
  {
    contract: contractFor('douyin'),
    intent: '皮肤护理 抖音项目成片',
    label: '视频 · 亮色 · 移动端',
    theme: 'light',
    viewport: MOBILE,
  },
  {
    contract: contractFor('video_account'),
    intent: '皮肤护理 视频号项目成片',
    label: '视频 · 暗色 · 移动端',
    theme: 'dark',
    viewport: MOBILE,
  },
];

/** Which entitlement bucket a modality spends. */
const BILLING_BUCKET: Record<JourneyContract['modality'], BillingResource> = {
  copy: 'copy',
  image_text: 'image',
  video: 'video',
};

type BillingResource = 'audio' | 'copy' | 'image' | 'video';

const BILLING_BUCKETS: readonly BillingResource[] = [
  'audio',
  'copy',
  'image',
  'video',
];

type UsageBucket = {
  allowance: number;
  available: number;
  committed: number;
  released: number;
  reserved: number;
};

type EntitlementProjection = {
  plan?: { tier?: string };
  usage: Record<BillingResource, UsageBucket>;
};

type ProductUsageUnit = { quantity: number; resource: BillingResource };

type ProductUsageRecord = {
  reservedQuantity: number;
  reservedUnits?: ProductUsageUnit[];
  settledQuantity: number;
  settledUnits?: ProductUsageUnit[];
  settlementStatus?: string;
  status: string;
  taskId: string;
};

type ProductQuoteSnapshot = {
  billingMode: string;
  outputCount?: number;
  quoteId: string;
  settlementStatus?: string;
  taskId?: string;
};

/**
 * 商家语言反向断言 (D-116).
 *
 * UUID / raw lifecycle enums / provider and model slugs / internal ids never
 * reach a merchant surface, and neither does any unit-price or margin wording.
 */
const MERCHANT_LEAK_PATTERN =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b|(?:\b(?:running|ready|delivered|candidate_ready|needs_input|automatic_verified|assisted|unavailable|internal_only|public_marketing|reserved|committed|reconciled)\b)|(?:provider|workId=|workspaceId=|taskId=|packageId=|assetId=|catalogModelId|store_fact:|seedance-2|seedream-5-pro|deepseek-v4-pro)|(?:成本价|毛利|供应商单价)/iu;

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return page.evaluate(
    async ({ queryAction, queryModule, queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: queryModule,
          payload: queryPayload,
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
        throw new Error(
          envelope.error?.message ??
            `${queryModule}.${queryAction} query failed`
        );
      }
      return envelope.data;
    },
    { queryAction: action, queryModule: module, queryPayload: payload }
  ) as Promise<T>;
}

/**
 * Reverse assertion on merchant language. Scope, stated so nobody reads a green
 * run as full coverage:
 *   - `innerText()` returns **rendered** text only — a leak inside a collapsed
 *     accordion, a closed dialog, an `aria-hidden` branch or an unopened tab is
 *     not scanned.
 *   - matching is **per trimmed line**, so a leak split across a line break
 *     (a wrapped UUID, a slug broken by the layout) is not matched.
 * What it does cover: every visible line of the four sampled surfaces, for
 * leaks that fit on one line.
 */
async function assertMerchantLanguage(page: Page, surface: string) {
  const text = await page.locator('body').innerText();
  const leaks = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && MERCHANT_LEAK_PATTERN.test(line));
  expect(
    leaks,
    `${surface} must stay merchant language — no UUID, raw state, provider slug, internal id or price wording: ${leaks.join(' | ')}`
  ).toEqual([]);
}

/**
 * Registration through the product's own form, on the real Better Auth
 * endpoint. A seeded session would skip the one step every merchant takes.
 */
async function registerThroughTheProductForm(page: Page) {
  const user = createE2EUser();
  await page.goto('/auth/register');
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="name"]').fill(user.name);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  const registrationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/auth/sign-up/email')
  );
  await page.getByRole('button', { name: /^sign up$|^注册$/iu }).click();
  const registrationResponse = await registrationResponsePromise;
  expect(
    registrationResponse.ok(),
    await registrationResponse.text()
  ).toBeTruthy();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const response = await fetch('/api/auth/get-session', {
            credentials: 'same-origin',
          });
          if (!response.ok) return null;
          const session = (await response.json()) as {
            user?: { email?: string };
          } | null;
          return session?.user?.email ?? null;
        }),
      { timeout: 30_000 }
    )
    .toBe(user.email);
  return user;
}

type ColdWorkspaceFacts = {
  assets: unknown[];
  contents: unknown[];
  jobs: unknown[];
  works: unknown[];
};

async function coldWorkspaceFacts(page: Page) {
  const creative = await p1Query<ColdWorkspaceFacts>(
    page,
    'operations',
    'creative_workbench'
  );
  const packages = await p1Query<unknown[]>(
    page,
    'operations',
    'content_packages'
  );
  return {
    assets: creative.assets ?? [],
    contents: creative.contents ?? [],
    contentPackages: packages,
    jobs: creative.jobs ?? [],
    works: creative.works ?? [],
  };
}

/**
 * Day-0 冷态: the three-industry sample showcase (TEST-CATALOG §25).
 *
 * The acceptance shape is 只读 + opt-in — browsing, switching industry and
 * reloading must create no Work, Job, Asset, ContentPackage or store fact. The
 * assertion is taken twice, before and after the interaction, so a write that
 * lands on any of those surfaces is attributable to the browsing itself.
 */
async function assertDayZeroSampleStoresStayReadOnly(page: Page) {
  await expect(page.getByTestId('dashboard-home-surface')).toBeVisible({
    timeout: 60_000,
  });
  const before = await coldWorkspaceFacts(page);
  expect(
    before,
    'a freshly registered workspace owns nothing yet'
  ).toMatchObject({
    assets: [],
    contentPackages: [],
    contents: [],
    jobs: [],
    works: [],
  });

  const showcase = page.getByTestId('example-store-showcase');
  await expect(
    showcase,
    'the sample showcase is opt-in — hidden by default'
  ).toBeHidden();
  await page.getByRole('button', { name: '查看示例' }).click();
  await expect(showcase).toBeVisible();

  // The three seeded industries (`recipe-studio-samples.ts`) reach the browser
  // by key and by merchant label alike.
  expect(
    (await productState(page)).exampleStores.map((store) => store.industry)
  ).toEqual(['hair_care', 'skin_management', 'hair_growth']);
  const industries = showcase.getByRole('radiogroup', {
    name: '选择示例门店行业',
  });
  await expect(industries.getByRole('radio')).toHaveCount(3);
  for (const industry of ['护发', '皮肤管理', '生发']) {
    await expect(
      industries.getByRole('radio', { name: industry }),
      `Day-0 must offer the ${industry} sample store`
    ).toBeVisible();
  }
  await expect(
    showcase.getByText('只读 · 浏览不消耗额度').first(),
    'the showcase must say out loud that browsing costs nothing'
  ).toBeVisible();

  // Switch industry, then reload — both are the interactions TEST-CATALOG §25
  // names as write-free.
  await industries.getByRole('radio', { name: '生发' }).click();
  await expect(showcase).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('dashboard-home-surface')).toBeVisible({
    timeout: 60_000,
  });

  const after = await coldWorkspaceFacts(page);
  expect(
    after,
    'browsing / switching industry / reloading the sample showcase must write nothing'
  ).toEqual(before);
  await assertMerchantLanguage(page, 'Day-0 冷态工作台');
}

async function entitlementProjection(page: Page) {
  return p1Query<EntitlementProjection>(page, 'entitlements', 'projection');
}

function bucketSpend(bucket: UsageBucket) {
  return bucket.reserved + bucket.committed - bucket.released;
}

/**
 * 计费对账 (R-06 / T26).
 *
 * Three claims, each on its own observable:
 *   1. 三桶各自扣减 — only the modality's own bucket moves; the other three
 *      stand still. Buckets are read before the run and after settlement.
 *   2. 预估=回执 — the ProductUsage receipt commits the units the reservation
 *      asked for, and the quote reaches `reconciled`.
 *   3. 视频按条 — W1: the authoritative video unit is the 条, one per run.
 *      A per-second reading of this leg is an expired contract.
 */
async function assertBillingReconciled(
  page: Page,
  contract: JourneyContract,
  taskId: string,
  before: EntitlementProjection
) {
  const bucket = BILLING_BUCKET[contract.modality];

  await expect
    .poll(
      async () =>
        (
          await p1Query<ProductUsageRecord>(
            page,
            'product-billing',
            'get_usage',
            { taskId }
          )
        ).status,
      {
        message: 'the run must settle its ProductUsage receipt',
        timeout: 120_000,
      }
    )
    .toBe('committed');
  const usage = await p1Query<ProductUsageRecord>(
    page,
    'product-billing',
    'get_usage',
    { taskId }
  );

  const quote = await p1Query<ProductQuoteSnapshot>(
    page,
    'product-billing',
    'get_quote_by_task',
    { taskId }
  );
  expect(quote.taskId, 'the quote must be bound to this very task').toBe(
    taskId
  );

  // 预估=回执: what was reserved is what was committed, bucket by bucket.
  expect(
    usage.settledUnits,
    'the receipt must carry canonical per-bucket units, not a legacy scalar'
  ).toBeTruthy();
  expect(usage.settledUnits).toEqual(usage.reservedUnits);
  expect(usage.settledQuantity).toBe(usage.reservedQuantity);

  // Settlement honesty. The contract is 「missing trusted usage → estimated |
  // unknown (never fake reconciled)」 (`@meiye/contracts` product-quote,
  // `productSettlementStatuses`). `reconciled` is only reachable when settle is
  // handed trusted usage evidence — provider usage, a provider bill, or
  // measured media duration; without either the service deliberately keeps
  // "estimated/unknown; do not invent billedSeconds". Which of the two lands is
  // a property of the modality's own fixture, not of this journey: 文案 settles
  // `estimated`, the media runs arrive with trusted units and settle
  // `reconciled`. What must never appear is `unknown` — that is evidence which
  // arrived and could not be used, and it would mean the receipt above equals
  // the estimate only by accident.
  const settlement = usage.settlementStatus ?? quote.settlementStatus;
  expect(
    ['estimated', 'reconciled'],
    `settlement must stay honest; got ${settlement}`
  ).toContain(settlement);

  // 三桶各自扣减, in its general form: the receipt and the entitlement
  // projection must agree bucket by bucket, and nothing outside the receipt may
  // move. Pinning one bucket per modality would assert a product shape that does
  // not exist — a 图文笔记 is text *and* images, so it legitimately spends both
  // the copy and the image bucket in one run (measured, not assumed).
  const spentByBucket = new Map<BillingResource, number>();
  for (const unit of usage.settledUnits ?? []) {
    spentByBucket.set(
      unit.resource,
      (spentByBucket.get(unit.resource) ?? 0) + unit.quantity
    );
  }
  expect(
    spentByBucket.get(bucket) ?? 0,
    `a ${contract.modality} run must spend its own ${bucket} bucket`
  ).toBeGreaterThan(0);
  expect(
    spentByBucket.get('audio') ?? 0,
    'no v1 output spends the audio bucket'
  ).toBe(0);

  if (contract.modality === 'video') {
    // W1: the authoritative video unit is the 条 — one per run. Measured where
    // the merchant's balance actually lives, the entitlement ledger.
    expect(
      spentByBucket.get('video'),
      'one 成片 run deducts exactly one 条 (W1)'
    ).toBe(1);
    // The price formula is a different axis from the entitlement unit, and this
    // quote still reports `per_output_second` (measured — see the T39 closeout
    // report). Recorded rather than pinned: asserting `per_request` would demand
    // a shape the product does not have today, and asserting
    // `per_output_second` would freeze the very thing W1 moved away from. What
    // must hold either way is the 条 above — under the per-second settle branch
    // a trusted-seconds receipt recomputes video units from seconds, so this
    // assertion is what would catch that path deducting more than one.
    expect(
      ['per_request', 'per_output_second'],
      `unexpected video billing mode ${quote.billingMode}`
    ).toContain(quote.billingMode);
  }

  const after = await entitlementProjection(page);
  for (const resource of BILLING_BUCKETS) {
    const expected = spentByBucket.get(resource) ?? 0;
    expect(
      bucketSpend(after.usage[resource]) - bucketSpend(before.usage[resource]),
      `${resource}: the entitlement projection must move exactly as the receipt says`
    ).toBe(expected);
    expect(
      after.usage[resource].available,
      `${resource}: the remaining balance must fall by what the receipt spent`
    ).toBe(before.usage[resource].available - expected);
  }
}

/**
 * 三路交付.
 *
 * The panel projects three capability groups and the matrix walks all three:
 *   - 取文件 — the real 完整发布包 download, through `downloadFullPackage`. What
 *     that verifies differs by leg: `packageFormat: 'zip'` (图文/视频) goes to
 *     `assertZipDownload` — manifest, caption, checklist and the declared file
 *     bytes; `packageFormat: 'text'` (文案) goes to `assertTextDownload` — file
 *     name and body only, no manifest (`ui-journey.ts`, the format branch in
 *     `downloadFullPackage`).
 *   - 协办交接 — the group is visible and both of its actions are asserted
 *     unconditionally disabled, because no leg here creates an ApprovalReceipt.
 *     Note what this does *not* cover: the inbox ApprovalCard does create
 *     receipts in a real browser (`pending-actions-inbox.spec.ts`), so the
 *     uncovered half is the *unlocked* state of this panel and the one-shot
 *     link → `/dashboard/handoff/<token>` → 回报 chain — recorded as a gap
 *     (报告 §7 G-5), not faked here.
 *   - 直接发布 — hidden at launch (`data-direct-publish-hidden`), asserted by
 *     `openDeliveryPanel`.
 * 发布确认 (人工发布回报) closes the loop after the package is in hand.
 */
async function assertThreeDeliveryRoutes(
  page: Page,
  contract: JourneyContract
) {
  await openDeliveryPanel(page, contract.modality);
  await downloadFullPackage(page, contract);

  const handoffGroup = page.getByTestId('delivery-group-handoff_to_platform');
  await expect(
    handoffGroup,
    '协办交接 must stay a visible route even before it is unlocked'
  ).toBeVisible();
  await expect(
    handoffGroup.getByTestId('delivery-assisted-setup'),
    '协办交接 must ask who takes publishing responsibility'
  ).toBeVisible();
  for (const action of ['system_share', 'assisted'] as const) {
    const control = page.getByTestId(`delivery-action-${action}`);
    await expect(control).toBeVisible();
    // Unconditional on purpose. No leg here creates an ApprovalReceipt, so
    // `hasExternalSendApproval` is false on every leg and both controls must be
    // disabled. Gating this on `data-enabled === 'false'` would make the check
    // skip itself exactly when `projectDeliveryCapabilityGroups`
    // (`delivery-capability-groups.ts`, `shareOk`/`assistedOk`) regresses to
    // enabled-without-approval — the M-04 病症 this matrix exists to catch.
    // If a future leg does create a receipt, branch on the receipt that leg
    // created and assert both sides; never on what the DOM reports.
    await expect(
      control,
      `没有一次性批准时 ${action} 必须置灰，不能只靠文案`
    ).toBeDisabled();
    await expect(control).toHaveAttribute('data-enabled', 'false');
    await expect(
      handoffGroup.getByText('外部发送前需完成一次性批准').first(),
      'a gated 协办交接 must say why in merchant language'
    ).toBeVisible();
  }

  await assertMerchantLanguage(page, `交付面板（${contract.deliveryTarget}）`);
}

/**
 * 发布确认 — the merchant reports what happened on the platform.
 *
 * Reload first: close-loop facts bind to the generated platform variants, which
 * only exist once adoption and export have landed.
 */
async function recordPublicationConfirmation(page: Page) {
  await page.reload();
  await expect(page.getByTestId('result-center-shell')).toBeVisible({
    timeout: 60_000,
  });
  const panel = page.getByTestId('publication-record-panel');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByTestId('publication-record-form'),
    '发布确认 needs a package and a variant — both exist after 采用 + 导出'
  ).toBeVisible({ timeout: 60_000 });

  const platformChips = page.locator('[data-testid^="publication-platform-"]');
  await expect(platformChips.first()).toBeVisible({ timeout: 30_000 });
  await platformChips.first().click();
  await page.getByTestId('publication-account').fill('E2E 门店账号');
  await page
    .getByTestId('publication-at')
    .fill(new Date().toISOString().slice(0, 16));
  await page
    .getByTestId('publication-url')
    .fill('https://example.test/t39-published');

  const responsePromise = page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as { action?: unknown };
        return body.action === 'record_content_package_manual_result';
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
  await page.getByTestId('publication-record-submit').click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByTestId('publication-record-row').first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('T39 R-gate journey matrix', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  for (const leg of MATRIX_LEGS) {
    const { contract } = leg;
    test(`${leg.label}: 注册 → Day-0 冷态 → 首次出活 → 采用 → 三路交付 → 计费对账 → 刷新恢复`, async ({
      page,
    }) => {
      test.setTimeout(contract.modality === 'video' ? 900_000 : 600_000);
      await page.setViewportSize(leg.viewport);
      await setTheme(page, leg.theme);

      // —— 注册 ——
      await registerThroughTheProductForm(page);
      await page.goto('/dashboard');
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${leg.theme}\\b`)
      );

      // —— Day-0 冷态 ——
      await assertDayZeroSampleStoresStayReadOnly(page);
      await assertThreeModalDiscovery(page);
      const beforeSpend = await entitlementProjection(page);
      expect(beforeSpend.plan?.tier, 'a cold tenant starts on trial').toBe(
        'trial'
      );

      // —— 首次出活 ——
      await seedConfirmedStore(page);
      await page.goto('/dashboard');
      if (contract.modality !== 'copy') {
        // 图文/视频 recipes require a real source; authorise it through the
        // Composer's own inline path, the way Day-0 offers it.
        await seedComposerInlineAuthorize(page);
      }

      const submissions: Array<{ task?: { id?: string } }> = [];
      page.on('response', (response) => {
        if (response.request().method() !== 'POST') return;
        if (!response.url().includes('/api/core/p1/composer/submissions')) {
          return;
        }
        void response
          .json()
          .then((body: { data?: { task?: { id?: string } } }) => {
            if (body.data) submissions.push(body.data);
          })
          .catch(() => undefined);
      });

      // Short suffix, not a full UUID: the merchant's own intent text is echoed
      // back on Works and on the publication row, so a UUID-shaped suffix would
      // trip this spec's own merchant-language reverse assertion — a leak the
      // test wrote itself. (That it did trip is the check proving it is live.)
      const workId = await submitComposerJourney(
        page,
        contract,
        `T39 ${leg.intent} ${crypto.randomUUID().slice(0, 8)}`
      );
      await waitForResultJourney(page, contract, workId);
      await assertMerchantLanguage(page, `Result（${contract.modality}）`);

      await expect
        .poll(() => submissions.length, {
          message: 'the run must have posted at least one submission',
          timeout: 30_000,
        })
        .toBeGreaterThanOrEqual(1);
      // Polling for `=== 1` would pass on the first observation and never see a
      // second submission that arrives after it. Let the network settle, then
      // require exactly one — counted by distinct task id, so a retried
      // transport cannot be mistaken for a second run.
      await page.waitForTimeout(1_000);
      const submittedTaskIds = new Set(
        submissions.map((submission) => submission.task?.id)
      );
      expect(
        submittedTaskIds.size,
        `the run must have posted exactly one submission — saw ${submissions.length} accepted response(s) carrying ${submittedTaskIds.size} distinct task id(s)`
      ).toBe(1);
      const taskId = submissions[0]?.task?.id;
      expect(
        taskId,
        'the 202 must carry the task the quote binds to'
      ).toBeTruthy();

      // —— 采用 ——
      await adoptResult(page, contract);

      // —— 三路交付 ——
      await assertThreeDeliveryRoutes(page, contract);

      // —— 计费对账 ——
      await assertBillingReconciled(page, contract, taskId!, beforeSpend);

      // —— 发布确认 ——
      await recordPublicationConfirmation(page);

      // —— 刷新恢复 ——
      await assertJourneyRestored(page, contract, workId);
      await assertMerchantLanguage(page, `刷新恢复后的 Result（${leg.label}）`);
    });
  }
});
