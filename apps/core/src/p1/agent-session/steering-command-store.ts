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
    | 'disabled';
  impactSummary: string;
};

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
};

export class MemorySteeringCommandStore implements SteeringCommandStore {
  readonly #byId = new Map<string, StoredSteeringCommand>();

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
          row.command.taskId === input.taskId,
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
        row.applicationStatus === 'queued_follow_up',
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
}
