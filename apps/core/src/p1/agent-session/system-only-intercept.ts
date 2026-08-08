/**
 * System-only action proposal-layer intercept (V3.1 §16.2 / A2).
 *
 * System-only actions are never registered as tools. Detection is closed-set:
 * forbidden intent tokens in model proposals (or generate params implying
 * external side effects). Returns structured block for model re-steer —
 * does not throw the turn.
 */

export const SYSTEM_ONLY_ACTION_KINDS = [
  'reserve_usage',
  'settle_usage',
  'commit_business_fact',
  'grant_rights',
  'publish_external',
  'final_contentpackage_commit',
  'provider_retry_after_unknown',
  // Short aliases accepted in proposals (ticket vocabulary).
  'reserve',
  'settle',
  'commit_fact',
  'publish',
  'final_commit',
] as const;

export type SystemOnlyActionKind = (typeof SYSTEM_ONLY_ACTION_KINDS)[number];

export const SYSTEM_ONLY_GATE_ID = 'system_only_action' as const;

export type SystemOnlyInterceptResult =
  | { blocked: false }
  | {
      blocked: true;
      gateId: typeof SYSTEM_ONLY_GATE_ID;
      reason: string;
      nextAction: 'ask_merchant' | 'propose_plan' | 'finish_turn';
      forbiddenKind: string;
    };

const KIND_SET = new Set<string>(SYSTEM_ONLY_ACTION_KINDS);

function collectCandidates(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= 200) {
      out.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, out);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const key of [
    'kind',
    'action',
    'intent',
    'systemAction',
    'systemOnlyAction',
    'forbiddenIntent',
  ]) {
    if (key in record) collectCandidates(record[key], out);
  }
  // Nested action bags
  if (record.action && typeof record.action === 'object') {
    collectCandidates(record.action, out);
  }
}

/**
 * Scan a model proposal / decision-shaped value for system-only intents.
 */
export function interceptSystemOnlyProposal(
  proposal: unknown,
): SystemOnlyInterceptResult {
  const candidates: string[] = [];
  collectCandidates(proposal, candidates);

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (KIND_SET.has(normalized) || KIND_SET.has(candidate)) {
      return {
        blocked: true,
        gateId: SYSTEM_ONLY_GATE_ID,
        reason: `System-only action "${candidate}" cannot be proposed by the model; only the deterministic orchestrator may emit it.`,
        nextAction: 'ask_merchant',
        forbiddenKind: candidate,
      };
    }
  }

  return { blocked: false };
}
