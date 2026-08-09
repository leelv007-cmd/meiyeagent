import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readCampaignPaidWork,
  submitCampaignPaidWork,
} from './campaign-paid-work-client';

const responseBody = {
  data: {
    campaignId: 'campaign-1',
    campaignPlanRef: { id: 'campaign-1:plan', revision: 1 },
    planApproval: {
      approvalScope: 'plan_only',
      planOnlyNotice: '本确认只批准计划排期，不含扣费',
      requestId: 'confirmation-campaign-1-plan',
      reservedCredits: 0,
      status: 'confirmed',
    },
    works: [
      {
        approvalScope: 'single_work',
        contentPackage: { expectedRevision: 0, id: 'package-1' },
        replayed: false,
        runId: 'run-1',
        snapshot: {
          id: 'snapshot-1',
          identity: { id: 'identity-1', revision: '1' },
          schemaVersion: 'creation-execution-snapshot/v1',
        },
        task: { id: 'task-1' },
        threadId: 'thread-1',
        usageReservation: { id: 'reservation-1' },
        work: { id: 'work-1' },
        workOrdinal: 1,
      },
      { approvalScope: 'single_work', state: 'scheduled', workOrdinal: 2 },
    ],
  },
  meta: { correlationId: 'campaign-client-test' },
};

test('Campaign client starts and reads the production Campaign routes', async () => {
  const requests: Array<{ body?: unknown; method?: string; url: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push({
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      method: init?.method,
      url: String(input),
    });
    return new Response(JSON.stringify(responseBody), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  }) as typeof fetch;
  try {
    const firstWork = {
      briefConfirmation: { id: 'brief-confirm-1', revision: 'draft-r3' },
      briefContext: { id: 'brief-context-1', revision: 3 },
      catalogModel: { id: 'catalog-copy-1', revision: 'catalog-r4' },
      contentPackagePlatform: 'douyin' as const,
      distributionTarget: 'export' as const,
      deliverable: { kind: 'copy_document' as const, quantity: 1 },
      creationMode: 'customized' as const,
      identity: { id: 'identity-brand', revision: '2' },
      idempotencyKey: 'campaign-work-1',
      intent: '第一周夏日护理海报',
      quote: { id: 'quote-1', revision: 'quote-r2' },
      recipe: { id: 'recipe-summer', revision: 'recipe-summer@2' },
      sources: { assets: [] },
      surface: { id: 'surface.home.launch', revision: 'surface.home.launch@3' },
    };
    const started = await submitCampaignPaidWork({
      firstWork,
      secondWorkIntent: '第二周补水海报',
    });
    const loaded = await readCampaignPaidWork('campaign-1');

    assert.equal(started.works[0]?.workOrdinal, 1);
    assert.equal(loaded.works[1]?.workOrdinal, 2);
    assert.deepEqual(requests, [
      {
        body: {
          firstWork: { ...firstWork, userSelectedSkillRefs: [] },
          secondWorkIntent: '第二周补水海报',
        },
        method: 'POST',
        url: '/api/core/p1/campaigns/paid-works',
      },
      {
        body: undefined,
        method: 'GET',
        url: '/api/core/p1/campaigns/paid-works/campaign-1',
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
