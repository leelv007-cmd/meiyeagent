import {
  confirmMemoryCandidateCommandSchema,
  deleteMemoryEntryCommandSchema,
  deleteMemorySourceConversationCommandSchema,
  memoryEntriesPageQuerySchema,
  memoryInjectionReceiptSchema,
  rejectMemoryCandidateCommandSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { AgentMemoryPlatform } from './agent-memory-platform.js';
import type { ReuseMemoryService } from './reuse-memory-service.js';

/** V31-18: injection receipt lookup — exactly one of taskId / runId. */
const injectionReceiptQuerySchema = z
  .object({
    taskId: z.string().trim().min(1).optional(),
    runId: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((input) => Boolean(input.taskId) !== Boolean(input.runId), {
    message: 'Exactly one of taskId or runId is required.',
  });

/** V31-18: revoke an injected memory from future injection. */
const revokeMemoryCommandSchema = z
  .object({
    memoryId: z.string().trim().min(1),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

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

  constructor(
    private readonly memory: ReuseMemoryService,
    /** V31-18 production-wired Agent Memory platform (optional for unit tests). */
    private readonly agentMemory?: AgentMemoryPlatform,
  ) {}

  /** Production AgentMemoryPlatform when assembly-wired; undefined in pure unit tests. */
  get agentMemoryPlatform(): AgentMemoryPlatform | undefined {
    return this.agentMemory;
  }

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
    if (action === 'revoke_memory') {
      const input = parse(revokeMemoryCommandSchema, payload);
      return this.memory.revokePreference(args.context, {
        preferenceId: input.memoryId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: args.idempotencyKey,
      });
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
    if (action === 'injection_receipt') {
      return this.injectionReceiptQuery(args.context, payload);
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown memory query ${action}.`,
    );
  }

  /**
   * V31-18: injection receipt visibility. Receipts are workspace-bound at
   * record time (retrieveForInjection is workspace-filtered), but the receipt
   * row itself carries no workspace column — so ownership is proven by every
   * injected memoryId resolving inside this workspace's own memory ledger.
   * Any foreign memoryId ⇒ cross-workspace leak attempt ⇒ FORBIDDEN.
   */
  private async injectionReceiptQuery(
    context: P1Context,
    payload: object,
  ) {
    if (!this.agentMemory) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Agent Memory platform is not assembled (V31-18).',
      );
    }
    const input = parse(injectionReceiptQuerySchema, payload);
    const receipt = input.taskId
      ? await this.agentMemory.getInjectionReceiptByTask(input.taskId)
      : await this.agentMemory.getInjectionReceiptByRun(input.runId!);
    if (!receipt) return { receipt: null };
    if (receipt.entries.length === 0) return { receipt };

    const view = await this.memory.preferenceView(context.workspaceId);
    const ownIds = new Set<string>([
      ...view.candidates.map((candidate) => candidate.candidateId),
      ...view.preferences.map((preference) => preference.preferenceId),
    ]);
    if (receipt.entries.some((entry) => !ownIds.has(entry.memoryId))) {
      throw new P1DomainError(
        'FORBIDDEN',
        'Injection receipt does not belong to this workspace.',
      );
    }

    const receiptMemoryIds = new Set<string>(
      receipt.entries.map((entry) => entry.memoryId),
    );
    const memoryIdsByCandidateId = new Map<string, string[]>();
    const linkCandidate = (candidateId: string, memoryId: string) => {
      const memoryIds = memoryIdsByCandidateId.get(candidateId) ?? [];
      memoryIds.push(memoryId);
      memoryIdsByCandidateId.set(candidateId, memoryIds);
    };
    for (const candidate of view.candidates) {
      if (receiptMemoryIds.has(candidate.candidateId)) {
        linkCandidate(candidate.candidateId, candidate.candidateId);
      }
    }
    for (const preference of view.preferences) {
      if (receiptMemoryIds.has(preference.preferenceId)) {
        linkCandidate(preference.candidateId, preference.preferenceId);
      }
    }

    const remainingCandidateIds = new Set(memoryIdsByCandidateId.keys());
    const sourceByMemoryId = new Map<
      string,
      {
        preview?: string;
        observedAt?: string;
        deleted: boolean;
      }
    >();
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    // Receipts contain at most 100 entries. Read the existing bounded vault
    // projection and stop as soon as every receipted source is resolved.
    while (remainingCandidateIds.size > 0) {
      const page = await this.memory.memoryEntriesPage(context.workspaceId, {
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
      for (const item of page.items) {
        if (!remainingCandidateIds.delete(item.entryId)) continue;
        const memoryIds = memoryIdsByCandidateId.get(item.entryId) ?? [];
        if (!item.source) continue;
        for (const memoryId of memoryIds) {
          sourceByMemoryId.set(
            memoryId,
            item.source.status === 'deleted'
              ? { deleted: true }
              : {
                  ...(item.source.preview
                    ? { preview: item.source.preview }
                    : {}),
                  ...(item.source.observedAt
                    ? { observedAt: item.source.observedAt }
                    : {}),
                  deleted: false,
                },
          );
        }
      }
      if (remainingCandidateIds.size === 0 || !page.nextCursor) break;
      if (seenCursors.has(page.nextCursor)) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Memory receipt source cursor repeated.',
        );
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    // Source is a read-time projection only: the put-once receipt and its
    // business identity remain the immutable v1 row recorded by Agent Memory.
    return {
      receipt: memoryInjectionReceiptSchema.parse({
        ...receipt,
        entries: receipt.entries.map((entry) => ({
          ...entry,
          ...(sourceByMemoryId.has(entry.memoryId)
            ? { source: sourceByMemoryId.get(entry.memoryId) }
            : {}),
        })),
      }),
    };
  }
}
