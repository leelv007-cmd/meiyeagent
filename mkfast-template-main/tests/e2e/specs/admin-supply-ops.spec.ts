import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const DAILY_OPERATOR_PATHS = [
  '/admin',
  '/admin/capabilities',
  '/admin/supply',
  '/admin/audit',
] as const;

const FORBIDDEN_CONTROL_NAME =
  /(?:^|[\s:/_-])(?:code|sql|env|raw\s*json|json|cli|shell|terminal|代码|环境变量|原始\s*json|命令行|终端)(?:$|[\s:/_-])/iu;

/** Align with admin-capability-catalog-model D048_BANNED_OPS_CONTROLS SSOT. */
const D048_BANNED_TESTIDS = [
  'code-editor',
  'sql-console',
  'env-editor',
  'raw-json-editor',
  'cli-console',
] as const;
const D048_BANNED_OPS_CONTROL = [
  'code',
  'sql',
  'env',
  'raw-json',
  'cli',
] as const;

async function loginAsAdmin(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);
}

/** G-E2E-PLAYWRIGHT-D048: exact banned control attributes on a surface. */
async function expectD048BanOnSurface(surface: Locator) {
  for (const id of D048_BANNED_TESTIDS) {
    await expect(
      surface.getByTestId(id),
      `D-048 forbids data-testid=${id} on ops surfaces`
    ).toHaveCount(0);
  }
  for (const kind of D048_BANNED_OPS_CONTROL) {
    await expect(
      surface.locator(`[data-ops-control="${kind}"]`),
      `D-048 forbids data-ops-control=${kind} on ops surfaces`
    ).toHaveCount(0);
  }
  await expect(surface.getByTestId('one-click-repair')).toHaveCount(0);
}

async function expectNoUnsafeDailyOperationControls(surface: Locator) {
  await expectD048BanOnSurface(surface);
  const descriptors = await surface
    .locator(
      [
        'button',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[contenteditable="true"]',
        '[role="combobox"]',
        '[role="textbox"]',
      ].join(',')
    )
    .evaluateAll((elements) =>
      elements.map((element) =>
        [
          element.getAttribute('aria-label'),
          element.getAttribute('id'),
          element.getAttribute('name'),
          element.getAttribute('placeholder'),
          element.textContent,
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
            ? Array.from(element.labels ?? [])
                .map((label) => label.textContent)
                .join(' ')
            : null,
        ]
          .filter(Boolean)
          .join(' ')
      )
    );

  expect(
    descriptors.filter((descriptor) => FORBIDDEN_CONTROL_NAME.test(descriptor)),
    'Daily operations must not expose code, SQL, env, raw JSON, or CLI controls.'
  ).toEqual([]);
  await expect(
    surface.locator(
      [
        '.cm-editor',
        '.monaco-editor',
        '[data-language]',
        '[data-testid*="code-editor"]',
        '[data-testid*="json-editor"]',
      ].join(',')
    )
  ).toHaveCount(0);
}

async function expectNoExceptionWorkflowControls(surface: Locator) {
  await expect(
    surface.locator(
      [
        '[data-action="ack"]',
        '[data-action="assign"]',
        '[data-action="set-owner"]',
        '[data-testid="exception-ack"]',
        '[data-testid="exception-assign"]',
        '[data-testid="exception-owner"]',
      ].join(',')
    )
  ).toHaveCount(0);
  await expect(
    surface.getByRole('button', {
      name: /acknowledge|assign owner|确认异常|指派负责人|指派给|分配给/iu,
    })
  ).toHaveCount(0);
}

test.describe('admin supply operations acceptance (#122/#123/#128)', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('admin enters the exception-first home and drills into model supply', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page, request);
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin\/?$/u);
    const exceptionHome = page.getByTestId('exception-home-panel');
    await expect(exceptionHome).toBeVisible();
    await expect(exceptionHome).toHaveAttribute('data-read-only', 'true');
    await expect(exceptionHome).toHaveAttribute('data-supports-ack', 'false');
    await expect(exceptionHome).toHaveAttribute(
      'data-supports-assign',
      'false'
    );
    await expectNoExceptionWorkflowControls(exceptionHome);
    await expectD048BanOnSurface(exceptionHome);

    const supplyDrilldown = page.locator('a[href="/admin/supply"]').first();
    await expect(
      supplyDrilldown,
      'The exception-first admin home must expose a visible model-supply drilldown.'
    ).toBeVisible();
    await supplyDrilldown.click();

    await expect(page).toHaveURL((url) => url.pathname === '/admin/supply');
    const supplyPanel = page.getByTestId('supply-control-center-panel');
    await expect(supplyPanel).toBeVisible();
    await expectD048BanOnSurface(supplyPanel);
  });

  test('governed channel isolation requires impact review and reaches audit evidence', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page, request);
    await page.goto('/admin/supply');

    await expect(page).toHaveURL((url) => url.pathname === '/admin/supply');
    const actions = page.getByTestId('supply-governed-actions-panel');
    await expect(actions).toBeVisible({ timeout: 30_000 });
    await expectD048BanOnSurface(actions);
    const isolate = actions.locator(
      '[data-testid="supply-governed-action-row"][data-action-id="channel_isolate"]'
    );
    await expect(isolate).toHaveAttribute('data-requires-preview', 'true');
    await expect(isolate).toHaveAttribute('data-requires-reason', 'true');
    await expect(isolate).toHaveAttribute('data-cas', 'true');
    await expect(isolate).toHaveAttribute('data-reversible-drain', 'true');

    const target = isolate.getByLabel('渠道隔离目标');
    await expect(target).toBeVisible();
    await target.selectOption({ index: 1 });
    const reason = `Playwright 渠道隔离验收 ${randomUUID()}`;
    await isolate.getByLabel('渠道隔离原因').fill(reason);
    await isolate
      .getByRole('button', { name: '渠道隔离', exact: true })
      .click();

    const review = page.getByRole('dialog', { name: '渠道隔离' });
    await expect(review).toBeVisible();
    await expectD048BanOnSurface(review);
    await expect(review.getByText(/影响范围/u)).toBeVisible();
    await expect(review.getByText(/可恢复|可逆/u)).toBeVisible();
    await expect(review.locator('#impact-review-reason')).toHaveValue(reason);
    await review
      .getByRole('button', { name: '确认渠道隔离', exact: true })
      .click();

    const auditLink = actions.getByRole('link', {
      name: '查看审计',
      exact: true,
    });
    await expect(auditLink).toBeVisible({ timeout: 30_000 });
    await auditLink.click();

    await expect(page).toHaveURL(/\/admin\/audit\/?$/u);
    await expect(page.getByText(reason, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expectD048BanOnSurface(page.locator('main'));
  });

  test('daily operator surfaces expose no technical editors or exception ownership workflow', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page, request);

    for (const path of DAILY_OPERATOR_PATHS) {
      await test.step(path, async () => {
        const response = await page.goto(path);
        expect(
          response?.ok(),
          `${path} must return a successful document`
        ).toBe(true);
        await expect(page.locator('main')).toBeVisible();
        await expectNoUnsafeDailyOperationControls(page.locator('main'));
        await expectNoExceptionWorkflowControls(page.locator('main'));
      });
    }
  });
});
