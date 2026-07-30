import { expect, test } from '@playwright/test';
import type {
  HarnessInteractionAnswer,
  HarnessInteractionMerchantMessage,
  StructuredDecisionInput,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';

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
    let submittedComposer: Record<string, unknown> | undefined;
    let composerSubmissionCount = 0;
    let directHarnessAdmissionCount = 0;
    let resolved = false;
    const taskId = 'e2e-composer-question-task';

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
    await page.route('**/api/core/p1/composer/submissions', async (route) => {
      composerSubmissionCount += 1;
      submittedComposer = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      await route.fulfill({
        json: {
          data: {
            contentPackage: {
              expectedRevision: 0,
              id: 'e2e-composer-question-package',
            },
            replayed: false,
            snapshot: {
              id: 'e2e-composer-question-snapshot',
              schemaVersion: 'creation-execution-snapshot/v1',
            },
            task: { id: taskId },
            usageReservation: { id: 'e2e-composer-question-reservation' },
            work: { id: 'e2e-composer-question-work' },
          },
        },
        status: 202,
      });
    });
    await page.route('**/api/core/p1/harness/tasks', async (route) => {
      if (route.request().method() === 'POST') {
        directHarnessAdmissionCount += 1;
        await route.fulfill({
          json: {
            error: {
              code: 'DIRECT_HARNESS_ADMISSION_RETIRED',
              message: 'Composer owns task admission.',
            },
          },
          status: 410,
        });
        return;
      }
      await route.continue();
    });

    await page.route(
      '**/api/core/p1/harness/tasks/*/decision',
      async (route) => {
        const requestedTaskId = decodeURIComponent(
          new URL(route.request().url()).pathname.split('/').at(-2) ?? ''
        );
        if (route.request().method() === 'POST') {
          submitted = route.request().postDataJSON() as StructuredDecisionInput;
          resolved = true;
          await route.fulfill({
            json: {
              data: {
                eventId: `${requestedTaskId}:decision:1`,
                replayed: false,
              },
            },
            status: 200,
          });
          return;
        }
        await route.fulfill({
          json: {
            data: {
              question: resolved
                ? null
                : {
                    questionId: `${requestedTaskId}:s1:offer_price`,
                    workflowId: requestedTaskId,
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
              resolutionSource: resolved ? 'decision' : null,
              status: resolved ? 'resolved' : 'pending',
              timeoutSeconds: null,
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
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await page.getByTestId('composer-lens-option-copy').click();
    await page
      .getByTestId('composer-intent-input')
      .fill('把新团购做一套能发的');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 30_000,
    });

    const workUrl = page.url();
    await expect(page.getByTestId('composer-submit')).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByTestId('composer-submit').click();

    const briefSurface = page.getByTestId('composer-brief-surface');
    const admission = await Promise.race([
      briefSurface
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'brief' as const)
        .catch(() => 'submission' as const),
      expect
        .poll(() => composerSubmissionCount, { timeout: 30_000 })
        .toBe(1)
        .then(() => 'submission' as const),
    ]);
    if (admission === 'brief') {
      await page.getByTestId('composer-brief-confirm').click();
    }

    await expect.poll(() => composerSubmissionCount).toBe(1);
    expect(directHarnessAdmissionCount).toBe(0);
    expect(submittedComposer).toMatchObject({
      creationMode: 'customized',
      deliverable: { kind: 'copy_document' },
      idempotencyKey: expect.any(String),
      intent: '把新团购做一套能发的',
      quote: { id: expect.any(String), revision: expect.any(String) },
      recipe: { id: expect.any(String), revision: expect.any(String) },
    });
    const work = page.getByTestId('composer-conversation');
    await expect(work).toBeVisible();
    await expect(page.getByTestId('composer-turn-merchant')).toContainText(
      '把新团购做一套能发的'
    );
    await expect(page.getByTestId('composer-question-card')).toBeVisible();
    await expect(page.getByText('这次团购价按哪个金额写？')).toBeVisible();
    await expect(page.getByText('补充当前任务所需的权威事实')).toBeVisible();
    await expect(page.getByText('等你确认当前团购价')).toBeVisible();

    await page.getByRole('button', { name: '¥398' }).click();
    await expect(page.getByTestId('composer-question-card')).toBeHidden();
    await expect(work).toBeVisible();
    await expect(page.getByTestId('composer-turn-merchant')).toContainText(
      '把新团购做一套能发的'
    );
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

  test('resumed durable interactions render and submit through Composer', async ({
    page,
    request,
  }) => {
    const taskId = 'e2e-composer-interaction-task';
    let interactionPhase: 'ask' | 'confirmation' | 'waiting' | 'resolved' =
      'ask';
    let interactionReads = 0;
    const rendererAcknowledgements: Array<Record<string, unknown>> = [];
    const submittedAnswers: HarnessInteractionAnswer[] = [];
    let submittedMessage: HarnessInteractionMerchantMessage | undefined;

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
    await page.route('**/api/core/p1/harness/tasks', (route) =>
      route.fulfill({
        json: {
          data: {
            tasks: [
              {
                taskId,
                workId: 'e2e-composer-interaction-work',
                packageId: 'e2e-composer-interaction-package',
                merchantText: '给头皮护理写一条周末活动文案',
                submittedAt: '2026-07-30T08:00:00.000Z',
              },
            ],
          },
        },
        status: 200,
      })
    );
    await page.route('**/api/core/p1/harness/tasks/*/decision', (route) =>
      route.fulfill({
        json: {
          data: {
            question: null,
            resolutionSource: null,
            status: 'absent',
            timeoutSeconds: null,
          },
        },
        status: 200,
      })
    );
    await page.route(
      '**/api/core/p1/harness/tasks/*/interaction/message',
      async (route) => {
        if (route.request().method() === 'POST') {
          submittedMessage = route
            .request()
            .postDataJSON() as HarnessInteractionMerchantMessage;
          interactionPhase = 'resolved';
          await route.fulfill({
            json: {
              data: {
                eventId: `${taskId}:interaction-message:1`,
                replayed: false,
              },
            },
            status: 200,
          });
          return;
        }
        await route.fulfill({
          json: {
            data:
              interactionPhase === 'waiting'
                ? {
                    requestId: 'execution-request-1',
                    runId: taskId,
                    step: 'execution_selection',
                    revision: 2,
                    kind: 'execution_confirmation',
                    frozen: {
                      executionSnapshotRef: {
                        id: 'execution-snapshot-1',
                        revision: 2,
                      },
                      quoteRevision: 'quote-r2',
                      params: [
                        {
                          key: 'model',
                          label: '模型',
                          value: 'model-1@r2',
                          hint: null,
                        },
                      ],
                      debitPreview: [],
                      condition: {
                        kind: 'external_action',
                        required: true,
                        serverEvaluated: true,
                      },
                      timeoutPolicy: {
                        kind: 'hold',
                        reason: 'external_action',
                        serverEvaluated: true,
                      },
                    },
                    presentation: {
                      carriers: ['conversation'],
                      notification: 'none',
                      renderer: 'execution_confirmation',
                    },
                  }
                : null,
          },
          status: 200,
        });
      }
    );
    await page.route(
      '**/api/core/p1/harness/tasks/*/interaction/v2/renderer',
      (route) => {
        rendererAcknowledgements.push(
          route.request().postDataJSON() as Record<string, unknown>
        );
        return route.fulfill({ json: { data: { acknowledged: true } } });
      }
    );
    await page.route(
      '**/api/core/p1/harness/tasks/*/interaction',
      async (route) => {
        if (route.request().method() === 'POST') {
          submittedAnswers.push(
            route.request().postDataJSON() as HarnessInteractionAnswer
          );
          interactionPhase =
            interactionPhase === 'ask' ? 'confirmation' : 'waiting';
          await route.fulfill({
            json: {
              data: {
                eventId: `${taskId}:interaction:1`,
                replayed: false,
              },
            },
            status: 200,
          });
          return;
        }
        interactionReads += 1;
        await route.fulfill({
          json: {
            data:
              interactionPhase === 'ask'
                ? {
                    requestId: 'ask-merchant-request-1',
                    runId: taskId,
                    step: 'intent_naming',
                    revision: 1,
                    kind: 'ask_merchant',
                    questions: [
                      {
                        itemId: 'service',
                        question: '这次主推哪个项目？',
                        options: [
                          {
                            label: '头皮护理',
                            description: '门店已有标准项目',
                          },
                        ],
                        fallback: { kind: 'deferred' },
                      },
                    ],
                    groupSkip: true,
                    timeoutPolicy: {
                      kind: 'hold',
                      reason: 'unknown',
                      serverEvaluated: true,
                    },
                    presentation: {
                      carriers: ['conversation'],
                      blocking: 'none',
                      notification: 'none',
                      renderer: 'ask_merchant_group',
                    },
                  }
                : interactionPhase === 'confirmation'
                  ? {
                      requestId: 'execution-request-1',
                      runId: taskId,
                      step: 'execution_selection',
                      revision: 2,
                      kind: 'execution_confirmation',
                      frozen: {
                        executionSnapshotRef: {
                          id: 'execution-snapshot-1',
                          revision: 2,
                        },
                        quoteRevision: 'quote-r2',
                        params: [
                          {
                            key: 'model',
                            label: '模型',
                            value: 'model-1@r2',
                            hint: null,
                          },
                        ],
                        debitPreview: [],
                        condition: {
                          kind: 'external_action',
                          required: true,
                          serverEvaluated: true,
                        },
                        timeoutPolicy: {
                          kind: 'hold',
                          reason: 'external_action',
                          serverEvaluated: true,
                        },
                      },
                      presentation: {
                        carriers: ['conversation'],
                        notification: 'none',
                        renderer: 'execution_confirmation',
                      },
                    }
                  : null,
          },
          status: 200,
        });
      }
    );
    await page.route('**/api/core/p1/workflows/*/events', (route) => {
      const progress = {
        eventId: `${taskId}:progress:1`,
        workflowId: taskId,
        workflowType: 'beauty_marketing_harness',
        sequence: 1,
        sourceRevision: 1,
        stage: 'intent_naming',
        state: 'suspended',
        message: '等你确认主推项目',
        occurredAt: '2026-07-30T08:00:01.000Z',
      };
      return route.fulfill({
        body:
          `id: ${progress.eventId}\n` +
          'event: workflow.progress\n' +
          `data: ${JSON.stringify(progress)}\n\n`,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        status: 200,
      });
    });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');

    const workUrl = page.url();
    const askCard = page.getByTestId('ask-merchant-group-card');
    await expect.poll(() => interactionReads).toBeGreaterThan(0);
    await expect(askCard).toBeVisible({ timeout: 30_000 });
    await expect(askCard.getByText('门店已有标准项目')).toBeVisible();

    await askCard.getByRole('button', { name: /头皮护理/u }).click();
    await askCard.getByRole('button', { name: '提交回答' }).click();
    await expect(askCard).toBeHidden();
    await expect(page).toHaveURL(workUrl);

    expect(submittedAnswers[0]).toMatchObject({
      requestId: 'ask-merchant-request-1',
      revision: 1,
      idempotencyKey: expect.any(String),
      resume: {
        runId: taskId,
        step: 'intent_naming',
      },
      response: {
        kind: 'answer',
        items: [
          {
            itemId: 'service',
            result: { kind: 'answer', value: '头皮护理' },
          },
        ],
      },
    });
    expect(JSON.stringify(submittedAnswers[0])).not.toContain(
      '门店已有标准项目'
    );

    const confirmationCard = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(confirmationCard).toBeVisible({ timeout: 10_000 });
    await expect(confirmationCard.getByText('model-1@r2')).toBeVisible();
    await confirmationCard.getByRole('button', { name: '暂不执行' }).click();
    await expect(confirmationCard).toBeHidden();

    expect(submittedAnswers[1]).toMatchObject({
      requestId: 'execution-request-1',
      revision: 2,
      idempotencyKey: expect.any(String),
      resume: {
        runId: taskId,
        step: 'execution_selection',
      },
      response: { kind: 'rejected' },
    });

    const waitingCard = page.getByTestId(
      'execution-confirmation-waiting-message-card'
    );
    await expect(waitingCard).toBeVisible({ timeout: 10_000 });
    await waitingCard
      .getByRole('textbox', { name: '补充你的调整说明' })
      .fill('  换成更稳妥的方案  ');
    await waitingCard.getByRole('button', { name: '继续调整' }).click();
    await expect(waitingCard).toBeHidden();
    await expect(page).toHaveURL(workUrl);

    expect(submittedMessage).toMatchObject({
      requestId: 'execution-request-1',
      revision: 2,
      step: 'execution_selection',
      carrier: 'conversation',
      idempotencyKey: expect.any(String),
      message: '换成更稳妥的方案',
    });
    expect(rendererAcknowledgements.length).toBeGreaterThanOrEqual(2);
    expect(rendererAcknowledgements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: 'ask-merchant-request-1',
          revision: 1,
          step: 'intent_naming',
          carrier: 'conversation',
        }),
        expect.objectContaining({
          requestId: 'execution-request-1',
          revision: 2,
          step: 'execution_selection',
          carrier: 'conversation',
        }),
      ])
    );
  });
});
