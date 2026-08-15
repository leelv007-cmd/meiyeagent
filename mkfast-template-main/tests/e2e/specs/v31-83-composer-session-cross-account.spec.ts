import { expect, test, type Page } from '@playwright/test';

import { composerSessionStorageKey } from '@/product/composer/composer-session';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
  signOut,
} from '../fixtures/auth';
import { productState, seedConfirmedStore } from '../fixtures/product';

/**
 * V31-83 — same-tab account switch must not render the previous merchant
 * conversation. Full-stack run is owned by the coordinator; this spec must
 * stay `--list` parseable.
 */

const RUNNING_TEXT = 'A账号运行中的周末预约文案-v31-83';
const HUNG_TEXT = 'A账号悬死work的到店团购文案-v31-83';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('A running handle is gone after logout and B login in the same tab', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await switchAccountAndAssertNoLeak(page, request, {
    merchantText: RUNNING_TEXT,
    taskId: 'task-running-owned-by-a',
  });
});

test('A hung-run handle is gone after logout and B login in the same tab', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await switchAccountAndAssertNoLeak(page, request, {
    merchantText: HUNG_TEXT,
    taskId: 'task-hung-owned-by-a',
  });
});

async function switchAccountAndAssertNoLeak(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0],
  input: { merchantText: string; taskId: string }
) {
  const userA = await registerE2EUser(request);
  const userB = await registerE2EUser(request);
  await loginByForm(page, userA);
  await seedConfirmedStore(page);
  const { workspaceId } = await productState(page);

  await plantComposerHandle(page, {
    merchantText: input.merchantText,
    taskId: input.taskId,
    workspaceId,
  });
  await page.reload();
  await expect(page.getByTestId('composer-turn-merchant')).toContainText(
    input.merchantText,
    { timeout: 30_000 }
  );

  await signOutViaProduct(page);
  expect(
    (await productSessionStorageKeys(page)).filter((key) =>
      key.startsWith('composer-session::')
    )
  ).toEqual([]);

  await loginByForm(page, userB);
  await seedConfirmedStore(page);
  await expect(page.getByTestId('composer-turn-merchant')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(input.merchantText);
  expect(await productSessionStorageKeys(page)).not.toContain(
    composerSessionStorageKey(workspaceId)
  );
}

async function plantComposerHandle(
  page: Page,
  input: { merchantText: string; taskId: string; workspaceId: string }
) {
  await page.evaluate(
    ({ key, merchantText, taskId, workspaceId }) => {
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          schema: 'composer-session/v1',
          sessionId: 'session-owned-by-a',
          workspaceId,
          updatedAt: new Date().toISOString(),
          merchantText,
          task: {
            taskId,
            workId: `work-${taskId}`,
            packageId: `package-${taskId}`,
            agentThreadId: `thread-${taskId}`,
          },
        })
      );
    },
    {
      key: composerSessionStorageKey(input.workspaceId),
      merchantText: input.merchantText,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    }
  );
}

async function signOutViaProduct(page: Page) {
  const menu = page.getByRole('button', { name: /用户菜单|User menu/ });
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await page.getByRole('menuitem', { name: /^退出$|^Log out$/ }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/', {
      timeout: 30_000,
    });
    return;
  }
  await signOut(page);
  await page.evaluate(() => {
    const prefixes = [
      'composer-session::',
      'meiye.creation-draft-intent.',
      'meiye.pending-creation-action.',
      'meiye:p1:model-selection:',
      'composer.catalog.return:',
      'meiye-submission-attempt:',
    ];
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (
        key === 'meiye-correlation-id' ||
        (key && prefixes.some((prefix) => key.startsWith(prefix)))
      ) {
        window.sessionStorage.removeItem(key);
      }
    }
  });
}

async function productSessionStorageKeys(page: Page) {
  return page.evaluate(() => {
    const prefixes = [
      'composer-session::',
      'meiye.creation-draft-intent.',
      'meiye.pending-creation-action.',
      'meiye:p1:model-selection:',
      'composer.catalog.return:',
      'meiye-submission-attempt:',
    ];
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (
        key === 'meiye-correlation-id' ||
        (key && prefixes.some((prefix) => key.startsWith(prefix)))
      ) {
        keys.push(key);
      }
    }
    return keys.sort();
  });
}
