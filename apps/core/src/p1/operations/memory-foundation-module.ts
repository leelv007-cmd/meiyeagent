import {
  confirmMemoryCandidateCommandSchema,
  deleteMemoryEntryCommandSchema,
  deleteMemorySourceConversationCommandSchema,
  memoryEntriesPageQuerySchema,
  rejectMemoryCandidateCommandSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { ReuseMemoryService } from './reuse-memory-service.js';

function inputAction(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || !input.action.trim()) {
    throw new P1DomainError('INVALID_STATE', 'A memory action is required.');
  }
  return input.action;
}

function inputPayload(input: Record<string, unknown>) {
  if (
    !input.payload ||
    typeof input.payload !== 'object' ||
    Array.isArray(input.payload)
  ) {
    throw new P1DomainError('INVALID_STATE', 'A memory payload is required.');
  }
  return input.payload;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError('INVALID_STATE', 'Invalid memory payload.');
  }
  return parsed.data;
}

export class MemoryFoundationModule implements P1OperationModule {
  readonly name = 'memory';

  constructor(private readonly memory: ReuseMemoryService) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const action = inputAction(args.input);
    const payload = inputPayload(args.input);
    if (action === 'confirm_candidate') {
      const input = parse(confirmMemoryCandidateCommandSchema, payload);
      return this.memory.confirmPreference(args.context, {
        candidateId: input.entryId,
        preferenceId: `memory-preference-${input.entryId}`,
        expectedRevision: 0,
        positiveExamples: input.positiveExamples,
        negativeExamples: input.negativeExamples,
        idempotencyKey: args.idempotencyKey,
      });
    }
    if (action === 'reject_candidate') {
      const input = parse(rejectMemoryCandidateCommandSchema, payload);
      return this.memory.rejectPreferenceCandidate(args.context, {
        candidateId: input.entryId,
        reason: input.reason,
        idempotencyKey: args.idempotencyKey,
      });
    }
    if (action === 'delete_entry') {
      const input = parse(deleteMemoryEntryCommandSchema, payload);
      return this.memory.deleteMemoryEntry(args.context, input.entryId);
    }
    if (action === 'delete_source_conversation') {
      const input = parse(
        deleteMemorySourceConversationCommandSchema,
        payload,
      );
      return this.memory.deleteMemorySourceConversation(
        args.context,
        input.conversationId,
      );
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown memory command ${action}.`,
    );
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const action = inputAction(args.input);
    const payload = inputPayload(args.input);
    if (action === 'entries_page') {
      return this.memory.memoryEntriesPage(
        args.context.workspaceId,
        parse(memoryEntriesPageQuerySchema, payload),
      );
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown memory query ${action}.`,
    );
  }
}
