import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { DiagnosticRun } from '@meiye/contracts';

import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

test('Campaign HTTP authenticates start and returns the production lifecycle projection', async (t) => {
  const starts: unknown[] = [];
  const advances: unknown[] = [];
  const projection = {
    campaignId: 'campaign-http-1',
    campaignPlanRef: { id: 'campaign-http-1:plan', revision: 1 },
    planApproval: {
      approvalScope: 'plan_only' as const,
      planOnlyNotice: '本确认只批准计划排期，不含扣费',
      requestId: 'confirmation-campaign-http-1-plan',
      reservedCredits: 0 as const,
      status: 'confirmed' as const,
    },
    works: [
      {
        approvalScope: 'single_work' as const,
        contentPackage: { id: 'package-1' },
        runId: 'run-1',
        task: { id: 'task-1' },
        threadId: 'thread-1',
        work: { id: 'work-1' },
        workOrdinal: 1 as const,
      },
      {
        approvalScope: 'single_work' as const,
        state: 'scheduled' as const,
        workOrdinal: 2 as const,
      },
    ],
  };
  const server = createCoreServer({
    campaignPaidWorks: {
      async start(input) {
        starts.push(input);
        return projection;
      },
      async advance(workspaceId, campaignId) {
        advances.push({ workspaceId, campaignId });
        return projection;
      },
    },
    diagnosticRepository: diagnostics,
    serviceToken: 'campaign-test-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/campaigns/paid-works`;
  const headers = {
    'content-type': 'application/json',
    'x-service-token': 'campaign-test-token',
    'x-user-id': 'owner-1',
    'x-workspace-id': 'workspace-1',
    'x-workspace-role': 'owner',
  };

  const unauthenticated = await fetch(base, {
    body: JSON.stringify({ firstWork: submissionPayload(), secondWorkIntent: '第二周' }),
    method: 'POST',
  });
  assert.equal(unauthenticated.status, 401);

  const started = await fetch(base, {
    body: JSON.stringify({ firstWork: submissionPayload(), secondWorkIntent: '第二周' }),
    headers,
    method: 'POST',
  });
  assert.equal(started.status, 202);
  assert.deepEqual((await started.json()).data, projection);
  assert.deepEqual(starts, [
    {
      actorId: 'owner-1',
      firstWork: submissionPayload(),
      secondWorkIntent: '第二周',
      workspaceId: 'workspace-1',
    },
  ]);

  const status = await fetch(`${base}/campaign-http-1`, { headers });
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).data, projection);
  assert.deepEqual(advances, [
    { campaignId: 'campaign-http-1', workspaceId: 'workspace-1' },
  ]);
});

function submissionPayload() {
  return {
    briefConfirmation: { id: 'brief-confirmation-1', revision: 'brief-r2' },
    briefContext: { id: 'brief-context-1', revision: 4 },
    catalogModel: { id: 'catalog-copy-1', revision: 'catalog-r4' },
    contentPackagePlatform: 'douyin',
    distributionTarget: 'export',
    deliverable: { kind: 'copy_document', quantity: 1, aspectRatio: '3:4' },
    creationMode: 'customized',
    contentModules: ['social_cover'],
    deliverables: [
      {
        aspectRatio: '3:4',
        id: 'deliverable-copy-main',
        kind: 'copy',
        order: 1,
        quantity: 1,
      },
    ],
    identity: { id: 'identity-brand', revision: 'identity-r3' },
    idempotencyKey: 'campaign-http-work-1',
    intent: '第一周',
    lens: 'copy',
    modelPolicy: { id: 'policy-copy', mode: 'fixed', revision: 'policy-r1' },
    quote: { id: 'quote-1', revision: 'quote-r5' },
    recipe: { id: 'recipe-service-promotion', revision: 'recipe-r7' },
    rights: { revision: 'rights-r4', summary: 'authorized' },
    route: { id: 'route-1', revision: 'route-r6' },
    sources: { assets: [] },
    surface: { id: 'surface-composer', revision: 'surface-r2' },
    userSelectedSkillRefs: [],
  };
}
