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
  type ConsumeHandoffLinkResult,
} from './assisted-receipt.js';
import type { AssistedReceiptService } from './assisted-receipt-service.js';
import type { CanonicalHandoffConsumeResult } from './assisted-canonical-repository.js';
import {
  DELIVERY_ENTRIES,
  DeliveryApplicationError,
  type DeliveryApplication,
} from './delivery-application.js';
import type { ResultDeliveryProjectionService } from './result-delivery-projection-service.js';
import type {
  FirstAdoptCommand,
  VisualAdoptionPort,
} from './visual-adoption.js';

const deliveryEntrySchema = z.enum(DELIVERY_ENTRIES);

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
      deliveryApplication?: DeliveryApplication;
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
        const deliveryApplication = this.options.deliveryApplication;
        if (deliveryApplication) {
          try {
            await deliveryApplication.consume(args.context, {
              approvalReceiptId: input.binding.approvalReceiptId,
              entry: 'result_center',
              packageId: input.binding.packageId,
            });
          } catch (error) {
            if (
              !(error instanceof DeliveryApplicationError) ||
              error.code !== 'APPROVAL_ALREADY_CONSUMED'
            ) {
              throw error;
            }
          }
        }
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
      case 'delivery_prepare_package': {
        const input = parse(
          z
            .object({
              entry: deliveryEntrySchema,
              packageId: z.string().trim().min(1),
              platform: z.enum(['xiaohongshu', 'douyin', 'video_account']),
              variantVersionId: z.string().trim().min(1),
            })
            .strict(),
          value,
        );
        return this.requireDeliveryApplication().preparePackage(
          args.context,
          input,
        );
      }
      case 'delivery_prepare_canonical_handoff': {
        const input = parse(
          z
            .object({
              entry: deliveryEntrySchema,
              expectedRevision: z.number().int().nonnegative(),
              packageId: z.string().trim().min(1),
              platform: z.string().trim().min(1),
              variantVersionId: z.string().trim().min(1),
              workId: z.string().trim().min(1).optional(),
            })
            .strict(),
          value,
        );
        return this.requireDeliveryApplication().prepareCanonicalHandoff(
          args.context,
          input,
        );
      }
      case 'delivery_consume': {
        const input = parse(
          z
            .object({
              approvalReceiptId: z.string().trim().min(1),
              entry: deliveryEntrySchema,
              packageId: z.string().trim().min(1),
            })
            .strict(),
          value,
        );
        return this.requireDeliveryApplication().consume(args.context, input);
      }
      case 'delivery_record_outcome': {
        const input = parse(
          z
            .object({
              entry: deliveryEntrySchema,
              expectedRevision: z.number().int().nonnegative(),
              note: z.string().trim().min(1).optional(),
              packageId: z.string().trim().min(1),
              platform: z.string().trim().min(1),
              platformUrl: z.string().trim().min(1).optional(),
              variantVersionId: z.string().trim().min(1),
              workId: z.string().trim().min(1).optional(),
            })
            .strict(),
          value,
        );
        return this.requireDeliveryApplication().recordOutcome(
          args.context,
          input,
        );
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
        return projectAssistedConsumeEnvelope(
          await this.requireAssistedReceipts().consume(args.context, input),
        );
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
      case 'delivery_project_state': {
        const input = parse(
          z
            .object({
              approvalReceiptId: z.string().trim().min(1),
              entry: deliveryEntrySchema,
              packageId: z.string().trim().min(1),
            })
            .strict(),
          value,
        );
        return this.requireDeliveryApplication().projectState(
          args.context,
          input,
        );
      }
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

  private requireDeliveryApplication() {
    if (!this.options.deliveryApplication) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Delivery application is not configured.',
      );
    }
    return this.options.deliveryApplication;
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

function projectAssistedConsumeEnvelope(
  result: CanonicalHandoffConsumeResult | ConsumeHandoffLinkResult,
): CanonicalHandoffConsumeResult | ConsumeHandoffLinkResult {
  if (result.kind !== 'ok') return result;
  if ('handoff' in result && result.handoff?.assistedReceipt) {
    return result;
  }
  const receipt = result.receipt;
  const token = receipt.handoffLink?.token ?? '';
  const platform =
    receipt.binding?.platform ??
    receipt.canonicalTarget?.platform ??
    'xiaohongshu';
  return {
    handoff: {
      assistedReceipt: receipt,
      body: '',
      checklist: [],
      contentPackageRevision:
        receipt.binding?.contentPackageRevision ??
        receipt.canonicalTarget?.contentPackageRevision ??
        0,
      conversionText: '',
      expiresAt: receipt.handoffLink?.expiresAt ?? '',
      exportReceiptId: receipt.exportReceiptId ?? `copy:${receipt.packageId}`,
      media: [],
      packageId: receipt.packageId,
      platform,
      sharePath: token
        ? `/dashboard/handoff/${encodeURIComponent(token)}`
        : '',
      title: '',
      token,
      topics: [],
      variantVersionId:
        receipt.binding?.variantVersionId ??
        receipt.canonicalTarget?.variantVersionId ??
        '',
    },
    kind: 'ok',
    receipt,
    revision: 'revision' in result ? result.revision : 0,
  };
}
