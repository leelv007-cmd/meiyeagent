/**
 * ModelContextProjection + context budget (V3.1 §18.2–§18.3).
 *
 * Permission pruning removes forbidden classes before budget ranking.
 * Over-budget lanes are ranked by relevance / freshness / authority — never
 * raw truncation of high-risk facts.
 */

import type { AgentTurnInput } from './turn-contracts.js';

/** Forbidden classes must never enter the model context (V3.1 §18.2). */
export const FORBIDDEN_CONTEXT_KEYS = [
  'providerSecret',
  'providerSecrets',
  'apiKey',
  'apiKeys',
  'otherWorkspaceData',
  'crossWorkspace',
  'unauthorizedCustomerPii',
  'customerRawPii',
  'dbPhysicalKey',
  'physicalKeys',
  'upstreamCost',
  'providerCost',
  'routeSecret',
  'routingSecrets',
  'rawOpLog',
  'rawOperationLog',
  'hiddenReasoning',
  'chainOfThought',
  'fullTranscript',
] as const;

export type ForbiddenContextKey = (typeof FORBIDDEN_CONTEXT_KEYS)[number];

export const CONTEXT_BUDGETS = {
  confirmedFacts: 20,
  assets: 12,
  recentContent: 6,
  confirmedExperience: 8,
  pendingExperience: 3,
} as const;

export type ContextBudgetKey = keyof typeof CONTEXT_BUDGETS;

export type ProjectedFact = {
  ref: string;
  kind: string;
  value: unknown;
  revision?: number | string;
  freshness?: string;
  claimPolicy?: string;
  /** Higher = more relevant for budget ranking. */
  relevance?: number;
  /** ISO timestamp; fresher ranks higher when relevance ties. */
  updatedAt?: string;
  /** Higher authority (system > merchant > model). */
  authorityRank?: number;
};

export type ProjectedAsset = {
  ref: string;
  category?: string;
  description?: string;
  rightsStatus?: string;
  allowedPlatforms?: string[];
  containsPerson?: boolean;
  relevance?: number;
  updatedAt?: string;
  authorityRank?: number;
};

export type ProjectedExperience = {
  ref: string;
  instruction: string;
  status: 'confirmed' | 'pending';
  relevance?: number;
  updatedAt?: string;
  authorityRank?: number;
};

export type ProjectedContent = {
  ref: string;
  summary: string;
  relevance?: number;
  updatedAt?: string;
  authorityRank?: number;
};

export type ModelContextSource = {
  merchantRequest: {
    text: string;
    creationMode?: string;
    language?: string;
  };
  confirmedFacts?: ProjectedFact[];
  assets?: ProjectedAsset[];
  identity?: Record<string, unknown> | null;
  recentContent?: ProjectedContent[];
  experience?: ProjectedExperience[];
  policies?: {
    forbiddenClaims?: string[];
    requiredDisclosures?: string[];
  };
  executionCapabilities?: {
    available?: string[];
    unavailable?: string[];
  };
  goalSummary?: string;
  threadSummary?: string;
  /** Any extra bag — scanned and stripped for forbidden keys. */
  extras?: Record<string, unknown>;
};

export type ModelContextProjection = {
  merchantRequest: ModelContextSource['merchantRequest'];
  confirmedFacts: ProjectedFact[];
  assets: ProjectedAsset[];
  identity: Record<string, unknown> | null;
  recentContent: ProjectedContent[];
  experience: ProjectedExperience[];
  policies: {
    forbiddenClaims: string[];
    requiredDisclosures: string[];
  };
  executionCapabilities: {
    available: string[];
    unavailable: string[];
  };
  goalSummary?: string;
  threadSummary?: string;
  phase: AgentTurnInput['phase'];
  proactiveMode: AgentTurnInput['proactiveMode'];
  /** Names that were stripped during permission prune (audit, not for model). */
  strippedKeys: string[];
};

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return FORBIDDEN_CONTEXT_KEYS.some(
    (forbidden) => forbidden.toLowerCase() === normalized,
  );
}

function stripForbidden(
  value: unknown,
  stripped: string[],
  path = '',
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      stripForbidden(item, stripped, `${path}[${index}]`),
    );
  }
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isForbiddenKey(key)) {
      stripped.push(childPath);
      continue;
    }
    out[key] = stripForbidden(child, stripped, childPath);
  }
  return out;
}

type Rankable = {
  relevance?: number;
  updatedAt?: string;
  authorityRank?: number;
};

function rankScore(item: Rankable): number {
  const relevance = item.relevance ?? 0;
  const authority = item.authorityRank ?? 0;
  const freshness = item.updatedAt
    ? Date.parse(item.updatedAt) / 1_000_000_000
    : 0;
  return relevance * 1_000 + authority * 10 + freshness;
}

function takeBudgeted<T extends Rankable>(
  items: readonly T[] | undefined,
  limit: number,
): T[] {
  if (!items || items.length === 0) return [];
  return [...items]
    .sort((left, right) => rankScore(right) - rankScore(left))
    .slice(0, limit);
}

/**
 * Build the minimal, permission-pruned, budgeted projection for the model.
 */
export function buildModelContextProjection(
  input: Pick<AgentTurnInput, 'phase' | 'proactiveMode' | 'merchantMessage'>,
  source: ModelContextSource,
): ModelContextProjection {
  const strippedKeys: string[] = [];
  const cleanIdentity = stripForbidden(source.identity ?? null, strippedKeys) as
    | Record<string, unknown>
    | null;
  const cleanExtras = source.extras
    ? (stripForbidden(source.extras, strippedKeys) as Record<string, unknown>)
    : undefined;
  // extras never re-enter projection — only used to surface strip audit.
  void cleanExtras;

  const experience = source.experience ?? [];
  const confirmed = experience.filter((item) => item.status === 'confirmed');
  const pending = experience.filter((item) => item.status === 'pending');

  return {
    merchantRequest: {
      text: source.merchantRequest.text || input.merchantMessage,
      ...(source.merchantRequest.creationMode
        ? { creationMode: source.merchantRequest.creationMode }
        : {}),
      ...(source.merchantRequest.language
        ? { language: source.merchantRequest.language }
        : {}),
    },
    confirmedFacts: takeBudgeted(
      source.confirmedFacts,
      CONTEXT_BUDGETS.confirmedFacts,
    ),
    assets: takeBudgeted(source.assets, CONTEXT_BUDGETS.assets),
    identity: cleanIdentity,
    recentContent: takeBudgeted(
      source.recentContent,
      CONTEXT_BUDGETS.recentContent,
    ),
    experience: [
      ...takeBudgeted(confirmed, CONTEXT_BUDGETS.confirmedExperience),
      ...takeBudgeted(pending, CONTEXT_BUDGETS.pendingExperience),
    ],
    policies: {
      forbiddenClaims: source.policies?.forbiddenClaims ?? [],
      requiredDisclosures: source.policies?.requiredDisclosures ?? [],
    },
    executionCapabilities: {
      available: source.executionCapabilities?.available ?? [],
      unavailable: source.executionCapabilities?.unavailable ?? [],
    },
    ...(source.goalSummary ? { goalSummary: source.goalSummary } : {}),
    ...(source.threadSummary ? { threadSummary: source.threadSummary } : {}),
    phase: input.phase,
    proactiveMode: input.proactiveMode,
    strippedKeys,
  };
}
