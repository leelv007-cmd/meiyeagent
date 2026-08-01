/**
 * Task-in experience surfaces — P2-13 / D5 / xhs-spec §8.3.
 *
 * Three merchant-facing slots inside a task (方案二):
 *   1. Pre-execution basis — what this run will reference
 *   2. Post-delivery sedimentation — non-blocking "remember this?" suggestions
 *   3. Correction routing — fact vs this-run-only feedback
 *
 * Pure model: no React, no fetch. Producers are optional — when a producer is
 * not ready or returns nothing, project honest empty states. Never invent chips
 * or correction classifications the server did not supply.
 */

export type ExperienceChip = {
  id: string;
  label: string;
};

export type ExperienceSurfaceState = 'loading' | 'empty' | 'ready';

export type ExperienceBasisProjection = {
  state: ExperienceSurfaceState;
  chips: ExperienceChip[];
};

export type ExperienceSedimentItem = {
  id: string;
  label: string;
};

export type ExperienceSedimentProjection = {
  state: ExperienceSurfaceState;
  items: ExperienceSedimentItem[];
};

/** Command guard: only current task-projected pending entries are actionable. */
export function canActOnExperienceSediment(
  projection: ExperienceSedimentProjection,
  entryId: string
): boolean {
  return (
    projection.state === 'ready' &&
    projection.items.some((item) => item.id === entryId)
  );
}

export type ExperienceCorrectionKind = 'fact' | 'task_only';

export type ExperienceCorrectionProjection = {
  state: ExperienceSurfaceState;
  kind: ExperienceCorrectionKind | null;
  summary: string | null;
};

/** Short merchant label from a memory entry value — never raw JSON. */
export function experienceEntryLabel(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .filter(
        (item): item is string | number | boolean =>
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean'
      )
      .map(String)
      .filter((part) => part.trim().length > 0);
    if (parts.length > 0) return parts.slice(0, 3).join(' · ');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const parts = entries
      .map(([, nested]) => {
        if (typeof nested === 'string' && nested.trim()) return nested.trim();
        if (typeof nested === 'number' || typeof nested === 'boolean') {
          return String(nested);
        }
        return null;
      })
      .filter((part): part is string => Boolean(part));
    if (parts.length > 0) return parts.slice(0, 3).join(' · ');
  }
  return fallback;
}

/**
 * Pre-execution basis: identity voice + confirmed experience chips.
 * `querySettled=false` → loading; settled with zero chips → honest empty.
 */
export function projectExperienceBasis(input: {
  querySettled: boolean;
  identityLabel: string | null;
  confirmedEntries: Array<{ entryId: string; value: unknown }>;
  /** Entry ids the current execution snapshot explicitly consumed. */
  consumedEntryIds: readonly string[] | null;
  maxChips?: number;
}): ExperienceBasisProjection {
  if (!input.querySettled) {
    return { state: 'loading', chips: [] };
  }
  const max = input.maxChips ?? 5;
  const chips: ExperienceChip[] = [];
  if (input.identityLabel?.trim()) {
    chips.push({
      id: 'identity',
      label: input.identityLabel.trim(),
    });
  }
  const consumedEntryIds = new Set(input.consumedEntryIds ?? []);
  for (const entry of input.confirmedEntries) {
    if (chips.length >= max) break;
    if (!consumedEntryIds.has(entry.entryId)) continue;
    chips.push({
      id: entry.entryId,
      label: experienceEntryLabel(entry.value, entry.entryId),
    });
  }
  if (chips.length === 0) {
    return { state: 'empty', chips: [] };
  }
  return { state: 'ready', chips };
}

/**
 * Post-delivery sedimentation: pending candidates the pipeline already wrote.
 * Without a settled producer → loading; settled empty list → honest empty.
 */
export function projectExperienceSediment(input: {
  querySettled: boolean;
  /** Exact source conversation emitted by the current Work + Task run. */
  taskSourceConversationId: string | null;
  pendingEntries: Array<{
    entryId: string;
    sourceConversationId: string | null;
    value: unknown;
  }>;
  maxItems?: number;
}): ExperienceSedimentProjection {
  if (!input.querySettled) {
    return { state: 'loading', items: [] };
  }
  const taskSourceConversationId = input.taskSourceConversationId?.trim();
  if (!taskSourceConversationId) {
    return { state: 'empty', items: [] };
  }
  const max = input.maxItems ?? 3;
  const items = input.pendingEntries
    .filter((entry) => entry.sourceConversationId === taskSourceConversationId)
    .slice(0, max)
    .map((entry) => ({
      id: entry.entryId,
      label: experienceEntryLabel(entry.value, entry.entryId),
    }));
  if (items.length === 0) {
    return { state: 'empty', items: [] };
  }
  return { state: 'ready', items };
}

/**
 * Correction routing: only lights up when a producer classifies the correction.
 * `producerReady=false` always yields honest empty (no auto-split yet).
 */
export function projectExperienceCorrection(input: {
  producerReady: boolean;
  classification: {
    kind: ExperienceCorrectionKind;
    summary: string;
  } | null;
}): ExperienceCorrectionProjection {
  if (!input.producerReady) {
    return { state: 'empty', kind: null, summary: null };
  }
  if (!input.classification) {
    return { state: 'empty', kind: null, summary: null };
  }
  const summary = input.classification.summary.trim();
  if (!summary) {
    return { state: 'empty', kind: null, summary: null };
  }
  return {
    state: 'ready',
    kind: input.classification.kind,
    summary,
  };
}

/** Phases where the pre-exec basis strip is honest to show. */
export function shouldShowExperienceBasis(phase: string): boolean {
  return (
    phase === 'submitting' || phase === 'running' || phase === 'awaiting_answer'
  );
}

/** Delivery phase is the only place non-blocking sediment belongs. */
export function shouldShowExperienceSediment(phase: string): boolean {
  return phase === 'delivered';
}

/**
 * Correction strip is always mountable once a task has started — empty until a
 * classifier producer supplies a fact vs task_only signal.
 */
export function shouldShowExperienceCorrection(phase: string): boolean {
  return phase !== 'idle';
}
