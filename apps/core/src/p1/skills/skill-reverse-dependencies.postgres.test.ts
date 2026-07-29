import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { CreationExperienceCatalogService } from '../creation-experience/catalog-service.js';
import { PostgresCreationExperienceCatalogRepository } from '../creation-experience/postgres-repository.js';
import { PostgresSkillRepository } from './postgres-repository.js';
import { SkillService } from './service.js';
import type { SkillRevision } from './types.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = '2026-07-30T10:00:00.000Z';

test(
  'PostgreSQL reference edges stay atomic and legacy missing scope fails closed',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const suffix = randomUUID();
    const skillId = `skill.reverse-dependency-postgres.${suffix}`;
    const targetSkillRevisionRef = `${skillId}@1`;
    const bindingId = `binding-reference-${suffix}`;
    const deploymentId = `deployment-reference-${suffix}`;
    const receiptId = `receipt-reference-${suffix}`;
    const legacyDeploymentId = `legacy-deployment-reference-${suffix}`;
    const recipeId = `recipe.reference-${suffix}`;
    const pool = new Pool({ connectionString });
    const repository = new PostgresSkillRepository(pool);
    try {
      await repository.migrate();
      await repository.putBinding({
        bindingId,
        workflowRevisionRef: 'workflow.copy@4',
        triggerCondition: {
          harnessStage: 'intent_naming',
          industryCategory: null,
          tenantId: 'workspace-pg-viewer',
        },
        ownerWorkspaceId: 'workspace-pg-viewer',
        skillId,
        skillRevisionRef: targetSkillRevisionRef,
        mode: 'required',
        status: 'active',
        supersededAt: null,
        supersededByBindingId: null,
        createdAt: NOW,
      });
      await repository.putDeployment(
        {
          deploymentId,
          skillRevisionRef: targetSkillRevisionRef,
          provider: 'internal',
          channel: 'prompt',
          nativeSkillId: skillId,
          nativeVersion: '1',
          executionMode: 'prompt_materialized',
          packagePaths: ['SKILL.md'],
          rolloutEvidenceRef: null,
          createdAt: NOW,
        },
        { kind: 'global', proof: 'deployment' },
      );
      await repository.putInvocationReceipt({
        invocationId: receiptId,
        workspaceId: 'workspace-pg-foreign',
        taskId: `task-${suffix}`,
        productUsageTaskId: `usage-${suffix}`,
        skillRevisionRef: targetSkillRevisionRef,
        childEffectIds: [],
        totalCostCents: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        status: 'settled',
        createdAt: NOW,
        inputFingerprint: `fingerprint-${suffix}`,
      });
      const recipeRepository =
        new PostgresCreationExperienceCatalogRepository(pool);
      await recipeRepository.migrate();
      const recipe = await new CreationExperienceCatalogService(
        recipeRepository,
        () => NOW,
      ).draftRecipe({
        actorId: 'operator-recipe-reference',
        body: {
          lensId: 'copy',
          modelPolicy: { mode: 'auto' },
          presentation: {
            summary: 'Atomic recipe Skill reference.',
            title: 'Reference recipe',
          },
          promptRevisionRef: 'prompt.reference@1',
          skillRevisionRefs: [targetSkillRevisionRef],
          targetWorkspaceKind: 'copy',
        },
        correlationId: `corr-${suffix}`,
        expectedRevision: null,
        reason: 'verify atomic Skill dependency indexing',
        recipeId,
      });

      await pool.query(
        `INSERT INTO p1_skill_deployments
           (deployment_id, skill_revision_ref, payload, created_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
        [
          legacyDeploymentId,
          targetSkillRevisionRef,
          JSON.stringify({
            deploymentId: legacyDeploymentId,
            skillRevisionRef: targetSkillRevisionRef,
            provider: 'legacy-provider-secret',
            channel: 'legacy-channel-secret',
            nativeSkillId: skillId,
            nativeVersion: 'legacy',
            executionMode: 'prompt_materialized',
            packagePaths: ['SKILL.md'],
            rolloutEvidenceRef: null,
            createdAt: NOW,
          }),
          NOW,
        ],
      );

      const restarted = new PostgresSkillRepository(pool);
      await restarted.migrate();
      await restarted.putDeployment({
        deploymentId: legacyDeploymentId,
        skillRevisionRef: targetSkillRevisionRef,
        provider: 'legacy-provider-secret',
        channel: 'legacy-channel-secret',
        nativeSkillId: skillId,
        nativeVersion: 'legacy',
        executionMode: 'prompt_materialized',
        packagePaths: ['SKILL.md'],
        rolloutEvidenceRef: null,
        createdAt: NOW,
      });
      const result = await new SkillService(
        restarted,
        () => NOW,
      ).inspectReverseDependencies({
        targetSkillRevisionRef,
        viewerWorkspaceId: 'workspace-pg-viewer',
      });

      assert.deepEqual(result, {
        targetSkillRevisionRef,
        visibleDependencies: [
          {
            consumerId: deploymentId,
            consumerKind: 'deployment',
            consumerLabel: 'internal/prompt',
            scopeKind: 'global',
          },
          {
            consumerId: recipe.revisionId,
            consumerKind: 'recipe_revision',
            consumerLabel: recipeId,
            scopeKind: 'global',
          },
          {
            consumerId: bindingId,
            consumerKind: 'workflow_binding',
            consumerLabel: 'workflow.copy@4',
            scopeKind: 'workspace',
          },
        ],
        hiddenCount: 2,
        blocked: true,
      });
      const serialized = JSON.stringify(result);
      assert.doesNotMatch(serialized, /foreign|legacy-provider|legacy-channel/u);

      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_skill_reference_edges
          WHERE target_skill_revision_ref = $1`,
        [targetSkillRevisionRef],
      );
      assert.equal(count.rows[0]?.count, '5');
    } finally {
      await pool.query(
        `DELETE FROM p1_skill_reference_edges
          WHERE consumer_id = ANY($1::text[])`,
        [
          [
            bindingId,
            deploymentId,
            receiptId,
            legacyDeploymentId,
            `${recipeId}@1`,
          ],
        ],
      );
      await pool.query(
        'DELETE FROM p1_creation_recipe_heads WHERE recipe_id = $1',
        [recipeId],
      );
      await pool.query(
        'DELETE FROM p1_creation_recipe_revisions WHERE recipe_id = $1',
        [recipeId],
      );
      await pool.query(
        'DELETE FROM p1_skill_invocation_receipts WHERE invocation_id = $1',
        [receiptId],
      );
      await pool.query(
        'DELETE FROM p1_skill_deployments WHERE deployment_id = ANY($1::text[])',
        [[deploymentId, legacyDeploymentId]],
      );
      await pool.query(
        'DELETE FROM p1_skill_bindings WHERE binding_id = $1',
        [bindingId],
      );
      await pool.end();
    }
  },
);

