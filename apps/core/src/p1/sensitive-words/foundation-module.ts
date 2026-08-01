import { createHash } from 'node:crypto';

import {
  createSensitiveWordCommandSchema,
  deleteSensitiveWordCommandSchema,
  listSensitiveWordsQuerySchema,
  SENSITIVE_SCAN_LIMITS,
  scanSensitiveTextQuerySchema,
  updateSensitiveWordCommandSchema,
} from '@meiye/contracts';

import { type P1Context, P1DomainError } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { buildSensitiveCheckBar } from './check-bar.js';
import { runGenerationChainSensitiveCheck } from './generation-chain-check.js';
import {
  SensitiveWordsIdempotencyConflictError,
  type SensitiveWordsRepository,
} from './repository.js';
import {
  SensitiveScanLimitError,
  scanSensitiveText,
} from './scan.js';

function failClosedOnScanLimit<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SensitiveScanLimitError) {
      throw new P1DomainError('INVALID_STATE', error.message);
    }
    throw error;
  }
}

function scanQueryOf(payload: Record<string, unknown>) {
  if (
    typeof payload.text === 'string' &&
    payload.text.length > SENSITIVE_SCAN_LIMITS.maxTextLength
  ) {
    const error = new SensitiveScanLimitError(
      'maxTextLength',
      SENSITIVE_SCAN_LIMITS.maxTextLength,
      payload.text.length,
    );
    throw new P1DomainError('INVALID_STATE', error.message);
  }
  return scanSensitiveTextQuerySchema.parse(payload);
}

function actionOf(input: Record<string, unknown>): string {
  const action = input.action;
  if (typeof action !== 'string' || action.length === 0) {
    throw new P1DomainError('INVALID_STATE', 'Sensitive-words action is required.');
  }
  return action;
}

function payloadOf(input: Record<string, unknown>): Record<string, unknown> {
  const payload = input.payload;
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new P1DomainError('INVALID_STATE', 'Sensitive-words payload must be an object.');
  }
  return payload as Record<string, unknown>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function commandPayloadHash(action: string, payload: Record<string, unknown>) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue({ action, payload })))
    .digest('hex');
}

/**
 * Ops CRUD + scan/check-bar queries for the platform sensitive-words lexicon.
 * Object-workspace inline UI is out of scope (#327).
 */
export class SensitiveWordsFoundationModule implements P1OperationModule {
  readonly name = 'sensitive-words';

  constructor(private readonly repository: SensitiveWordsRepository) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    const action = actionOf(args.input);
    const payload = payloadOf(args.input);
    const executeIdempotent = <T>(
      commandAction: 'create' | 'update' | 'delete',
      execute: (repository: SensitiveWordsRepository) => Promise<T>
    ) =>
      args.idempotencyKey
        ? this.repository.executeIdempotentCommand(
            {
              action: commandAction,
              idempotencyKey: args.idempotencyKey,
              payloadHash: commandPayloadHash(action, payload),
              workspaceId: args.context.workspaceId,
            },
            execute
          )
        : execute(this.repository);

    if (action === 'create') {
      const command = createSensitiveWordCommandSchema.parse(payload);
      try {
        return await executeIdempotent('create', (repository) =>
          repository.create(command)
        );
      } catch (error) {
        if (error instanceof SensitiveWordsIdempotencyConflictError) {
          throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
        }
        throw new P1DomainError(
          'INVALID_STATE',
          error instanceof Error ? error.message : 'Failed to create sensitive word.',
        );
      }
    }

    if (action === 'update') {
      const command = updateSensitiveWordCommandSchema.parse(payload);
      try {
        return await executeIdempotent('update', (repository) =>
          repository.update(command)
        );
      } catch (error) {
        if (error instanceof SensitiveWordsIdempotencyConflictError) {
          throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
        }
        const message =
          error instanceof Error ? error.message : 'Failed to update sensitive word.';
        if (/not found/i.test(message)) {
          throw new P1DomainError('NOT_FOUND', message);
        }
        throw new P1DomainError('INVALID_STATE', message);
      }
    }

    if (action === 'delete') {
      const command = deleteSensitiveWordCommandSchema.parse(payload);
      try {
        return await executeIdempotent('delete', (repository) =>
          repository.delete(command.id)
        );
      } catch (error) {
        if (error instanceof SensitiveWordsIdempotencyConflictError) {
          throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
        }
        const message =
          error instanceof Error ? error.message : 'Failed to delete sensitive word.';
        if (/not found/i.test(message)) {
          throw new P1DomainError('NOT_FOUND', message);
        }
        throw new P1DomainError('INVALID_STATE', message);
      }
    }

    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown sensitive-words action ${action}.`,
    );
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const action = actionOf(args.input);
    const payload = payloadOf(args.input);

    if (action === 'list') {
      const query = listSensitiveWordsQuerySchema.parse(payload);
      const items = await this.repository.list(query);
      return { items, total: items.length };
    }

    if (action === 'get') {
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      if (!id) {
        throw new P1DomainError('INVALID_STATE', 'Sensitive word id is required.');
      }
      const item = await this.repository.get(id);
      if (!item) {
        throw new P1DomainError('NOT_FOUND', `Sensitive word ${id} was not found.`);
      }
      return item;
    }

    if (action === 'scan') {
      const query = scanQueryOf(payload);
      const lexicon = await this.repository.listEnabled();
      return failClosedOnScanLimit(() => scanSensitiveText(query.text, lexicon));
    }

    if (action === 'check_bar') {
      const query = scanQueryOf(payload);
      const lexicon = await this.repository.listEnabled();
      const chain = failClosedOnScanLimit(() =>
        runGenerationChainSensitiveCheck({
          text: query.text,
          lexicon,
        }),
      );
      return chain.checkBar;
    }

    if (action === 'generation_chain_check') {
      const query = scanQueryOf(payload);
      const lexicon = await this.repository.listEnabled();
      return failClosedOnScanLimit(() =>
        runGenerationChainSensitiveCheck({
          text: query.text,
          lexicon,
        }),
      );
    }

    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown sensitive-words query ${action}.`,
    );
  }
}

export { buildSensitiveCheckBar, runGenerationChainSensitiveCheck, scanSensitiveText };
