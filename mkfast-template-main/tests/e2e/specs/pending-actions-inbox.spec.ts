import { expect, test, type Page } from '@playwright/test';
import type {
  ContentPackage,
  PendingAction,
  QuestionCard,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

async function operationsCommand<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown>
) {
  return page.evaluate(
    async ({ action: command, payload: input }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: command,
          module: 'operations',
          payload: input,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `pending-actions-e2e:${command}:${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: T;
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? `${command} failed`);
      }
      return envelope.data;
    },
    { action, payload }
  );
}

async function contentPackages(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'content_packages',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: ContentPackage[];
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'ContentPackage query failed');
    }
    return envelope.data;
  });
}

async function pendingActions(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/pending-actions', {
      credentials: 'same-origin',
    });
    const envelope = (await response.json()) as {
      data?: PendingAction[];
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Pending actions query failed'
      );
    }
    return envelope.data;
  });
}

async function createHarnessPackage(page: Page) {
  return operationsCommand<ContentPackage>(page, 'create_content_package', {
    kind: 'image_text',
    source: { assetIds: [] },
  });
}

async function submitHarnessTask(
  page: Page,
  input: { packageId: string; taskId: string }
) {
  await page.evaluate(async ({ packageId, taskId }) => {
    const rawInput = '把新团购做成一条可以发的小红书文案';
    const response = await fetch('/api/core/p1/harness/tasks', {
      body: JSON.stringify({
        taskId,
        packageId,
        expectedRevision: 0,
        workflowRevision: 1,
        rawInput,
        intent: {
          context: {
            workId: `work-${taskId}`,
            intent: rawInput,
            sourceSummaries: [],
          },
          assetReferences: [],
        },
      }),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': taskId,
      },
      method: 'POST',
    });
    if (!response.ok) {
      const envelope = (await response.json()) as {
        error?: { message: string };
      };
      throw new Error(envelope.error?.message ?? 'Harness submission failed');
    }
  }, input);
}

async function pendingQuestion(page: Page, taskId: string) {
  return page.evaluate(async (currentTaskId) => {
    const response = await fetch(
      `/api/core/p1/harness/tasks/${encodeURIComponent(currentTaskId)}/decision`,
      { credentials: 'same-origin' }
    );
    const envelope = (await response.json()) as {
      data?: { question: QuestionCard | null };
      error?: { message: string };
    };
    if (!response.ok || !envelope.data?.question) {
      throw new Error(envelope.error?.message ?? 'Pending question was absent');
    }
    return envelope.data.question;
  }, taskId);
}

async function answerHarnessQuestion(page: Page, taskId: string) {
  const question = await pendingQuestion(page, taskId);
  await page.evaluate(
    async ({ currentTaskId, currentQuestion }) => {
      const value = '299 元';
      const response = await fetch(
        `/api/core/p1/harness/tasks/${encodeURIComponent(currentTaskId)}/decision`,
        {
          body: JSON.stringify({
            idempotencyKey: `pending-actions-seed:${currentQuestion.questionId}`,
            questionId: currentQuestion.questionId,
            workflowRevision: currentQuestion.workflowRevision,
            patch: {
              field: currentQuestion.response.field,
              value,
              reason: currentQuestion.response.reason,
            },
            decision: { state: 'accepted', value },
          }),
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `pending-actions-seed:${currentQuestion.questionId}`,
          },
          method: 'POST',
        }
      );
      if (!response.ok) {
        const envelope = (await response.json()) as {
          error?: { message: string };
        };
        throw new Error(envelope.error?.message ?? 'Harness answer failed');
      }
    },
    { currentQuestion: question, currentTaskId: taskId }
  );
}

async function waitForTaskQuestion(page: Page, taskId: string) {
  await expect
    .poll(
      async () =>
        (await pendingActions(page)).some(
          (action) => action.taskId === taskId && action.kind === 'question'
        ),
      { timeout: 60_000 }
    )
    .toBe(true);
}

test.describe('pending action inbox', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('three parallel tasks keep one stable current action and each resumes after its authoritative card', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const packages = await Promise.all([
      createHarnessPackage(page),
      createHarnessPackage(page),
      createHarnessPackage(page),
    ]);
    const tasks = packages.map((contentPackage, index) => ({
      packageId: contentPackage.id,
      taskId: `pending-actions-task-${index + 1}-${crypto.randomUUID()}`,
    }));

    await submitHarnessTask(page, tasks[0]!);
    await waitForTaskQuestion(page, tasks[0]!.taskId);
    await answerHarnessQuestion(page, tasks[0]!.taskId);
    await expect
      .poll(
        async () =>
          (await contentPackages(page)).find(
            (contentPackage) => contentPackage.id === tasks[0]!.packageId
          )?.status,
        { timeout: 60_000 }
      )
      .toBe('review_ready');

    await page.goto(
      `/dashboard/content/${encodeURIComponent(tasks[0]!.packageId)}`
    );
    const generateVariants = page.getByRole('button', {
      name: /^生成三平台版本/,
    });
    await expect(generateVariants).toBeEnabled({ timeout: 30_000 });
    await generateVariants.click();
    await expect
      .poll(
        async () =>
          (await contentPackages(page)).find(
            (contentPackage) => contentPackage.id === tasks[0]!.packageId
          )?.variants.length,
        { timeout: 60_000 }
      )
      .toBe(3);
    const publishable = (await contentPackages(page)).find(
      (contentPackage) => contentPackage.id === tasks[0]!.packageId
    );
    expect(publishable?.status).toBe('accepted');
    expect(publishable?.source.targetPlatform).toBeTruthy();
    await operationsCommand<ContentPackage>(page, 'export_content_package', {
      expectedRevision: publishable!.revision,
      packageId: publishable!.id,
      platform: publishable!.source.targetPlatform,
    });
    await expect
      .poll(
        async () =>
          (await pendingActions(page)).some(
            (action) =>
              action.taskId === tasks[0]!.taskId && action.kind === 'approval'
          ),
        { timeout: 30_000 }
      )
      .toBe(true);

    await Promise.all([
      submitHarnessTask(page, tasks[1]!),
      submitHarnessTask(page, tasks[2]!),
    ]);
    await expect
      .poll(async () => (await pendingActions(page)).length, {
        timeout: 60_000,
      })
      .toBe(3);
    const initial = await pendingActions(page);
    expect(initial.filter((action) => action.kind === 'approval')).toHaveLength(
      1
    );
    expect(initial.filter((action) => action.kind === 'question')).toHaveLength(
      2
    );

    const trigger = page.getByRole('button', { exact: true, name: '3 项' });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const inbox = page.getByTestId('pending-actions');
    await expect(inbox.locator('[data-pending-action-ref]')).toHaveCount(3);
    await expect(inbox.locator('[data-current="true"]')).toHaveCount(1);
    const stableCurrentRef = await inbox
      .locator('[data-current="true"]')
      .getAttribute('data-pending-action-ref');
    expect(stableCurrentRef).toBe(initial[0]?.questionOrApprovalRef);

    await page.reload();
    await page.getByRole('button', { exact: true, name: '3 项' }).click();
    const reloadedInbox = page.getByTestId('pending-actions');
    await expect(
      reloadedInbox.locator('[data-pending-action-ref]')
    ).toHaveCount(3);
    await expect(
      reloadedInbox.locator('[data-current="true"]')
    ).toHaveAttribute('data-pending-action-ref', stableCurrentRef!);

    const approvalItem = reloadedInbox.locator('[data-current="true"]');
    await approvalItem.getByLabel('发布账号').fill('e2e-xiaohongshu-account');
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 16);
    await approvalItem.getByLabel('计划发布时间').fill(scheduledAt);
    await approvalItem.getByLabel('本次费用（CNY）').fill('0');
    await approvalItem.getByRole('button', { name: '确认并发布' }).click();
    await expect
      .poll(async () => (await pendingActions(page)).length, {
        timeout: 30_000,
      })
      .toBe(2);
    await expect
      .poll(async () => {
        const contentPackage = (await contentPackages(page)).find(
          (candidate) => candidate.id === tasks[0]!.packageId
        );
        return {
          delivery: contentPackage?.deliveryEvents?.at(-1)?.type,
          request: contentPackage?.approvalRequests?.[0]?.status,
        };
      })
      .toEqual({ delivery: 'assisted_handoff_prepared', request: 'consumed' });

    for (let remaining = 2; remaining > 0; remaining -= 1) {
      const currentAction = (await pendingActions(page))[0];
      expect(currentAction).toMatchObject({ kind: 'question' });
      const currentItem = reloadedInbox.locator('[data-current="true"]');
      await currentItem
        .locator('input[placeholder="输入这次任务的答案"]')
        .fill('299 元');
      await currentItem.getByRole('button', { name: '确认并继续' }).click();
      await expect
        .poll(
          async () =>
            (await pendingActions(page)).some(
              (action) => action.taskId === currentAction!.taskId
            ),
          { timeout: 30_000 }
        )
        .toBe(false);
      const matchingTask = tasks.find(
        (candidate) => candidate.taskId === currentAction!.taskId
      );
      expect(matchingTask).toBeTruthy();
      await expect
        .poll(
          async () =>
            (await contentPackages(page)).find(
              (contentPackage) => contentPackage.id === matchingTask!.packageId
            )?.status,
          { timeout: 60_000 }
        )
        .toBe('review_ready');
    }

    await expect.poll(async () => (await pendingActions(page)).length).toBe(0);
    await expect(reloadedInbox).toBeHidden();
    await expect(page.getByTestId('pending-actions-badge')).toBeHidden();
  });
});
