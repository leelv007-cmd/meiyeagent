import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

/**
 * T33 / #227 — the four asset surfaces after the reshell.
 *
 * Journey acceptance: store, identity, workspace and leads all render in the
 * one 门店橱窗 language (HeroUI Pro V3 on the Glass sheet), in both themes and
 * at a phone viewport, with no shadcn-era markup left in the page body.
 */
const SURFACES = [
  '/dashboard/store',
  '/dashboard/identity',
  '/dashboard/workspace',
  '/dashboard/leads',
] as const;

/**
 * data-slot values only src/components/ui/* emits. HeroUI namespaces its own
 * (alert-root, tabs-tab, …), so a hit here is genuine shadcn residue rather
 * than a name collision. The shared dashboard chrome uses none of them.
 */
const SHADCN_RESIDUE = [
  'card',
  'card-title',
  'card-content',
  'badge',
  'alert',
  'tabs-trigger',
  'tabs-content',
] as const;

async function readSurface(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('.meiye-heroui-glass')).toHaveCount(1);
  return page.evaluate((residue: readonly string[]) => {
    const main = document.querySelector('main');
    return {
      glassSheetLinked: Boolean(
        document.querySelector('link[href*="heroui-glass"]')
      ),
      residue: residue.filter(
        (slot) => main?.querySelector(`[data-slot="${slot}"]`) != null
      ),
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, SHADCN_RESIDUE);
}

test('the four asset surfaces render one Glass shell in both themes', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);

    for (const theme of ['light', 'dark'] as const) {
      await page.goto('/dashboard');
      await page.evaluate(
        (value) => localStorage.setItem('theme', value),
        theme
      );
      for (const path of SURFACES) {
        const surface = await readSurface(page, path);
        expect(surface.glassSheetLinked, `${path} ${theme} glass sheet`).toBe(
          true
        );
        expect(surface.residue, `${path} ${theme} shadcn residue`).toEqual([]);
      }
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});

test('the four asset surfaces fit a phone viewport without overflow', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const user = await registerE2EUser(request);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginByForm(page, user);
    for (const path of SURFACES) {
      const surface = await readSurface(page, path);
      expect(surface.scrollWidth, `${path} overflow`).toBeLessThanOrEqual(390);
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});

test('the identity page keeps D-117 three actions apart', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    await page.goto('/dashboard/identity');

    const manager = page.getByRole('region', { name: '表达身份' });
    // Creating is the only action available before an identity exists — saving
    // can never be the thing that silently sets a default.
    await expect(manager.getByRole('button', { name: '设为默认' })).toHaveCount(
      0
    );
    await expect(
      manager.getByRole('link', { name: '用这个身份创作（本次）' })
    ).toHaveCount(0);

    await manager.getByRole('button', { name: '品牌', exact: true }).click();
    for (const [question, answer] of [
      ['希望在内容里怎么称呼这个身份？', 'T33 Identity'],
      ['这个身份归属于谁？', 'T33 Studio'],
      ['这个品牌最核心的主张是什么？', 'Steady care'],
      ['哪些话或做法绝对不能碰？', 'No medical claims'],
      ['给一两句最能代表这个身份的表达样例。', 'A calm opening line'],
      ['授权证明或内部备注是什么？（可填编号）', 't33-identity-1'],
    ] as const) {
      const region = manager.getByRole('region', { name: question });
      await region.getByRole('textbox', { name: question }).fill(answer);
      await region.getByRole('button', { name: '继续' }).click();
    }
    for (const question of [
      '有哪些话这个品牌坚决不说？',
      '画面希望长期保持什么感觉？',
      '有哪些栏目值得长期连续做？',
    ]) {
      await manager
        .getByRole('region', { name: question })
        .getByRole('button', { name: '暂时跳过' })
        .click();
    }
    await manager.getByRole('button', { name: '登记身份' }).click();

    const saved = manager
      .locator('article')
      .filter({ hasText: 'T33 Identity' });
    await expect(saved).toHaveCount(1);
    // Creating did not make it the default…
    await expect(saved.getByText('默认身份')).toHaveCount(0);
    // …and the session choice is a separate route into the conversation.
    await expect(
      saved.getByRole('link', { name: '用这个身份创作（本次）' })
    ).toHaveAttribute('href', /\/dashboard\?identity=/u);

    await saved.getByRole('button', { name: '设为默认' }).click();
    await expect(saved.getByText('默认身份')).toBeVisible();
    await page.reload();
    await expect(
      manager
        .locator('article')
        .filter({ hasText: 'T33 Identity' })
        .getByText('默认身份')
    ).toBeVisible();
  } finally {
    await cleanupE2EUsers(request);
  }
});

test('the workspace surface keeps platform sample material out', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    await page.goto('/dashboard/workspace');
    await expect(
      page.getByRole('heading', { level: 1, name: '内容工作区' })
    ).toBeVisible();

    // The dashboard shell owns an outer <main>; the page body is the glass one.
    const body = await page.locator('main.meiye-heroui-glass').innerText();
    expect(body).not.toMatch(/platform[_-]?sample/iu);
    // D-126 sample stores are named on the cold-start home, never here.
    expect(body).not.toMatch(/示例店/u);
  } finally {
    await cleanupE2EUsers(request);
  }
});
