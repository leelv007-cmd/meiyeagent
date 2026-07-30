import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessSkillManifestSnapshot } from '../harness/task-admission.js';
import { DurableSkillInstructionResolver } from './runtime.js';
import type { SkillService } from './service.js';
import type { ResolvedSkillInstruction } from './types.js';

const BUILTIN_PROMPT = {
  contentHash: 'builtin-prompt-hash',
  fallbackReason: 'unconfigured',
  isFallback: true,
  label: 'builtin',
  name: 'harness/intent-naming',
  source: 'builtin',
  version: 'builtin-v1',
} as const;

test('durable resolution keeps harness-native builtin instructions without recording prompt materialization', async () => {
  const harnessNative = instruction(
    'skill.capture-store-workflow@1',
    'harness_native',
    BUILTIN_PROMPT,
  );
  const promptMaterialized = instruction(
    'skill.beauty-copywriting@1',
    'prompt_materialized',
    BUILTIN_PROMPT,
  );
  let recordedInstructions: readonly ResolvedSkillInstruction[] = [];
  const resolver = resolverWith({
    async recordPromptMaterializationReceipts(input) {
      recordedInstructions = input.instructions;
      if (
        input.instructions.some(
          ({ executionMode }) => executionMode !== 'prompt_materialized',
        )
      ) {
        throw new Error(
          'Production decision stages may only materialize accepted frozen prompt_materialized Skills.',
        );
      }
      return [];
    },
  });

  const resolved = await resolver.resolve({
    skillManifestSnapshots: [
      snapshot(harnessNative),
      snapshot(promptMaterialized),
    ],
    stage: 'intent_naming',
    workflowId: 'task-fixture-copy',
    workflowRevision: 1,
    workspaceId: 'workspace-fixture',
  });

  assert.deepEqual(resolved.instructions, [harnessNative, promptMaterialized]);
  assert.deepEqual(recordedInstructions, [promptMaterialized]);
  assert.deepEqual(resolved.receipts, []);
  assert.equal(
    resolved.instructions[0]?.prompt?.fallbackReason,
    'unconfigured',
  );
  assert.equal(resolved.instructions[0]?.prompt?.source, 'builtin');
});

test('durable resolution preserves the configured prompt materialization strict path', async () => {
  const configured = instruction(
    'skill.beauty-copywriting@1',
    'prompt_materialized',
    {
      contentHash: 'langfuse-production-hash',
      isFallback: false,
      label: 'production',
      name: 'harness/copy-candidate',
      source: 'langfuse',
      version: '42',
    },
  );
  const resolver = resolverWith({
    async recordPromptMaterializationReceipts(input) {
      assert.deepEqual(input.instructions, [configured]);
      throw new Error(
        'Prompt Skill acceptance requires a frozen Langfuse production revision.',
      );
    },
  });

  await assert.rejects(
    resolver.resolve({
      skillManifestSnapshots: [snapshot(configured)],
      stage: 'execution_selection',
      workflowId: 'task-configured-copy',
      workflowRevision: 1,
      workspaceId: 'workspace-configured',
    }),
    /requires a frozen Langfuse production revision/u,
  );
});

function resolverWith(service: {
  recordPromptMaterializationReceipts: (
    input: Parameters<SkillService['recordPromptMaterializationReceipts']>[0],
  ) => ReturnType<SkillService['recordPromptMaterializationReceipts']>;
}) {
  return new DurableSkillInstructionResolver(service as never, {
    async getRecipeByRevisionId() {
      return null;
    },
  } as never);
}

function instruction(
  skillRevisionRef: string,
  executionMode: ResolvedSkillInstruction['executionMode'],
  prompt: NonNullable<ResolvedSkillInstruction['prompt']>,
): ResolvedSkillInstruction {
  return {
    contentHash: `${skillRevisionRef}-content-hash`,
    executionMode,
    instruction: `Apply ${skillRevisionRef}.`,
    prompt,
    requiredModelCapabilities: [],
    skillRevisionRef,
  };
}

function snapshot(
  resolvedInstruction: ResolvedSkillInstruction,
): HarnessSkillManifestSnapshot {
  return {
    contentHash: resolvedInstruction.contentHash,
    requiredModelCapabilities: [
      ...resolvedInstruction.requiredModelCapabilities,
    ],
    resolvedInstruction,
    skillRevisionRef: resolvedInstruction.skillRevisionRef,
  };
}
