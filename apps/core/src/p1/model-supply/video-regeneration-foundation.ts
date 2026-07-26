import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type {
  FoundationStore,
  P1OperationModule,
} from '../foundation/ports.js';
import type {
  VideoFreeAction,
  VideoRegenQuoteIntent,
  VideoRegenRetryIntent,
} from './video-regeneration.js';
import { toPublicProductQuoteSnapshot } from '../product-billing/server-quote-authority.js';

const commandEnvelopeSchema = z
  .object({
    action: z.string().trim().min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const quoteSchema = z
  .object({
    actorId: z.string().optional(),
    scope: z.literal('shot'),
    shotId: z.string().trim().min(1).optional(),
    sourceRunId: z.string().trim().min(1),
    workspaceId: z.string().optional(),
  })
  .strict();

const confirmSchema = z
  .object({
    approvalReceiptId: z.string().trim().min(1).optional(),
    quoteId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    workspaceId: z.string().optional(),
  })
  .strict();

const retrySchema = quoteSchema.extend({
  approvalReceiptId: z.string().trim().min(1).optional(),
  quoteId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
});

const recoverSchema = z
  .object({
    supplierTaskRef: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
  })
  .strict();

const freeActionSchema = z
  .object({
    action: z.enum([
      'poll',
      'recover',
      'download_supplier_task',
      'adopt_candidate',
      'deterministic_sort',
      'subtitle_text_edit',
    ]),
    supplierTaskRef: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1),
  })
  .strict();

const taskQuerySchema = z.object({ taskId: z.string().trim().min(1) }).strict();

export interface VideoRegenerationApplicationPort {
  quote(input: VideoRegenQuoteIntent): Promise<unknown>;
  confirmAndDispatch(input: {
    approvalReceiptId?: string;
    quoteId: string;
    taskId: string;
    workspaceId: string;
  }): Promise<unknown>;
  retry(input: VideoRegenRetryIntent): Promise<unknown>;
  recover(input: {
    actorId?: string;
    supplierTaskRef: string;
    taskId: string;
    workspaceId: string;
  }): Promise<unknown>;
  executeFreeAction(input: {
    action: VideoFreeAction;
    actorId?: string;
    supplierTaskRef?: string;
    taskId: string;
    workspaceId: string;
  }): Promise<unknown>;
  getTask(workspaceId: string, taskId: string): Promise<unknown>;
}

/** Public, workspace-scoped seam for the durable regeneration lifecycle. */
export class VideoRegenerationFoundationModule implements P1OperationModule {
  readonly name = 'video-regeneration';

  constructor(private readonly application: VideoRegenerationApplicationPort) {}

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
    store: FoundationStore;
  }) {
    const envelope = parse(commandEnvelopeSchema, args.input);
    switch (envelope.action) {
      case 'quote': {
        const input = parse(quoteSchema, envelope.payload);
        return publicBillingResponse(await this.application.quote({
          ...input,
          actorId: args.context.userId,
          requestId: args.idempotencyKey,
          workspaceId: args.context.workspaceId,
        }));
      }
      case 'confirm': {
        const input = parse(confirmSchema, envelope.payload);
        return publicBillingResponse(await this.application.confirmAndDispatch({
          ...input,
          workspaceId: args.context.workspaceId,
        }));
      }
      case 'recover': {
        const input = parse(recoverSchema, envelope.payload);
        return this.application.recover({
          ...input,
          actorId: args.context.userId,
          workspaceId: args.context.workspaceId,
        });
      }
      case 'retry': {
        const input = parse(retrySchema, envelope.payload);
        return publicBillingResponse(await this.application.retry({
          ...input,
          actorId: args.context.userId,
          requestId: args.idempotencyKey,
          workspaceId: args.context.workspaceId,
        }));
      }
      case 'free_action': {
        const input = parse(freeActionSchema, envelope.payload);
        return this.application.executeFreeAction({
          ...input,
          actorId: args.context.userId,
          workspaceId: args.context.workspaceId,
        });
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unsupported video-regeneration command ${envelope.action}.`,
        );
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
    store: FoundationStore;
  }) {
    const envelope = parse(commandEnvelopeSchema, args.input);
    if (envelope.action !== 'get_task') {
      throw new P1DomainError(
        'INVALID_STATE',
        `Unsupported video-regeneration query ${envelope.action}.`,
      );
    }
    const input = parse(taskQuerySchema, envelope.payload);
    return this.application.getTask(args.context.workspaceId, input.taskId);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError('INVALID_STATE', parsed.error.message);
  }
  return parsed.data;
}

function publicBillingResponse(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const response = value as Record<string, unknown>;
  const quote = response.quote;
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return value;
  return {
    ...response,
    quote: toPublicProductQuoteSnapshot(
      quote as Parameters<typeof toPublicProductQuoteSnapshot>[0],
    ),
  };
}
