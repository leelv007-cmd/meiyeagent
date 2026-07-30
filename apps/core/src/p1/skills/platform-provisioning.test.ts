import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  HARNESS_BUILTIN_PROMPTS,
  HARNESS_PROMPT_SITES,
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
