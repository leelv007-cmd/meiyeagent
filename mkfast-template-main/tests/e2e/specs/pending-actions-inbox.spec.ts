import { expect, test, type Page } from '@playwright/test';
import type {
  ApprovalReceipt,
  ContentPackage,
  PendingAction,
  QuestionCard,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

async function p1Command<T>(
  page: Page,
  module: 'operations' | 'result-delivery',
  action: string,
  payload: Record<string, unknown>
) {
  return page.evaluate(
    async ({ action: command, module: commandModule, payload: input }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: command,
          module: commandModule,
          payload: input,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `pending-actions-e2e:${commandModule}:${command}:${crypto.randomUUID()}`,
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
    { action, module, payload }
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
      data?: (PendingAction | { pendingAction?: PendingAction })[];
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Pending actions query failed'
      );
    }
    return envelope.data.flatMap((item) =>
      'kind' in item ? [item] : item.pendingAction ? [item.pendingAction] : []
    );
  });
}

type ComposerTask = {
  packageId: string;
  taskId: string;
  workId: string;
};

async function submitComposerTask(page: Page): Promise<ComposerTask> {
  await page.evaluate(() => {
    window.sessionStorage.removeItem('composer-session::composer-session/v1');
  });
  await page.goto('/dashboard');
  await page.getByTestId('composer-lens-option-copy').click();
  await page
    .getByTestId('composer-intent-input')
    .fill('写一条周末到店的团购活动文案');
  const destination = page.getByTestId(
    'composer-destination-option-xiaohongshu'
  );
  await expect(destination).toBeVisible({ timeout: 30_000 });
  if ((await destination.getAttribute('aria-pressed')) !== 'true') {
    await destination.click();
  }
  await expect(destination).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  const submit = page.getByTestId('composer-submit');
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();

  const brief = page.getByTestId('composer-brief-surface');
  const next = await Promise.race([
    responsePromise.then(() => 'submission' as const),
    brief
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const),
  ]);
  if (next === 'brief') {
    await page.getByTestId('composer-brief-confirm').click();
  }

  const response = await responsePromise;
  const body = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      task?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(response.status(), body.error?.message).toBe(202);
  const result = {
    packageId: body.data?.contentPackage?.id ?? '',
    taskId: body.data?.task?.id ?? '',
    workId: body.data?.work?.id ?? '',
  };
  expect(result.packageId).toBeTruthy();
  expect(result.taskId).toBeTruthy();
  expect(result.workId).toBeTruthy();
  return result;
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

  test('parallel tasks resume and the approved task completes canonical one-shot handoff', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (payload: ShareData) => !payload.files?.length,
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (payload: ShareData) => {
          if (payload.url) {
            window.sessionStorage.setItem(
              'e2e-canonical-handoff-url',
              payload.url
            );
          }
        },
      });
    });

    const tasks: ComposerTask[] = [await submitComposerTask(page)];
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
      `/dashboard/results/${encodeURIComponent(tasks[0]!.workId)}`
    );
    const adopt = page.getByTestId('result-primary-action');
    await expect(adopt).toHaveText('采用此版本', { timeout: 60_000 });
    await expect(adopt).toBeEnabled();
    await adopt.click();
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
    await p1Command<ContentPackage>(page, 'result-delivery', 'result_export', {
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

    tasks.push(await submitComposerTask(page));
    tasks.push(await submitComposerTask(page));
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

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 16);
    const approvalAction = initial.find((action) => action.kind === 'approval');
    if (!approvalAction) throw new Error('Pending approval action was absent');
    const currentPackage = (await contentPackages(page)).find(
      ({ id }) => id === approvalAction.approvalRequest.packageId
    );
    if (!currentPackage) throw new Error('Approval package was absent');
    const approvalReceipt = await p1Command<ApprovalReceipt>(
      page,
      'operations',
      'approve_content_package_action',
      {
        accountId: 'e2e-xiaohongshu-account',
        actionKind: approvalAction.approvalRequest.actionKind,
        actionScheduledAt: new Date(scheduledAt).toISOString(),
        approvalKey: `pending-actions-e2e:${approvalAction.questionOrApprovalRef}`,
        cost: { amount: 0, currency: 'CNY' },
        expectedRevision: currentPackage.revision,
        packageId: approvalAction.approvalRequest.packageId,
        platform: approvalAction.approvalRequest.platform,
        purpose: approvalAction.approvalRequest.purpose,
        requestId: approvalAction.approvalRequest.id,
        variantVersionId: approvalAction.approvalRequest.variantVersionId,
      }
    );
    expect(approvalReceipt.status).toBe('approved');
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
          approval: contentPackage?.approvalReceipts?.at(-1)?.status,
          request: contentPackage?.approvalRequests?.[0]?.status,
        };
      })
      .toEqual({ approval: 'approved', request: 'consumed' });

    await page.reload();
    await page.getByRole('button', { exact: true, name: '2 项' }).click();
    const questionInbox = page.getByTestId('pending-actions');

    for (let remaining = 2; remaining > 0; remaining -= 1) {
      const currentAction = (await pendingActions(page))[0];
      expect(currentAction).toMatchObject({ kind: 'question' });
      const currentItem = questionInbox.locator('[data-current="true"]');
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
    await expect(questionInbox).toBeHidden();
    await expect(page.getByTestId('pending-actions-badge')).toBeHidden();

    const approvedTask = tasks[0]!;
    await page.goto(
      `/dashboard/works/${encodeURIComponent(approvedTask.packageId)}`
    );
    const handoffDoorway = page.getByTestId('works-action-handoff');
    await expect(handoffDoorway).toBeVisible({ timeout: 60_000 });
    await expect(handoffDoorway).toHaveAttribute(
      'href',
      new RegExp(
        `/dashboard/results/${encodeURIComponent(approvedTask.workId)}\\?[^#]*panel=delivery`,
        'u'
      )
    );
    await handoffDoorway.click();
    await expect(page.getByTestId('delivery-panel')).toBeVisible({
      timeout: 60_000,
    });

    const assistedAction = page.getByTestId('delivery-action-assisted');
    await expect(assistedAction).toBeEnabled();
    await expect(assistedAction).toHaveAttribute('data-enabled', 'true');
    await assistedAction.click();
    await expect(page.getByTestId('delivery-outcome-handed-over')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('delivery-assisted-panel')).toHaveAttribute(
      'data-handed-over',
      'true'
    );
    await expect(page.getByTestId('delivery-share-strategy')).toHaveAttribute(
      'data-strategy',
      'one_shot_link'
    );

    await page.getByTestId('delivery-action-system_share').click();
    await expect(page.getByTestId('delivery-outcome-share-done')).toBeVisible();
    const canonicalHandoffUrl = await page.evaluate(() =>
      window.sessionStorage.getItem('e2e-canonical-handoff-url')
    );
    expect(canonicalHandoffUrl).toMatch(/\/dashboard\/handoff\/[^/?#]{16,}$/u);
    if (!canonicalHandoffUrl) {
      throw new Error('System share produced no canonical handoff URL');
    }

    await page.goto(canonicalHandoffUrl);
    await expect(
      page.getByRole('heading', { name: '小红书交接包' })
    ).toBeVisible({ timeout: 60_000 });
    for (const section of ['share', 'download', 'copy', 'report']) {
      await expect(
        page.getByTestId(`handoff-section-${section}`)
      ).toBeVisible();
    }
    await page
      .getByLabel('平台链接')
      .fill('https://example.test/posts/canonical-handoff');
    await page.getByLabel('备注').fill('canonical assisted handoff e2e');
    await page.getByTestId('handoff-report-published').click();
    await expect(page.getByTestId('handoff-section-report')).toHaveAttribute(
      'data-published',
      'true'
    );
    await expect(page.getByTestId('handoff-report-status')).toHaveText(
      '已发布'
    );
    await expect
      .poll(async () => {
        const contentPackage = (await contentPackages(page)).find(
          ({ id }) => id === approvedTask.packageId
        );
        const delivery = contentPackage?.deliveryEvents?.at(-1);
        return {
          approval: contentPackage?.approvalReceipts?.at(-1)?.status,
          deliveryStatus:
            delivery?.type === 'manual_publish_result'
              ? delivery.status
              : undefined,
          deliveryType: delivery?.type,
        };
      })
      .toEqual({
        approval: 'consumed',
        deliveryStatus: 'published',
        deliveryType: 'manual_publish_result',
      });
  });
});
