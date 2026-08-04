import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { EvalRun } from '../../contracts/index.js';
import { Pool } from 'pg';

import {
  HARNESS_BUILTIN_PROMPTS,
  HARNESS_PROMPT_SITES,
  LangfuseHarnessPromptResolver,
  type HarnessFrozenPrompts,
} from '../harness/langfuse-prompts.js';
import { MemorySkillRepository } from './repository.js';
import { PostgresSkillRepository } from './postgres-repository.js';
import { SkillService } from './service.js';
import { skillPromptSnapshotPortFromHarness } from './runtime.js';
import {
  PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
  PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID,
  PLATFORM_COPY_WORKFLOW_REVISION_REF,
  provisionPlatformRecipes,
} from './platform-provisioning.js';

test('production provisioning consumes both platform factories idempotently', async () => {
  const prompts = frozenPrompts();
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => '2026-07-30T00:00:00.000Z',
    skillPromptSnapshotPortFromHarness({
      async resolve() {
        return prompts;
      },
    }),
  );

  await provisionPlatformRecipes({ prompts, repository, service });
  await provisionPlatformRecipes({ prompts, repository, service });

  const copy = await repository.getCatalog(
    PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
  );
  const capture = await repository.getCatalog(
    PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID,
  );
  assert.equal(copy?.activeRevisionRef, 'skill.beauty-copywriting@1');
  assert.equal(capture?.activeRevisionRef, 'skill.capture-store-workflow@1');
  assert.equal(
    (await repository.listRevisions(PLATFORM_BEAUTY_COPYWRITING_SKILL_ID, 10))
      .length,
    1,
  );
  assert.equal(
    (
      await repository.listRevisions(
        PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID,
        10,
      )
    ).length,
    1,
  );

  assert.deepEqual(
    (
      await repository.listBindings(PLATFORM_COPY_WORKFLOW_REVISION_REF, {
        harnessStage: 'execution_selection',
        industryCategory: null,
        tenantId: null,
      })
    ).map(({ skillRevisionRef }) => skillRevisionRef),
    ['skill.beauty-copywriting@1'],
  );
  assert.deepEqual(
    (
      await repository.listBindings(PLATFORM_COPY_WORKFLOW_REVISION_REF, {
        harnessStage: 'intent_naming',
        industryCategory: null,
        tenantId: null,
      })
    ).map(({ skillRevisionRef }) => skillRevisionRef),
    ['skill.capture-store-workflow@1'],
  );
  assert.equal(
    (
      await repository.getDeployment(
        'deployment.platform.capture-store-workflow@1',
      )
    )?.executionMode,
    'harness_native',
  );
});

