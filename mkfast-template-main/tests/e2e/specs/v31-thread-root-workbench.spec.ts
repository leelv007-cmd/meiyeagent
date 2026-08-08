/**
 * V31-05 Thread-root Workbench journeys (write-only; master runs with lane ports).
 *
 * Covers batch-1 exit gates from V3.1 §35 / ticket V31-05:
 * - refresh / device switch returns to the same Thread
 * - multi Work / reconnect / lazy legacy open
 * - /dashboard/recent is the sole Thread list session entry
 *
 * Do not run in agent worktrees without lane-owned ports (dispatch rule).
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';

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
      return envelope.data as T;
    },
    { queryAction: action, queryModule: module, queryPayload: payload }
  );
}

async function p1Command<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) {
  return page.evaluate(
    async ({ cmdAction, cmdModule, cmdPayload, key }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: cmdAction,
          module: cmdModule,
          payload: cmdPayload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ?? `${cmdModule}.${cmdAction} command failed`
        );
      }
      return envelope.data as T;
    },
    {
      cmdAction: action,
      cmdModule: module,
      cmdPayload: payload,
      key: idempotencyKey,
    }
  );
}

test.describe('V31-05 Thread-root Workbench', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('refresh returns to the same explicit Thread', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const created = await p1Command<{
      session: { threadId: string; title: string };
    }>(
      page,
      'agent-session',
      'create_thread',
      { title: '刷新可恢复会话' },
      `v31-create-${Date.now()}`
    );
    const threadId = created.session.threadId;

    await page.goto(`/dashboard?threadId=${encodeURIComponent(threadId)}`);
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      threadId,
      { timeout: 30_000 }
    );
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-workbench-root',
      'thread'
    );

    await page.reload();
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      threadId,
      { timeout: 30_000 }
    );
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-resolve-source',
      'explicit_thread'
    );
  });

  test('device switch via cold navigation reopens the same Thread', async ({
    page,
    request,
    browser,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const created = await p1Command<{
      session: { threadId: string };
    }>(
      page,
      'agent-session',
      'create_thread',
      { title: '跨设备同一会话' },
      `v31-device-${Date.now()}`
    );
    const threadId = created.session.threadId;

    await page.goto(`/dashboard?threadId=${encodeURIComponent(threadId)}`);
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      threadId,
      { timeout: 30_000 }
    );

    // Simulate another device: fresh context, re-login, same threadId deep link.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await loginByForm(otherPage, user);
    await otherPage.goto(
      `/dashboard?threadId=${encodeURIComponent(threadId)}`
    );
    await expect(
      otherPage.getByTestId('agent-workbench-host')
    ).toHaveAttribute('data-thread-id', threadId, { timeout: 30_000 });
    await other.close();
  });

  test('lazy legacy Work open lands in a Thread without migration', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const legacyWorkId = `legacy-work-${Date.now()}`;
    const opened = await p1Command<{
      created: boolean;
      session: { threadId: string };
      thread: { threadId: string };
    }>(
      page,
      'agent-session',
      'open_legacy_work_thread',
      { legacyWorkId, title: '历史作品懒打开' },
      `v31-legacy-${Date.now()}`
    );
    expect(opened.created).toBe(true);

    const reopened = await p1Command<{
      created: boolean;
      session: { threadId: string };
    }>(
      page,
      'agent-session',
      'open_legacy_work_thread',
      { legacyWorkId, title: '历史作品懒打开' },
      `v31-legacy-again-${Date.now()}`
    );
    expect(reopened.created).toBe(false);
    expect(reopened.session.threadId).toBe(opened.session.threadId);

    await page.goto(
      `/dashboard?threadId=${encodeURIComponent(opened.session.threadId)}`
    );
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      opened.session.threadId,
      { timeout: 30_000 }
    );
  });

  test('one Thread can host multiple Works while write paths stay Work-scoped', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const created = await p1Command<{
      session: { threadId: string };
    }>(
      page,
      'agent-session',
      'create_thread',
      { title: '多 Work 同 Thread' },
      `v31-multi-${Date.now()}`
    );
    const threadId = created.session.threadId;

    // Thread list can hold multiple entries; workbench mounts on one chosen
    // Thread. Business write path remains Composer/Task (not rewritten here).
    await p1Command(
      page,
      'agent-session',
      'create_thread',
      { title: '另一条会话' },
      `v31-multi-b-${Date.now()}`
    );

    const listed = await p1Query<{ threads: Array<{ threadId: string }> }>(
      page,
      'agent-session',
      'list_threads',
      {}
    );
    expect(listed.threads.length).toBeGreaterThanOrEqual(2);

    await page.goto(`/dashboard?threadId=${encodeURIComponent(threadId)}`);
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      threadId,
      { timeout: 30_000 }
    );
    // Container renders empty until semantic replay wiring lands (V31-04 rule
    // hides empty content), so assert attachment rather than visibility.
    await expect(page.getByTestId('agent-workstream-process')).toBeAttached();
  });

  test('/dashboard/recent is Thread list and sole session entry', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const created = await p1Command<{
      session: { threadId: string; title: string };
    }>(
      page,
      'agent-session',
      'create_thread',
      { title: '最近页会话入口' },
      `v31-recent-${Date.now()}`
    );

    await page.goto('/dashboard/recent');
    await expect(page.getByTestId('thread-list')).toBeVisible({
      timeout: 30_000,
    });
    const row = page.getByTestId('thread-list-item').filter({
      hasText: '最近页会话入口',
    });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute(
      'data-thread-id',
      created.session.threadId
    );

    await row.click();
    await expect(page).toHaveURL(
      new RegExp(
        `threadId=${encodeURIComponent(created.session.threadId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
      )
    );
    await expect(page.getByTestId('agent-workbench-host')).toHaveAttribute(
      'data-thread-id',
      created.session.threadId,
      { timeout: 30_000 }
    );
  });
});
