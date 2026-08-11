import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const CONVERSATION_ID = 'conversation-delete-fixture';

const canonicalHistory = {
  assets: [],
  canvasWorks: [],
  contents: [
    {
      acceptedAt: '2026-07-30T08:30:00.000Z',
      assetIds: [],
      body: '这条内容记录不会随对话一起删除。',
      createdAt: '2026-07-30T08:00:00.000Z',
      id: 'content-delete-fixture',
      jobId: 'job-delete-fixture',
      status: 'accepted',
      title: '保留的内容记录',
      workId: 'work-delete-fixture',
      workspaceId: 'workspace-delete-fixture',
    },
  ],
  creativeWorks: [],
  exportReceipts: [],
  imageJobs: [],
  jobs: [],
  sessions: [
    {
      createdAt: '2026-07-30T08:00:00.000Z',
      id: CONVERSATION_ID,
      updatedAt: '2026-07-30T09:00:00.000Z',
      workIds: [],
    },
  ],
  tasks: [],
};

async function installConversationDeletionFixtures(
  page: Page,
  options: { forbidden?: boolean } = {}
) {
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/api/core/p1/query', async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      module?: string;
    };
    if (body.module === 'operations' && body.action === 'canonical_history') {
      await route.fulfill({
        json: {
          data: canonicalHistory,
          meta: { correlationId: 'e2e-canonical-history' },
        },
      });
      return;
    }
    if (body.module === 'operations' && body.action === 'content_packages') {
      await route.fulfill({
        json: { data: [], meta: { correlationId: 'e2e-content-packages' } },
      });
      return;
    }
    if (body.module === 'operations' && body.action === 'creation_catalog') {
      await route.fulfill({
        json: {
          data: { shortcuts: [], templates: [], userTemplates: [] },
          meta: { correlationId: 'e2e-creation-catalog' },
        },
      });
      return;
    }
    if (body.module === 'model-supply' && body.action === 'video_workflows') {
      await route.fulfill({
        json: { data: [], meta: { correlationId: 'e2e-video-workflows' } },
      });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/core/p1/commands', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action !== 'delete_composer_conversation') {
      await route.continue();
      return;
    }
    commands.push(body);
    if (options.forbidden) {
      await route.fulfill({
        json: {
          error: {
            code: 'CAPABILITY_DENIED',
            message: 'The current actor cannot delete this conversation.',
          },
          meta: { correlationId: 'e2e-delete-forbidden' },
        },
        status: 403,
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          conversationId: CONVERSATION_ID,
          deletedAt: '2026-07-30T10:00:00.000Z',
        },
        meta: { correlationId: 'e2e-delete-success' },
      },
    });
  });
  return commands;
}

test.describe('Composer conversation deletion', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('recent activity confirms, cancels, then deletes through the canonical Operations command', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const commands = await installConversationDeletionFixtures(page);

    await page.goto('/dashboard/recent');
    const deleteButton = page.getByRole('button', {
      name: '删掉这次创作对话',
    });
    await expect(deleteButton).toHaveCount(1);
    await expect(deleteButton).toBeVisible();

    await deleteButton.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(
      '已经沉淀的记忆会保留，并标注“来源已删除”'
    );
    await dialog.getByRole('button', { name: '先不删' }).click();
    expect(commands).toHaveLength(0);

    await deleteButton.click();
    await dialog.getByRole('button', { name: '删掉对话' }).click();

    await expect
      .poll(() => commands)
      .toEqual([
        {
          action: 'delete_composer_conversation',
          module: 'operations',
          payload: { conversationId: CONVERSATION_ID },
        },
      ]);
    await expect(deleteButton).toHaveCount(0);
    await expect(page.getByText('保留的内容记录')).toBeVisible();
  });

  test('a forbidden deletion stays visible with the product generic failure explanation', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const commands = await installConversationDeletionFixtures(page, {
      forbidden: true,
    });

    await page.goto('/dashboard/recent');
    await page.getByRole('button', { name: '删掉这次创作对话' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: '删掉对话' }).click();

    await expect
      .poll(() => commands)
      .toEqual([
        {
          action: 'delete_composer_conversation',
          module: 'operations',
          payload: { conversationId: CONVERSATION_ID },
        },
      ]);
    // The product intentionally presents one generic deletion error for every
    // command failure. This test proves the denied command has a valid P1
    // envelope; it does not claim that the UI distinguishes CAPABILITY_DENIED.
    await expect(dialog.getByRole('alert')).toContainText('没能删掉这次对话');
    await dialog.getByRole('button', { name: '先不删' }).click();
    await expect(
      page.getByRole('button', { name: '删掉这次创作对话' })
    ).toBeVisible();
  });
});