test('platform provisioning records strict and pilot authorities under distinct boot keys', async () => {
  const strictResolver = strictPromptResolver();
  const pilotResolver = new LangfuseHarnessPromptResolver({
    policy: 'pilot',
    warn() {},
  });
  const strictPrompts = await strictResolver.resolve();
  const pilotPrompts = await pilotResolver.resolve();
  const repository = new RecordingSkillRepository();
  const strictService = new SkillService(
    repository,
    () => '2026-07-30T00:00:00.000Z',
    skillPromptSnapshotPortFromHarness(strictResolver),
  );
  const pilotService = new SkillService(
    repository,
    () => '2026-07-30T00:00:00.000Z',
    skillPromptSnapshotPortFromHarness(pilotResolver),
  );

  await provisionPlatformRecipes({
    prompts: strictPrompts,
    repository,
    service: strictService,
  });
  const strictRunIds = [...repository.createdImmutableRunIds];
  const strictRuns = await Promise.all(
    strictRunIds.map((runId) => repository.get(runId)),
  );

  await provisionPlatformRecipes({
    prompts: pilotPrompts,
    repository,
    service: pilotService,
  });
  const pilotRunIds = repository.createdImmutableRunIds.slice(
    strictRunIds.length,
  );
  const pilotRuns = await Promise.all(
    pilotRunIds.map((runId) => repository.get(runId)),
  );

  assert.equal(strictRunIds.length, 2);
  assert.equal(pilotRunIds.length, 2);
  assert.equal(
    strictRunIds.every((runId) => !pilotRunIds.includes(runId)),
    true,
  );
  assert.deepEqual(
    strictRuns.map((run) => run?.results[0]?.promptRevision).sort(),
    ['harness/copy-candidate@1', 'harness/intent-naming@1'],
  );
  assert.equal(pilotRuns.every((run) => run !== null), true);
  assert.deepEqual(
    pilotRuns.map((run) => run?.results[0]?.promptRevision).sort(),
    ['harness/copy-candidate@builtin-v1', 'harness/intent-naming@builtin-v1'],
  );

  await provisionPlatformRecipes({
    prompts: pilotPrompts,
    repository,
    service: pilotService,
  });
  assert.equal(repository.createdImmutableRunIds.length, 4);
  assert.deepEqual(
    repository.immutableWriteRunIds.slice(
      strictRunIds.length + pilotRunIds.length,
    ),
    pilotRunIds,
  );
});

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'platform provisioning records strict and pilot authorities in PostgreSQL',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const strictResolver = strictPromptResolver();
    const pilotResolver = new LangfuseHarnessPromptResolver({
      policy: 'pilot',
      warn() {},
    });
    const strictPrompts = await strictResolver.resolve();
    const pilotPrompts = await pilotResolver.resolve();
    const pool = new Pool({ connectionString });
    const repository = new PostgresSkillRepository(pool);
    const strictService = new SkillService(
      repository,
      () => '2026-07-30T00:00:00.000Z',
      skillPromptSnapshotPortFromHarness(strictResolver),
    );
    const pilotService = new SkillService(
      repository,
      () => '2026-07-30T00:00:00.000Z',
      skillPromptSnapshotPortFromHarness(pilotResolver),
    );

    try {
      await repository.migrate();
      await provisionPlatformRecipes({
        prompts: strictPrompts,
        repository,
        service: strictService,
      });
      await provisionPlatformRecipes({
        prompts: pilotPrompts,
        repository,
        service: pilotService,
      });

      const runIds = (await pool.query<{ run_id: string }>(
        `SELECT run_id
           FROM p1_skill_eval_runs
          WHERE run_id LIKE 'eval.platform.%'
          ORDER BY run_id`,
      )).rows.map(({ run_id }) => run_id);
      const authorityRuns = await Promise.all(
        runIds.map((runId) => repository.get(runId)),
      );
      const expectedPromptRevisions = [
        'harness/copy-candidate@1',
        'harness/copy-candidate@builtin-v1',
        'harness/intent-naming@1',
        'harness/intent-naming@builtin-v1',
      ];
      const authorityRunsForPrompts = authorityRuns.filter((run) =>
        expectedPromptRevisions.includes(run?.results[0]?.promptRevision ?? ''),
      );
      assert.equal(authorityRunsForPrompts.length, 4);
      assert.deepEqual(
        authorityRunsForPrompts
          .map((run) => run?.results[0]?.promptRevision)
          .sort(),
        expectedPromptRevisions,
      );

      await provisionPlatformRecipes({
        prompts: pilotPrompts,
        repository,
        service: pilotService,
      });
      const replayedRunIds = (await pool.query<{ run_id: string }>(
        `SELECT run_id
           FROM p1_skill_eval_runs
          WHERE run_id LIKE 'eval.platform.%'
          ORDER BY run_id`,
      )).rows.map(({ run_id }) => run_id);
      assert.deepEqual(replayedRunIds, runIds);
    } finally {
      await pool.end();
    }
  },
);

test('unconfigured prompt supply provisions builtin platform recipes with explicit fallback provenance', async () => {
  const promptResolver = new LangfuseHarnessPromptResolver({
    policy: 'pilot',
    warn() {},
  });
  const prompts = await promptResolver.resolve();
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => '2026-07-30T00:00:00.000Z',
    skillPromptSnapshotPortFromHarness(promptResolver),
  );

  const { revisions } = await provisionPlatformRecipes({
    prompts,
    repository,
    service,
  });

  assert.equal(revisions.length, 2);
  for (const revision of revisions) {
    const stored = await repository.getRevision(revision.skillRevisionRef);
    assert.equal(stored?.status, 'accepted_frozen');
    assert.deepEqual(
      {
        fallbackReason: stored?.prompt.fallbackReason,
        isFallback: stored?.prompt.isFallback,
        source: stored?.prompt.source,
        version: stored?.prompt.version,
      },
      {
        fallbackReason: 'unconfigured',
        isFallback: true,
        source: 'builtin',
        version: 'builtin-v1',
      },
    );
    assert.equal(
      (await repository.getCatalog(revision.skillId))?.activeRevisionRef,
      revision.skillRevisionRef,
    );
  }
  const resolved = await service.resolveFrozenRevisions(
    revisions.map(({ skillRevisionRef }) => skillRevisionRef),
  );
  for (const instruction of resolved) {
    assert.equal(instruction.prompt?.source, 'builtin');
    assert.equal(instruction.prompt?.fallbackReason, 'unconfigured');
  }
  const receipts = await service.recordPromptMaterializationReceipts({
    instructions: resolved.filter(
      ({ executionMode }) => executionMode === 'prompt_materialized',
    ),
    stage: 'execution_selection',
    taskId: 'task-unconfigured-platform-recipe',
    workflowRevisionRef: 'workflow.copy@1',
    workspaceId: 'workspace-unconfigured-platform-recipe',
  });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.prompt?.source, 'builtin');
  assert.equal(receipts[0]?.prompt?.fallbackReason, 'unconfigured');
  assert.ok(
    await repository.getBinding('binding.platform.beauty-copywriting@1'),
  );
  assert.ok(
    await repository.getBinding('binding.platform.capture-store-workflow@1'),
  );
  assert.ok(
    await repository.getDeployment(
      'deployment.platform.beauty-copywriting@1',
    ),
  );
  assert.ok(
    await repository.getDeployment(
      'deployment.platform.capture-store-workflow@1',
    ),
  );
});

