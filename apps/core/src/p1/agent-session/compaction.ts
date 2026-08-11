/**
 * Thread compaction (V3.1 §18.3 / U4 / B3).
 *
 * 6-section structured summary + retainedTail self-contained checkpoint.
 * Cost is platform-borne (not merchant credits). Failure keeps the last
 * summary and does not block the turn.
 *
 * Sole writer of working-memory Thread checkpoint — hung on
 * WORKING_MEMORY_CHECKPOINT_WRITE_HOOK from the memory platform (V31-18).
 */

import { WORKING_MEMORY_CHECKPOINT_WRITE_HOOK } from '../operations/agent-memory-platform.js';
import type { AgentSessionStore } from './agent-session-store.js';

export const THREAD_COMPACTION_SCHEMA_VERSION =
  'thread-compaction-checkpoint/v1' as const;

export const COMPACTION_SECTION_KEYS = [
  'goal',
  'progress',
  'keyDecisions',
  'nextSteps',
  'criticalContext',
  'referencedObjects',
] as const;

export type CompactionSectionKey = (typeof COMPACTION_SECTION_KEYS)[number];

export type CompactionSections = {
  goal: string;
  progress: string;
  keyDecisions: string;
  nextSteps: string;
  criticalContext: string;
  /** Referenced object inventory (plan/task/asset refs). */
  referencedObjects: string[];
};

export type RetainedTailMessage = {
  role: string;
  text: string;
};

export type ThreadCompactionCheckpoint = {
  schemaVersion: typeof THREAD_COMPACTION_SCHEMA_VERSION;
  sections: CompactionSections;
  retainedTail: RetainedTailMessage[];
  /** Mirror of AgentThread.summaryRevision after write. */
  summaryRevision: number;
  /** Token cost attribution (U4=A): always platform. */
  costBearer: 'platform';
  writtenAt: string;
  writerHook: typeof WORKING_MEMORY_CHECKPOINT_WRITE_HOOK;
};

export type CompactionWriteInput = {
  resourceId: string;
  threadId: string;
  sections: CompactionSections;
  retainedTail: RetainedTailMessage[];
  now: string;
  /**
   * Optional prior summary text. On failure we preserve it and do not block.
   */
  previousSummary?: string | null;
};

export type CompactionWriteResult =
  | {
      ok: true;
      checkpoint: ThreadCompactionCheckpoint;
      summary: string;
      summaryRevision: number;
    }
  | {
      ok: false;
      /** Last good summary retained (U4 failure degradation). */
      retainedSummary: string | null;
      error: string;
      blocked: false;
    };

/**
 * Serialize checkpoint into AgentThread.summary (bounded string column).
 */
export function serializeCompactionSummary(
  checkpoint: Omit<ThreadCompactionCheckpoint, 'summaryRevision' | 'writtenAt'> & {
    summaryRevision?: number;
    writtenAt?: string;
  },
): string {
  const s = checkpoint.sections;
  const lines = [
    `Goal: ${s.goal}`,
    `Progress: ${s.progress}`,
    `Key Decisions: ${s.keyDecisions}`,
    `Next Steps: ${s.nextSteps}`,
    `Critical Context: ${s.criticalContext}`,
    `Refs: ${s.referencedObjects.join(', ') || '(none)'}`,
  ];
  return lines.join('\n').slice(0, 8_000);
}

export function parseCompactionSummarySections(
  summary: string | null | undefined,
): Partial<CompactionSections> | null {
  if (!summary?.trim()) return null;
  // Best-effort parse for tests / restore; not a second writer path.
  const pick = (label: string): string | undefined => {
    const match = summary.match(
      new RegExp(`${label}:\\s*(.+?)(?=\\n[A-Z]|$)`, 's'),
    );
    return match?.[1]?.trim();
  };
  return {
    goal: pick('Goal'),
    progress: pick('Progress'),
    keyDecisions: pick('Key Decisions'),
    nextSteps: pick('Next Steps'),
    criticalContext: pick('Critical Context'),
    referencedObjects: (pick('Refs') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && part !== '(none)'),
  };
}

/**
 * Writer for Thread working-memory checkpoints. Production assembly owns the
 * single service instance; persistence still flows only through this class.
 */
export class ThreadCheckpointWriter {
  readonly hookId = WORKING_MEMORY_CHECKPOINT_WRITE_HOOK;

  constructor(private readonly store: AgentSessionStore) {}

  async write(
    input: CompactionWriteInput,
  ): Promise<CompactionWriteResult> {
    try {
      const draft: Omit<
        ThreadCompactionCheckpoint,
        'summaryRevision' | 'writtenAt'
      > & { writtenAt: string } = {
        schemaVersion: THREAD_COMPACTION_SCHEMA_VERSION,
        sections: input.sections,
        retainedTail: input.retainedTail.slice(),
        costBearer: 'platform',
        writtenAt: input.now,
        writerHook: WORKING_MEMORY_CHECKPOINT_WRITE_HOOK,
      };
      const summary = serializeCompactionSummary(draft);
      const thread = await this.store.recordThreadSummary({
        resourceId: input.resourceId,
        threadId: input.threadId,
        summary,
        now: input.now,
      });
      const checkpoint: ThreadCompactionCheckpoint = {
        ...draft,
        summaryRevision: thread.summaryRevision,
      };
      return {
        ok: true,
        checkpoint,
        summary,
        summaryRevision: thread.summaryRevision,
      };
    } catch (error) {
      return {
        ok: false,
        retainedSummary: input.previousSummary ?? null,
        error: error instanceof Error ? error.message : String(error),
        blocked: false,
      };
    }
  }
}
