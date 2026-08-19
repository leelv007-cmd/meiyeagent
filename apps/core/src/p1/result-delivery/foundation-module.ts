import {
  adoptIntoContentPackageCommandSchema,
  resultAdjustConfirmCommandSchema,
  resultAdjustCommandSchema,
  resultAdoptCommandSchema,
  resultExportCommandSchema,
  resultPanels,
  reviseContentPackageVisualsCommandSchema,
  type ResultAdjustCommand,
  type ResultAdjustConfirmCommand,
  type ResultAdoptCommand,
  type ResultExportCommand,
} from '@meiye/contracts';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { VisualAdoptionError } from './errors.js';
import {
  assistedPublishResultSchema,
  assistedReceiptBindingSchema,
} from './assisted-receipt.js';
import type { AssistedReceiptService } from './assisted-receipt-service.js';
import type { ResultDeliveryProjectionService } from './result-delivery-projection-service.js';
import type {
  FirstAdoptCommand,
  VisualAdoptionPort,
} from './visual-adoption.js';

function actionName(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A result-delivery action is required.',
    );
  }
  return input.action;
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A result-delivery payload is required.',
    );
  }
  return value as Record<string, unknown>;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new VisualAdoptionError(
      'INVALID_COMMAND',
      parsed.error.message,
      400,
    );
  }
  return parsed.data;
}

/**
 * Independent public FoundationModule seam for visual adoption and delivery.
 * Durable Operations adapters stay behind the injected ports (S1 freeze).
 */
export class ResultDeliveryFoundationModule implements P1OperationModule {
  readonly name = 'result-delivery';

  constructor(
    private readonly visualAdoption: VisualAdoptionPort,
    private readonly options: {
      assistedReceipts?: AssistedReceiptService;
      commands?: {
        adopt(
          context: P1Context,
          input: ResultAdoptCommand,
          idempotencyKey: string,
        ): Promise<unknown>;
        adjust(
          context: P1Context,
          input: ResultAdjustConfirmCommand,
          idempotencyKey: string,
        ): Promise<unknown>;
        prepareAdjust(
          context: P1Context,
          input: ResultAdjustCommand,
          idempotencyKey: string,
        ): Promise<unknown>;
        exportPackage(
          context: P1Context,
          input: ResultExportCommand,
          idempotencyKey: string,
        ): Promise<unknown>;
      };
      projections?: ResultDeliveryProjectionService;
    } = {},
  ) {}

  projectCommandReplay(args: {
    input: Record<string, unknown>;
    value: unknown;
  }) {
    return args.input.action === 'assisted_consume_handoff'
      ? { kind: 'consumed' as const }
      : args.value;
  }

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    const action = actionName(args.input);
    const value = payload(args.input);

