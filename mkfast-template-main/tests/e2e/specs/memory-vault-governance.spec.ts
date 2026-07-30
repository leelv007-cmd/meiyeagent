import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import type { MemoryEntriesPage } from '@meiye/contracts';
import postgres from 'postgres';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const DURABLE_PREFERENCE = '以后每次文案都保持克制、像熟客分享，请长期记住';
const EXECUTION_LIMITS_KEY = 'harness.bounded_execution.limits';
const EXECUTION_LIMITS = {
  maxIterations: { default: 2, hardCap: 4 },
  maxCostCents: { default: 100, hardCap: 200 },
  maxWallClockMs: { default: 60_000, hardCap: 120_000 },
  maxDelegations: { default: 'unset', hardCap: 'unset' },
} as const;
async function signOut(page: Page) {
  await page.evaluate(async () => {
    await fetch('/api/auth/sign-out', {
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  });
}

async function seedExecutionLimits(page: Page, request: APIRequestContext) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);
  const historyResponse = await page.request.post('/api/core/p1/query', {
    data: {
      action: 'config_history',
      module: 'admin-config',
      payload: { key: EXECUTION_LIMITS_KEY },
    },
  });
  expect(historyResponse.ok(), await historyResponse.text()).toBeTruthy();
  const history = (
    (await historyResponse.json()) as {
      data?: Array<{ revision?: number }>;
    }
  ).data;
  const currentRevision = history?.reduce(
    (current, item) => Math.max(current, item.revision ?? 0),
    0
  );
  const applyResponse = await page.request.post('/api/core/p1/commands', {
    data: {
      action: 'config_apply',
      module: 'admin-config',
      payload: {
        expectedRevision: currentRevision || null,
        key: EXECUTION_LIMITS_KEY,
        reason: 'Issue 251 real E2E execution bounds',
        value: EXECUTION_LIMITS,
      },
    },
    headers: {
      'idempotency-key': `issue-251-bounds-${crypto.randomUUID()}`,
    },
  });
  expect(applyResponse.ok(), await applyResponse.text()).toBeTruthy();
  await signOut(page);
}

async function memoryEntries(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'entries_page',
        module: 'memory',
        payload: { limit: 20 },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: MemoryEntriesPage;
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Memory query failed');
    }
    return envelope.data;
  });
}

test.describe('memory vault governance', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('Composer proposes a governed memory that the next ContextBundle consumes', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    await seedExecutionLimits(page, request);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    const copyContract = JOURNEY_CONTRACTS.find(
      (contract) => contract.modality === 'copy'
    )!;
    const sql = postgres(
      process.env.TEST_DATABASE_URL ??
        process.env.DATABASE_URL ??
        'postgres://meiye:meiye@127.0.0.1:54329/meiye',
      { max: 1 }
    );

    try {
      const [platformSupply] = await sql<
        Array<{ revisionId: string }>
      >`SELECT revision_id AS "revisionId"
          FROM p1_supply_registry_heads
         WHERE workspace_id = '__platform_supply__'
         LIMIT 1`;
      expect(
        platformSupply?.revisionId,
        'fresh Core startup must initialize the platform supply head before frozen-route admission'
      ).toBeTruthy();
      await page.goto('/dashboard');
      const firstWorkId = await submitComposerJourney(
        page,
        copyContract,
        DURABLE_PREFERENCE
      );
      await waitForResultJourney(page, copyContract, firstWorkId);

      let entryId = '';
      await expect
        .poll(
          async () => {
            const entry = (await memoryEntries(page)).items.find(
              (item) => item.value === DURABLE_PREFERENCE
            );
            entryId = entry?.entryId ?? '';
            return entry;
          },
          {
            message:
              'the completed Composer run must create one visible pending preference',
            timeout: 60_000,
          }
        )
        .toMatchObject({
          status: 'pending',
          source: {
            messageRange: { start: 0, end: 0 },
            status: 'available',
          },
        });

      await page.goto('/dashboard/memory');
      const card = page.getByTestId(`memory-entry-${entryId}`);
      await expect(card.getByTestId('memory-entry-provenance')).toContainText(
        DURABLE_PREFERENCE
      );
      await card.getByRole('button', { name: '确认记住' }).click();
      await expect(card).toContainText('已确认');

      let secondTaskId = '';
      await page.goto('/dashboard');
      const secondWorkId = await submitComposerJourney(
        page,
        copyContract,
        '再写一条周末皮肤护理到店预约文案',
        {
          onSubmissionAccepted({ taskId }) {
            secondTaskId = taskId;
          },
        }
      );
      await waitForResultJourney(page, copyContract, secondWorkId);

      const [owner] = await sql<
        Array<{ workspaceId: string }>
      >`SELECT workspace_id AS "workspaceId"
          FROM p1_creative_works
         WHERE id = ${firstWorkId}
         LIMIT 1`;
      expect(owner?.workspaceId).toBeTruthy();
      await expect
        .poll(
          async () => {
            const [bundle] = await sql<
              Array<{ payload: Record<string, unknown> }>
            >`SELECT payload
                FROM p1_context_bundle_revisions
               WHERE workspace_id = ${owner!.workspaceId}
                 AND payload->>'taskId' = ${secondTaskId}
               ORDER BY revision DESC
               LIMIT 1`;
            const dimensions = bundle?.payload.dimensions as
              | {
                  expression_identity?: Record<string, unknown>;
                }
              | undefined;
            return dimensions?.expression_identity
              ?.preference_style_copy_long_term;
          },
          {
            message:
              'the next production ContextBundle must consume the confirmed preference',
            timeout: 60_000,
          }
        )
        .toEqual({
          layer: 'confirmed_preference',
          pool: 'store_personal',
          sourceRef: expect.stringMatching(/^preference:memory-preference-/u),
          value: DURABLE_PREFERENCE,
        });

      await page.goto('/dashboard/memory');
      const confirmedCard = page.getByTestId(`memory-entry-${entryId}`);
      await confirmedCard.getByRole('button', { name: '删除来源对话' }).click();
      await expect(
        confirmedCard.getByTestId('memory-entry-provenance')
      ).toContainText('来源对话已删除');
    } finally {
      await sql.end();
    }
  });
});
