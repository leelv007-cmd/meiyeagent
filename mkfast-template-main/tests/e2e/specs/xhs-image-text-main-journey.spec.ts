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

import {
  expect,
  test,
  type Request as PlaywrightRequest,
  type Response,
} from '@playwright/test';

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
import { AgentFaultReceiptProbe } from '../../../scripts/e2e/agent-fault-receipt';

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;
const TARGET_THREAD_BIND_TIMEOUT_MS = 15_000;

function agentFaultEndpoint(rawUrl: string) {
  const endpoint = new URL(rawUrl).pathname.match(
    /\/api\/core\/p1\/agent-threads\/[^/]+\/(events|replay)$/u
  )?.[1];
  return endpoint === 'events' || endpoint === 'replay' ? endpoint : null;
}

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
    let acceptedThreadId: string | undefined;
    const streamFaultProbe = new AgentFaultReceiptProbe('artifact-gap-close');
    const replayFaultProbe = new AgentFaultReceiptProbe('artifact-head-replay');
    const eventRequestCursors = new Map<
      PlaywrightRequest,
      {
        lastEventId: string | undefined;
        lastStreamOffset: string | null;
      }
    >();
    let recoveryRequest: PlaywrightRequest | undefined;
    page.on('response', (response) => {
      const endpoint = agentFaultEndpoint(response.url());
      const probe =
        endpoint === 'events'
          ? streamFaultProbe
          : endpoint === 'replay'
            ? replayFaultProbe
            : null;
      if (!probe) return;
      probe.recordResponseStarted(response.request(), response.status());
      void response
        .headerValue('x-meiye-e2e-agent-fault-applied')
        .then((fault) => {
          probe.recordResponse(response.request(), response.status(), fault);
        })
        .catch(() => {
          probe.recordResponse(response.request(), response.status(), null);
        });
    });
    page.on('requestfinished', (finishedRequest) => {
      const endpoint = agentFaultEndpoint(finishedRequest.url());
      if (endpoint === 'events') {
        streamFaultProbe.recordFinished(finishedRequest);
      } else if (endpoint === 'replay') {
        replayFaultProbe.recordFinished(finishedRequest);
      }
    });
    page.on('requestfailed', (failedRequest) => {
      const endpoint = agentFaultEndpoint(failedRequest.url());
      const probe =
        endpoint === 'events'
          ? streamFaultProbe
          : endpoint === 'replay'
            ? replayFaultProbe
            : null;
      if (!probe) return;
      probe.recordFailure(
        failedRequest,
        failedRequest.failure()?.errorText ?? 'unknown browser request failure'
      );
    });
    await page.route(
      '**/api/core/p1/agent-threads/*/replay**',
      async (route) => {
        replayCalls += 1;
        const routedRequest = route.request();
        const originalUrl = routedRequest.url();
        expect(
          new URL(originalUrl).searchParams.has('e2eAgentFault'),
          'the original browser replay URL must be fault-free before route rewriting'
        ).toBe(false);
        const { forwardUrl } = await replayFaultProbe.beginRequestAfterTarget(
          routedRequest,
          originalUrl,
          TARGET_THREAD_BIND_TIMEOUT_MS
        );
        await route.continue(forwardUrl ? { url: forwardUrl } : undefined);
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
        const { forwardUrl } = await streamFaultProbe.beginRequestAfterTarget(
          routedRequest,
          originalUrl,
          TARGET_THREAD_BIND_TIMEOUT_MS
        );
        eventRequestCursors.set(routedRequest, {
          lastEventId: routedRequest.headers()['last-event-id'],
          lastStreamOffset: new URL(originalUrl).searchParams.get(
            'lastStreamOffset'
          ),
        });
        if (streamFaultProbe.isRecoveryRequest(routedRequest)) {
          recoveryRequest = routedRequest;
        }
        await route.continue(forwardUrl ? { url: forwardUrl } : undefined);
      }
    );

    const workId = await submitComposerJourney(
      page,
      imageTextContract,
      '把本店皮肤护理案例做成小红书图文笔记',
      {
        onSubmissionAccepted: ({ threadId }) => {
          acceptedThreadId = threadId;
          streamFaultProbe.bindTargetThread(threadId);
          replayFaultProbe.bindTargetThread(threadId);
        },
        onDeliveryCardVisible: async () => {
          const host = page.getByTestId('agent-workbench-host');
          const threadId = await host.getAttribute('data-thread-id');
          expect(
            threadId,
            'Composer must bind the Artifact to its real Thread'
          ).toBeTruthy();
          expect(
            threadId,
            'the visible Artifact Thread must match the authoritative 202 receipt'
          ).toBe(acceptedThreadId);

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
                  'Core must receipt and finish an artifact-gap-close request before the spec stops injecting it',
              })
              .toBe(true);
            await expect
              .poll(() => replayFaultProbe.receiptObserved, {
                message:
                  'Core must receipt and finish an artifact-head-replay request before the spec stops injecting it',
              })
              .toBe(true);
            await expect.poll(() => replayCalls).toBeGreaterThanOrEqual(2);
            await expect.poll(() => eventCalls).toBeGreaterThanOrEqual(2);
            await expect
              .poll(
                () =>
                  recoveryRequest !== undefined &&
                  streamFaultProbe.isRecoveryRequest(recoveryRequest),
                {
                  message:
                    'the SSE recovery cursor must belong to the first target request begun after the successful fault terminal',
                }
              )
              .toBe(true);
            expect(streamFaultProbe.appliedReceiptCount).toBe(1);
            expect(replayFaultProbe.appliedReceiptCount).toBe(1);
            expect(streamFaultProbe.injectedRequestCount).toBe(1);
            expect(replayFaultProbe.injectedRequestCount).toBe(1);
            expect(streamFaultProbe.receiptedInjectedRequestCount).toBe(1);
            expect(replayFaultProbe.receiptedInjectedRequestCount).toBe(1);
            expect(
              streamFaultProbe
                .diagnostics()
                .filter(({ successfulFault }) => successfulFault)
            ).toHaveLength(1);
            expect(
              replayFaultProbe
                .diagnostics()
                .filter(({ successfulFault }) => successfulFault)
            ).toHaveLength(1);
          } finally {
            await testInfo.attach('xhs-agent-fault-receipts', {
              body: Buffer.from(
                JSON.stringify(
                  {
                    events: {
                      appliedReceiptCount: streamFaultProbe.appliedReceiptCount,
                      injectedRequestCount:
                        streamFaultProbe.injectedRequestCount,
                      receiptObserved: streamFaultProbe.receiptObserved,
                      receiptedInjectedRequestCount:
                        streamFaultProbe.receiptedInjectedRequestCount,
                      requests: streamFaultProbe.diagnostics(),
                    },
                    replay: {
                      appliedReceiptCount: replayFaultProbe.appliedReceiptCount,
                      injectedRequestCount:
                        replayFaultProbe.injectedRequestCount,
                      receiptObserved: replayFaultProbe.receiptObserved,
                      receiptedInjectedRequestCount:
                        replayFaultProbe.receiptedInjectedRequestCount,
                      requests: replayFaultProbe.diagnostics(),
                    },
                  },
                  null,
                  2
                )
              ),
              contentType: 'application/json',
            });
          }
          const terminalDiagnostics = streamFaultProbe.diagnostics();
          const terminalReplayDiagnostics = replayFaultProbe.diagnostics();
          const reconnectCursor = recoveryRequest
            ? eventRequestCursors.get(recoveryRequest)
            : undefined;
          expect(
            reconnectCursor,
            'the recovery cursor must be bound to its concrete Playwright Request'
          ).toBeDefined();
          if (!reconnectCursor) {
            throw new Error('the concrete SSE recovery cursor is unavailable');
          }

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
          expect(reconnectCursor.lastEventId).toBe(firstArtifact.eventId);
          expect(reconnectCursor.lastStreamOffset).toBe(
            firstArtifact.streamOffset
          );
          expect(terminalDiagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                failure: null,
                faultInjected: true,
                finished: true,
                matchesTargetThread: true,
                receipt: 'artifact-gap-close',
                status: 200,
                successfulFault: true,
              }),
            ])
          );
          expect(terminalReplayDiagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                failure: null,
                faultInjected: true,
                finished: true,
                matchesTargetThread: true,
                receipt: 'artifact-head-replay',
                status: 200,
                successfulFault: true,
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
