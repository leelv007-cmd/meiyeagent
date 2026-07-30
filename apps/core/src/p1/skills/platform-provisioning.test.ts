import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HARNESS_BUILTIN_PROMPTS,
  HARNESS_PROMPT_SITES,
  LangfuseHarnessPromptResolver,
  type HarnessFrozenPrompts,
} from '../harness/langfuse-prompts.js';
import { MemorySkillRepository } from './repository.js';
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
