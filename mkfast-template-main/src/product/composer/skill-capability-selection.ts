/**
 * Composer draft skill capability-pack selection (Spec E / #380).
 *
 * Zero persistence: selection lives only on the current Composer draft and is
 * frozen into the submission body as `userSelectedSkillRefs`. Only merchant
 * projection items with presentationPolicy=user_selectable may enter the set.
 * explainable is display-only; backend_only never renders.
 */

export type SkillCapabilityKind = 'user_selectable' | 'explainable';

/**
 * Projection items plus defensive extras. Core never returns backend_only, but
 * the row still drops any foreign policy so a stale client cannot render it.
 */
export type SkillCapabilityItemInput = {
  skillId: string;
  skillRevisionRef: string;
  title: string;
  summary: string;
  presentationPolicy: string;
  selectionEligible: boolean;
};

export type SkillCapabilityView = {
  kind: SkillCapabilityKind;
  skillId: string;
  /** Selection identity — never render this in merchant-facing UI. */
  skillRevisionRef: string;
  title: string;
  summary: string;
  selected: boolean;
  /** True only for user_selectable confirm pills. */
  toggleable: boolean;
};

/**
 * Stable, deduped sort for draft/submission skill revision refs.
 * Lexicographic on the ref string — matches server fingerprint discipline.
 */
export function normalizeSelectedSkillRevisionRefs(
  refs: readonly string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of refs) {
    const ref = typeof raw === 'string' ? raw.trim() : '';
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out.sort((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}

/** Eligible revision refs from a merchant projection payload. */
export function eligibleSkillRevisionRefs(
  items: readonly SkillCapabilityItemInput[]
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const item of items) {
    if (
      item.presentationPolicy === 'user_selectable' &&
      item.selectionEligible &&
      item.skillRevisionRef.trim().length > 0
    ) {
      set.add(item.skillRevisionRef);
    }
  }
  return set;
}

/**
 * Drop refs that are no longer eligible (lens change, projection refresh).
 * Does not add anything automatically — zero persistence / no workspace default.
 */
export function pruneSelectedSkillRevisionRefs(
  selected: readonly string[],
  eligible: ReadonlySet<string>
): string[] {
  return normalizeSelectedSkillRevisionRefs(
    selected.filter((ref) => eligible.has(ref))
  );
}

/**
 * Confirm-style toggle: click selects, click again removes.
 * Ignores refs outside the current eligible set (explainable / backend_only /
 * catalog-foreign never enter the draft set).
 */
export function toggleSelectedSkillRevisionRef(
  selected: readonly string[],
  skillRevisionRef: string,
  eligible: ReadonlySet<string>
): string[] {
  const ref = skillRevisionRef.trim();
  if (!ref || !eligible.has(ref)) {
    return normalizeSelectedSkillRevisionRefs(selected);
  }
  const next = new Set(normalizeSelectedSkillRevisionRefs(selected));
  if (next.has(ref)) next.delete(ref);
  else next.add(ref);
  return normalizeSelectedSkillRevisionRefs([...next]);
}

/**
 * Project merchant items into row views. backend_only (and any non-merchant
 * policy) is excluded. explainable never marks selected / never toggleable.
 */
export function projectSkillCapabilityViews(
  items: readonly SkillCapabilityItemInput[],
  selectedRefs: readonly string[]
): SkillCapabilityView[] {
  const selected = new Set(normalizeSelectedSkillRevisionRefs(selectedRefs));
  const views: SkillCapabilityView[] = [];

  for (const item of items) {
    // backend_only and any non-merchant policy: never render.
    if (item.presentationPolicy === 'explainable') {
      views.push({
        kind: 'explainable',
        skillId: item.skillId,
        skillRevisionRef: item.skillRevisionRef,
        title: item.title,
        summary: item.summary,
        selected: false,
        toggleable: false,
      });
      continue;
    }
    if (item.presentationPolicy !== 'user_selectable') continue;
    if (!item.selectionEligible) continue;
    views.push({
      kind: 'user_selectable',
      skillId: item.skillId,
      skillRevisionRef: item.skillRevisionRef,
      title: item.title,
      summary: item.summary,
      selected: selected.has(item.skillRevisionRef),
      toggleable: true,
    });
  }

  return views;
}

/**
 * Build the submission field from draft selection. Only eligible
 * user_selectable refs are kept — unselected draft yields [].
 */
export function userSelectedSkillRefsForSubmission(
  selected: readonly string[],
  items: readonly SkillCapabilityItemInput[]
): string[] {
  return pruneSelectedSkillRevisionRefs(
    selected,
    eligibleSkillRevisionRefs(items)
  );
}

/** Engineering / governance keys that must never appear on the pill surface. */
export const FORBIDDEN_SKILL_PILL_SURFACE_KEYS = [
  'skillRevisionRef',
  'provider',
  'nativeSkillId',
  'contentHash',
  'governance',
  'workflowRevisionRefs',
  'hiddenPrompt',
  'allowedTools',
  'allowed-tools',
  'scripts',
  'SKILL.md',
  'instruction',
  'systemPrompt',
] as const;
