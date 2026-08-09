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

import { expect, test } from '@playwright/test';

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

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;

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
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const merchant = await registerE2EUser(request);
    await loginByForm(page, merchant);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await seedComposerInlineAuthorize(page, {
      fileName: 'xhs-main-journey-source.png',
    });

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

          let replayCalls = 0;
          let eventCalls = 0;
          let reconnectLastEventId: string | undefined;
          await page.route(`**${replayPath}**`, async (route) => {
            replayCalls += 1;
            if (replayCalls === 1) {
              await route.fulfill({
                body: JSON.stringify({
                  ...fullReplay,
                  data: {
                    ...fullReplay.data,
                    events: [firstArtifact],
                    snapshot: {
                      revision: '0',
                      lastEventId: null,
                      lastStreamOffset: null,
                    },
                  },
                }),
                contentType: 'application/json',
                status: 200,
              });
              return;
            }
            await route.fulfill({
              body: JSON.stringify(fullReplay),
              contentType: 'application/json',
              status: 200,
            });
          });
          await page.route(
            `**/api/core/p1/agent-threads/${encodeURIComponent(threadId!)}/events**`,
            async (route) => {
              eventCalls += 1;
              if (eventCalls !== 1) {
                await route.continue();
                return;
              }
              reconnectLastEventId = route.request().headers()['last-event-id'];
              await route.fulfill({
                body: `id: ${finalArtifact.eventId}\nevent: agent.semantic\ndata: ${JSON.stringify(finalArtifact)}\n\n`,
                contentType: 'text/event-stream',
                status: 200,
              });
            }
          );

          // A real browser transport disconnect loses the in-memory Workbench.
          // On reconnect, the first durable replay is intentionally truncated;
          // the live final revision creates a real gap and must trigger a second,
          // full snapshot replay rather than accepting the jumped revision.
          await page.context().setOffline(true);
          await page.context().setOffline(false);
          await page.reload();

          await expect(page.getByTestId('agent-artifact-note')).toHaveAttribute(
            'data-artifact-status',
            'ready',
            { timeout: 60_000 }
          );
          await expect.poll(() => replayCalls).toBeGreaterThanOrEqual(2);
          expect(reconnectLastEventId).toBe(firstArtifact.eventId);
          await expect(page.getByTestId('agent-artifact-card')).toHaveCount(1);
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
