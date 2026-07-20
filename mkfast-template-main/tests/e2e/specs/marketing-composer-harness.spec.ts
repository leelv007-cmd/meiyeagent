import { expect, test } from '@playwright/test';
import type { StructuredDecisionInput } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('marketing Composer and Harness question', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('one server-owned question answers its declared target and leaves the current Work in place', async ({
    page,
    request,
  }) => {
    let submitted: StructuredDecisionInput | undefined;
    let submittedTask: Record<string, unknown> | undefined;
    let taskSubmissionCount = 0;
    let resolved = false;

    await page.route('**/api/core/p1/harness/recommendation', (route) =>
      route.fulfill({
        json: {
          data: {
            workspaceId: 'e2e-workspace',
            currentFactsRevision: 0,
            recommendation: null,
            stale: false,
          },
        },
        status: 200,
      })
    );
    await page.route('**/api/core/p1/harness/tasks', async (route) => {
      taskSubmissionCount += 1;
      submittedTask = route.request().postDataJSON() as Record<string, unknown>;
      if (taskSubmissionCount === 1) {
        await route.fulfill({
          json: {
            error: {
              code: 'HARNESS_TEMPORARILY_UNAVAILABLE',
              message: 'Harness is temporarily unavailable.',
            },
          },
          status: 503,
        });
        return;
      }
      await route.fulfill({
        json: {
          data: {
            workflowId: String(submittedTask.taskId),
            replayed: false,
          },
        },
        status: 202,
      });
    });

    await page.route(
      '**/api/core/p1/harness/tasks/*/decision',
      async (route) => {
        const taskId = decodeURIComponent(
          new URL(route.request().url()).pathname.split('/').at(-2) ?? ''
        );
        if (route.request().method() === 'POST') {
          submitted = route.request().postDataJSON() as StructuredDecisionInput;
          resolved = true;
          await route.fulfill({
            json: {
              data: { eventId: `${taskId}:decision:1`, replayed: false },
            },
            status: 200,
          });
          return;
        }
        if (taskSubmissionCount < 2) {
          await route.fulfill({
            json: {
              error: {
                code: 'TASK_NOT_FOUND',
                message: 'The Harness task was not found.',
              },
            },
            status: 404,
          });
          return;
        }
        await route.fulfill({
          json: {
            data: {
              question: resolved
                ? null
                : {
                    questionId: `${taskId}:s1:offer_price`,
                    workflowId: taskId,
                    workflowRevision: 3,
                    question: '这次团购价按哪个金额写？',
                    options: [
                      { id: 'price-398', label: '¥398' },
                      { id: 'price-498', label: '¥498' },
                    ],
                    freeText: { enabled: true },
                    response: {
                      field: 'offer_price',
                      reason: '补充当前任务所需的权威事实',
                    },
                    scope: 'current_task',
                  },
            },
          },
          status: 200,
        });
      }
    );
    await page.route('**/api/core/p1/workflows/*/events', async (route) => {
      const workflowId = decodeURIComponent(
        new URL(route.request().url()).pathname.split('/').at(-2) ?? ''
      );
      const progress = {
        eventId: `${workflowId}:progress:1`,
        workflowId,
        workflowType: 'beauty_marketing_harness',
        sequence: 1,
        sourceRevision: 3,
        stage: 'intent_naming',
        state: 'suspended',
        message: '等你确认当前团购价',
        occurredAt: '2026-07-18T08:00:00.000Z',
      };
      await route.fulfill({
        body: `id: ${progress.eventId}\nevent: workflow.progress\ndata: ${JSON.stringify(progress)}\n\n`,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        status: 200,
      });
    });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const composer = page.getByLabel('描述这次想创作的内容');
    await composer.fill('把新团购做一套能发的');
    await page.getByRole('button', { name: '建立创作记录' }).click();

    const work = page.getByRole('article', { name: '创作助理整理的记录' });
    await expect(work).toBeVisible();
    const workUrl = page.url();
    await expect(page.getByText('快速开始')).toBeHidden();
    await page.getByRole('button', { name: '重试自动更新' }).click();
    await expect.poll(() => taskSubmissionCount).toBe(2);
    expect(submittedTask).toMatchObject({
      taskId: expect.any(String),
      packageId: expect.any(String),
      expectedRevision: 0,
      workflowRevision: 1,
      rawInput: '把新团购做一套能发的',
      intent: {
        context: {
          workId: expect.any(String),
          intent: '把新团购做一套能发的',
          sourceSummaries: expect.any(Array),
        },
      },
    });
    await expect(page.getByText('只需确认一件事')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '这次团购价按哪个金额写？' })
    ).toBeVisible();
    await expect(page.getByText('仅本次任务')).toBeVisible();
    await expect(page.getByText('等你确认当前团购价')).toBeVisible();

    await page.getByRole('button', { name: '¥398' }).click();
    await page.getByRole('button', { name: '确认并继续' }).click();
    await expect(
      page.getByRole('heading', { name: '这次团购价按哪个金额写？' })
    ).toBeHidden();
    await expect(work).toBeVisible();
    await expect(page).toHaveURL(workUrl);

    expect(submitted).toMatchObject({
      questionId: expect.stringMatching(/:s1:offer_price$/u),
      workflowRevision: 3,
      patch: {
        field: 'offer_price',
        value: '¥398',
        reason: '补充当前任务所需的权威事实',
      },
      decision: { state: 'accepted', value: '¥398' },
    });
    expect(submitted?.idempotencyKey).toBeTruthy();
  });
});
