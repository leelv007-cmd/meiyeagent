import assert from 'node:assert/strict';
import test from 'node:test';

import type { ComposerSubmissionBody } from '../execution-spine/creation-execution-snapshot.js';
import {
  CampaignPaidWorkApplication,
  type CampaignPaidWorkApplicationStart,
} from './campaign-paid-work-application.js';

const firstWork = {
  idempotencyKey: 'composer-campaign-1',
  intent: '第一周夏日护理海报',
} as ComposerSubmissionBody;

test('Campaign application derives one stable plan and two independent submissions', async () => {
  let started: CampaignPaidWorkApplicationStart | undefined;
  const approvals: unknown[] = [];
  const planApproval = {
    async ensure(input: unknown) {
      approvals.push(structuredClone(input));
      return {
        approvalScope: 'plan_only' as const,
        planOnlyNotice: '本确认只批准计划排期，不含扣费',
        requestId: 'confirmation-plan-1',
        reservedCredits: 0 as const,
        status: 'pending' as const,
      };
    },
    async read() {
      return {
        approvalScope: 'plan_only' as const,
        planOnlyNotice: '本确认只批准计划排期，不含扣费',
        requestId: 'confirmation-plan-1',
        reservedCredits: 0 as const,
        status: 'pending' as const,
      };
    },
  };
  const application = new CampaignPaidWorkApplication({
    async start(input) {
      started = structuredClone(input);
      return { ...input, results: [] };
    },
    async advance() {
      throw new Error('not used');
    },
    async get() {
      throw new Error('not used');
    },
  }, planApproval);

  const result = await application.start({
    actorId: 'merchant-1',
    firstWork,
    secondWorkIntent: '第二周补水护理海报',
    workspaceId: 'workspace-1',
  });

  assert.ok(started);
  assert.equal(result.campaignId, started.campaignId);
  assert.equal(started.planApprovalRequestId, 'confirmation-plan-1');
  assert.deepEqual(result.planApproval, await planApproval.read());
  assert.equal(result.works[0]?.state, 'awaiting_plan_confirmation');
  assert.equal(approvals.length, 1);
  assert.deepEqual(started.campaignPlanRef, {
    id: `${started.campaignId}:plan`,
    revision: 1,
  });
  assert.deepEqual(
    started.submissions.map((submission) => ({
      actorId: submission.actorId,
      idempotencyKey: submission.idempotencyKey,
      intent: submission.intent,
      workspaceId: submission.workspaceId,
    })),
    [
      {
        actorId: 'merchant-1',
        idempotencyKey: 'composer-campaign-1',
        intent: '第一周夏日护理海报',
        workspaceId: 'workspace-1',
      },
      {
        actorId: 'merchant-1',
        idempotencyKey: 'composer-campaign-1:campaign:2',
        intent: '第二周补水护理海报',
        workspaceId: 'workspace-1',
      },
    ]
  );

  const replay = await application.start({
    actorId: 'merchant-1',
    firstWork,
    secondWorkIntent: '第二周补水护理海报',
    workspaceId: 'workspace-1',
  });
  assert.equal(replay.campaignId, result.campaignId);
});
