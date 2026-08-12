/**
 * Journey-gate XHS image-text main chain (L4 / #313–#328 surface).
 *
 * Lean path for the ordinary production-main-journey job:
 *   register → seed store → submit 小红书图文 (fixture)
 *   → direction + execution confirm → delivered
 *   → Result Center object workspace with note document
 *
 * Prefer shared ui-journey helpers over the full T20 compiler suite so the
 * gate stays near a three-minute budget while still covering the note carrier.
 */

import { expect, test, type Response } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';
import { AgentFaultReceiptProbe } from '../fixtures/agent-fault-receipt';

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;

function isResultDeliveryResponse(response: Response, action: string) {
  if (
    response.request().method() !== 'POST' ||
    !response.url().includes('/api/core/p1/commands')
  ) {
    return false;
  }
  try {
    const body = response.request().postDataJSON() as {
      action?: string;
      module?: string;
    };
    return body.module === 'result-delivery' && body.action === action;
  } catch {
    return false;
  }
}

test.describe('XHS image-text main journey (production gate)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(120_000);
    await cleanupE2EUsers(request);
  });

  test('fixture 小红书图文 reaches delivered note object workspace', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const merchant = await registerE2EUser(request);
    await loginByForm(page, merchant);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await seedComposerInlineAuthorize(page, {
      fileName: 'xhs-main-journey-source.png',
    });
    let replayCalls = 0;
    let eventCalls = 0;
    let reconnectCursorObserved = false;
    let reconnectLastEventId: string | undefined;
    let reconnectLastStreamOffset: string | null = null;
    let replayFaultApplied = false;
    const streamFaultProbe = new AgentFaultReceiptProbe('artifact-gap-close');
    const agentResponses: Response[] = [];
    page.on('response', (response) => {
      if (!response.url().includes('/api/core/p1/agent-threads/')) return;
      agentResponses.push(response);
      void response
        .headerValue('x-meiye-e2e-agent-fault-applied')
        .then((fault) => {
          if (fault === 'artifact-head-replay') replayFaultApplied = true;
          if (response.url().includes('/events')) {
            streamFaultProbe.recordResponse(
              response.request(),
              response.status(),
              fault
            );
          }
        })
        .catch(() => {
          if (response.url().includes('/events')) {
            streamFaultProbe.recordResponse(
              response.request(),
              response.status(),
              null
            );
          }
        });
    });
    page.on('requestfailed', (failedRequest) => {
      if (!failedRequest.url().includes('/agent-threads/')) return;
      if (!failedRequest.url().includes('/events')) return;
      streamFaultProbe.recordFailure(
        failedRequest,
        failedRequest.failure()?.errorText ?? 'unknown browser request failure'
      );
    });
    await page.route(
      '**/api/core/p1/agent-threads/*/replay**',
      async (route) => {
        replayCalls += 1;
        if (!replayFaultApplied) {
          const faultUrl = new URL(route.request().url());
          faultUrl.searchParams.set('e2eAgentFault', 'artifact-head-replay');
          await route.continue({ url: faultUrl.toString() });
          return;
        }
        await route.continue();
      }
    );
    await page.route(
      '**/api/core/p1/agent-threads/*/events**',
      async (route) => {
        eventCalls += 1;
        const routedRequest = route.request();
        const originalUrl = routedRequest.url();
        expect(
          new URL(originalUrl).searchParams.has('e2eAgentFault'),
          'the original browser events URL must be fault-free before route rewriting'
        ).toBe(false);
        const { forwardUrl } = streamFaultProbe.beginRequest(
          routedRequest,
          originalUrl
        );
        if (streamFaultProbe.receiptObserved && !reconnectCursorObserved) {
          reconnectCursorObserved = true;
          reconnectLastEventId = routedRequest.headers()['last-event-id'];
          reconnectLastStreamOffset = new URL(originalUrl).searchParams.get(
            'lastStreamOffset'
          );
        }
        await route.continue(forwardUrl ? { url: forwardUrl } : undefined);
      }
    );

    const workId = await submitComposerJourney(
      page,
      imageTextContract,
      '把本店皮肤护理案例做成小红书图文笔记',
      {
        onDeliveryCardVisible: async () => {
          const host = page.getByTestId('agent-workbench-host');
          const threadId = await host.getAttribute('data-thread-id');
          expect(
            threadId,
            'Composer must bind the Artifact to its real Thread'
          ).toBeTruthy();

          const note = page.getByTestId('agent-artifact-note');
          await expect(note).toBeVisible({ timeout: 60_000 });
          await expect(note).toHaveAttribute('data-artifact-status', 'ready');
          await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);
          // Core closes the first real SSE after dropping one Artifact revision.
          // The host must reconnect itself; this journey never reloads the page.
          try {
            await expect
              .poll(() => streamFaultProbe.receiptObserved, {
                message:
                  'Core must receipt an artifact-gap-close request before the spec stops injecting it',
              })
              .toBe(true);
          } finally {
            await testInfo.attach('xhs-agent-events-fault-receipt', {
              body: Buffer.from(
                JSON.stringify(streamFaultProbe.diagnostics(), null, 2)
              ),
              contentType: 'application/json',
            });
          }
          await expect.poll(() => replayFaultApplied).toBe(true);
          await expect.poll(() => replayCalls).toBeGreaterThanOrEqual(2);
          await expect.poll(() => eventCalls).toBeGreaterThanOrEqual(2);

          const replayPath = `/api/core/p1/agent-threads/${encodeURIComponent(threadId!)}/replay`;
          const fullReplay = (await page.evaluate(async (path) => {
            const response = await fetch(path, { credentials: 'same-origin' });
            if (!response.ok)
              throw new Error(`replay failed: ${response.status}`);
            return response.json();
          }, replayPath)) as {
            data: {
              events: Array<{
                eventId: string;
                eventType: string;
                payload: { revision?: number; status?: string };
                streamOffset: string;
              }>;
              session: unknown;
              snapshot: unknown;
            };
            meta?: unknown;
          };
          const artifacts = fullReplay.data.events.filter(
            ({ eventType }) => eventType === 'artifact.revised'
          );
          expect(artifacts.length).toBeGreaterThanOrEqual(3);
          expect(artifacts.at(-1)?.payload.status).toBe('ready');
          const firstArtifact = artifacts[0]!;
          const finalArtifact = artifacts.at(-1)!;
          expect(finalArtifact.payload.revision).toBeGreaterThan(
            (firstArtifact.payload.revision ?? 0) + 1
          );

          await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
            'data-artifact-status',
            'ready',
            { timeout: 60_000 }
          );
          expect(reconnectLastEventId).toBe(firstArtifact.eventId);
          expect(reconnectLastStreamOffset).toBe(firstArtifact.streamOffset);
          const appliedFaults = (
            await Promise.all(
              agentResponses.map((response) =>
                response.headerValue('x-meiye-e2e-agent-fault-applied')
              )
            )
          ).filter((value): value is string => value !== null);
          expect(appliedFaults).toContain('artifact-head-replay');
          expect(appliedFaults).toContain('artifact-gap-close');
          expect(streamFaultProbe.diagnostics()).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                faultInjected: true,
                receipt: 'artifact-gap-close',
                status: 200,
              }),
            ])
          );
          await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);

          const recoveredRevision = Number(
            await page
              .getByTestId('agent-artifact-note')
              .getAttribute('data-revision')
          );
          expect(recoveredRevision).toBeGreaterThan(0);
          const readyRow = page
            .locator(
              '[data-testid="note-plan-page-row"][data-image-status="ready"]'
            )
            .first();
          await expect(readyRow).toBeVisible({ timeout: 60_000 });
          const prepareResponse = page.waitForResponse(
            (response) =>
              isResultDeliveryResponse(response, 'result_adjust_prepare'),
            { timeout: 60_000 }
          );
          await readyRow.getByTestId('note-plan-page-regenerate').click();
          expect((await prepareResponse).ok()).toBe(true);

          const confirmResponse = page.waitForResponse(
            (response) => isResultDeliveryResponse(response, 'result_adjust'),
            { timeout: 60_000 }
          );
          await page.getByTestId('execution-confirm-accept').click();
          expect((await confirmResponse).ok()).toBe(true);
          const derivedConfirmation = page.getByTestId(
            'execution-confirmation-interaction-card'
          );
          await expect(derivedConfirmation).toBeVisible({ timeout: 60_000 });
          await derivedConfirmation
            .getByRole('button', { name: '确认执行' })
            .click();

          await expect
            .poll(
              async () =>
                Number(
                  await page
                    .getByTestId('agent-artifact-note')
                    .getAttribute('data-revision')
                ),
              {
                message:
                  'the automatically re-subscribed SSE must receive the successor Artifact revision',
                timeout: 120_000,
              }
            )
            .toBeGreaterThan(recoveredRevision);
          await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
            'data-artifact-status',
            'ready',
            { timeout: 120_000 }
          );
        },
      }
    );
    await waitForResultJourney(page, imageTextContract, workId);

    const workspace = page.getByTestId('result-image-text-workspace');
    await expect(workspace.getByTestId('image-worksurface')).toBeVisible();
    await expect(
      workspace.getByTestId('object-workspace-shell')
    ).toHaveAttribute('data-carrier', 'note');
    await expect(workspace.getByTestId('note-object-workspace')).toBeVisible();
    await expect(workspace.getByTestId('copy-field-body')).toContainText(/\S/u);
  });
});
