import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { QuestionCard } from '@meiye/contracts';

import { HarnessWorkflowEventSource } from '../workflow-events.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { SkillFoundationModule } from '../skills/foundation-module.js';
import { MemorySkillRepository } from '../skills/repository.js';
import { SkillService } from '../skills/service.js';
import type { SkillRevision } from '../skills/types.js';
import { HarnessDbosWorkflowEventReader } from './dbos-workflow-events.js';
import {
  normalizeHarnessDbosWorkflowInput,
  registerHarnessDbosWorkflow,
  resumeHarnessDbosWorkflow,
} from './dbos-workflow.js';
import { harnessRuntimeId } from './workspace-scope.js';
import type { HarnessStagePorts } from './workflow-core.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;

test('registered workflow accepts both legacy and scoped invocation payloads', () => {
  const request = {
    actorId: 'owner-smoke',
    workspaceId: 'workspace-smoke',
    packageId: 'package-smoke',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: 'work-smoke',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
  assert.deepEqual(
    normalizeHarnessDbosWorkflowInput(request, 'legacy-task'),
    { workflowId: 'legacy-task', request },
  );
  assert.deepEqual(
    normalizeHarnessDbosWorkflowInput(
      { workflowId: 'task-logical', request },
      harnessRuntimeId('workspace-smoke', 'task-logical'),
    ),
    { workflowId: 'task-logical', request },
  );
});

test(
  'production DBOS registration launches and delivers one five-stage workflow',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-smoke-${randomUUID()}`;
    const executionSnapshot = createCreationExecutionSnapshot(
      {
        actorId: 'owner-smoke',
        workspaceId: 'workspace-smoke',
        idempotencyKey: `submission-${workflowId}`,
        taskId: workflowId,
        workId: 'work-smoke',
        contentPackageId: 'package-smoke',
        expectedContentPackageRevision: 0,
        creationMode: 'customized',
        intent: '把新团购做一套能发的',
        surface: { id: 'surface-smoke', revision: 'surface-r1' },
        recipe: { id: 'recipe-smoke', revision: 'recipe-r1' },
        lens: 'copy',
        platform: { id: 'xiaohongshu' },
        deliverables: [
          { id: 'copy-main', kind: 'copy', order: 0, quantity: 1 },
        ],
        sources: { assets: [] },
        rights: { revision: 'rights-r1', summary: 'authorized' },
        identity: { id: 'identity-smoke', revision: 'identity-r1' },
        modelPolicy: { id: 'policy-smoke', revision: 'policy-r1', mode: 'auto' },
        catalogModel: { id: 'model-smoke', revision: 'model-r1' },
        quote: { id: `quote-${workflowId}`, revision: 'quote-r1' },
        route: { id: 'route-smoke', revision: 'route-r1' },
        briefContext: { id: 'brief-smoke', revision: 1 },
        contentModules: ['social_cover'],
      },
      '2026-07-26T09:00:00.000Z',
    );
    const traces: string[] = [];
    const billingReceipts: string[] = [];
    const providerSkillRefs: string[][] = [];
    const skills = await createSmokeSkills(workflowId);
    let pendingQuestion: QuestionCard | null = null;
    let signalPendingRegistered = () => {};
    const pendingRegistered = new Promise<void>((resolve) => {
      signalPendingRegistered = resolve;
    });
    DBOS.setConfig({
      name: 'beauty-marketing-harness-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      smokePorts(workflowId, skills.service, providerSkillRefs),
      {
        async registerPending(_workspaceId, question) {
          pendingQuestion = question;
          signalPendingRegistered();
        },
        async readPending() {
          return pendingQuestion;
        },
        async recordStageTrace(input) {
          traces.push(input.stage);
        },
        async recordTerminalFailure() {},
      },
      undefined,
      {
        async commit({ taskId }) {
          billingReceipts.push(`committed:${taskId}`);
        },
        async refund({ taskId }) {
          billingReceipts.push(`refunded:${taskId}`);
        },
        async scheduleCompensation({ action, taskId }) {
          billingReceipts.push(`scheduled:${action}:${taskId}`);
        },
      },
    );

    try {
      await DBOS.launch();
      const runtimeWorkflowId = harnessRuntimeId(
        'workspace-smoke',
        workflowId,
      );
      const workflowInput = {
        workflowId,
        request: {
          actorId: 'owner-smoke',
          workspaceId: 'workspace-smoke',
          packageId: 'package-smoke',
          expectedRevision: 0,
          workflowRevision: 1,
          creationMode: 'customized' as const,
          rawInput: '把新团购做一套能发的',
          intent: {
            context: {
              workId: 'work-smoke',
              intent: '把新团购做一套能发的',
              sourceSummaries: [],
            },
            assetReferences: [],
          },
          executionSnapshot,
        },
      };
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })(workflowInput);

      let pendingTimeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          pendingRegistered,
          new Promise<never>((_resolve, reject) => {
            pendingTimeout = setTimeout(
              () => reject(new Error('DBOS smoke workflow did not suspend.')),
              15_000,
            );
          }),
        ]);
      } finally {
        if (pendingTimeout) clearTimeout(pendingTimeout);
      }
      const beforeSteps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.ok(beforeSteps);
      const beforeResolutionNames = beforeSteps
        .filter(({ name }) => name.startsWith('skill-resolve-intent'))
        .map(({ name }) => name);
      assert.deepEqual(beforeResolutionNames, ['skill-resolve-intent']);
      assert.equal(
        JSON.stringify(beforeSteps).includes(SMOKE_PRIVATE_INSTRUCTION),
        false,
      );

      await skills.foundation.execute({
        context: {
          actor: 'admin',
          correlationId: `rollback-${workflowId}`,
          userId: 'operator-smoke',
          workspaceId: 'workspace-smoke',
        },
        idempotencyKey: `rollback-${workflowId}`,
        input: {
          action: 'skill_rollback',
          payload: {
            bindingId: `binding.smoke-v1-${workflowId}`,
            sourceBindingId: `binding.smoke-v2-${workflowId}`,
            targetSkillRevisionRef: 'skill.intent-one@1',
            workflowRevisionRef: 'workflow.copy@1',
          },
        },
      });
      await DBOS.cancelWorkflow(runtimeWorkflowId);
      const recoveredHandle =
        await DBOS.resumeWorkflow<
          Awaited<ReturnType<typeof handle.getResult>>
        >(runtimeWorkflowId);
      await resumeHarnessDbosWorkflow('workspace-smoke', workflowId, {
        idempotencyKey: `ignore-${workflowId}`,
        questionId: `${workflowId}:s1:offer_price`,
        workflowRevision: 1,
        patch: {
          field: 'offer_price',
          value: '本次跳过',
          reason: 'DBOS 恢复测试',
        },
        decision: { state: 'ignored', value: '本次跳过' },
      });
      const result = await recoveredHandle.getResult();
      assert.equal(result.delivery.revision, 1);
      assert.equal(result.trace.winnerCandidateId, 'c01');
      assert.deepEqual(traces, [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ]);
      assert.deepEqual(billingReceipts, [`committed:${workflowId}`]);
      assert.deepEqual(providerSkillRefs, [['skill.intent-one@2']]);

      const afterSteps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.ok(afterSteps);
      const afterResolutionSteps = afterSteps.filter(({ name }) =>
        name.startsWith('skill-resolve-intent'),
      );
      assert.deepEqual(
        afterResolutionSteps.map(({ name }) => name),
        beforeResolutionNames,
      );
      assert.equal(afterResolutionSteps.length, 1);
      assert.deepEqual(afterResolutionSteps[0]?.output, {
        skillRevisionRefs: ['skill.intent-one@2'],
        skillContentHashes: ['hash-skill-2'],
        skillReceiptIds: [
          `skill-materialized:${workflowId}:intent_naming:skill.intent-one%402`,
        ],
      });
      assert.equal(
        JSON.stringify(afterSteps).includes(SMOKE_PRIVATE_INSTRUCTION),
        false,
      );
      assert.equal(
        afterSteps.filter(({ name }) =>
          name.includes('s1-intent-skills=skill.intent-one%402-0'),
        ).length,
        1,
      );
      assert.equal(
        afterSteps.some(({ name }) =>
          name.includes('s1-intent-skills=skill.intent-one%401-0'),
        ),
        false,
      );
      const events = [];
      const source = new HarnessWorkflowEventSource(
        new HarnessDbosWorkflowEventReader({
          async taskBelongsToWorkspace(taskId, workspaceId) {
            return taskId === workflowId && workspaceId === 'workspace-smoke';
          },
          async workflowRuntimeId(workspaceId, logicalWorkflowId) {
            return harnessRuntimeId(workspaceId, logicalWorkflowId);
          },
          async readTerminalFailure() {
            return null;
          },
        }),
      );
      for await (const frame of source.stream({
        signal: new AbortController().signal,
        workflowId,
        workspaceId: 'workspace-smoke',
      })) {
        events.push(frame);
      }
      assert.deepEqual(
        events.map((frame) => frame.event),
        [
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.state',
        ],
      );
      assert.equal(events.at(-1)?.data.sourceRevision, 1);
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'confirmation timeout exits DBOS pending state and delivers the generic route',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-timeout-${randomUUID()}`;
    const runtimeWorkflowId = harnessRuntimeId(
      'workspace-timeout',
      workflowId,
    );
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId: `${workflowId}:offer-price`,
        workflowId,
        workflowRevision: 1,
        question: 'What is the current offer price?',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: 'Ground the promotion in the current merchant offer',
        },
        scope: 'current_task',
      },
    });
    let pendingQuestionId: string | null = null;
    let configReads = 0;
    DBOS.setConfig({
      name: 'beauty-marketing-harness-timeout-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-timeout-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending(_workspaceId, question) {
          pendingQuestionId = question.questionId;
        },
        async readPending() {
          return null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      undefined,
      undefined,
      {
        async get() {
          configReads += 1;
          return {
            actorId: 'platform-admin',
            correlationId: 'timeout-smoke-config',
            createdAt: '2026-07-26T09:00:00.000Z',
            key: 'harness.confirmation_card.timeout_seconds',
            reason: 'Exercise durable timeout',
            revision: 1,
            rolledBackToRevision: null,
            scope: 'global',
            status: 'applied',
            value: 2,
            workspaceId: '__global__',
          };
        },
      },
    );

    try {
      await DBOS.launch();
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({
        workflowId,
        request: {
          actorId: 'owner-timeout',
          workspaceId: 'workspace-timeout',
          packageId: 'package-timeout',
          expectedRevision: 0,
          workflowRevision: 1,
          creationMode: 'customized',
          rawInput: '把新团购做一套能发的',
          intent: {
            context: {
              workId: 'work-timeout',
              intent: '把新团购做一套能发的',
              sourceSummaries: [],
            },
            assetReferences: [],
          },
        },
      });

      const pending = await DBOS.getEvent(
        runtimeWorkflowId,
        'pending-structured-decision',
        { timeoutSeconds: 5 },
      );
      assert.equal(
        (pending as { questionId?: string } | null)?.questionId,
        `${workflowId}:offer-price`,
      );
      assert.equal((await handle.getStatus())?.status, 'PENDING');

      const result = await handle.getResult();
      assert.equal(result.delivery.revision, 1);
      assert.equal(result.trace.winnerCandidateId, 'c01');
      assert.equal((await handle.getStatus())?.status, 'SUCCESS');
      assert.equal(
        (
          await DBOS.listWorkflows({
            workflowIDs: [runtimeWorkflowId],
            status: 'PENDING',
          })
        ).length,
        0,
      );
      assert.equal(pendingQuestionId, `${workflowId}:offer-price`);
      assert.equal(configReads, 1);
      assert.ok(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))?.some(
          (step) =>
            step.name ===
            `snapshot-confirmation-timeout-${workflowId}:offer-price`,
        ),
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

const SMOKE_PRIVATE_INSTRUCTION =
  'F21 private Skill instruction must never enter DBOS step output.';

function smokePorts(
  workflowId: string,
  skills: SkillService,
  providerSkillRefs: string[][],
): HarnessStagePorts {
  const context = {
    bundle: {
      bundleId: 'bundle-smoke',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: 'workspace-smoke',
      taskId: 'task-smoke',
      frozenAt: '2026-07-18T00:00:00.000Z',
      frozenBy: 'owner-smoke',
      previousRevision: null,
      referencedFactRevisions: [],
      sourceRevisions: {
        facts: 0,
        assets: 0,
        identity: 0,
        rights: 0,
        preferences: 0,
        recipe: 0,
        platformRules: 0,
        currentSignal: 1,
      },
      dimensions: {
        promotion_task: {},
        traffic_opportunity: {},
        expression_identity: {},
        platform_mechanism: {},
        store_facts_assets: {},
        conversion_action: {},
      },
    },
    policyReferences: { sourceRefs: [], rightsRefs: [], identityRefs: [] },
  };
  return {
    async resolveStageSkills(input) {
      const instructions = input.skillRevisionRefs
        ? await skills.resolveFrozenRevisions(input.skillRevisionRefs)
        : (
            await skills.resolveStage({
              plannerSelectedSkillRefs: [],
              stage: input.stage,
              userSelectedSkillRefs: [],
              workflowRevisionRef: 'workflow.copy@1',
            })
          ).selected;
      const receipts = await skills.recordPromptMaterializationReceipts({
        instructions,
        stage: input.stage,
        taskId: workflowId,
        workflowRevisionRef: 'workflow.copy@1',
        workspaceId: 'workspace-smoke',
      });
      return {
        instructions,
        receipts,
      };
    },
    async nameIntent(input) {
      providerSkillRefs.push(
        input.skillInstructions?.map(
          ({ skillRevisionRef }) => skillRevisionRef,
        ) ?? [],
      );
      return {
        declaration: {
          normalizedIntent: '推广本店团购',
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: ['promotion_activity'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: [],
        },
        blockingQuestion: {
          questionId: `${workflowId}:s1:offer_price`,
          workflowId,
          workflowRevision: 1,
          question: '本次团购的当前价格是多少？',
          options: [],
          freeText: { enabled: true },
          response: {
            field: 'offer_price',
            reason: '补充当前任务所需的权威事实',
          },
          scope: 'current_task',
        },
      };
    },
    async injectContext() {
      return context;
    },
    async fenceContext() {
      return context;
    },
    async compileBrief() {
      return {
        kind: 'copy',
        instructions:
          '基于当前有效的门店事实生成可直接发布的团购文案，明确服务价值、适用人群、预约动作与事实边界，不编造价格、效果或顾客案例，并保留必要的审核信息。',
        platform: 'xiaohongshu',
        cta: '私信预约',
        factRefs: [],
        assetRefs: [],
        identityRefs: [],
        constraints: [],
      };
    },
    async executeAndSelect() {
      return {
        candidates: [
          {
            candidateId: 'c01',
            title: '新团购体验',
            body: '到店了解当前团购服务，按你的需求确认适合项目。',
            conversionHook: '私信预约',
            score: 90,
          },
        ],
        winner: {
          candidateId: 'c01',
          title: '新团购体验',
          body: '到店了解当前团购服务，按你的需求确认适合项目。',
          conversionHook: '私信预约',
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: 'c01',
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'copy-quality-v1',
          rubricHash: 'smoke-rubric',
        },
      };
    },
    async assembleAndDeliver() {
      return {
        packageId: 'package-smoke',
        versionId: 'version-smoke',
        revision: 1,
      };
    },
  };
}

async function createSmokeSkills(workflowId: string) {
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => '2026-07-26T09:00:00.000Z',
  );
  await repository.putCatalog({
    activeRevisionRef: 'skill.intent-one@2',
    actorId: 'operator-smoke',
    createdAt: '2026-07-26T09:00:00.000Z',
    name: 'F21 smoke Skill',
    presentationPolicy: 'backend_only',
    skillId: 'skill.intent-one',
    updatedAt: '2026-07-26T09:00:00.000Z',
  });
  await repository.putRevision(
    smokeSkillRevision(1, 'Earlier private instruction.'),
    null,
  );
  await repository.putRevision(
    smokeSkillRevision(2, SMOKE_PRIVATE_INSTRUCTION),
    1,
  );
  await service.bindRevision({
    bindingId: `binding.smoke-v2-${workflowId}`,
    mode: 'required',
    skillRevisionRef: 'skill.intent-one@2',
    stage: 'intent_naming',
    workflowRevisionRef: 'workflow.copy@1',
  });
  return {
    foundation: new SkillFoundationModule(service),
    service,
  };
}

function smokeSkillRevision(
  revision: number,
  instruction: string,
): SkillRevision {
  return {
    acceptedAt: '2026-07-26T09:00:00.000Z',
    acceptedBy: 'operator-smoke',
    contentHash: `hash-skill-${revision}`,
    createdAt: '2026-07-26T09:00:00.000Z',
    createdBy: 'operator-smoke',
    evalRunId: `eval-smoke-${revision}`,
    instruction,
    manifest: {
      allowedTools: [],
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 10_000,
      },
      compatibility: {
        workflowRevisionRefs: ['workflow.copy@1'],
      },
      contextScopes: [],
      evalSuiteRef: 'skills-f21-smoke@1',
      executionMode: 'prompt_materialized',
      fallback: 'fail_closed',
      inputSchemaRef: 'skill-input.intent@1',
      outputSchemaRef: 'skill-output.intent@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none',
    },
    prompt: {
      content: instruction,
      contentHash: `prompt-hash-${revision}`,
      isFallback: false,
      label: 'production',
      name: 'skills/f21-smoke',
      source: 'langfuse',
      version: String(revision),
    },
    revision,
    skillId: 'skill.intent-one',
    skillRevisionRef: `skill.intent-one@${revision}`,
    status: 'accepted_frozen',
  };
}
