/**
 * SteeringCommandStore — sole writer of steering_command semantic fact
 * (V3.1 §23.3 / ownership matrix / V31-16).
 *
 * Append-only. Memory implementation is test-only; production uses Postgres.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  makeSteeringCommandSchema,
  type MakeSteeringCommand,
} from '@meiye/contracts';

export type SteeringCommandStoreErrorCode =
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_COMMAND';

export class SteeringCommandStoreError extends Error {
  constructor(
    readonly code: SteeringCommandStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SteeringCommandStoreError';
  }
}

/**
 * V31-105 §1 (B). One Make task is written under two different ids. The harness
 * records progress and drains the queue under its durable workflow id
 * (`<taskId>:plan-r<n>…`, `harness/workflow-core.ts:2548`,
 * `harness/dbos-workflow.ts:1830`); the merchant's command carries the bare id
 * the browser holds (`steering-service.ts:763`). They are one task, so a lookup
 * arriving from either side has to find the other — until it did, `queued_steer`
 * never drained into Make and the authority projection read an empty progress
 * table, which is what told a merchant "还没开始做" about pages already on screen.
 *
 * Membership is the anchored-prefix test V31-90 settled on for
 * `getLatestForTask`, applied in both directions: equal, or one is the other
 * plus `:` and more. The colon is what stops `…:X` from claiming `…:XY`, and
 * comparing prefixes rather than matching a LIKE pattern stops a
 * caller-supplied id from widening the family with `%` or `_`.
 *
 * This aligns the two keys at the read edge only. Writers still write the id
 * they own — no schema change, no re-keying of existing rows.
 */
