import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  createDurableSkillRuntime,
  PostgresSkillRepository,
  SkillService,
} from './index.js';

function promptReference(prompt: {
  contentHash: string;
  name: string;
  version: string;
}) {
  return {
    contentHash: prompt.contentHash,
    name: prompt.name,
    version: prompt.version,
  };
}
import {
  nameHarnessIntent,
  type StructuredNodeRunner,
} from '../harness/structured-nodes.js';
import type {
  SkillBinding,
  SkillCatalog,
  SkillChildEffect,
  SkillDeployment,
  SkillInvocationReceipt,
  SkillRevision,
} from './types.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'all five Skill objects and child-effect settlements survive a PostgreSQL restart',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const skillId = `skill.postgres.${suffix}`;
    const skillRevisionRef = `${skillId}@1`;
    const invocationId = `invocation-postgres-${suffix}`;
    const workflowRevisionRef = `workflow.postgres.${suffix}@1`;
    const repository = new PostgresSkillRepository(pool);
    await repository.migrate();
    const catalog: SkillCatalog = {
      activeRevisionRef: skillRevisionRef,
      actorId: 'operator-postgres',
      createdAt: '2026-07-26T03:00:00.000Z',
      name: 'Postgres Skill',
      presentationPolicy: 'backend_only',
      skillId,
      updatedAt: '2026-07-26T03:01:00.000Z',
    };
    const revision: SkillRevision = {
      acceptedAt: '2026-07-26T03:01:00.000Z',
      acceptedBy: 'operator-postgres',
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-26T03:00:00.000Z',
      createdBy: 'operator-postgres',
      evalRunId: 'eval-postgres',
      instruction: 'Use the declared fact scope.',
      manifest: {
        description:
          'Uses a declared fact scope. Use in PostgreSQL persistence tests.',
        name: 'postgres-skill',
      },
      governance: {
        allowedTools: ['tool.fact.read'],
        budget: {
          maxChildEffects: 1,
          maxCostCents: 1,
          timeoutMs: 10_000,
        },
        contextScopes: ['facts'],
        executionMode: 'harness_native',
        fallback: 'fail_closed',
        inputSchemaRef: 'skill-input.daily-industry@1',
        outputSchemaRef: 'skill-output.intent-decision@1',
        requiredModelCapabilities: ['structured_output'],
        sideEffectClass: 'read',
        workflowRevisionRefs: [workflowRevisionRef],
      },
      prompt: {
        contentHash: 'b'.repeat(64),
        fallbackContent: 'Use the declared fact scope.',
        isFallback: false,
        label: 'production',
        name: 'skills/postgres',
        source: 'langfuse',
        version: '1',
      },
      revision: 1,
      skillId,
      skillRevisionRef,
      status: 'accepted_frozen',
    };
    const binding: SkillBinding = {
      bindingId: `binding-postgres-${suffix}`,
      createdAt: '2026-07-26T03:02:00.000Z',
      mode: 'required',
      skillId,
      skillRevisionRef,
      stage: 'intent_naming',
      status: 'active',
      supersededAt: null,
      supersededByBindingId: null,
      workflowRevisionRef,
    };
    const deployment: SkillDeployment = {
      artifactType: 'instruction',
      channel: 'official-direct',
      createdAt: '2026-07-26T03:03:00.000Z',
      deploymentId: `deployment-postgres-${suffix}`,
      executionMode: 'harness_native',
      nativeSkillId: 'native-postgres',
      nativeVersion: '1',
      provider: 'fixture',
      rolloutEvidenceRef: 'evidence://fixture/harness-native',
      skillRevisionRef,
    };
    const effect: SkillChildEffect = {
      acceptanceStatus: 'accepted',
      declaredBudgetCapCents: 1,
      contextRefs: ['facts:offer'],
      costCents: 1,
      createdAt: '2026-07-26T03:04:00.000Z',
      effectId: `${invocationId}:read`,
      fingerprint: 'c'.repeat(64),
      idempotencyKey: `skill:${invocationId}:read`,
      invocationId,
      providerReceipt: {
        accepted: true,
        providerTaskRef: 'provider-postgres',
      },
      retryStatus: 'first_attempt',
      settlementStatus: 'settled',
      toolId: 'tool.fact.read',
      usage: { inputTokens: 2, outputTokens: 1 },
    };
    const receipt: SkillInvocationReceipt = {
      childEffectIds: [effect.effectId],
      createdAt: '2026-07-26T03:05:00.000Z',
      inputFingerprint: 'd'.repeat(64),
      invocationId,
      productUsageTaskId: `product-usage-${suffix}`,
      skillRevisionRef,
      status: 'settled',
      taskId: `task-${suffix}`,
      totalCostCents: 1,
      totalInputTokens: 2,
      totalOutputTokens: 1,
      workspaceId: `workspace-${suffix}`,
    };

    try {
      await repository.putCatalog(catalog);
      await repository.putRevision(revision, null);
      await repository.putBinding(binding);
      await repository.putDeployment(deployment);
      await repository.putChildEffect(effect);
      await repository.putInvocationReceipt(receipt);

      const restarted = new PostgresSkillRepository(pool);
      assert.deepEqual(await restarted.getCatalog(skillId), catalog);
      assert.deepEqual(
        await restarted.getRevision(skillRevisionRef),
        revision,
      );
      assert.deepEqual(
        await restarted.listBindings(
          binding.workflowRevisionRef,
          binding.stage,
        ),
        [binding],
      );
      assert.deepEqual(
        await restarted.getDeployment(deployment.deploymentId),
        deployment,
      );
      assert.deepEqual(await restarted.getChildEffect(effect.effectId), effect);
      assert.deepEqual(
        await restarted.getInvocationReceipt(invocationId),
        receipt,
      );
      assert.deepEqual(
        (
          await new SkillService(restarted).resolveExecutedSelection(
            invocationId,
          )
        ).map((skill) => skill.skillRevisionRef),
        [skillRevisionRef],
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_skill_invocation_receipts WHERE invocation_id = $1',
        [invocationId],
      );
      await pool.query(
        'DELETE FROM p1_skill_child_effects WHERE invocation_id = $1',
        [invocationId],
      );
      await pool.query(
        'DELETE FROM p1_skill_deployments WHERE skill_revision_ref = $1',
        [skillRevisionRef],
      );
      await pool.query(
        'DELETE FROM p1_skill_bindings WHERE skill_revision_ref = $1',
        [skillRevisionRef],
      );
      await pool.query(
        'DELETE FROM p1_skill_revisions WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_revision_heads WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_catalogs WHERE skill_id = $1',
        [skillId],
      );
      await pool.end();
    }
  },
);

