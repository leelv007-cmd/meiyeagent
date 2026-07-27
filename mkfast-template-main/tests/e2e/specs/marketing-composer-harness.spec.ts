import { expect, test } from '@playwright/test';
import type { StructuredDecisionInput } from '@meiye/contracts';

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
});
