import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import {
  ContentPackageApprovalService,
  MemoryApprovalReceiptRepository,
  createPendingApprovalRequest,
} from '../operations/content-package-approval.js';
import { MemoryContextBundleRepository } from '../operations/context-bundle-repository.js';
import { ContextInvalidationService } from '../operations/context-invalidation.js';
import { MemoryContextSourceRevisionRepository } from '../operations/context-source-revisions.js';
import { MemoryMarketingIdentityRepository } from '../operations/marketing-identity.js';
import { MemoryStoreFactLedger } from '../operations/store-fact-ledger.js';
import { LedgerBackedHarnessContextPort } from './production-context-port.js';
import {
  HarnessIdentityPreflightError,
  ProductionHarnessStagePorts,
  type HarnessCopyDeliveryPort,
} from './production-stage-ports.js';
import type { HarnessWorkflowInput } from './task-admission.js';

test('identity revocation rejects the stale persona, falls back safely, and invalidates approval', async () => {
  let now = '2026-07-18T00:00:00.000Z';
  const identities = new MemoryMarketingIdentityRepository();
  const sourceRevisions = new MemoryContextSourceRevisionRepository();
  const bundles = new MemoryContextBundleRepository();
  await identities.register({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    occurredAt: now,
    command: {
      identityId: 'person-1',
      kind: 'person',
      expectedVersion: 0,
      displayName: '小林老师',
      owner: '林晓',
      professionalBoundaries: ['只分享真实从业经验'],
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['brand_personal_ip'],
      expressionSamples: ['先判断发质，再讨论适合的发色。'],
      effectiveFrom: now,
      expiresAt: null,
      departureHandling: '离职或撤权后停止生成新内容。',
      sourceRef: 'person-authorization-1',
      realWorldRole: '染发师',
      portraitAuthorization: 'authorized',
      voiceAuthorization: 'not_authorized',
      historicalContentPermission: 'review_required',
    },
  });
  await sourceRevisions.advance({
    workspaceId: 'workspace-1',
    key: 'identity',
    expectedRevision: 0,
  });
  const contextPort = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    bundles,
    () => now,
    sourceRevisions,
    undefined,
    undefined,
    undefined,
    identities,
  );
  const workflow = {
    workflowId: 'task-identity-revocation',
    request: taskInput(),
    declaration: {
      normalizedIntent: '用主理人口吻介绍本店服务',
      taskType: 'brand_personal_ip' as const,
      deliveryLayer: 'copy' as const,
      relevantAssetCategories: ['personal_ip' as const],
      usedAssetCategories: ['personal_ip' as const],
      route: 'customized' as const,
      routingSource: 'model' as const,
      implicitConstraints: ['绝不冒用已撤权身份'],
    },
  };
  const frozen = await contextPort.compileAndFreeze(workflow);
  assert.deepEqual(frozen.policyReferences.identityRefs, [
    {
      id: 'marketing_identity:person-1:1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
  ]);

  const approvalRepository = new MemoryApprovalReceiptRepository();
  const approvalService = new ContentPackageApprovalService(
    approvalRepository,
    () => now,
  );
  const approvalRequest = createPendingApprovalRequest({
    actionKind: 'publish',
    contentPackageRevision: 1,
    createdAt: now,
    packageId: 'package-1',
    platform: 'xiaohongshu',
    purpose: '发布主理人栏目',
    taskId: 'task-identity-revocation',
    variantVersionId: 'xiaohongshu-v1',
    workflowId: 'task-identity-revocation',
    workflowRevision: 1,
    workspaceId: 'workspace-1',
  });
  approvalRepository.seedPendingRequest(approvalRequest);
  const approval = await approvalService.approve({
    accountId: 'xiaohongshu-account-1',
    actionKind: 'publish',
    actionScheduledAt: '2026-07-18T02:00:00.000Z',
    actorId: 'owner-1',
    contextBundle: {
      bundleId: frozen.bundle.bundleId,
      hash: frozen.bundle.hash,
      revision: frozen.bundle.revision,
    },
    cost: { amount: 0, currency: 'CNY' },
    contentRevision: 1,
    idempotencyKey: 'approve-person-1-content',
    packageId: 'package-1',
    platform: 'xiaohongshu',
    purpose: '发布主理人栏目',
    requestId: approvalRequest.id,
    variantVersionId: 'xiaohongshu-v1',
    workspaceId: 'workspace-1',
  });

  now = '2026-07-18T01:00:00.000Z';
  await identities.transition({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    occurredAt: now,
    command: {
      identityId: 'person-1',
      expectedVersion: 1,
      transition: 'revoke',
      reason: '本人撤回内容授权',
    },
  });
  await sourceRevisions.advance({
    workspaceId: 'workspace-1',
    key: 'identity',
    expectedRevision: 1,
  });
  await new ContextInvalidationService(bundles, [approvalService])
    .dispatchSourceInvalidation({
      workspaceId: 'workspace-1',
      sourceKey: 'identity',
      sourceReferenceId: 'marketing_identity:person-1:1',
      reason: 'identity_revoked',
      observedAt: now,
      affectedBundles: [frozen.bundle],
    });
  assert.equal(
    (await approvalRepository.get(approval.id))?.status,
    'invalidated',
  );

  const recompiled = await contextPort.fence({ ...workflow, context: frozen });
  assert.equal(recompiled.bundle.revision, 2);
  assert.deepEqual(recompiled.policyReferences.identityRefs, []);

  const runner = new RecordingRunner([
    candidate('品牌官方候选 A'),
    candidate('品牌官方候选 B'),
    candidate('品牌官方候选 C'),
    score(91),
    score(88),
    score(84),
  ]);
  const delivery = new RecordingDelivery();
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    contextPort,
    delivery,
    () => now,
  );
  const staleBrief = brief(['marketing_identity:person-1:1']);
  assert.throws(
    () =>
      ports.executeAndSelect({
        workflowId: workflow.workflowId,
        request: workflow.request,
        context: recompiled,
        brief: staleBrief,
      }),
    HarnessIdentityPreflightError,
  );
  assert.equal(runner.requests.length, 0);

  const fallbackBrief = brief([]);
  const selection = await ports.executeAndSelect({
    workflowId: workflow.workflowId,
    request: workflow.request,
    context: recompiled,
    brief: fallbackBrief,
  });
  await ports.assembleAndDeliver({
    workflowId: workflow.workflowId,
    request: workflow.request,
    declaration: workflow.declaration,
    context: recompiled,
    brief: fallbackBrief,
    selection,
  });

  const generationPrompt = JSON.parse(runner.requests[0]!.prompt) as {
    context: { marketing: { identityFallback: string } };
  };
  assert.equal(
    generationPrompt.context.marketing.identityFallback,
    'brand_official',
  );
  assert.equal(delivery.inputs[0]?.marketing.identityFallback, 'brand_official');
  assert.equal(selection.winner.title, '品牌官方候选 A');
});

class RecordingRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    return {
      output: request.schema.parse(this.outputs.shift()),
      attempts: 1,
      providerTaskRef: `provider-${this.requests.length}`,
      replayed: false,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

class RecordingDelivery implements HarnessCopyDeliveryPort {
  readonly inputs: Array<
    Parameters<HarnessCopyDeliveryPort['deliverCopyRevision']>[0]
  > = [];

  async deliverCopyRevision(
    input: Parameters<HarnessCopyDeliveryPort['deliverCopyRevision']>[0],
  ) {
    this.inputs.push(input);
    return { packageId: input.packageId, versionId: 'version-2', revision: 2 };
  }
}

function taskInput(): HarnessWorkflowInput {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 1,
    workflowRevision: 2,
    rawInput: '继续用小林老师的口吻写发色选择栏目',
    intent: {
      context: {
        workId: 'work-1',
        intent: '继续用小林老师的口吻写发色选择栏目',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function brief(identityRefs: string[]) {
  return {
    kind: 'copy' as const,
    instructions:
      '请基于已冻结的有效表达身份与门店事实，生成一条可直接发布的小红书文案；身份无效时必须使用品牌官方口吻，绝不代言或编造个人经历。',
    platform: 'xiaohongshu' as const,
    cta: '私信了解适合自己的发色',
    factRefs: [],
    assetRefs: [],
    identityRefs,
    constraints: ['绝不冒用已撤权身份'],
  };
}

function candidate(title: string) {
  return {
    title,
    body: `${title}：从发质和日常打理需求出发选择发色。`,
    conversionHook: '私信了解适合自己的发色',
    factClaims: [],
    assetRefs: [],
  };
}

function score(value: number) {
  return {
    score: value,
    dimensions: { grounding: 1, usefulness: 1, platformFit: 1 },
    reason: '品牌官方口吻清晰且不代言。',
  };
}
