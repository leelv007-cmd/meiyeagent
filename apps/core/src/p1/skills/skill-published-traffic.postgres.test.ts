import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresSkillRepository } from './postgres-repository.js';
import { SkillService } from './service.js';
import type { SkillRevision } from './types.js';

const connectionString = process.env.TEST_DATABASE_URL;
const NOW = '2026-07-30T12:00:00.000Z';

test(
  'PostgreSQL Published CAS keeps one canonical pointer and lifecycle edge',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const suffix = randomUUID();
    const skillId = `skill.published-traffic-postgres.${suffix}`;
    const pool = new Pool({ connectionString });
    const repository = new PostgresSkillRepository(pool);
    const revisions = [
      acceptedRevision(skillId, 1),
      acceptedRevision(skillId, 2),
    ] as const;
    try {
      await repository.migrate();
      await repository.putCatalog({
        activeRevisionRef: null,
        actorId: 'operator-seed',
        createdAt: NOW,
        description: 'PostgreSQL Published traffic fixture.',
        name: 'PostgreSQL Published traffic fixture',
        presentationPolicy: 'backend_only',
        publicationGeneration: 0,
        skillId,
        sourceKind: 'authored',
        tier: 'platform',
        updatedAt: NOW,
      });
      await repository.putRevision(revisions[0], null);
      await repository.putRevision(revisions[1], 1);
      const service = new SkillService(repository, () => NOW);

      const competing = await Promise.all([
        service.publishAcceptedRevision({
          actorId: 'operator-a',
          expectedPublicationGeneration: 0,
          expectedPublishedRevisionRef: null,
          runId: `publish-a-${suffix}`,
          skillId,
          targetSkillRevisionRef: revisions[0].skillRevisionRef,
          workspaceId: 'workspace-ops',
        }),
        service.publishAcceptedRevision({
          actorId: 'operator-b',
          expectedPublicationGeneration: 0,
          expectedPublishedRevisionRef: null,
          runId: `publish-b-${suffix}`,
          skillId,
          targetSkillRevisionRef: revisions[1].skillRevisionRef,
          workspaceId: 'workspace-ops',
        }),
      ]);
      assert.equal(
        competing.filter((result) => result.applied).length,
        1,
      );
      assert.equal(
        competing.filter(
          (result) =>
            !result.applied &&
            result.validationResults[0]?.reasonCode === 'cas_conflict',
        ).length,
        1,
      );

      const catalog = await repository.getCatalog(skillId);
      assert.equal(catalog?.publicationGeneration, 1);
      assert.ok(catalog?.activeRevisionRef);
      const lifecycleEdges = (
        await repository.listReferenceEdges(catalog.activeRevisionRef)
      ).filter((edge) => edge.consumerKind === 'published_lifecycle');
      assert.equal(lifecycleEdges.length, 1);
      await pool.query(
        `DELETE FROM p1_skill_reference_edges
          WHERE consumer_kind = 'published_lifecycle'
            AND consumer_id = $1`,
        [skillId],
      );
      await repository.migrate();
      assert.equal(
        (
          await repository.listReferenceEdges(catalog.activeRevisionRef)
        ).filter((edge) => edge.consumerKind === 'published_lifecycle').length,
        1,
      );
    } finally {
      await pool.query(
        `DELETE FROM p1_skill_reference_edges
          WHERE consumer_id = $1`,
        [skillId],
      );
      await pool.query(
        `DELETE FROM p1_skill_governance_runs
          WHERE run_id = ANY($1::text[])`,
        [[`publish-a-${suffix}`, `publish-b-${suffix}`]],
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

function acceptedRevision(
  skillId: string,
  revision: number,
): SkillRevision {
  return {
    acceptedAt: NOW,
    acceptedBy: 'operator-seed',
    contentHash: `content-hash-${revision}`,
    createdAt: NOW,
    createdBy: 'operator-seed',
    evalRunId: `eval-run-${revision}`,
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
    instruction: `Instruction ${revision}`,
    manifest: {
      description: `Published traffic fixture ${revision}.`,
      name: 'published-traffic',
    },
    packagePaths: ['SKILL.md'],
    prompt: {
      content: 'Fixture prompt.',
      contentHash: 'fixture-prompt-hash',
      isFallback: false,
      label: 'production',
      name: 'harness/intent-naming',
      source: 'langfuse',
      version: String(revision),
    },
    revision,
    skillId,
    skillRevisionRef: `${skillId}@${revision}`,
    status: 'accepted_frozen',
  };
}
