import {
  createSensitiveWordCommandSchema,
  deleteSensitiveWordCommandSchema,
  listSensitiveWordsQuerySchema,
  scanSensitiveTextQuerySchema,
  updateSensitiveWordCommandSchema,
} from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { buildSensitiveCheckBar } from './check-bar.js';
import { runGenerationChainSensitiveCheck } from './generation-chain-check.js';
import type { SensitiveWordsRepository } from './repository.js';
import { scanSensitiveText } from './scan.js';

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
  }) {
    const action = actionOf(args.input);
    const payload = payloadOf(args.input);

    if (action === 'create') {
      const command = createSensitiveWordCommandSchema.parse(payload);
      try {
        return await this.repository.create(command);
      } catch (error) {
        throw new P1DomainError(
          'INVALID_STATE',
          error instanceof Error ? error.message : 'Failed to create sensitive word.',
        );
      }
    }

    if (action === 'update') {
      const command = updateSensitiveWordCommandSchema.parse(payload);
      try {
        return await this.repository.update(command);
      } catch (error) {
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
        return await this.repository.delete(command.id);
      } catch (error) {
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
      const query = scanSensitiveTextQuerySchema.parse(payload);
      const lexicon = await this.repository.listEnabled();
      return scanSensitiveText(query.text, lexicon);
    }

    if (action === 'check_bar') {
      const query = scanSensitiveTextQuerySchema.parse(payload);
      const lexicon = await this.repository.listEnabled();
      const chain = runGenerationChainSensitiveCheck({
        text: query.text,
        lexicon,
      });
      return chain.checkBar;
    }

    if (action === 'generation_chain_check') {
      const query = scanSensitiveTextQuerySchema.parse(payload);
      const lexicon = await this.repository.listEnabled();
      return runGenerationChainSensitiveCheck({
        text: query.text,
        lexicon,
      });
    }

    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown sensitive-words query ${action}.`,
    );
  }
}

export { buildSensitiveCheckBar, runGenerationChainSensitiveCheck, scanSensitiveText };
