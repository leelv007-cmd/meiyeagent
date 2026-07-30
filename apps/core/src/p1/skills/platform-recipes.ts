import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';

export const BEAUTY_COPYWRITING_INSTRUCTION = [
  'Write one directly usable primary recommendation before optional alternatives.',
  'Prefer customer benefits and concrete confirmed facts over feature lists or vague claims.',
  'Use customer language, one claim per paragraph, and one confirmed conversion action.',
  'Never invent prices, results, qualifications, reviews, scarcity, statistics, or authorization.',
  'Keep the title, body, and CTA aligned to the same marketing objective.',
].join(' ');

export const CAPTURE_STORE_WORKFLOW_INSTRUCTION = [
  'Use this recipe when the merchant says phrases such as "以后都这么做", "记住这个流程", or "下次照这个来".',
  'Read the current conversation first and extract the tools used, ordered steps, merchant corrections, and observed input/output formats.',
  'Ask once for only the missing fields; the group and every field must allow an explicit unknown or skipped answer.',
  'Create only a proposal with source-conversation evidence. Record an immutable store recipe only after an authenticated merchant confirmation.',
].join(' ');

interface PlatformRecipeDefinitionInput {
  expectedRevision: number | null;
  instruction?: string;
  prompt: HarnessFrozenPrompt;
  skillId: string;
  workflowRevisionRef: string;
}

export function beautyCopywritingDefinition(
  input: PlatformRecipeDefinitionInput
) {
  return {
    expectedRevision: input.expectedRevision,
    frontmatter: {
      description:
        'Writes grounded beauty-business copy with one usable primary recommendation.',
      license: 'MIT',
      metadata: {
        author: 'Corey Haines',
        'source-commit': '7868cb9251fad80a73d26e488a5ad5f6c4a9f335',
        'source-path': 'skills/copywriting/SKILL.md',
      },
      name: 'beauty-copywriting',
    },
    governance: {
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 10_000,
      },
      contextScopes: [],
      executionMode: 'prompt_materialized',
      fallback: 'fail_closed',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none',
      workflowRevisionRefs: [input.workflowRevisionRef],
    },
    instruction: input.instruction ?? BEAUTY_COPYWRITING_INSTRUCTION,
    name: 'Beauty copywriting',
    packagePaths: ['SKILL.md'],
    presentationPolicy: 'backend_only',
    promptReference: promptReference(input.prompt),
    skillId: input.skillId,
    sourceKind: 'harvested',
    sourceRef: {
      externalUrl:
        'https://github.com/coreyhaines31/marketingskills/blob/7868cb9251fad80a73d26e488a5ad5f6c4a9f335/skills/copywriting/SKILL.md',
      harvestedAt: '2026-07-30T00:00:00.000Z',
    },
    tier: 'platform',
  };
}

export function captureStoreWorkflowDefinition(
  input: PlatformRecipeDefinitionInput
) {
  return {
    expectedRevision: input.expectedRevision,
    frontmatter: {
      'allowed-tools': 'read_context ask_merchant record',
      compatibility:
        'Requires an ordinary-session proposal and authenticated confirmation consumer before binding.',
      description:
        'Captures a merchant-approved conversation workflow as an immutable store recipe.',
      license: 'Apache-2.0',
      metadata: {
        author: 'Anthropic',
        'source-commit': 'b29e7cf65e5cb78a5ac33d582270551bc74a14eb',
        'source-path': 'skills/skill-creator/SKILL.md',
      },
      name: 'capture-store-workflow',
    },
    governance: {
      budget: {
        maxChildEffects: 3,
        maxCostCents: 0,
        timeoutMs: 30_000,
      },
      contextScopes: ['conversation', 'merchant_confirmation'],
      executionMode: 'harness_native',
      fallback: 'fail_closed',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: ['tool_calling'],
      sideEffectClass: 'bounded_write',
      workflowRevisionRefs: [input.workflowRevisionRef],
    },
    instruction: CAPTURE_STORE_WORKFLOW_INSTRUCTION,
    name: 'Capture store workflow',
    packagePaths: ['SKILL.md'],
    presentationPolicy: 'backend_only',
    promptReference: promptReference(input.prompt),
    skillId: input.skillId,
    sourceKind: 'harvested',
    sourceRef: {
      externalUrl:
        'https://github.com/anthropics/skills/blob/b29e7cf65e5cb78a5ac33d582270551bc74a14eb/skills/skill-creator/SKILL.md',
      harvestedAt: '2026-07-30T00:00:00.000Z',
    },
    tier: 'platform',
  };
}

function promptReference(prompt: HarnessFrozenPrompt) {
  return {
    contentHash: prompt.contentHash,
    name: prompt.name,
    version: prompt.version,
  };
}