export function isSameSteeringTaskFamily(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}:`) ||
    right.startsWith(`${left}:`)
  );
}

export type StoredSteeringCommand = {
  command: MakeSteeringCommand;
  workspaceId: string;
  /** Application status after classifier + queue admission. */
  applicationStatus:
    | 'accepted'
    | 'queued_steer'
    | 'queued_follow_up'
    | 'requires_replan_confirm'
    | 'rejected_unsafe'
    | 'disabled'
    /** A canonical consumer has not yet durably launched this command. */
    | 'consumer_pending';
  impactSummary: string;
};

export type SteeringTaskProgressRow = {
  unitId: string;
  status: 'pending' | 'completed';
  label?: string;
  pageIndex?: number;
};

export type SteeringTaskProgressCursor = {
  justCompletedUnitId: string | null;
  remainingUnitIds: readonly string[];
  allUnitsTerminal: boolean;
  /** Merchant labels / 0-based page order, keyed by unit id when the writer has them. */
  units?: readonly {
    unitId: string;
    label?: string;
    pageIndex?: number;
  }[];
};

function progressMetaByUnitId(
  cursor: SteeringTaskProgressCursor,
): Map<string, { label?: string; pageIndex?: number }> {
  const meta = new Map<string, { label?: string; pageIndex?: number }>();
  for (const unit of cursor.units ?? []) {
    meta.set(unit.unitId, {
      ...(unit.label ? { label: unit.label } : {}),
      ...(typeof unit.pageIndex === 'number' ? { pageIndex: unit.pageIndex } : {}),
    });
  }
  return meta;
}

export function asSteeringTaskProgressRow(input: {
  unitId: string;
  status: 'pending' | 'completed';
  label?: string;
  pageIndex?: number | null;
}): SteeringTaskProgressRow {
  return {
    unitId: input.unitId,
    status: input.status,
    ...(input.label ? { label: input.label } : {}),
    ...(typeof input.pageIndex === 'number' ? { pageIndex: input.pageIndex } : {}),
  };
}

export type SteeringCommandStore = {
  /** Append-only put; identical payload is idempotent replay. */
  put(row: StoredSteeringCommand): Promise<StoredSteeringCommand>;
  getById(commandId: string): Promise<StoredSteeringCommand | null>;
  listByTask(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<StoredSteeringCommand[]>;
  listByThread(input: {
    workspaceId: string;
    threadId: string;
  }): Promise<StoredSteeringCommand[]>;
  /**
   * Pending queue drain: commands still waiting for insertion point.
   * Memory/Postgres both filter by applicationStatus.
   */
  listQueued(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<StoredSteeringCommand[]>;
  /**
   * Mark a queued command as accepted (applied at insertion point).
   * Idempotent when already accepted with same impact summary.
   */
  markApplied(input: {
    commandId: string;
    applicationStatus: StoredSteeringCommand['applicationStatus'];
    impactSummary: string;
  }): Promise<StoredSteeringCommand>;
  /**
   * Server-observed Make progress. Browser projections must never decide
   * whether a steering instruction can change a billable provider attempt.
   */
  recordTaskProgress(input: {
    workspaceId: string;
    taskId: string;
    cursor: SteeringTaskProgressCursor;
  }): Promise<void>;
  getTaskProgress(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<SteeringTaskProgressRow[]>;
};

type MemoryProgressEntry = {
  status: 'pending' | 'completed';
  label?: string;
  pageIndex?: number;
};

function mergeProgressEntry(
  existing: MemoryProgressEntry | undefined,
  next: MemoryProgressEntry,
): MemoryProgressEntry {
  const status =
    existing?.status === 'completed' || next.status === 'completed'
      ? 'completed'
      : next.status;
  return {
    status,
    ...(existing?.label ?? next.label
      ? { label: existing?.label ?? next.label }
      : {}),
    ...(typeof existing?.pageIndex === 'number' ||
    typeof next.pageIndex === 'number'
      ? { pageIndex: existing?.pageIndex ?? next.pageIndex }
      : {}),
  };
}

export class MemorySteeringCommandStore implements SteeringCommandStore {
  readonly #byId = new Map<string, StoredSteeringCommand>();
  readonly #progress = new Map<string, Map<string, MemoryProgressEntry>>();

  async put(row: StoredSteeringCommand): Promise<StoredSteeringCommand> {
    const command = makeSteeringCommandSchema.parse(row.command);
    const existing = this.#byId.get(command.commandId);
    if (existing) {
      if (
        existing.workspaceId === row.workspaceId &&
        isDeepStrictEqual(existing.command, command) &&
        existing.applicationStatus === row.applicationStatus &&
        existing.impactSummary === row.impactSummary
      ) {
        return structuredClone(existing);
      }
      if (
        existing.workspaceId === row.workspaceId &&
        isDeepStrictEqual(existing.command, command)
      ) {
        // Same command, status may advance via markApplied — put is create-only.
        return structuredClone(existing);
      }
      throw new SteeringCommandStoreError(
        'IDEMPOTENCY_CONFLICT',
        `Steering command ${command.commandId} already exists with a different payload.`,
      );
    }
    const stored: StoredSteeringCommand = {
      command,
      workspaceId: row.workspaceId,
      applicationStatus: row.applicationStatus,
      impactSummary: row.impactSummary,
    };
    this.#byId.set(command.commandId, stored);
    return structuredClone(stored);
  }

  async getById(commandId: string): Promise<StoredSteeringCommand | null> {
    const row = this.#byId.get(commandId);
    return row ? structuredClone(row) : null;
  }

  async listByTask(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<StoredSteeringCommand[]> {
    return [...this.#byId.values()]
      .filter(
        (row) =>
          row.workspaceId === input.workspaceId &&
          isSameSteeringTaskFamily(row.command.taskId, input.taskId),
      )
      .map((row) => structuredClone(row))
      .sort((a, b) => a.command.createdAt.localeCompare(b.command.createdAt));
  }

  async listByThread(input: {
    workspaceId: string;
    threadId: string;
  }): Promise<StoredSteeringCommand[]> {
    return [...this.#byId.values()]
      .filter(
        (row) =>
          row.workspaceId === input.workspaceId &&
          row.command.threadId === input.threadId,
      )
      .map((row) => structuredClone(row))
      .sort((a, b) => a.command.createdAt.localeCompare(b.command.createdAt));
  }

  async listQueued(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<StoredSteeringCommand[]> {
    const rows = await this.listByTask(input);
    return rows.filter(
      (row) =>
      row.applicationStatus === 'queued_steer' ||
        row.applicationStatus === 'queued_follow_up' ||
        (row.applicationStatus === 'consumer_pending' &&
          row.command.classification.kind === 'derived_revision'),
    );
  }

  async markApplied(input: {
    commandId: string;
    applicationStatus: StoredSteeringCommand['applicationStatus'];
    impactSummary: string;
  }): Promise<StoredSteeringCommand> {
    const row = this.#byId.get(input.commandId);
    if (!row) {
      throw new SteeringCommandStoreError(
        'NOT_FOUND',
        `Steering command ${input.commandId} was not found.`,
      );
    }
    if (
      row.applicationStatus === input.applicationStatus &&
      row.impactSummary === input.impactSummary
    ) {
      return structuredClone(row);
    }
    if (
      row.applicationStatus === 'accepted' &&
      input.applicationStatus !== 'accepted'
    ) {
      throw new SteeringCommandStoreError(
        'IDEMPOTENCY_CONFLICT',
        `Steering command ${input.commandId} is already accepted.`,
      );
    }
    const next: StoredSteeringCommand = {
      ...row,
      applicationStatus: input.applicationStatus,
      impactSummary: input.impactSummary,
    };
    this.#byId.set(input.commandId, next);
    return structuredClone(next);
  }

  async recordTaskProgress(input: {
    workspaceId: string;
    taskId: string;
    cursor: SteeringTaskProgressCursor;
  }): Promise<void> {
    const key = `${input.workspaceId}:${input.taskId}`;
    const progress = this.#progress.get(key) ?? new Map();
    const meta = progressMetaByUnitId(input.cursor);
    for (const unitId of input.cursor.remainingUnitIds) {
      progress.set(
        unitId,
        mergeProgressEntry(progress.get(unitId), {
          status: 'pending',
          ...meta.get(unitId),
        }),
      );
    }
    if (input.cursor.justCompletedUnitId) {
      progress.set(
        input.cursor.justCompletedUnitId,
        mergeProgressEntry(progress.get(input.cursor.justCompletedUnitId), {
          status: 'completed',
          ...meta.get(input.cursor.justCompletedUnitId),
        }),
      );
    }
    if (input.cursor.allUnitsTerminal) {
      for (const [unitId, entry] of progress) {
        progress.set(unitId, mergeProgressEntry(entry, { status: 'completed' }));
      }
    }
    this.#progress.set(key, progress);
  }

  async getTaskProgress(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<SteeringTaskProgressRow[]> {
    // Progress may sit under the harness workflow id while the caller holds the
    // bare one (or the reverse), so the whole family is merged. A unit that any
    // member reports completed is completed — progress only moves forward, the
    // same way the Postgres upsert refuses to walk 'completed' back.
    const merged = new Map<string, MemoryProgressEntry>();
    const prefix = `${input.workspaceId}:`;
    for (const [key, progress] of this.#progress) {
      if (!key.startsWith(prefix)) continue;
      if (!isSameSteeringTaskFamily(key.slice(prefix.length), input.taskId)) {
        continue;
      }
      for (const [unitId, entry] of progress) {
        merged.set(unitId, mergeProgressEntry(merged.get(unitId), entry));
      }
    }
    return [...merged]
      .map(([unitId, entry]) =>
        asSteeringTaskProgressRow({ unitId, ...entry }),
      )
      .sort((left, right) => left.unitId.localeCompare(right.unitId));
  }
}
