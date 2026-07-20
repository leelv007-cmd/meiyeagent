/**
 * Unified ResultCommandAdapter (D-085 / D-089 / #99).
 *
 * Wave 0 adapter: pure validation + dispatch table over injected ports.
 * No second Result mutation path — ports map to existing Product Core commands.
 */

import type {
  ResultActionId,
  ResultCommandAdapter,
  ResultCommandInput,
  ResultCommandOutcome,
  ResultTarget,
} from '@meiye/contracts';
import { resultActionIds } from '@meiye/contracts';

/** Port the adapter uses to talk to existing canonical commands. */
export type ResultCommandPort = {
  /**
   * Execute a canonical product command.
   * Implementations own OCC, idempotency registry, ledger, and audit.
   */
  executeCanonical(input: {
    action: ResultActionId;
    target: ResultTarget;
    expectedRevision?: string;
    idempotencyKey: string;
  }): Promise<ResultCommandOutcome>;
};

export type ResultCommandAdapterOptions = {
  port: ResultCommandPort;
  /** Optional live revision lookup for stale detection before dispatch. */
  getCurrentRevision?: (target: ResultTarget) => Promise<string | undefined>;
};

const ACTION_SET = new Set<string>(resultActionIds);

export function isResultActionId(value: string): value is ResultActionId {
  return ACTION_SET.has(value);
}

/**
 * Validate command input before any port call.
 * Rejects unknown actions and missing workId without side effects.
 */
export function validateResultCommandInput(
  input: ResultCommandInput,
): ResultCommandOutcome | null {
  if (!input.target.workId || input.target.workId.trim() === '') {
    return {
      kind: 'rejected',
      code: 'MISSING_WORK_ID',
      message: 'Result command requires a workId target.',
    };
  }
  if (!input.idempotencyKey || input.idempotencyKey.trim() === '') {
    return {
      kind: 'rejected',
      code: 'MISSING_IDEMPOTENCY_KEY',
      message: 'Result command requires an idempotencyKey.',
    };
  }
  if (!isResultActionId(input.action)) {
    return {
      kind: 'rejected',
      code: 'UNKNOWN_ACTION',
      message: `Unknown result action "${String(input.action)}".`,
    };
  }
  return null;
}

/**
 * Create the unified command adapter.
 * All Result Center (and migration-era workbench) mutations must go through it.
 */
export function createResultCommandAdapter(
  options: ResultCommandAdapterOptions,
): ResultCommandAdapter {
  return {
    async execute(input: ResultCommandInput): Promise<ResultCommandOutcome> {
      const invalid = validateResultCommandInput(input);
      if (invalid) return invalid;

      if (input.expectedRevision && options.getCurrentRevision) {
        const current = await options.getCurrentRevision(input.target);
        if (current !== undefined && current !== input.expectedRevision) {
          return {
            kind: 'stale',
            currentRevisionId: current,
            baseRevisionId: input.expectedRevision,
          };
        }
      }

      return options.port.executeCanonical({
        action: input.action,
        target: input.target,
        ...(input.expectedRevision
          ? { expectedRevision: input.expectedRevision }
          : {}),
        idempotencyKey: input.idempotencyKey,
      });
    },
  };
}

/**
 * In-memory recording port for pure adapter tests (no network).
 */
export function createRecordingResultCommandPort(): ResultCommandPort & {
  calls: ResultCommandInput[];
  setOutcome: (outcome: ResultCommandOutcome) => void;
} {
  const calls: ResultCommandInput[] = [];
  let next: ResultCommandOutcome = { kind: 'ok', revisionId: 'rev-1' };
  return {
    calls,
    setOutcome(outcome) {
      next = outcome;
    },
    async executeCanonical(input) {
      calls.push({
        action: input.action,
        target: input.target,
        ...(input.expectedRevision
          ? { expectedRevision: input.expectedRevision }
          : {}),
        idempotencyKey: input.idempotencyKey,
      });
      return next;
    },
  };
}
