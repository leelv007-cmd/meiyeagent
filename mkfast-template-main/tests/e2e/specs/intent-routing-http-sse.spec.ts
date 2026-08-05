import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';
import { installUserActivationCounter } from '../fixtures/user-activation';

type AskMerchantPending = {
  requestId: string;
  revision: number;
  runId: string;
  step: string;
  firstItemId: string;
};

async function submitCustomizedCopy(page: Page, intent = '写一条周末预约文案') {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'copy');
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });
  const submit = page.getByTestId('composer-submit');
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await submit.click();
  const response = await responsePromise;
  const envelope = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      task?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();
  expect(envelope.data?.contentPackage?.id).toBeTruthy();
  expect(envelope.data?.work?.id).toBeTruthy();
  return {
    packageId: envelope.data!.contentPackage!.id!,
    taskId: envelope.data!.task!.id!,
    workId: envelope.data!.work!.id!,
  };
}

// The semantic ask rides the interaction channel; the retired structured-
// decision seam deliberately reports null for it, so the spec syncs on the
// typed interaction snapshot instead.
async function waitForQuestion(page: Page, taskId: string) {
  let question: AskMerchantPending | null = null;
  await expect
    .poll(
      async () => {
        question = await page.evaluate(async (id) => {
          const response = await fetch(
            `/api/core/p1/harness/tasks/${encodeURIComponent(id)}/interaction?view=snapshot`
          );
          if (!response.ok) return null;
          const envelope = (await response.json()) as {
            data?: {
              request?: {
                kind?: string;
                requestId?: string;
                revision?: number;
                runId?: string;
                step?: string;
                questions?: Array<{ itemId?: string }>;
              } | null;
              status?: string;
            };
          };
          const request = envelope.data?.request;
          if (
            envelope.data?.status !== 'pending' ||
            request?.kind !== 'ask_merchant' ||
            !request.requestId ||
            typeof request.revision !== 'number' ||
            !request.runId ||
            !request.step ||
            !request.questions?.[0]?.itemId
          ) {
            return null;
          }
          return {
            requestId: request.requestId,
            revision: request.revision,
            runId: request.runId,
            step: request.step,
            firstItemId: request.questions[0].itemId,
          };
        }, taskId);
        return question?.requestId ?? null;
      },
      { timeout: 60_000 }
    )
    .not.toBeNull();
  return question!;
}

async function ignoreThroughHttpAndCollectSse(
  page: Page,
  input: { question: AskMerchantPending; taskId: string }
) {
  return page.evaluate(
    ({ currentQuestion, currentTaskId }) =>
      new Promise<{ messages: string[]; status: string }>((resolve, reject) => {
        const messages: string[] = [];
        const stream = new EventSource(
          `/api/core/p1/workflows/${encodeURIComponent(currentTaskId)}/events`
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
          const idempotencyKey = `skip-${currentQuestion.requestId}`;
          void fetch(
            `/api/core/p1/harness/tasks/${encodeURIComponent(currentTaskId)}/interaction`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'content-type': 'application/json',
                'idempotency-key': idempotencyKey,
              },
              body: JSON.stringify({
                requestId: currentQuestion.requestId,
                revision: currentQuestion.revision,
                idempotencyKey,
                resume: {
                  runId: currentQuestion.runId,
                  step: currentQuestion.step,
                },
                response: { kind: 'skipped' },
              }),
            }
          )
            .then(async (response) => {
              if (!response.ok) {
                throw new Error(
                  `Interaction HTTP failed: ${await response.text()}`
                );
              }
            })
            .catch((error: unknown) => {
              window.clearTimeout(timeout);
              stream.close();
              reject(error);
            });
        };
      }),
    { currentQuestion: input.question, currentTaskId: input.taskId }
  );
}

test.describe('D-111 intent routing over real HTTP and SSE', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('a confirmed-fact workspace continues automatically with an explicit grounded-mode notice', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const counter = await installUserActivationCounter(page);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    counter.beginMeasurement();
    const submission = await submitCustomizedCopy(page);
    const activations = await counter.waitForFirstTokenAndStop({
      timeout: 120_000,
    });
    expect(
      activations,
      `confirmed-fact mode must reach its first token in exactly two activations; events=${JSON.stringify(counter.events())}`
    ).toBe(2);
    await expect(page.getByTestId('composer-question-turn')).toHaveCount(0);
    await expect(page.getByTestId('composer-route-notice')).toHaveText(
      '这次会参考你已确认的资料，直接继续生成。',
      { timeout: 60_000 }
    );
    await expect(page.getByTestId('composer-delivery-card')).toBeVisible({
      timeout: 120_000,
    });
    await expect
      .poll(
        () =>
          page.evaluate(async (taskId) => {
            const response = await fetch(
              `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction?view=snapshot`
            );
            if (!response.ok) return 'request-failed';
            const envelope = (await response.json()) as {
              data?: { status?: string };
            };
            return envelope.data?.status ?? 'absent';
          }, submission.taskId),
        { timeout: 30_000 }
      )
      .toBe('absent');
    await expect(page.getByTestId('composer-route-notice')).not.toContainText(
      /industry_category|intent|snapshot|route|schema|asset|workflow|revision|id/iu
    );
  });

  test('answering the conversation semantic question keeps the same task moving forward', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const submission = await submitCustomizedCopy(
      page,
      '给护理套餐写一条推广文案'
    );
    const question = await waitForQuestion(page, submission.taskId);
    expect(question.firstItemId).toBe('promotion_details');

    const streamPromise = page.evaluate(
      (taskId) =>
        new Promise<{ messages: string[]; status: string }>(
          (resolve, reject) => {
            const messages: string[] = [];
            const stream = new EventSource(
              `/api/core/p1/workflows/${encodeURIComponent(taskId)}/events`
            );
            const timeout = window.setTimeout(() => {
              stream.close();
              reject(
                new Error('Workflow SSE did not continue after the answer.')
              );
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
          }
        ),
      submission.taskId
    );

    // ask_merchant presentation pins notification to 'none' (contract
    // literal), so the question never rides the pending-actions inbox: the
    // merchant answers on the conversation card.
    const questionCard = page.getByTestId('ask-merchant-group-card');
    await expect(questionCard).toBeVisible({ timeout: 30_000 });
    await questionCard.getByRole('textbox').fill('透亮猫眼 398 元');
    await questionCard.getByRole('button', { name: '提交回答' }).click();

    const stream = await streamPromise;
    expect(stream.status).toBe('success');
    expect(stream.messages).toContain('已收到，继续为你生成。');
    expect(stream.messages.join('\n')).not.toMatch(/生成失败|支持编号/u);
    expect(submission.taskId).toBe(question.requestId.split(':s1:')[0]);
    expect(submission.workId).toBeTruthy();
  });

  test('ignoring a reachable guidance question through HTTP resumes SSE to success', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const submission = await submitCustomizedCopy(
      page,
      '给护理套餐写一条推广文案'
    );
    const question = await waitForQuestion(page, submission.taskId);
    expect(question.firstItemId).toBe('promotion_details');

    const stream = await ignoreThroughHttpAndCollectSse(page, {
      question,
      taskId: submission.taskId,
    });

    expect(stream.status).toBe('success');
    expect(stream.messages.join('\n')).not.toMatch(/生成失败|支持编号/u);
    expect(submission.taskId).toBe(question.requestId.split(':s1:')[0]);
  });
});
