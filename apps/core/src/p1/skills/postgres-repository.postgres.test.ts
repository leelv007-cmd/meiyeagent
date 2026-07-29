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
      formatVersion: 2,
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
      packagePaths: ['SKILL.md'],
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
        contentHash: createHash('sha256')
          .update('Use the declared fact scope.')
          .digest('hex'),
        content: 'Use the declared fact scope.',
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
      triggerCondition: {
        harnessStage: 'intent_naming',
        industryCategory: null,
        tenantId: null,
      },
      status: 'active',
      supersededAt: null,
      supersededByBindingId: null,
      workflowRevisionRef,
    };
    const deployment: SkillDeployment = {
      channel: 'official-direct',
      createdAt: '2026-07-26T03:03:00.000Z',
      deploymentId: `deployment-postgres-${suffix}`,
      executionMode: 'harness_native',
      nativeSkillId: 'native-postgres',
      nativeVersion: '1',
      packagePaths: ['SKILL.md', 'assets/preview.png'],
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
      await pool.query(
        `INSERT INTO p1_skill_bindings
           (binding_id, workflow_revision_ref, stage, trigger_condition, skill_id,
            skill_revision_ref, status, superseded_at, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NULL, $8::jsonb, $9::timestamptz)`,
        [
          binding.bindingId,
          binding.workflowRevisionRef,
          binding.triggerCondition.harnessStage,
          JSON.stringify({
            harnessStage: binding.triggerCondition.harnessStage,
          }),
          binding.skillId,
          binding.skillRevisionRef,
          binding.status,
          JSON.stringify({
            bindingId: binding.bindingId,
            createdAt: binding.createdAt,
            mode: binding.mode,
            skillId: binding.skillId,
            skillRevisionRef: binding.skillRevisionRef,
            stage: binding.triggerCondition.harnessStage,
            status: binding.status,
            supersededAt: binding.supersededAt,
            supersededByBindingId: binding.supersededByBindingId,
            workflowRevisionRef: binding.workflowRevisionRef,
          }),
          binding.createdAt,
        ],
      );
      assert.deepEqual(await repository.putBinding(binding), binding);
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
          binding.triggerCondition,
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
  'migration reads legacy revision payloads and writes v2 physical sidecars',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const legacySkillId = `skill.legacy-revision.${suffix}`;
    const legacyRevisionRef = `${legacySkillId}@1`;
    const transitionalSkillId = `skill.transitional-revision.${suffix}`;
    const transitionalRevisionRef = `${transitionalSkillId}@1`;
    const v2SkillId = `skill.v2-revision.${suffix}`;
    const v2RevisionRef = `${v2SkillId}@1`;
    const legacyDeploymentId = `deployment.legacy.${suffix}`;
    const repository = new PostgresSkillRepository(pool);
    const legacyContent = 'Legacy prompt content.';
    const legacyPayload = {
      acceptedAt: '2026-07-25T00:00:00.000Z',
      acceptedBy: 'operator-legacy',
      contentHash: '1'.repeat(64),
      createdAt: '2026-07-25T00:00:00.000Z',
      createdBy: 'operator-legacy',
      evalRunId: 'eval-legacy',
      instruction: legacyContent,
      manifest: {
        allowedTools: [],
        budget: {
          maxChildEffects: 0,
          maxCostCents: 0,
          timeoutMs: 10_000,
        },
        compatibility: {
          workflowRevisionRefs: ['workflow.legacy@1'],
        },
        contextScopes: [],
        evalSuiteRef: 'legacy@1',
        executionMode: 'prompt_materialized',
        fallback: 'skip',
        inputSchemaRef: 'skill-input.daily-industry@1',
        outputSchemaRef: 'skill-output.intent-decision@1',
        requiredModelCapabilities: ['structured_output'],
        sideEffectClass: 'none',
      },
      prompt: {
        content: legacyContent,
        contentHash: createHash('sha256')
          .update(legacyContent)
          .digest('hex'),
        isFallback: false,
        label: 'production',
        name: 'skills/legacy',
        source: 'langfuse',
        version: '1',
      },
      revision: 1,
      skillId: legacySkillId,
      skillRevisionRef: legacyRevisionRef,
      status: 'accepted_frozen',
    };
    const v2Fallback = 'V2 trusted prompt fallback.';
    const transitionalPayload = {
      ...legacyPayload,
      acceptedAt: null,
      acceptedBy: null,
      evalRunId: null,
      governance: {
        allowedTools: [],
        budget: {
          maxChildEffects: 0,
          maxCostCents: 0,
          timeoutMs: 10_000,
        },
        contextScopes: [],
        executionMode: 'prompt_materialized',
        fallback: 'skip',
        inputSchemaRef: 'skill-input.daily-industry@1',
        outputSchemaRef: 'skill-output.intent-decision@1',
        requiredModelCapabilities: ['structured_output'],
        sideEffectClass: 'none',
        workflowRevisionRefs: ['workflow.transitional@1'],
      },
      manifest: {
        description: 'Transitional standard Skill frontmatter.',
        name: 'transitional-revision',
      },
      prompt: {
        ...legacyPayload.prompt,
        content: undefined,
        fallbackContent: legacyContent,
      },
      skillId: transitionalSkillId,
      skillRevisionRef: transitionalRevisionRef,
      status: 'draft',
    };
    const v2Revision: SkillRevision = {
      acceptedAt: null,
      acceptedBy: null,
      contentHash: '2'.repeat(64),
      createdAt: '2026-07-29T00:00:00.000Z',
      createdBy: 'operator-v2',
      evalRunId: null,
      formatVersion: 2,
      governance: {
        allowedTools: [],
        budget: {
          maxChildEffects: 0,
          maxCostCents: 0,
          timeoutMs: 10_000,
        },
        contextScopes: [],
        executionMode: 'prompt_materialized',
        fallback: 'skip',
        inputSchemaRef: 'skill-input.daily-industry@1',
        outputSchemaRef: 'skill-output.intent-decision@1',
        requiredModelCapabilities: ['structured_output'],
        sideEffectClass: 'none',
        workflowRevisionRefs: ['workflow.v2@1'],
      },
      instruction: v2Fallback,
      manifest: {
        description: 'Exercises the v2 physical Skill sidecars.',
        name: 'v2-revision',
      },
      packagePaths: ['SKILL.md'],
      prompt: {
        contentHash: createHash('sha256')
          .update(v2Fallback)
          .digest('hex'),
        content: v2Fallback,
        isFallback: false,
        label: 'production',
        name: 'skills/v2',
        source: 'langfuse',
        version: '1',
      },
      revision: 1,
      skillId: v2SkillId,
      skillRevisionRef: v2RevisionRef,
      status: 'draft',
    };

    try {
      await repository.migrate();
      await pool.query(
        `INSERT INTO p1_skill_revisions
           (skill_id, revision, skill_revision_ref, status, content_hash,
            payload, created_at)
         VALUES
           ($1, 1, $2, 'accepted_frozen', $3, $4::jsonb, $5::timestamptz),
           ($6, 1, $7, 'draft', $8, $9::jsonb, $10::timestamptz)`,
        [
          legacySkillId,
          legacyRevisionRef,
          legacyPayload.contentHash,
          JSON.stringify(legacyPayload),
          legacyPayload.createdAt,
          transitionalSkillId,
          transitionalRevisionRef,
          transitionalPayload.contentHash,
          JSON.stringify(transitionalPayload),
          transitionalPayload.createdAt,
        ],
      );

      const legacy = await repository.getRevision(legacyRevisionRef);
      assert.equal(legacy?.formatVersion, 1);
      assert.deepEqual(legacy?.governance.workflowRevisionRefs, [
        'workflow.legacy@1',
      ]);
      assert.equal(legacy?.prompt.content, legacyContent);
      assert.equal(Object.hasOwn(legacy?.prompt ?? {}, 'fallbackContent'), false);
      const transitional = await repository.getRevision(
        transitionalRevisionRef,
      );
      assert.equal(transitional?.formatVersion, 1);
      assert.deepEqual(
        transitional?.governance.workflowRevisionRefs,
        ['workflow.transitional@1'],
      );
      assert.deepEqual(transitional?.manifest, transitionalPayload.manifest);
      assert.equal(
        transitional?.prompt.content,
        legacyContent,
      );
      assert.ok(transitional);
      const acceptedTransitional: SkillRevision = {
        ...transitional,
        acceptedAt: '2026-07-29T00:01:00.000Z',
        acceptedBy: 'operator-transitional-accept',
        evalRunId: 'eval-transitional-accept',
        status: 'accepted_frozen',
      };
      await repository.acceptRevision(acceptedTransitional);
      assert.deepEqual(
        await repository.getRevision(transitionalRevisionRef),
        acceptedTransitional,
      );
      await pool.query(
        `INSERT INTO p1_skill_deployments
           (deployment_id, skill_revision_ref, payload, created_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
        [
          legacyDeploymentId,
          legacyRevisionRef,
          JSON.stringify({
            artifactType: 'reference',
            channel: 'legacy',
            createdAt: legacyPayload.createdAt,
            deploymentId: legacyDeploymentId,
            executionMode: 'harness_native',
            nativeSkillId: 'legacy-native',
            nativeVersion: '1',
            provider: 'fixture',
            rolloutEvidenceRef: null,
            skillRevisionRef: legacyRevisionRef,
          }),
          legacyPayload.createdAt,
        ],
      );
      const normalizedLegacyDeployment: SkillDeployment = {
        channel: 'legacy',
        createdAt: legacyPayload.createdAt,
        deploymentId: legacyDeploymentId,
        executionMode: 'harness_native',
        nativeSkillId: 'legacy-native',
        nativeVersion: '1',
        packagePaths: ['SKILL.md', 'references/'],
        provider: 'fixture',
        rolloutEvidenceRef: null,
        skillRevisionRef: legacyRevisionRef,
      };
      assert.deepEqual(
        await repository.getDeployment(legacyDeploymentId),
        normalizedLegacyDeployment,
      );
      assert.deepEqual(
        await repository.putDeployment(normalizedLegacyDeployment),
        normalizedLegacyDeployment,
      );

      await repository.putRevision(v2Revision, null);
      const stored = await pool.query<{
        format_version: number;
        frontmatter: unknown;
        governance_sidecar: unknown;
        payload_has_governance: boolean;
        payload_has_prompt: boolean;
        prompt_fallback_content: string;
      }>(
        `SELECT format_version,
                frontmatter,
                governance_sidecar,
                payload ? 'governance' AS payload_has_governance,
                payload ? 'prompt' AS payload_has_prompt,
                prompt_fallback_content
           FROM p1_skill_revisions
          WHERE skill_revision_ref = $1`,
        [v2RevisionRef],
      );
      assert.deepEqual(stored.rows, [
        {
          format_version: 2,
          frontmatter: v2Revision.manifest,
          governance_sidecar: v2Revision.governance,
          payload_has_governance: false,
          payload_has_prompt: false,
          prompt_fallback_content: v2Fallback,
        },
      ]);
      assert.deepEqual(
        await repository.getRevision(v2RevisionRef),
        v2Revision,
      );
      await pool.query(
        `UPDATE p1_skill_revisions
            SET governance_sidecar = '{}'::jsonb
          WHERE skill_revision_ref = $1`,
        [v2RevisionRef],
      );
      await assert.rejects(
        repository.getRevision(v2RevisionRef),
        /Persisted Skill revision payload is invalid/u,
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_skill_deployments WHERE deployment_id = $1',
        [legacyDeploymentId],
      );
      await pool.query(
        'DELETE FROM p1_skill_revisions WHERE skill_id = ANY($1::text[])',
        [[legacySkillId, transitionalSkillId, v2SkillId]],
      );
      await pool.query(
        'DELETE FROM p1_skill_revision_heads WHERE skill_id = $1',
        [v2SkillId],
      );
      await pool.end();
    }
  },
);

test(
  'migration upgrades authentic v1 revision and stage-only binding rows',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const adminPool = new Pool({ connectionString });
    const schema = `skill_migration_${randomUUID().replaceAll('-', '_')}`;
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
    });
    const skillId = `skill.authentic-v1.${randomUUID()}`;
    const skillRevisionRef = `${skillId}@1`;
    const bindingId = `binding.authentic-v1.${randomUUID()}`;
    const workflowRevisionRef = `workflow.authentic-v1.${randomUUID()}@1`;
    const promptContent = 'Authentic v1 prompt content.';
    const legacyPayload = {
      acceptedAt: null,
      acceptedBy: null,
      contentHash: '1'.repeat(64),
      createdAt: '2026-07-25T00:00:00.000Z',
      createdBy: 'operator-authentic-v1',
      evalRunId: null,
      instruction: promptContent,
      manifest: {
        allowedTools: [],
        budget: {
          maxChildEffects: 0,
          maxCostCents: 0,
          timeoutMs: 10_000,
        },
        compatibility: {
          workflowRevisionRefs: ['workflow.authentic-v1@1'],
        },
        contextScopes: [],
        evalSuiteRef: 'authentic-v1@1',
        executionMode: 'prompt_materialized',
        fallback: 'skip',
        inputSchemaRef: 'skill-input.daily-industry@1',
        outputSchemaRef: 'skill-output.intent-decision@1',
        requiredModelCapabilities: ['structured_output'],
        sideEffectClass: 'none',
      },
      prompt: {
        content: promptContent,
        contentHash: createHash('sha256')
          .update(promptContent)
          .digest('hex'),
        isFallback: false,
        label: 'production',
        name: 'skills/authentic-v1',
        source: 'langfuse',
        version: '1',
      },
      revision: 1,
      skillId,
      skillRevisionRef,
      status: 'draft',
    };
    const legacyBinding = {
      bindingId,
      workflowRevisionRef,
      stage: 'intent_naming',
      skillId,
      skillRevisionRef,
      mode: 'required',
      status: 'active',
      supersededAt: null,
      supersededByBindingId: null,
      createdAt: '2026-07-25T00:01:00.000Z',
    };

    try {
      await pool.query(`
        CREATE TABLE p1_skill_revisions (
          skill_id text NOT NULL,
          revision bigint NOT NULL CHECK (revision > 0),
          skill_revision_ref text NOT NULL UNIQUE,
          status text NOT NULL CHECK (status IN ('draft', 'accepted_frozen')),
          content_hash text NOT NULL,
          payload jsonb NOT NULL,
          created_at timestamptz NOT NULL,
          PRIMARY KEY (skill_id, revision)
        );
        CREATE TABLE p1_skill_bindings (
          binding_id text PRIMARY KEY,
          workflow_revision_ref text NOT NULL,
          stage text NOT NULL,
          skill_id text NOT NULL,
          skill_revision_ref text NOT NULL,
          status text NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'superseded')),
          superseded_at timestamptz,
          payload jsonb NOT NULL,
          created_at timestamptz NOT NULL
        )
      `);
      await pool.query(
        `INSERT INTO p1_skill_revisions
           (skill_id, revision, skill_revision_ref, status, content_hash,
            payload, created_at)
         VALUES ($1, 1, $2, 'draft', $3, $4::jsonb, $5::timestamptz)`,
        [
          skillId,
          skillRevisionRef,
          legacyPayload.contentHash,
          JSON.stringify(legacyPayload),
          legacyPayload.createdAt,
        ],
      );
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
      const repository = new PostgresSkillRepository(pool);
      await repository.migrate();

      const restarted = new PostgresSkillRepository(pool);
      const migrated = await restarted.getRevision(skillRevisionRef);
      assert.equal(migrated?.formatVersion, 1);
      assert.equal(migrated?.status, 'draft');
      assert.deepEqual(migrated?.governance.workflowRevisionRefs, [
        'workflow.authentic-v1@1',
      ]);
      assert.equal(migrated?.prompt.content, promptContent);
      assert.deepEqual(await restarted.getBinding(bindingId), {
        bindingId,
        workflowRevisionRef,
        skillId,
        skillRevisionRef,
        mode: legacyBinding.mode,
        status: legacyBinding.status,
        supersededAt: legacyBinding.supersededAt,
        supersededByBindingId: legacyBinding.supersededByBindingId,
        createdAt: legacyBinding.createdAt,
        triggerCondition: {
          harnessStage: legacyBinding.stage,
          industryCategory: null,
          tenantId: null,
        },
      });

      const firstBackfill = await pool.query<{
        format_version: number;
        frontmatter: unknown;
        governance_sidecar: unknown;
        trigger_condition: unknown;
      }>(
        `SELECT revisions.format_version,
                revisions.frontmatter,
                revisions.governance_sidecar,
                bindings.trigger_condition
           FROM p1_skill_revisions revisions
           JOIN p1_skill_bindings bindings
             ON bindings.skill_revision_ref = revisions.skill_revision_ref
          WHERE revisions.skill_revision_ref = $1
            AND bindings.binding_id = $2`,
        [skillRevisionRef, bindingId],
      );
      assert.deepEqual(firstBackfill.rows[0], {
        format_version: 1,
        frontmatter: null,
        governance_sidecar: null,
        trigger_condition: {
          harnessStage: legacyBinding.stage,
          industryCategory: null,
          tenantId: null,
        },
      });

      await restarted.migrate();
      const secondBackfill = await pool.query(
        `SELECT revisions.format_version,
                revisions.frontmatter,
                revisions.governance_sidecar,
                bindings.trigger_condition
           FROM p1_skill_revisions revisions
           JOIN p1_skill_bindings bindings
             ON bindings.skill_revision_ref = revisions.skill_revision_ref
          WHERE revisions.skill_revision_ref = $1
            AND bindings.binding_id = $2`,
        [skillRevisionRef, bindingId],
      );
      assert.deepEqual(secondBackfill.rows, firstBackfill.rows);
    } finally {
      await pool.end();
      await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminPool.end();
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
           (binding_id, workflow_revision_ref, stage, trigger_condition, skill_id,
            skill_revision_ref, status, superseded_at, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'active', NULL, $7::jsonb, $8::timestamptz)`,
        [
          bindingId,
          workflowRevisionRef,
          legacyBinding.stage,
          JSON.stringify({ harnessStage: legacyBinding.stage }),
          skillId,
          skillRevisionRef,
          JSON.stringify(legacyBinding),
          legacyBinding.createdAt,
        ],
      );

      assert.deepEqual(
        await repository.listBindings(
          workflowRevisionRef,
          { harnessStage: 'intent_naming' },
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
          { harnessStage: 'intent_naming' },
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
        formatVersion: 2,
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
        packagePaths: ['SKILL.md'],
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
          content: 'Validate output before any side effect.',
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
        triggerCondition: { harnessStage: 'intent_naming' },
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
            AND trigger_condition = $2::jsonb
            AND skill_id = $3
            AND status = 'active'`,
        [
          workflowRevisionRef,
          JSON.stringify({
            harnessStage: 'intent_naming',
            industryCategory: null,
            tenantId: null,
          }),
          skillId,
        ],
      );
      assert.deepEqual(active.rows, [
        { skill_revision_ref: draftV1.skillRevisionRef },
      ]);
      const uniqueIndex = await pool.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexname = 'p1_skill_bindings_active_trigger_uq'`,
      );
      assert.match(
        uniqueIndex.rows[0]?.indexdef ?? '',
        /UNIQUE INDEX .*workflow_revision_ref, trigger_condition, skill_id/u,
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