test('configured prompt supply still requires frozen Langfuse production revisions', async () => {
  let requests = 0;
  const promptResolver = new LangfuseHarnessPromptResolver({
    baseUrl: 'https://langfuse.fixture',
    fetch: async () => {
      requests += 1;
      return Response.json({});
    },
    policy: 'pilot',
    publicKey: 'fixture-public',
    secretKey: 'fixture-secret',
    versions: {
      copyCandidate: 1,
      intentNaming: 1,
    },
    warn() {},
  });
  const prompts = await promptResolver.resolve();
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => '2026-07-30T00:00:00.000Z',
    skillPromptSnapshotPortFromHarness(promptResolver),
  );

  assert.equal(prompts.copyCandidate.fallbackReason, 'invalid_response');
  await assert.rejects(
    provisionPlatformRecipes({ prompts, repository, service }),
    /requires a frozen Langfuse production revision/u,
  );
  assert.ok(requests > 0);
});

test('main enables platform recipe provisioning in the production runtime', async () => {
  const source = await readFile(new URL('../../main.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /createDurableSkillRuntime\(\{[\s\S]*?provisionPlatformRecipes: true,[\s\S]*?\}\);/u,
  );
});

function frozenPrompts(): HarnessFrozenPrompts {
  return Object.fromEntries(
    Object.entries(HARNESS_PROMPT_SITES).map(([key, site]) => {
      const content = HARNESS_BUILTIN_PROMPTS[
        key as keyof typeof HARNESS_BUILTIN_PROMPTS
      ];
      return [
        key,
        {
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          isFallback: false,
          label: 'production',
          name: site.name,
          source: 'langfuse',
          version: 'platform-1',
        },
      ];
    }),
  ) as HarnessFrozenPrompts;
}

function strictPromptResolver() {
  return new LangfuseHarnessPromptResolver({
    baseUrl: 'https://langfuse.fixture',
    fetch: async (request) => {
      const name = decodeURIComponent(
        new URL(String(request)).pathname.split('/').pop()!,
      );
      const key = Object.entries(HARNESS_PROMPT_SITES).find(
        ([, site]) => site.name === name,
      )?.[0] as keyof typeof HARNESS_BUILTIN_PROMPTS | undefined;
      if (!key) return new Response(null, { status: 404 });
      return Response.json({
        prompt: `Strict Langfuse pin: ${HARNESS_BUILTIN_PROMPTS[key]}`,
        type: 'text',
        version: 1,
      });
    },
    policy: 'strict',
    publicKey: 'fixture-public',
    secretKey: 'fixture-secret',
    versions: Object.fromEntries(
      Object.keys(HARNESS_PROMPT_SITES).map((key) => [key, 1]),
    ),
    warn() {},
  });
}

class RecordingSkillRepository extends MemorySkillRepository {
  readonly createdImmutableRunIds: string[] = [];
  readonly immutableWriteRunIds: string[] = [];

  override async putImmutable(runId: string, input: EvalRun) {
    const existing = await this.get(runId);
    this.immutableWriteRunIds.push(runId);
    const run = await super.putImmutable(runId, input);
    if (!existing) this.createdImmutableRunIds.push(runId);
    return run;
  }
}
