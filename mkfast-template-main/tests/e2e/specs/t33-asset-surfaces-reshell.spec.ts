import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

/**
 * T33 / #227 — the retained asset surfaces after the reshell.
 *
 * Journey acceptance: store, identity and workspace all render in the
 * one 门店橱窗 language (HeroUI Pro V3 on the Glass sheet), in both themes and
 * at a phone viewport, with no shadcn-era markup left in the page body.
 */
const SURFACES = [
  '/dashboard/store',
  '/dashboard/identity',
  '/dashboard/workspace',
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
  'alert',
  'tabs-trigger',
  'tabs-content',
] as const;

async function readSurface(page: Page, path: string) {
  await page.goto(path);
  // 「一个 Glass 壳根」照旧，只是那个根从每页各自的 <main> 挪到了共享壳上
  // （S7 / U07 换壳：壳本体就是 HeroUI Pro Sidebar，token 桥得覆盖整个
  // /dashboard 与 /settings，不再只覆盖恰好渲染 Pro 件的那几页）。
  await expect(page.locator('.meiye-heroui-glass')).toHaveCount(1);
  await expect(
    page.locator('[data-slot="sidebar-provider"].meiye-heroui-glass')
  ).toHaveCount(1);
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

test('the retained asset surfaces render one Glass shell in both themes', async ({
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

test('the retained asset surfaces fit a phone viewport without overflow', async ({
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

async function registerIdentity(manager: Locator, displayName: string) {
  await manager.getByRole('button', { name: '品牌', exact: true }).click();
  for (const [question, answer] of [
    ['希望在内容里怎么称呼这个身份？', displayName],
    ['这个身份归属于谁？', 'T33 Studio'],
    ['这个品牌最核心的主张是什么？', 'Steady care'],
    ['哪些话或做法绝对不能碰？', 'No medical claims'],
    ['给一两句最能代表这个身份的表达样例。', 'A calm opening line'],
    ['授权证明或内部备注是什么？（可填编号）', `t33-${displayName}`],
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
  // D-142: the authorized reach is asked for, not written for the merchant, so
  // registration cannot be reached until both scopes name something.
  for (const [question, option] of [
    ['这个人设可以用在哪些平台？', '小红书'],
    ['这个人设可以用在哪些场景？', '品牌人设'],
  ] as const) {
    const region = manager.getByRole('region', { name: question });
    await region.getByRole('button', { name: option }).click();
    await region.getByRole('button', { name: '继续' }).click();
  }
  await manager.getByRole('button', { name: '登记身份' }).click();
  const card = manager.locator('article').filter({ hasText: displayName });
  await expect(card).toHaveCount(1);
  return card;
}

test('the identity page keeps D-117 three actions apart', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    await page.goto('/dashboard/identity');

    // The surface was renamed to 口吻; exact keeps this off the save panel and
    // the composer card, which are both named「…口吻」as well.
    const manager = page.getByRole('region', { name: '口吻', exact: true });
    // Creating is the only action available before an identity exists — saving
    // can never be the thing that silently sets a default.
    await expect(manager.getByRole('button', { name: '设为默认' })).toHaveCount(
      0
    );
    await expect(
      manager.getByRole('link', { name: '用这个身份创作（本次）' })
    ).toHaveCount(0);

    const first = await registerIdentity(manager, 'T33 Identity A');
    // Creating did not make it the default…
    await expect(first.getByText('默认身份')).toHaveCount(0);
    // …and the session choice is a separate route into the conversation.
    await expect(
      first.getByRole('link', { name: '用这个身份创作（本次）' })
    ).toHaveAttribute('href', /\/dashboard\?identity=/u);

    const second = await registerIdentity(manager, 'T33 Identity B');
    await expect(second.getByText('默认身份')).toHaveCount(0);

    // A → B → A. The third hop repeats an (identity, version) pair whose
    // decision revision has already moved twice; without a freshness component
    // in the idempotency key the command replays a spent key and the default
    // can never come back.
    await first.getByRole('button', { name: '设为默认' }).click();
    await expect(first.getByText('默认身份')).toBeVisible();
    await expect(second.getByText('默认身份')).toHaveCount(0);

    await second.getByRole('button', { name: '设为默认' }).click();
    await expect(second.getByText('默认身份')).toBeVisible();
    await expect(first.getByText('默认身份')).toHaveCount(0);

    await first.getByRole('button', { name: '设为默认' }).click();
    await expect(first.getByText('默认身份')).toBeVisible();
    await expect(second.getByText('默认身份')).toHaveCount(0);
    await expect(
      manager.getByText('身份操作未完成，请检查必填项或刷新后重试。')
    ).toHaveCount(0);

    await page.reload();
    await expect(
      manager
        .locator('article')
        .filter({ hasText: 'T33 Identity A' })
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

    // 壳的 <main> 是 Pro Sidebar 的 sidebar-main 槽，页面正文就装在里面
    // （S7 / U07 前这里认的是页面自己那个 .meiye-heroui-glass <main>，
    // Glass 壳根上移后不再有第二个 main）。
    const body = await page
      .locator('main[data-slot="sidebar-main"]')
      .innerText();
    expect(body).not.toMatch(/platform[_-]?sample/iu);
    // D-126 sample stores are named on the cold-start home, never here.
    expect(body).not.toMatch(/示例店/u);
  } finally {
    await cleanupE2EUsers(request);
  }
});
