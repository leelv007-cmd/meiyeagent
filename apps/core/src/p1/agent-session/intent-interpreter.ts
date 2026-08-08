/**
 * Intent hypothesis + Day-0 free-creation fact layering (V31-07 / V3.1 §19.2, D-175).
 *
 * free creation is not blocked by missing confirmed_store/project.
 * System must not invent store facts for free mode.
 */

import { z } from 'zod';

import type { ProactiveMode } from './turn-contracts.js';
import {
  classifyAmbiguity,
  applyProactiveMode,
  type AmbiguityAxes,
  type AmbiguityLevel,
  type ImpactCategory,
  type VisibleAssumption,
} from './ambiguity-policy.js';

export const CREATION_MODES = ['customized', 'free'] as const;
export type SessionCreationMode = (typeof CREATION_MODES)[number];

export const intentAmbiguitySchema = z
  .object({
    field: z.string().min(1).max(100),
    impact: z.enum([
      'cosmetic',
      'strategy',
      'rights',
      'facts',
      'fees',
      'external_action',
    ]),
    reversibility: z.enum(['reversible', 'hard_to_reverse', 'irreversible']),
    authority: z.enum([
      'system_fact',
      'merchant_confirmed',
      'model_inferred',
      'unknown',
    ]),
    resolution: z.enum(['safe_default', 'retrieve', 'ask_user', 'block']),
    level: z.enum(['L0', 'L1', 'L2', 'L3']).optional(),
  })
  .strict();

export type IntentAmbiguity = z.infer<typeof intentAmbiguitySchema>;