test(
  'migration supersedes legacy planner-selected bindings without deleting their audit facts',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const bindingId = `binding-legacy-planner-${suffix}`;
    const skillId = `skill.legacy-planner.${suffix}`;
    const skillRevisionRef = `${skillId}@1`;
    const workflowRevisionRef = `workflow.legacy-planner.${suffix}@1`;
    const repository = new PostgresSkillRepository(pool);
    const legacyBinding = {
      bindingId,
      workflowRevisionRef,
      stage: 'intent_naming',
      skillId,
      skillRevisionRef,
      mode: 'planner_selected',
      status: 'active',
      supersededAt: null,
      supersededByBindingId: null,
      createdAt: '2026-07-26T03:02:00.000Z',
    };

    try {
      await repository.migrate();
      await pool.query(
        `INSERT INTO p1_skill_bindings
           (binding_id, workflow_revision_ref, stage, skill_id,
            skill_revision_ref, status, superseded_at, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NULL, $6::jsonb, $7::timestamptz)`,
        [
          bindingId,
          workflowRevisionRef,
          legacyBinding.stage,
          skillId,
          skillRevisionRef,
          JSON.stringify(legacyBinding),
          legacyBinding.createdAt,
        ],
      );

      assert.deepEqual(
        await repository.listBindings(
          workflowRevisionRef,
          'intent_naming',
        ),
        [],
      );
      await repository.migrate();

      const audited = await repository.getBinding(bindingId);
      assert.equal(audited?.status, 'superseded');
      assert.equal((audited?.mode as string | undefined), 'planner_selected');
      assert.ok(audited?.supersededAt);
      assert.equal(audited?.supersededByBindingId, null);
      assert.deepEqual(
        await repository.listBindings(
          workflowRevisionRef,
          'intent_naming',
        ),
        [],
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_skill_bindings WHERE binding_id = $1',
        [bindingId],
      );
      await pool.end();
    }
  },
);

