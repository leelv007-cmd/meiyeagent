/**
 * 拟人化交付语言的走查断言清单 (D-116, T31 / #225).
 *
 * The card family is a projection: core owns every sentence a merchant reads
 * (`apps/core/src/p1/harness/merchant-delivery-language.ts`). So this module is
 * deliberately an *assertion* list, not a runtime filter — silently scrubbing a
 * leak on the way to the screen would hide the defect from the very gate that
 * is supposed to catch it, and the cards would stop being a projection.
 *
 * The forbidden set mirrors core's `FORBIDDEN_LANGUAGE` (same labels, so a
 * failure names the same thing on both sides) and adds the internal-identifier
 * shapes that only exist once a card is rendered against a live run.
 */

const FORBIDDEN_LANGUAGE = [
  { label: 'workspace id', pattern: /workspace\s+id/iu },
  { label: 'task id', pattern: /task\s+id/iu },
  { label: 'work id', pattern: /work\s+id/iu },
  { label: 'provider', pattern: /\bprovider\b/iu },
  { label: 'DeepSeek', pattern: /\bdeepseek\b/iu },
  { label: 'HTTP code', pattern: /\bhttp\s*[1-5]\d{2}\b/iu },
  { label: 'workflow', pattern: /\bworkflow\b/iu },
  { label: 'revision', pattern: /\brevision\b/iu },
  { label: 'candidate', pattern: /\bcandidate\b/iu },
  { label: 'schema', pattern: /\bschema\b/iu },
  { label: 'DBOS', pattern: /\bdbos\b/iu },
  { label: 'LLM', pattern: /\bllm\b/iu },
  { label: 'internal cost', pattern: /成本价|毛利/iu },
] as const;

/**
 * Identifier shapes the merchant must never see. D-123 keeps the internal cost
 * baseline off the front end entirely, so a bare currency amount in card copy
 * is a leak too — the merchant-facing unit is 积分, never 元 (D-109 / D-172).
 */
const FORBIDDEN_IDENTIFIERS = [
  { label: 'uuid', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/iu },
  { label: 'harness id', pattern: /\b[\w-]+:s\d+:[\w-]+/u },
  { label: 'ledger key', pattern: /\b(?:store_fact|content_package|task):/iu },
  { label: 'money amount', pattern: /[¥$]\s*\d|\d+(?:\.\d+)?\s*元/u },
] as const;

/**
 * Every label this list can report. Exported so a spec can prove the gate still
 * covers what it claims to cover instead of trusting an empty result.
 */
export const CARD_LANGUAGE_ISSUE_LABELS = [
  ...FORBIDDEN_LANGUAGE.map(({ label }) => label),
  ...FORBIDDEN_IDENTIFIERS.map(({ label }) => label),
] as const;

/**
 * Report every merchant-language violation in one piece of visible card copy.
 * `internalIds` are the run's own identifiers (task / work / package / version):
 * they are only knowable at assertion time, and a card that prints one has
 * leaked an internal ID even though the string looks like nothing in general.
 */
export function cardLanguageIssues(
  text: string,
  internalIds: readonly string[] = []
): string[] {
  const issues: string[] = [...FORBIDDEN_LANGUAGE, ...FORBIDDEN_IDENTIFIERS]
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
  for (const id of internalIds) {
    if (id && text.includes(id)) issues.push(`internal id ${id}`);
  }
  return issues;
}
