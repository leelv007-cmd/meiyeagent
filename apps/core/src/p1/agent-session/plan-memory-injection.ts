import {
  planMemoryContextSchema,
  type PlanMemoryContext,
} from '@meiye/contracts';
import type { RetrievalExperience } from './context-retrieval.js';

/**
 * Turn confirmed merchant preferences into the constraints a plan can carry.
 *
 * This is where injection either happens or quietly does not. The recognisers
 * below understand two intents; a merchant who confirmed 「别用感叹号」 or
 * 「客单价别写死」 matches neither, and before this module the statement was
 * joined into one string, tested, and dropped — while MemoryInjectionReceipt
 * went on recording the memory as injected. The receipt was telling the truth
 * about *reference* and saying nothing about *effect*, and the two read the
 * same on the panel.
 *
 * So the misses are returned, not discarded. Widening the recognisers is a
 * separate job; what this makes possible is knowing how much there is to widen
 * for, and noticing when it changes.
 */

const CONCISE = /简洁|简短|精炼/u;
const RESTRAINED = /克制|不夸张|少夸张/u;

const EXPERIENCE_PREFIX = 'experience:';

export function compilePlanMemoryContext(input: {
  entries: RetrievalExperience[];
  runId: string;
  taskId: string;
  harnessReleaseId: string;
}): PlanMemoryContext | null {
  const confirmed = input.entries.filter(
    (entry) =>
      entry.status === 'confirmed' && entry.ref.startsWith(EXPERIENCE_PREFIX),
  );
  if (confirmed.length === 0) return null;

  // Per entry rather than over one joined string. Both recognisers are single
  // alternations with no newline in them, so a join could never have matched
  // across a boundary — the two booleans are exactly what the previous
  // `.join('\n')` produced. What per-entry evaluation adds is knowing *which*
  // preference produced nothing.
  const recognised = confirmed.map((entry) => ({
    memoryId: entry.ref.slice(EXPERIENCE_PREFIX.length),
    statement: entry.instruction,
    revision: entry.revision,
    concise: CONCISE.test(entry.instruction),
    restrained: RESTRAINED.test(entry.instruction),
  }));
  const concise = recognised.some((item) => item.concise);
  const restrained = recognised.some((item) => item.restrained);

  return planMemoryContextSchema.parse({
    entries: recognised.map((item) => ({
      memoryId: item.memoryId,
      revision: item.revision,
    })),
    unmapped: recognised
      .filter((item) => !item.concise && !item.restrained)
      .map((item) => ({
        memoryId: item.memoryId,
        statement: item.statement,
      })),
    receiptRef: {
      harnessReleaseId: input.harnessReleaseId,
      runId: input.runId,
      taskId: input.taskId,
    },
    styleConstraints: {
      forbiddenPhrases: restrained ? ['绝对', '保证', '必然'] : [],
      maxBodyChars: concise ? 32 : 4_000,
      maxSentenceChars: concise ? 24 : 500,
      maxTitleChars: concise ? 24 : 500,
      tones: [
        ...(concise ? (['concise'] as const) : []),
        ...(restrained ? (['restrained'] as const) : []),
      ],
    },
  });
}