export const intentHypothesisSchema = z
  .object({
    normalizedGoal: z
      .object({
        type: z.string().min(1).max(100),
        summary: z.string().min(1).max(2_000),
        urgency: z.enum(['low', 'normal', 'high']).optional(),
      })
      .strict(),
    subject: z.string().min(1).max(500).optional(),
    desiredActions: z.array(z.string().min(1).max(200)).max(20).optional(),
    platformHints: z.array(z.string().min(1).max(100)).max(12).optional(),
    deliverableHints: z.array(z.string().min(1).max(100)).max(12).optional(),
    creationMode: z.enum(CREATION_MODES),
    assumptions: z
      .array(
        z
          .object({
            key: z.string().min(1).max(100),
            statement: z.string().min(1).max(1_000),
            risk: z.enum(['low', 'medium', 'high']),
            userVisible: z.boolean().optional(),
            reversible: z.boolean().optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    ambiguities: z.array(intentAmbiguitySchema).max(50).optional(),
    retrievalRequests: z
      .array(
        z
          .object({
            toolName: z.string().min(1).max(100),
            reason: z.string().min(1).max(500).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

export type IntentHypothesis = z.infer<typeof intentHypothesisSchema>;

export function parseIntentHypothesis(value: unknown): IntentHypothesis {
  return intentHypothesisSchema.parse(value);
}

/**
 * D-175 free-creation grounding: free is never blocked by confirmed_store/project.
 * Customized still requires store/project when missing (signaled, not invented).
 */
export type FreeCreationGrounding = {
  creationMode: SessionCreationMode;
  /** Always false for free — store/project missing must not block. */
  blockedByMissingStoreOrProject: boolean;
  missing: Array<'confirmed_store' | 'confirmed_project'>;
  /** free must never invent store-scoped claims. */
  mayInventStoreFacts: false;
  /** Safe generic copy path is available on Day-0. */
  day0SafeGenericPath: boolean;
};

export function resolveFreeCreationGrounding(input: {
  creationMode: SessionCreationMode;
  hasConfirmedStore: boolean;
  hasConfirmedProject: boolean;
}): FreeCreationGrounding {
  const missing: Array<'confirmed_store' | 'confirmed_project'> = [];
  if (!input.hasConfirmedStore) missing.push('confirmed_store');
  if (!input.hasConfirmedProject) missing.push('confirmed_project');

  if (input.creationMode === 'free') {
    return {
      creationMode: 'free',
      blockedByMissingStoreOrProject: false,
      missing: [],
      mayInventStoreFacts: false,
      day0SafeGenericPath: true,
    };
  }

  return {
    creationMode: 'customized',
    blockedByMissingStoreOrProject: missing.length > 0,
    missing,
    mayInventStoreFacts: false,
    day0SafeGenericPath: missing.length === 0,
  };
}

/** Default retrieval tools for a vague merchant goal (workflow-level, not endpoint). */
export const DEFAULT_INTENT_RETRIEVAL_TOOLS = [
  'find_store_projects',
  'read_confirmed_store_facts',
  'find_authorized_assets',
  'read_marketing_identity',
  'read_recent_content',
  'read_confirmed_experience',
] as const;

/**
 * Build a minimal IntentHypothesis from merchant message + mode (deterministic seed).
 * LLM may refine; high-risk fields stay unresolved (not defaulted).
 */
export function seedIntentHypothesis(input: {
  merchantMessage: string;
  creationMode: SessionCreationMode;
  proactiveMode: ProactiveMode;
  knownFields?: readonly string[];
  platformHint?: string;
}): IntentHypothesis {
  const known = new Set(input.knownFields ?? []);
  const ambiguities: IntentAmbiguity[] = [];
  const assumptions: NonNullable<IntentHypothesis['assumptions']> = [];

  // Platform is low-risk reversible strategy when unknown → L1 safe default under balanced.
  if (!known.has('platform')) {
    const axes: AmbiguityAxes = {
      impact: 'strategy',
      reversibility: 'reversible',
      authority: input.platformHint ? 'merchant_confirmed' : 'unknown',
    };
    const level = applyProactiveMode(
      classifyAmbiguity(axes),
      input.proactiveMode,
      axes,
    );
    if (level === 'L1' || (level === 'L0' && input.platformHint)) {
      assumptions.push({
        key: 'platform',
        statement: input.platformHint
          ? `平台：${input.platformHint}`
          : '默认小红书（可逆）',
        risk: 'low',
        userVisible: true,
        reversible: true,
      });
    } else if (level === 'L2') {
      ambiguities.push({
        field: 'platform',
        impact: 'strategy',
        reversibility: 'reversible',
        authority: 'unknown',
        resolution: 'ask_user',
        level,
      });
    }
  }

  // Price/rights must not be defaulted when unknown.
  if (!known.has('price')) {
    const axes: AmbiguityAxes = {
      impact: 'facts',
      reversibility: 'hard_to_reverse',
      authority: 'unknown',
    };
    const level = applyProactiveMode(
      classifyAmbiguity(axes),
      input.proactiveMode,
      axes,
    );
    ambiguities.push({
      field: 'price',
      impact: 'facts',
      reversibility: 'hard_to_reverse',
      authority: 'unknown',
      resolution: level === 'L3' ? 'block' : 'retrieve',
      level,
    });
  }

  const retrievalRequests =
    input.creationMode === 'free'
      ? [
          { toolName: 'read_marketing_identity', reason: 'optional_identity' },
          { toolName: 'read_recent_content', reason: 'style_reference' },
          {
            toolName: 'read_confirmed_experience',
            reason: 'confirmed_preferences',
          },
        ]
      : DEFAULT_INTENT_RETRIEVAL_TOOLS.map((toolName) => ({ toolName }));

  return intentHypothesisSchema.parse({
    normalizedGoal: {
      type: 'marketing_content',
      summary: input.merchantMessage.slice(0, 2_000),
      urgency: 'normal',
    },
    creationMode: input.creationMode,
    platformHints: input.platformHint ? [input.platformHint] : ['xiaohongshu'],
    assumptions,
    ambiguities,
    retrievalRequests,
  });
}

/**
 * Pick at most one ask field from ambiguities, respecting known fields + budget.
 */
export function pickSingleQuestionField(input: {
  ambiguities: readonly IntentAmbiguity[];
  knownFields: ReadonlySet<string> | readonly string[];
  remainingBudget: number;
}): string | null {
  if (input.remainingBudget <= 0) return null;
  const known = new Set(input.knownFields);
  const askable = input.ambiguities.filter(
    (item) =>
      item.resolution === 'ask_user' &&
      !known.has(item.field) &&
      item.impact !== 'rights' &&
      item.impact !== 'fees' &&
      item.impact !== 'external_action',
  );
  // Prefer strategy over cosmetic; facts that are ask_user (rare) last.
  const order: ImpactCategory[] = ['strategy', 'cosmetic', 'facts'];
  for (const impact of order) {
    const hit = askable.find((item) => item.impact === impact);
    if (hit) return hit.field;
  }
  return askable[0]?.field ?? null;
}

export function visibleAssumptionsFromHypothesis(
  hypothesis: IntentHypothesis,
): VisibleAssumption[] {
  return (hypothesis.assumptions ?? [])
    .filter((item) => item.userVisible !== false && item.risk === 'low')
    .map((item) => ({
      key: item.key,
      statement: item.statement,
      risk: 'low' as const,
      userVisible: true as const,
      reversible: item.reversible !== false,
    }));
}

export type { AmbiguityLevel };