test(
  'invalid generated Skill output leaves PostgreSQL receipt empty while preserving provider audit',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const invocationId = `invocation-invalid-output-${suffix}`;
    const skillId = `skill.invalid-output.${suffix}`;
    const skillRevisionRef = `${skillId}@1`;
    const repository = new PostgresSkillRepository(pool);
    await repository.migrate();
    await repository.putCatalog({
      activeRevisionRef: skillRevisionRef,
      actorId: 'operator-postgres',
      createdAt: '2026-07-29T02:00:00.000Z',
      name: 'Invalid output PostgreSQL fixture',
      presentationPolicy: 'backend_only',
      skillId,
      updatedAt: '2026-07-29T02:00:00.000Z',
    });
    await repository.putRevision(
      {
        acceptedAt: '2026-07-29T02:00:00.000Z',
        acceptedBy: 'operator-postgres',
        contentHash: 'a'.repeat(64),
        createdAt: '2026-07-29T02:00:00.000Z',
        createdBy: 'operator-postgres',
        evalRunId: 'eval-invalid-output',
        instruction: 'Validate output before any side effect.',
        manifest: {
          description:
            'Validates generated output. Use in persistence boundary tests.',
          name: 'invalid-output',
        },
        governance: {
          allowedTools: ['tool.fact.read'],
          budget: {
            maxChildEffects: 1,
            maxCostCents: 1,
            timeoutMs: 10_000,
          },
          contextScopes: ['facts'],
          executionMode: 'harness_native',
          fallback: 'fail_closed',
          inputSchemaRef: 'skill-input.daily-industry@1',
          outputSchemaRef: 'skill-output.intent-decision@1',
          requiredModelCapabilities: ['structured_output'],
          sideEffectClass: 'read',
          workflowRevisionRefs: ['workflow.invalid-output@1'],
        },
        prompt: {
          contentHash: 'b'.repeat(64),
          fallbackContent: 'Validate output before any side effect.',
          isFallback: false,
          label: 'production',
          name: 'skills/invalid-output',
          source: 'langfuse',
          version: '1',
        },
        revision: 1,
        skillId,
        skillRevisionRef,
        status: 'accepted_frozen',
      },
      null,
    );
    let executions = 0;
    let generations = 0;
    let publications = 0;

    try {
      const runtime = await createDurableSkillRuntime({
        pool,
        repository,
        toolExecutionAllowlist: [
          { caller: skillRevisionRef, toolId: 'tool.fact.read' },
        ],
      });
      const tool = runtime.createInvocationTool({
        executor: {
          async execute() {
            executions += 1;
            return {
              acceptanceStatus: 'accepted',
              costCents: 1,
              providerReceipt: {
                accepted: true,
                providerTaskRef: 'provider-invalid-output-postgres',
              },
              usage: { inputTokens: 5, outputTokens: 2 },
            };
          },
          async generate() {
            generations += 1;
            return { value: { route: 'customized' } };
          },
        },
        resultPublisher: {
          async publishOnce(input) {
            publications += 1;
            return input.result;
          },
        },
      });
      const result = await tool.execute({
        calls: [
          {
            callId: 'read-facts',
            contextRefs: ['facts:current-offer'],
            declaredBudgetCapCents: 1,
            payload: {},
            toolId: 'tool.fact.read',
          },
        ],
        input: {
          context: {
            workId: 'work-invalid-output',
            intent: '写一条行业内容',
            scene: '日常项目曝光',
            sourceSummaries: ['门店价目表'],
          },
          assetReferences: [],
        },
        invocationId,
        output: {
          schemaRevision: 'skill-output.intent-decision@1',
          target: 'workflow_artifact',
        },
        productUsageTaskId: `product-usage-${suffix}`,
        skillRevisionRef,
        taskId: `task-${suffix}`,
        workspaceId: `workspace-${suffix}`,
      });
      assert.deepEqual(result, {
        ok: false,
        error: {
          code: 'SKILL_OUTPUT_INVALID',
          message: 'Skill 输出未通过 Schema 或质量门。',
          retryable: false,
        },
      });
      const receiptRows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_skill_invocation_receipts
          WHERE invocation_id = $1`,
        [invocationId],
      );
      const effectRows = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_skill_child_effects
          WHERE invocation_id = $1`,
        [invocationId],
      );
      assert.equal(executions, 1);
      assert.equal(generations, 1);
      assert.equal(publications, 0);
      assert.equal(receiptRows.rows[0]?.count, '0');
      assert.equal(effectRows.rows[0]?.count, '1');
    } finally {
      await pool.query(
        'DELETE FROM p1_skill_child_effects WHERE invocation_id = $1',
        [invocationId],
      );
      await pool.query(
        'DELETE FROM p1_skill_invocation_receipts WHERE invocation_id = $1',
        [invocationId],
      );
      await pool.query(
        'DELETE FROM p1_skill_revisions WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_revision_heads WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_catalogs WHERE skill_id = $1',
        [skillId],
      );
      await pool.end();
    }
  },
);