test(
  'PostgreSQL retirement cannot race a new reference edge',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const suffix = randomUUID();
    const sqlSuffix = suffix.replaceAll('-', '').slice(0, 16);
    const skillId = `skill.retirement-race.${suffix}`;
    const skillRevisionRef = `${skillId}@1`;
    const runId = `retire-race-${suffix}`;
    const edgeId = `edge-race-${suffix}`;
    const triggerName = `p1_retire_pause_${sqlSuffix}`;
    const functionName = `p1_retire_pause_fn_${sqlSuffix}`;
    const pool = new Pool({ connectionString });
    const repository = new PostgresSkillRepository(pool);
    try {
      await repository.migrate();
      await repository.putCatalog({
        activeRevisionRef: null,
        actorId: 'operator-seed',
        createdAt: NOW,
        description: 'Retirement race fixture.',
        name: 'Retirement race fixture',
        presentationPolicy: 'backend_only',
        publicationGeneration: 0,
        skillId,
        sourceKind: 'authored',
        tier: 'platform',
        updatedAt: NOW,
      });
      await repository.putRevision(acceptedRevision(skillId), null);
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_sleep(0.5);
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON p1_skill_revisions
        FOR EACH ROW
        WHEN (NEW.skill_revision_ref = '${skillRevisionRef}')
        EXECUTE FUNCTION ${functionName}();
      `);

      const service = new SkillService(repository, () => NOW);
      const retirement = service.retireRevision({
        actorId: 'operator-retirement',
        runId,
        skillRevisionRef,
        workspaceId: 'workspace-retirement',
      });
      await waitForRetirementPause(pool);
      const edgeWrite = repository.putReferenceEdge({
        consumerId: `binding-race-${suffix}`,
        consumerKind: 'workflow_binding',
        consumerLabel: 'workflow.copy@race',
        createdAt: NOW,
        edgeId,
        scope: {
          kind: 'workspace',
          workspaceId: 'workspace-retirement',
        },
        targetSkillRevisionRef: skillRevisionRef,
      });
      const [retirementResult, edgeResult] = await Promise.allSettled([
        retirement,
        edgeWrite,
      ]);

      assert.equal(retirementResult.status, 'fulfilled');
      if (retirementResult.status === 'fulfilled') {
        assert.equal(retirementResult.value.applied, true);
      }
      assert.equal(edgeResult.status, 'rejected');
      assert.equal(
        (await repository.getRevision(skillRevisionRef))?.status,
        'retired',
      );
      assert.deepEqual(
        await repository.listReferenceEdges(skillRevisionRef),
        [],
      );
      assert.deepEqual(
        await service.retireRevision({
          actorId: 'operator-retirement',
          runId,
          skillRevisionRef,
          workspaceId: 'workspace-retirement',
        }),
        retirementResult.status === 'fulfilled'
          ? retirementResult.value
          : assert.fail('Retirement did not produce a replayable result.'),
      );
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON p1_skill_revisions`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await pool.query(
        'DELETE FROM p1_skill_reference_edges WHERE edge_id = $1',
        [edgeId],
      );
      await pool.query(
        'DELETE FROM p1_skill_governance_runs WHERE run_id = $1',
        [runId],
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
  'PostgreSQL recipe reference indexing cannot race Skill retirement',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const suffix = randomUUID();
    const sqlSuffix = suffix.replaceAll('-', '').slice(0, 16);
    const skillId = `skill.recipe-retirement-race.${suffix}`;
    const skillRevisionRef = `${skillId}@1`;
    const runId = `recipe-retire-race-${suffix}`;
    const recipeId = `recipe.retirement-race.${suffix}`;
    const triggerName = `p1_recipe_retire_pause_${sqlSuffix}`;
    const functionName = `p1_recipe_retire_pause_fn_${sqlSuffix}`;
    const pool = new Pool({ connectionString });
    const repository = new PostgresSkillRepository(pool);
    try {
      await repository.migrate();
      await repository.putCatalog({
        activeRevisionRef: null,
        actorId: 'operator-seed',
        createdAt: NOW,
        description: 'Recipe retirement race fixture.',
        name: 'Recipe retirement race fixture',
        presentationPolicy: 'backend_only',
        publicationGeneration: 0,
        skillId,
        sourceKind: 'authored',
        tier: 'platform',
        updatedAt: NOW,
      });
      await repository.putRevision(acceptedRevision(skillId), null);
      const recipeRepository =
        new PostgresCreationExperienceCatalogRepository(pool);
      await recipeRepository.migrate();
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_sleep(0.5);
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON p1_skill_revisions
        FOR EACH ROW
        WHEN (NEW.skill_revision_ref = '${skillRevisionRef}')
        EXECUTE FUNCTION ${functionName}();
      `);

      const retirement = new SkillService(
        repository,
        () => NOW,
      ).retireRevision({
        actorId: 'operator-retirement',
        runId,
        skillRevisionRef,
        workspaceId: 'workspace-retirement',
      });
      await waitForRetirementPause(pool);
      const recipeWrite = new CreationExperienceCatalogService(
        recipeRepository,
        () => NOW,
      ).draftRecipe({
        actorId: 'operator-recipe',
        body: {
          lensId: 'copy',
          modelPolicy: { mode: 'auto' },
          presentation: {
            summary: 'Recipe retirement race.',
            title: 'Recipe retirement race',
          },
          promptRevisionRef: 'prompt.recipe-retirement-race@1',
          skillRevisionRefs: [skillRevisionRef],
          targetWorkspaceKind: 'copy',
        },
        correlationId: `corr-${suffix}`,
        expectedRevision: null,
        reason: 'verify retirement/reference serialization',
        recipeId,
      });
      const [retirementResult, recipeResult] = await Promise.allSettled([
        retirement,
        recipeWrite,
      ]);

      assert.equal(retirementResult.status, 'fulfilled');
      assert.equal(recipeResult.status, 'rejected');
      assert.equal(
        (await repository.getRevision(skillRevisionRef))?.status,
        'retired',
      );
      assert.equal(
        await recipeRepository.getRecipeHead(recipeId),
        null,
      );
      assert.deepEqual(
        await repository.listReferenceEdges(skillRevisionRef),
        [],
      );
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON p1_skill_revisions`,
      );
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await pool.query(
        `DELETE FROM p1_skill_reference_edges
          WHERE consumer_id LIKE $1`,
        [`${recipeId}@%`],
      );
      await pool.query(
        'DELETE FROM p1_creation_recipe_heads WHERE recipe_id = $1',
        [recipeId],
      );
      await pool.query(
        'DELETE FROM p1_creation_recipe_revisions WHERE recipe_id = $1',
        [recipeId],
      );
      await pool.query(
        'DELETE FROM p1_skill_governance_runs WHERE run_id = $1',
        [runId],
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

async function waitForRetirementPause(pool: Pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ paused: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event = 'PgSleep'
            AND query LIKE '%UPDATE p1_skill_revisions%'
       ) AS paused`,
    );
    if (result.rows[0]?.paused) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Retirement never reached the deterministic race barrier.');
}

function acceptedRevision(skillId: string): SkillRevision {
  return {
    acceptedAt: NOW,
    acceptedBy: 'operator-seed',
    contentHash: 'retirement-race-content',
    createdAt: NOW,
    createdBy: 'operator-seed',
    evalRunId: 'retirement-race-eval',
    formatVersion: 2,
    governance: {
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 1_000,
      },
      contextScopes: [],
      executionMode: 'prompt_materialized',
      fallback: 'skip',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: [],
      sideEffectClass: 'none',
      workflowRevisionRefs: ['workflow.copy@1'],
    },
    instruction: 'Retirement race fixture.',
    manifest: {
      description: 'Retirement race fixture.',
      name: 'retirement-race',
    },
    packagePaths: ['SKILL.md'],
    prompt: {
      content: 'Retirement race prompt.',
      contentHash: 'retirement-race-prompt-hash',
      isFallback: false,
      label: 'production',
      name: 'harness/intent-naming',
      source: 'langfuse',
      version: '1',
    },
    revision: 1,
    skillId,
    skillRevisionRef: `${skillId}@1`,
    status: 'accepted_frozen',
  };
}
