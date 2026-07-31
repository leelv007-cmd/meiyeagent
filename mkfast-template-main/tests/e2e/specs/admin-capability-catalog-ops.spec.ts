/**
 * J3 D-048 acceptance: daily ops catalog path has no raw JSON / env / SQL /
 * code / CLI edit controls. Focused on the capability catalog surface.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const FORBIDDEN_CONTROL_NAME =
  /(?:^|[\s:/_-])(?:code|sql|env|raw\s*json|json|cli|shell|terminal|代码|环境变量|原始\s*json|命令行|终端)(?:$|[\s:/_-])/iu;

async function loginAsAdmin(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);
}

async function expectNoUnsafeDailyOperationControls(surface: Locator) {
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
        '[data-testid="code-editor"]',
        '[data-testid="sql-console"]',
        '[data-testid="env-editor"]',
        '[data-testid="raw-json-editor"]',
        '[data-testid="cli-console"]',
        '[data-ops-control="code"]',
        '[data-ops-control="sql"]',
        '[data-ops-control="env"]',
        '[data-ops-control="raw-json"]',
        '[data-ops-control="cli"]',
      ].join(',')
    )
  ).toHaveCount(0);
}

test.describe('admin capability catalog ops path (#123 J3)', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('capability catalog daily path has no D-048 banned controls and links seven drilldowns', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page, request);

    // Until Z2-WIRING lands Routes.AdminCapabilities in sidebar/routeTree,
    // navigate by absolute path (route module is present).
    await page.goto('/admin/capabilities');

    const catalog = page.getByTestId('capability-catalog-panel');
    await expect(catalog).toBeVisible();
    await expect(catalog).toHaveAttribute('data-ops-path', 'daily');
    await expect(catalog).toHaveAttribute(
      'data-l1-excludes-workspace-id',
      'true'
    );

    for (const domain of ['账号与商业化', 'AI 供应与生成', '运行与治理']) {
      const section = catalog
        .getByTestId('catalog-l1-section')
        .filter({ hasText: domain });
      await expect(section).toHaveCount(1);
      await expect(section.getByText(domain, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('不在运营界面伪装成一键修复')).toBeVisible();

    for (const path of [
      '/admin/users',
      '/admin/plans',
      '/admin/redemptions',
      '/admin/models',
      '/admin/templates',
      '/admin/integrations',
      '/admin/audit',
    ]) {
      await expect(catalog.locator(`a[href="${path}"]`).first()).toBeVisible();
    }

    await expectNoUnsafeDailyOperationControls(catalog);

    // Drill into models evidence page — banner must speak operator language.
    await catalog.locator('a[href="/admin/models"]').first().click();
    await expect(page).toHaveURL(/\/admin\/models/);
    const banner = page.getByTestId('capability-drilldown-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute(
      'data-domain',
      'ai_supply_and_generation'
    );
    await expect(banner.getByTestId('drilldown-function')).toContainText(
      '功能：'
    );
    await expect(banner.getByTestId('drilldown-user-impact')).toContainText(
      '用户影响：'
    );
    await expect(banner).not.toContainText('workspaceId');
  });
});