    switch (action) {
      case 'adopt_into_content_package': {
        // First-adopt path — same command name/payload as operations, via port.
        const command = parse(adoptIntoContentPackageCommandSchema, value);
        return this.visualAdoption.firstAdopt(
          args.context,
          command satisfies FirstAdoptCommand,
          args.idempotencyKey,
        );
      }
      case 'revise_content_package_visuals': {
        const command = parse(reviseContentPackageVisualsCommandSchema, value);
        return this.visualAdoption.reviseContentPackageVisuals(
          args.context,
          command,
          args.idempotencyKey,
        );
      }
      case 'result_adopt':
        return this.requireCommands().adopt(
          args.context,
          parse(resultAdoptCommandSchema, value),
          args.idempotencyKey,
        );
      case 'result_adjust':
        return this.requireCommands().adjust(
          args.context,
          parse(resultAdjustConfirmCommandSchema, value),
          args.idempotencyKey,
        );
      case 'result_adjust_prepare':
        return this.requireCommands().prepareAdjust(
          args.context,
          parse(resultAdjustCommandSchema, value),
          args.idempotencyKey,
        );
      case 'result_export':
        return this.requireCommands().exportPackage(
          args.context,
          parse(resultExportCommandSchema, value),
          args.idempotencyKey,
        );
      case 'assisted_prepare': {
        const input = parse(
          z
            .object({
              id: z.string().trim().min(1).optional(),
              packageId: z.string().trim().min(1),
              contentPackageRevision: z.number().int().nonnegative(),
              exportReceiptId: z.string().trim().min(1),
              occurredAt: z.iso.datetime(),
              platform: z.enum(['xiaohongshu', 'douyin', 'video_account']),
              variantVersionId: z.string().trim().min(1),
            })
            .strict(),
          value,
        );
        return this.requireAssistedReceipts().prepare(args.context, input);
      }
      case 'assisted_hand_over': {
        const input = parse(
          z
            .object({
              receiptId: z.string().trim().min(1),
              expectedRevision: z.number().int().nonnegative(),
              binding: assistedReceiptBindingSchema,
              occurredAt: z.iso.datetime(),
              issueHandoffLink: z.boolean().optional(),
              linkToken: z.string().trim().min(16).optional(),
            })
            .strict(),
          value,
        );
        return this.requireAssistedReceipts().handOver(args.context, input);
      }
      case 'assisted_mark_pending': {
        const input = parse(
          z
            .object({
              receiptId: z.string().trim().min(1),
              expectedRevision: z.number().int().nonnegative(),
              occurredAt: z.iso.datetime(),
            })
            .strict(),
          value,
        );
        return this.requireAssistedReceipts().markPending(args.context, input);
      }
      case 'assisted_record_publish_result': {
        const input = parse(
          z
            .object({
              receiptId: z.string().trim().min(1),
              expectedRevision: z.number().int().nonnegative(),
              result: assistedPublishResultSchema,
            })
            .strict(),
          value,
        );
        return this.requireAssistedReceipts().recordPublishResult(
          args.context,
          input,
        );
      }
      case 'assisted_consume_handoff': {
        const input = parse(
          z
            .object({
              token: z.string().trim().min(16),
              now: z.iso.datetime(),
            })
            .strict(),
          value,
        );
        return this.requireAssistedReceipts().consume(args.context, input);
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown result-delivery command ${action}.`,
        );
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const action = actionName(args.input);
    const value =
      args.input.payload &&
      typeof args.input.payload === 'object' &&
      !Array.isArray(args.input.payload)
        ? (args.input.payload as Record<string, unknown>)
        : {};

    switch (action) {
      case 'assisted_get': {
        const input = parse(
          z.object({ receiptId: z.string().trim().min(1) }).strict(),
          value,
        );
        return this.requireAssistedReceipts().get(
          args.context,
          input.receiptId,
        );
      }
      case 'assisted_list':
        return this.requireAssistedReceipts().list(args.context);
      case 'assisted_pending_confirm': {
        const input = parse(
          z.object({ now: z.iso.datetime() }).strict(),
          value,
        );
        return this.requireAssistedReceipts().listPendingConfirm(
          args.context,
          input.now,
        );
      }
      case 'result_target_resolve': {
        const input = parse(
          z
            .object({
              target: z
                .object({
                  workId: z.string(),
                  contentId: z.string().trim().min(1).optional(),
                  versionId: z.string().trim().min(1).optional(),
                  panel: z.enum(resultPanels).optional(),
                  focusKey: z.string().trim().min(1).optional(),
                })
                .strict(),
            })
            .strict(),
          value,
        );
        return this.requireProjections().resolveTarget({
          userId: args.context.userId,
          workspaceId: args.context.workspaceId,
          target: input.target,
        });
      }
      case 'recent_list': {
        const input = parse(
          z.object({ viewport: z.enum(['desktop', 'mobile']) }).strict(),
          value,
        );
        return this.requireProjections().listRecent({
          userId: args.context.userId,
          workspaceId: args.context.workspaceId,
          viewport: input.viewport,
        });
      }
      case 'actionable_inbox':
        return this.requireProjections().listActionableInbox({
          userId: args.context.userId,
          workspaceId: args.context.workspaceId,
        });
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown result-delivery query ${action}.`,
        );
    }
  }

  private requireAssistedReceipts() {
    if (!this.options.assistedReceipts) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Assisted receipt persistence is not configured.',
      );
    }
    return this.options.assistedReceipts;
  }

  private requireCommands() {
    if (!this.options.commands) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Canonical Result commands are not configured.',
      );
    }
    return this.options.commands;
  }

  private requireProjections() {
    if (!this.options.projections) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Result delivery projections are not configured.',
      );
    }
    return this.options.projections;
  }
}
