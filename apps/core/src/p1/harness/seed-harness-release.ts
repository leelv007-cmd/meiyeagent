import type { PublishHarnessReleaseInput } from './harness-release.js';
import {
  HarnessReleaseService,
  type HarnessReleaseStore,
} from './harness-release.js';
import {
  defaultPromptPackBindings,
  promptKeysForAllPacks,
} from './prompt-packs.js';

export const SEED_HARNESS_RELEASE_ID = 'harness-release-seed-v1';
const SEED_CREATED_AT = '2026-08-09T00:00:00.000Z';

/** Checked-in exact-pin seed; it is release authority, never derived from env. */
export function seedHarnessReleaseManifest(): PublishHarnessReleaseInput {
  return {
    releaseId: SEED_HARNESS_RELEASE_ID,
    version: 1,
    agentSessionHarnessVersion: 'agent-session/v1',
    makeHarnessVersion: 'make-harness/v1',
    middlewareBindings: [],
    controlLimits: {
      maxLlmSteps: 6,
      maxToolCalls: 8,
      maxRetrievalCalls: 4,
      maxMerchantQuestions: 1,
      maxReplans: 3,
      maxSchemaRepairs: 1,
      maxContextTokens: 32_000,
      maxDelegations: 2,
    },
    supervisorPolicyRef: { id: 'supervisor', revision: '1' },
    memoryPolicyRef: { id: 'memory', revision: '1' },
    contextCompilerRef: { id: 'context-compiler', revision: '1' },
    planSchemaRevision: 'plan-schema/v1',
    promptBindings: Object.fromEntries(
      promptKeysForAllPacks().map((key) => [key, { key, version: '1' }]),
    ),
    promptPackBindings: defaultPromptPackBindings(),
    schemaBindings: { default: 'schema/v1' },
    skillBindings: {},
    toolPolicyRevision: 'tool-policy/v1',
    modelPolicyRevision: 'model-policy/v1',
    factPolicyRevision: 'fact-policy/v1',
    rightsPolicyRevision: 'rights-policy/v1',
    budgetPolicyRevision: 'budget-policy/v1',
    evalSuiteRevision: 'eval-suite/v1',
    createdAt: SEED_CREATED_AT,
  };
}

/** Upgrade legacy empty immutable production by publishing and swapping a new artifact. */
export async function ensureSeedProductionRelease(input: {
  store: HarnessReleaseStore;
  service: HarnessReleaseService;
}): Promise<void> {
  const production = await input.store.getLifecycleByStatus('production');
  const artifact = production
    ? await input.store.getArtifact(production.releaseId)
    : null;
  if (artifact && Object.keys(artifact.promptPackBindings).length > 0) return;

  await input.service.publishArtifact(seedHarnessReleaseManifest());
  let lifecycle = await input.store.getLifecycle(SEED_HARNESS_RELEASE_ID);
  if (!lifecycle) throw new Error('Seed HarnessRelease lifecycle was not created.');
  for (const status of ['evaluating', 'canary', 'production'] as const) {
    if (lifecycle.status === status || lifecycle.status === 'production') continue;
    lifecycle = await input.service.transitionLifecycle({
      releaseId: SEED_HARNESS_RELEASE_ID,
      toStatus: status,
      approvedBy: 'system:migration',
      now: SEED_CREATED_AT,
    });
  }
}
