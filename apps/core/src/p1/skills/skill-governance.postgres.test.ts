import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresSkillRepository } from './postgres-repository.js';
import { SkillService } from './service.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'governance draft and redacted run record persist atomically in PostgreSQL',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const suffix = randomUUID();
    const skillId = `skill.governance-postgres.${suffix}`;
    const runId = `skill-governance-postgres-${suffix}`;
    const protectedValue = `protected-${suffix}`;
    const instruction = `Approved instruction ${suffix}`;
    const pool = new Pool({ connectionString });
    const repository = new PostgresSkillRepository(pool);
    try {
      await repository.migrate();
      const promptContent = `Governance prompt ${suffix}`;
      const prompt = {
        content: promptContent,
        contentHash: sha256(promptContent),
        isFallback: false as const,
        label: 'production',
        name: 'harness/intent-naming',
        source: 'langfuse' as const,
        version: '42',
      };
      const authoring = new SkillService(
        repository,
        () => '2026-07-30T02:00:00.000Z',
        {
          async capture() {
            return prompt;
          },
        },
      );
      await authoring.defineCatalogEntry({
        actorId: 'platform-admin-postgres',
        description: 'PostgreSQL governance atomicity fixture.',
        name: 'PostgreSQL governance fixture',
        presentationPolicy: 'backend_only',
        skillId,
        sourceKind: 'authored',
        tier: 'platform',
      });
      const base = await authoring.draftRevision({
        actorId: 'platform-admin-postgres',
        expectedRevision: null,
        governance: {
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
          workflowRevisionRefs: ['workflow.governance@1'],
        },
        instruction: 'Original instruction',
        manifest: {
          description: 'PostgreSQL governance atomicity fixture.',
          name: `governance-postgres-${suffix}`,
        },
        promptReference: {
          contentHash: prompt.contentHash,
          name: prompt.name,
          version: prompt.version,
        },
        skillId,
      });

      const result = await new SkillService(
        repository,
        () => '2026-07-30T02:01:00.000Z',
      ).applyGovernanceRevision({
        actorId: 'platform-admin-postgres',
        baseSkillRevisionRef: base.skillRevisionRef,
        expectedHeadRevision: 1,
        patch: {
          'governance.fallback': protectedValue,
          instruction,
        },
        runId,
        workspaceId: 'platform-operations',
      });

      assert.equal(result.applied, true);
      assert.equal(
        (await repository.getRevision(`${skillId}@2`))?.instruction,
        instruction,
      );
      assert.deepEqual(
        (await repository.getGovernanceRun(runId))?.result,
        result,
      );
      const persisted = await pool.query<{ payload: string }>(
        `SELECT payload::text AS payload
           FROM p1_skill_governance_runs
          WHERE run_id = $1`,
        [runId],
      );
      assert.doesNotMatch(
        persisted.rows[0]?.payload ?? '',
        new RegExp(`${protectedValue}|${instruction}`, 'u'),
      );
    } finally {
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

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