test(
  'define, accept CAS, inject, and same-workflow rollback execute against PostgreSQL',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const skillId = `skill.postgres-journey.${suffix}`;
    const workflowRevisionRef = `workflow.postgres-journey.${suffix}@1`;
    const repository = new PostgresSkillRepository(pool);
    await repository.migrate();
    const service = new SkillService(
      repository,
      () => '2026-07-26T04:00:00.000Z',
      {
        async capture(reference) {
          const content =
            reference.version === '1' ? instructionV1 : instructionV2;
          return prompt(content, reference.version);
        },
      },
    );
    const instructionV1 = 'Use the stable journey behavior.';
    const instructionV2 = 'Use the changed journey behavior.';
    const prompt = (content: string, version: string) => ({
      content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      isFallback: false as const,
      label: 'production' as const,
      name: `skills/postgres-journey-${suffix}`,
      source: 'langfuse' as const,
      version,
    });
    const manifest = {
      description: 'Exercises the PostgreSQL Skill revision journey.',
      name: `postgres-journey-${suffix}`,
    };
    const governance = {
      allowedTools: [],
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 10_000,
      },
      contextScopes: [],
      executionMode: 'prompt_materialized' as const,
      fallback: 'skip' as const,
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none' as const,
      workflowRevisionRefs: [workflowRevisionRef],
    };
    const accept = async (
      skillRevisionRef: string,
      promptRevision: string,
      runId: string,
    ) =>
      service.acceptAndFreezeRevision({
        actorId: 'operator-postgres',
        skillRevisionRef,
        evalRun: {
          createdAt: '2026-07-26T04:00:00.000Z',
          mode: 'recorded_fixture',
          passed: true,
          results: [
            {
              caseId: 'postgres-journey',
              gateId: 'skill_revision_acceptance',
              memoryDiff: null,
              passed: true,
              promptRevision,
              reason: 'Fixture passed.',
              scorerRevision: 'skill-routing-scorer@1',
              skillRevisionRef,
            },
          ],
          runId,
          schemaVersion: 'eval-run/v1',
          suiteId: 'skills-postgres-journey',
          suiteRevision: 'skills-postgres-journey@1',
        },
      });

    try {
      await service.defineCatalogEntry({
        actorId: 'operator-postgres',
        name: 'Postgres journey',
        presentationPolicy: 'explainable',
        skillId,
      });
      const draftV1 = await service.draftRevision({
        actorId: 'operator-postgres',
        expectedRevision: null,
        governance,
        instruction: instructionV1,
        manifest,
        promptReference: promptReference(prompt(instructionV1, '1')),
        skillId,
      });
      await accept(
        draftV1.skillRevisionRef,
        `${prompt(instructionV1, '1').name}@1`,
        `eval-${suffix}-1`,
      );
      const draftV2 = await service.draftRevision({
        actorId: 'operator-postgres',
        expectedRevision: 1,
        governance,
        instruction: instructionV2,
        manifest,
        promptReference: promptReference(prompt(instructionV2, '2')),
        skillId,
      });
      await accept(
        draftV2.skillRevisionRef,
        `${prompt(instructionV2, '2').name}@2`,
        `eval-${suffix}-2`,
      );
      assert.equal(
        (await repository.getRevisionHead(skillId))?.skillRevisionRef,
        draftV2.skillRevisionRef,
      );
      await service.bindRevision({
        bindingId: `binding-${suffix}-v2`,
        mode: 'required',
        skillRevisionRef: draftV2.skillRevisionRef,
        stage: 'intent_naming',
        workflowRevisionRef,
      });
      const current = await service.resolveStage({
        stage: 'intent_naming',
        userSelectedSkillRefs: [],
        workflowRevisionRef,
      });
      assert.deepEqual(
        current.allowlist.map((skill) => skill.skillRevisionRef),
        [draftV2.skillRevisionRef],
      );
      await service.rollbackBinding({
        bindingId: `binding-${suffix}-v1`,
        sourceBindingId: `binding-${suffix}-v2`,
        targetSkillRevisionRef: draftV1.skillRevisionRef,
        workflowRevisionRef,
      });
      const restored = await service.resolveStage({
        stage: 'intent_naming',
        userSelectedSkillRefs: [],
        workflowRevisionRef,
      });
      assert.deepEqual(
        restored.allowlist.map((skill) => skill.skillRevisionRef),
        [draftV1.skillRevisionRef],
      );
      const runner: StructuredNodeRunner = {
        async run(request) {
          const changed = request.instructions.includes(instructionV2);
          return {
            attempts: 1,
            output: request.schema.parse({
              blockingGap: changed
                ? null
                : {
                    allowFreeText: true,
                    field: 'industry',
                    options: [],
                    question: '你主要做哪个美业项目？',
                    scope: 'current_task',
                  },
              deliveryLayer: 'copy',
              implicitConstraints: [],
              normalizedIntent: '写一条护理日常',
              relevantAssetCategories: ['industry_category'],
              route: changed ? 'customized' : 'guidance',
              taskType: 'daily_service_exposure',
              usedAssetCategories: changed
                ? ['industry_category']
                : [],
            }),
            providerTaskRef: 'fixture-postgres-journey',
            replayed: false,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
      };
      const intentInput = {
        intent: {
          assetReferences: [],
          context: {
            intent: '写一条护理日常',
            sourceSummaries: [],
            workId: 'work-postgres-journey',
          },
        },
        workflowId: `task-${suffix}`,
        workflowRevision: 1,
      };
      assert.equal(
        (
          await nameHarnessIntent(
            { ...intentInput, skillInstructions: current.allowlist },
            runner,
          )
        ).declaration.route,
        'customized',
      );
      assert.equal(
        (
          await nameHarnessIntent(
            { ...intentInput, skillInstructions: restored.allowlist },
            runner,
          )
        ).declaration.route,
        'guidance',
      );
      const active = await pool.query<{ skill_revision_ref: string }>(
        `SELECT skill_revision_ref
           FROM p1_skill_bindings
          WHERE workflow_revision_ref = $1
            AND stage = 'intent_naming'
            AND skill_id = $2
            AND status = 'active'`,
        [workflowRevisionRef, skillId],
      );
      assert.deepEqual(active.rows, [
        { skill_revision_ref: draftV1.skillRevisionRef },
      ]);
      const uniqueIndex = await pool.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'p1_skill_bindings_active_slot_uq'`,
      );
      assert.match(
        uniqueIndex.rows[0]?.indexdef ?? '',
        /UNIQUE INDEX .*workflow_revision_ref, stage, skill_id/u,
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_skill_bindings WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_revisions WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_revision_heads WHERE skill_id = $1',
        [skillId],
      );
      await pool.query(
        'DELETE FROM p1_skill_catalogs WHERE skill_id = $1',
        [skillId],
      );
      await pool.end();
    }
  },
);
