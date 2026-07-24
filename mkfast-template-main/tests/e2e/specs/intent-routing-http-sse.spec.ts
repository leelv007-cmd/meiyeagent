import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

type QuestionCard = {
  questionId: string;
  workflowRevision: number;
  response: { field: string; reason: string };
};

async function submitCustomizedCopy(page: Page) {
  await page.goto('/dashboard');
  const lens = page.getByTestId('composer-lens-option-copy');
  await lens.click();
  await page
    .getByTestId('composer-intent-input')
    .fill('写一条周末预约文案');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 },
  );
  await page.getByTestId('composer-submit').click();
  const response = await responsePromise;
  const envelope = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      task?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();
  expect(envelope.data?.contentPackage?.id).toBeTruthy();
  return {
    packageId: envelope.data!.contentPackage!.id!,
    taskId: envelope.data!.task!.id!,
  };
}

async function waitForQuestion(page: Page, taskId: string) {
  let question: QuestionCard | null = null;
  await expect
    .poll(
      async () => {
        question = await page.evaluate(async (id) => {
          const response = await fetch(
            `/api/core/p1/harness/tasks/${encodeURIComponent(id)}/decision`,
          );
          if (!response.ok) return null;
          const envelope = (await response.json()) as {
            data?: { question?: QuestionCard | null };
          };
          return envelope.data?.question ?? null;
        }, taskId);
        return question?.questionId ?? null;
      },
      { timeout: 60_000 },
    )
    .not.toBeNull();
  return question!;
}

async function ignoreThroughHttpAndCollectSse(
  page: Page,
  input: { question: QuestionCard; taskId: string },
) {
  return page.evaluate(
    ({ currentQuestion, currentTaskId }) =>
      new Promise<{ messages: string[]; status: string }>((resolve, reject) => {
        const messages: string[] = [];
        const stream = new EventSource(
          `/api/core/p1/workflows/${encodeURIComponent(currentTaskId)}/events`,
        );
        const timeout = window.setTimeout(() => {
          stream.close();
          reject(new Error('Workflow SSE did not reach a terminal state.'));
        }, 120_000);
        stream.addEventListener('workflow.progress', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as {
            message: string;
          };
          messages.push(data.message);
        });
        stream.addEventListener('workflow.state', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as {
            status: string;
          };
          if (data.status === 'success' || data.status === 'failed') {
            window.clearTimeout(timeout);
            stream.close();
            resolve({ messages, status: data.status });
          }
        });
        stream.onerror = () => {
          if (stream.readyState === EventSource.CLOSED) {
            window.clearTimeout(timeout);
            reject(new Error('Workflow SSE closed before terminal state.'));
          }
        };
        stream.onopen = () => {
          const idempotencyKey = `skip-${currentQuestion.questionId}`;
          void fetch(
            `/api/core/p1/harness/tasks/${encodeURIComponent(currentTaskId)}/decision`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'content-type': 'application/json',
                'idempotency-key': idempotencyKey,
              },
              body: JSON.stringify({
                idempotencyKey,
                questionId: currentQuestion.questionId,
                workflowRevision: currentQuestion.workflowRevision,
                patch: {
                  field: currentQuestion.response.field,
                  value: '这次先跳过',
                  reason: currentQuestion.response.reason,
                },
                decision: { state: 'ignored', value: '这次先跳过' },
              }),
            },
          ).then(async (response) => {
            if (!response.ok) {
              throw new Error(`Decision HTTP failed: ${await response.text()}`);
            }
          }).catch((error: unknown) => {
            window.clearTimeout(timeout);
            stream.close();
            reject(error);
          });
        };
      }),
    { currentQuestion: input.question, currentTaskId: input.taskId },
  );
}

test.describe('D-111 intent routing over real HTTP and SSE', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('customized entry can skip guidance and finishes with an explicit generic-mode notice', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const submission = await submitCustomizedCopy(page);
    const question = await waitForQuestion(page, submission.taskId);
    expect(question.response.reason).toBe('让这次内容更贴合你的实际情况');

    const stream = await ignoreThroughHttpAndCollectSse(page, {
      question,
      taskId: submission.taskId,
    });
    expect(stream.status).toBe('success');
    expect(stream.messages).toContain(
      '这次先按通用模式生成；以后补充门店、项目或风格资料，内容会更像你的店。',
    );
    for (const message of stream.messages) {
      expect(message).not.toMatch(/route|schema|asset|workflow|revision|id/iu);
    }

    const contentPackage = await page.evaluate(async (packageId) => {
      const response = await fetch('/api/core/p1/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          module: 'operations',
          action: 'content_package',
          payload: { packageId },
        }),
      });
      const envelope = (await response.json()) as {
        data?: { revision?: number; currentVersionId?: string | null };
        error?: { message?: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? 'Content package query failed');
      }
      return envelope.data;
    }, submission.packageId);
    expect(contentPackage.revision).toBeGreaterThan(0);
    expect(contentPackage.currentVersionId).toBeTruthy();
  });
});
