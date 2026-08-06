/**
 * Skill binding matrix resolution (Spec E / #381).
 *
 * Server-side only: one deterministic active binding per skillId for a matched
 * stage/trigger set. Specificity (tenant > industry > global) picks the winner;
 * equal-specificity mode/revision disagreements surface diagnostic conflict
 * codes — never silent browser or server sort-picks.
 *
 * Mode application after winner selection:
 * - disabled: never inject (beats any user selection of that skill)
 * - required: always inject; presence in userSelectedSkillRefs cannot change mode
 *   or double-inject
 * - user_selected: inject only when the merchant selected that revision ref
 */

import type { SkillBinding, SkillTriggerCondition } from './types.js';

/** Stable HTTP/diagnostic code for binding matrix conflicts (projection + admission). */
export const SKILL_BINDING_CONFLICT_CODE = 'SKILL_BINDING_CONFLICT' as const;

export type SkillBindingConflictReason =
  | 'mode_mismatch'
  | 'revision_mismatch';

/**
 * Explicit 4xx when the same skillId has competing active bindings that the
 * server cannot deterministically collapse (same specificity, different mode
 * or revision). Operator-facing message stays Chinese.
 */
export class SkillBindingConflictError extends Error {
  readonly status = 400;
  readonly code = SKILL_BINDING_CONFLICT_CODE;
  readonly details: {
    skillId: string;
    reason: SkillBindingConflictReason;
    bindingIds: string[];
  };

  constructor(
    readonly skillId: string,
    readonly reason: SkillBindingConflictReason,
    bindingIds: readonly string[],
  ) {
    const orderedIds = [...bindingIds].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const detail =
      reason === 'mode_mismatch'
        ? '同一触发槽位存在不同绑定模式，无法确定生效绑定。'
        : '同一触发槽位存在不同 Skill 版本，无法确定生效绑定。';
    super(`Skill 绑定冲突（${skillId}）：${detail}`);
    this.name = 'SkillBindingConflictError';
    this.details = {
      skillId,
      reason,
      bindingIds: orderedIds,
    };
  }
}

/**
 * Trigger specificity: tenant (+2) outranks industry (+1); global is 0.
 * Workflow and stage are filters applied before this score (caller scope).
 */
export function bindingTriggerSpecificity(
  condition: SkillTriggerCondition,
): number {
  return (
    (condition.industryCategory ? 1 : 0) + (condition.tenantId ? 2 : 0)
  );
}

/**
 * Collapse matching active bindings to one winner per skillId.
 *
 * Callers pass already stage/workflow/trigger-matched active bindings.
 * Throws {@link SkillBindingConflictError} on equal-specificity disagreement.
 */
export function selectHighestCertaintyBindings(
  bindings: readonly SkillBinding[],
): Map<string, SkillBinding> {
  const bySkillId = new Map<string, SkillBinding[]>();
  for (const binding of bindings) {
    const group = bySkillId.get(binding.skillId);
    if (group) {
      group.push(binding);
    } else {
      bySkillId.set(binding.skillId, [binding]);
    }
  }

  const winners = new Map<string, SkillBinding>();
  for (const [skillId, group] of bySkillId) {
    winners.set(skillId, pickHighestCertaintyBinding(skillId, group));
  }
  return winners;
}

/**
 * Whether the winning binding injects into the stage allowlist given merchant
 * selection. User refs never change required mode and never revive disabled.
 */
export function isWinningBindingInjected(
  binding: SkillBinding,
  userSelectedSkillRefs: ReadonlySet<string>,
): boolean {
  if (binding.mode === 'disabled') {
    return false;
  }
  if (binding.mode === 'required') {
    return true;
  }
  if (binding.mode === 'user_selected') {
    return userSelectedSkillRefs.has(binding.skillRevisionRef);
  }
  return false;
}

function pickHighestCertaintyBinding(
  skillId: string,
  group: readonly SkillBinding[],
): SkillBinding {
  let bestSpecificity = Number.NEGATIVE_INFINITY;
  const top: SkillBinding[] = [];
  for (const binding of group) {
    const specificity = bindingTriggerSpecificity(binding.triggerCondition);
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      top.length = 0;
      top.push(binding);
    } else if (specificity === bestSpecificity) {
      top.push(binding);
    }
  }

  const ordered = [...top].sort((left, right) =>
    left.bindingId < right.bindingId
      ? -1
      : left.bindingId > right.bindingId
        ? 1
        : 0,
  );
  const head = ordered[0]!;
  for (const candidate of ordered.slice(1)) {
    if (candidate.mode !== head.mode) {
      throw new SkillBindingConflictError(
        skillId,
        'mode_mismatch',
        ordered.map((binding) => binding.bindingId),
      );
    }
    if (candidate.skillRevisionRef !== head.skillRevisionRef) {
      throw new SkillBindingConflictError(
        skillId,
        'revision_mismatch',
        ordered.map((binding) => binding.bindingId),
      );
    }
  }
  return head;
}
