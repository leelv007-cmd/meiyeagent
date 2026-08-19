/**
 * ARCH-01 / R-P1-13 typed P1 operation registry.
 *
 * Operation key → query/command + input/output + auth + idempotency + handler.
 * First wave covers Store, Composer, Delivery, Credits, and Memory. HTTP URLs
 * stay the existing P1 query/command and Composer routes.
 */
import { z } from 'zod';

import { memoryInjectionReceiptSchema } from './agent-domain.js';
import {
  confirmAssetIntakeFactCommandSchema,
  finalizeStoreIntakeCommandSchema,
} from './asset-intake.js';
import {
  entitlementsProjectionSchema,
  publicCreditBalanceSchema,
} from './billing-balance.js';
import type { P1Module, ProductCapability } from './capability-permission.js';
import { composerDestinationMappingSchema } from './composer-destination.js';
import {
  storeFactKindSchema,
  storeFactSchema,
  storeFactScopeSchema,
  storeFactSourceSchema,
} from './context-bundle.js';
import { merchantCreditDetailSchema } from './merchant-credit-detail.js';
import {
  assetIntakeExperienceQuerySchema,
  assetIntakeExperienceSchema,
  assetParseTaskDraftsQuerySchema,
  assetParseTaskDraftsSchema,
  assetParseTaskQuerySchema,
  parseAssetBatchInputSchema,
  parseSingleAssetCommandSchema,
  parseTaskSchema,
  prepareManualAssetDraftCommandSchema,
} from './parse-service.js';
import { publicProductQuoteSnapshotSchema } from './product-quote.js';
import {
  confirmMemoryCandidateCommandSchema,
  deleteMemoryEntryCommandSchema,
  deleteMemorySourceConversationCommandSchema,
  memoryEntriesPageQuerySchema,
  memoryEntriesPageSchema,
  rejectMemoryCandidateCommandSchema,
} from './reuse-memory.js';
import {
  extractStoreSentenceCommandSchema,
  extractStoreSentenceResultSchema,
} from './store-sentence-extract.js';

const p1JsonResultSchema = z.json();
const p1ObjectPayloadSchema = z.object({}).passthrough();
const storeFactsActiveQuerySchema = z
  .object({
    at: z.iso.datetime(),
    scope: storeFactScopeSchema,
  })
  .strict();
const storeFactHistoryQuerySchema = z
  .object({
    factId: z.string().trim().min(1),
  })
  .strict();
const storeFactAppendCommandSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime().nullable(),
    factId: z.string().trim().min(1),
    kind: storeFactKindSchema,
    key: z.string().trim().min(1),
    revisionKind: z.literal('revocation').optional(),
    scope: storeFactScopeSchema,
    source: storeFactSourceSchema,
    effectiveFrom: z.iso.datetime(),
    value: z.json(),
  })
  .strict();
const storeFactsResultSchema = z.array(storeFactSchema);
const memoryInjectionReceiptQuerySchema = z
  .object({
    runId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
  })
  .strict();
const memoryInjectionReceiptResultSchema = z
  .object({
    receipt: memoryInjectionReceiptSchema.nullable(),
  })
  .strict();
const revokeMemoryCommandSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    memoryId: z.string().trim().min(1),
  })
  .strict();
const quoteIdPayloadSchema = z
  .object({
    quoteId: z.string().trim().min(1),
  })
  .passthrough();
const quoteConfirmPayloadSchema = z
  .object({
    quoteId: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
  })
  .passthrough();
const taskIdPayloadSchema = z
  .object({
    taskId: z.string().trim().min(1),
  })
  .passthrough();
const redemptionCodePayloadSchema = z
  .object({
    code: z.string().trim().min(1),
  })
  .passthrough();
const redemptionVoidPayloadSchema = z
  .object({
    code: z.string().trim().min(1),
    expectedRevision: z.number(),
  })
  .passthrough();
const receiptIdPayloadSchema = z
  .object({
    receiptId: z.string().trim().min(1),
  })
  .strict();
const recentListQuerySchema = z
  .object({
    viewport: z.enum(['desktop', 'mobile']),
  })
  .strict();
const assistedPendingConfirmQuerySchema = z
  .object({
    now: z.iso.datetime(),
  })
  .strict();
const composerSubmitPayloadSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .passthrough();
const composerDestinationPayloadSchema = z
  .object({
    destination: z.string().trim().min(1),
  })
  .passthrough();
const composerTaskIdPayloadSchema = z
  .object({
    taskId: z.string().trim().min(1),
  })
  .passthrough();
const resultTargetResolveQuerySchema = z
  .object({
    target: z
      .object({
        contentId: z.string().trim().min(1).optional(),
        focusKey: z.string().trim().min(1).optional(),
        panel: z.enum(['result', 'adjust', 'delivery', 'history', 'run']).optional(),
        versionId: z.string().trim().min(1).optional(),
        workId: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();
const resultTargetResolveOutcomeSchema = z
  .object({
    kind: z.enum([
      'ok',
      'legacy_readonly',
      'lineage_mismatch',
      'not_found',
      'forbidden',
    ]),
  })
  .passthrough();

export const P1_REGISTRY_OWNED_MODULES = [
  'asset-memory',
  'context',
  'entitlements',
  'memory',
  'product-billing',
  'redemptions',
  'result-delivery',
] as const;

export type P1RegistryOwnedModule = (typeof P1_REGISTRY_OWNED_MODULES)[number];

export function isP1RegistryOwnedModule(
  module: string,
): module is P1RegistryOwnedModule {
  return (P1_REGISTRY_OWNED_MODULES as readonly string[]).includes(module);
}

function moduleOperation<
  const Module extends P1Module,
  const Action extends string,
  const Kind extends 'query' | 'command',
  Input extends z.ZodType,
  Output extends z.ZodType,
>(
  module: Module,
  action: Action,
  kind: Kind,
  fields: {
    auth: ProductCapability | null;
    input: Input;
    output: Output;
    idempotency?: 'none' | 'required';
  },
) {
  const key = `${module}.${action}` as const;
  return {
    key,
    kind,
    module,
    action,
    auth: fields.auth,
    idempotency:
      fields.idempotency ?? (kind === 'command' ? 'required' : 'none'),
    input: fields.input,
    output: fields.output,
    handler: key,
    http: {
      method: 'POST' as const,
      path: (kind === 'query'
        ? '/api/core/p1/query'
        : '/api/core/p1/commands') as
        | '/api/core/p1/query'
        | '/api/core/p1/commands',
    },
  };
}

function composerOperation<
  const Action extends string,
  const Kind extends 'query' | 'command',
  Input extends z.ZodType,
  Output extends z.ZodType,
>(
  action: Action,
  kind: Kind,
  path: string,
  fields: {
    auth: ProductCapability | null;
    input: Input;
    output: Output;
    idempotency?: 'none' | 'required';
  },
) {
  const key = `composer.${action}` as const;
  return {
    key,
    kind,
    module: 'composer' as const,
    action,
    auth: fields.auth,
    idempotency:
      fields.idempotency ?? (kind === 'command' ? 'required' : 'none'),
    input: fields.input,
    output: fields.output,
    handler: key,
    http: {
      method: 'POST' as const,
      path,
    },
  };
}

export const P1_OPERATIONS = {
  'asset-memory.asset_intake_experience': moduleOperation(
    'asset-memory',
    'asset_intake_experience',
    'query',
    {
      auth: 'workspace.read',
      input: assetIntakeExperienceQuerySchema,
      output: assetIntakeExperienceSchema,
    },
  ),
  'asset-memory.asset_parse_task': moduleOperation(
    'asset-memory',
    'asset_parse_task',
    'query',
    {
      auth: 'workspace.read',
      input: assetParseTaskQuerySchema,
      output: parseTaskSchema,
    },
  ),
  'asset-memory.asset_parse_task_drafts': moduleOperation(
    'asset-memory',
    'asset_parse_task_drafts',
    'query',
    {
      auth: 'workspace.read',
      input: assetParseTaskDraftsQuerySchema,
      output: assetParseTaskDraftsSchema,
    },
  ),
  'asset-memory.confirm_asset_intake_fact': moduleOperation(
    'asset-memory',
    'confirm_asset_intake_fact',
    'command',
    {
      auth: null,
      input: confirmAssetIntakeFactCommandSchema,
      output: p1JsonResultSchema,
    },
  ),
  'asset-memory.extract_store_sentence': moduleOperation(
    'asset-memory',
    'extract_store_sentence',
    'command',
    {
      auth: 'content.create',
      input: extractStoreSentenceCommandSchema,
      output: extractStoreSentenceResultSchema,
    },
  ),
  'asset-memory.finalize_store_intake': moduleOperation(
    'asset-memory',
    'finalize_store_intake',
    'command',
    {
      auth: 'content.create',
      input: finalizeStoreIntakeCommandSchema,
      output: p1JsonResultSchema,
    },
  ),
  'asset-memory.parse_single_asset': moduleOperation(
    'asset-memory',
    'parse_single_asset',
    'command',
    {
      auth: 'content.create',
      input: parseSingleAssetCommandSchema,
      output: z
        .object({
          draft: z.record(z.string(), p1JsonResultSchema),
          task: parseTaskSchema.optional(),
        })
        .passthrough(),
    },
  ),
  'asset-memory.prepare_manual_asset_draft': moduleOperation(
    'asset-memory',
    'prepare_manual_asset_draft',
    'command',
    {
      auth: 'content.create',
      input: prepareManualAssetDraftCommandSchema,
      output: z.record(z.string(), p1JsonResultSchema),
    },
  ),
  'asset-memory.prepare_store_profile_import': moduleOperation(
    'asset-memory',
    'prepare_store_profile_import',
    'command',
    {
      auth: 'content.create',
      input: p1ObjectPayloadSchema,
      output: z
        .object({
          batch: z.record(z.string(), p1JsonResultSchema).nullable(),
        })
        .passthrough(),
    },
  ),
  'asset-memory.start_parse_asset_batch': moduleOperation(
    'asset-memory',
    'start_parse_asset_batch',
    'command',
    {
      auth: 'content.create',
      input: parseAssetBatchInputSchema,
      output: parseTaskSchema,
    },
  ),
  'composer.answer_task': composerOperation(
    'answer_task',
    'command',
    '/api/core/p1/composer/tasks/:taskId/answer',
    {
      auth: 'content.create',
      input: composerTaskIdPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'composer.cancel_task': composerOperation(
    'cancel_task',
    'command',
    '/api/core/p1/composer/tasks/:taskId/cancel',
    {
      auth: 'content.create',
      input: composerTaskIdPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'composer.map_destination': composerOperation(
    'map_destination',
    'query',
    '/api/core/p1/composer/destination-map',
    {
      auth: 'content.create',
      input: composerDestinationPayloadSchema,
      output: composerDestinationMappingSchema,
      idempotency: 'none',
    },
  ),
  'composer.revise_task': composerOperation(
    'revise_task',
    'command',
    '/api/core/p1/composer/tasks/:taskId/revise',
    {
      auth: 'content.create',
      input: composerTaskIdPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'composer.start_task': composerOperation(
    'start_task',
    'command',
    '/api/core/p1/composer/tasks/:taskId/start',
    {
      auth: 'content.create',
      input: composerTaskIdPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'composer.submit': composerOperation(
    'submit',
    'command',
    '/api/core/p1/composer/submissions',
    {
      auth: 'content.create',
      input: composerSubmitPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'context.store_fact_append': moduleOperation(
    'context',
    'store_fact_append',
    'command',
    {
      auth: null,
      input: storeFactAppendCommandSchema,
      output: p1JsonResultSchema,
    },
  ),
  'context.store_fact_history': moduleOperation(
    'context',
    'store_fact_history',
    'query',
    {
      auth: 'workspace.read',
      input: storeFactHistoryQuerySchema,
      output: storeFactsResultSchema,
    },
  ),
  'context.store_facts_active': moduleOperation(
    'context',
    'store_facts_active',
    'query',
    {
      auth: 'workspace.read',
      input: storeFactsActiveQuerySchema,
      output: storeFactsResultSchema,
    },
  ),
  'entitlements.auto_top_up': moduleOperation(
    'entitlements',
    'auto_top_up',
    'command',
    {
      auth: 'workspace.billing.manage',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'entitlements.balance': moduleOperation('entitlements', 'balance', 'query', {
    auth: 'workspace.read',
    input: p1ObjectPayloadSchema,
    output: publicCreditBalanceSchema,
  }),
  'entitlements.catalog': moduleOperation('entitlements', 'catalog', 'query', {
    auth: 'workspace.read',
    input: p1ObjectPayloadSchema,
    output: z
      .object({
        addOns: z.array(p1JsonResultSchema).optional(),
        mode: z.string().optional(),
        plans: z.array(p1JsonResultSchema).optional(),
        trialEnabled: z.boolean().optional(),
      })
      .passthrough(),
  }),
  'entitlements.checkout_add_on': moduleOperation(
    'entitlements',
    'checkout_add_on',
    'command',
    {
      auth: 'workspace.billing.manage',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'entitlements.checkout_plan': moduleOperation(
    'entitlements',
    'checkout_plan',
    'command',
    {
      auth: 'workspace.billing.manage',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'entitlements.configure_auto_top_up': moduleOperation(
    'entitlements',
    'configure_auto_top_up',
    'command',
    {
      auth: 'workspace.billing.manage',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'entitlements.credit_detail': moduleOperation(
    'entitlements',
    'credit_detail',
    'query',
    {
      auth: 'workspace.read',
      input: p1ObjectPayloadSchema,
      output: merchantCreditDetailSchema,
    },
  ),
  'entitlements.payment_add_on_grant': moduleOperation(
    'entitlements',
    'payment_add_on_grant',
    'command',
    {
      auth: null,
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'entitlements.payment_grant': moduleOperation(
    'entitlements',
    'payment_grant',
    'command',
    {
      auth: 'workspace.billing.manage',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'entitlements.projection': moduleOperation(
    'entitlements',
    'projection',
    'query',
    {
      auth: 'workspace.read',
      input: p1ObjectPayloadSchema,
      output: entitlementsProjectionSchema,
    },
  ),
  'entitlements.provision_model_defaults': moduleOperation(
    'entitlements',
    'provision_model_defaults',
    'command',
    {
      auth: 'workspace.billing.manage',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'entitlements.register_gift': moduleOperation(
    'entitlements',
    'register_gift',
    'command',
    {
      auth: 'account.commerce.govern',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'memory.confirm_candidate': moduleOperation(
    'memory',
    'confirm_candidate',
    'command',
    {
      auth: 'personal.preferences.manage',
      input: confirmMemoryCandidateCommandSchema,
      output: p1JsonResultSchema,
    },
  ),
  'memory.delete_entry': moduleOperation('memory', 'delete_entry', 'command', {
    auth: 'personal.preferences.manage',
    input: deleteMemoryEntryCommandSchema,
    output: p1JsonResultSchema,
  }),
  'memory.delete_source_conversation': moduleOperation(
    'memory',
    'delete_source_conversation',
    'command',
    {
      auth: 'personal.preferences.manage',
      input: deleteMemorySourceConversationCommandSchema,
      output: p1JsonResultSchema,
    },
  ),
  'memory.entries_page': moduleOperation('memory', 'entries_page', 'query', {
    auth: 'workspace.read',
    input: memoryEntriesPageQuerySchema,
    output: memoryEntriesPageSchema,
  }),
  'memory.injection_receipt': moduleOperation(
    'memory',
    'injection_receipt',
    'query',
    {
      auth: 'workspace.read',
      input: memoryInjectionReceiptQuerySchema,
      output: memoryInjectionReceiptResultSchema,
    },
  ),
  'memory.reject_candidate': moduleOperation(
    'memory',
    'reject_candidate',
    'command',
    {
      auth: 'personal.preferences.manage',
      input: rejectMemoryCandidateCommandSchema,
      output: p1JsonResultSchema,
    },
  ),
  'memory.revoke_memory': moduleOperation('memory', 'revoke_memory', 'command', {
    auth: 'personal.preferences.manage',
    input: revokeMemoryCommandSchema,
    output: p1JsonResultSchema,
  }),
  'product-billing.confirm': moduleOperation(
    'product-billing',
    'confirm',
    'command',
    {
      auth: 'content.create',
      input: quoteConfirmPayloadSchema,
      output: publicProductQuoteSnapshotSchema,
    },
  ),
  'product-billing.get_quote': moduleOperation(
    'product-billing',
    'get_quote',
    'query',
    {
      auth: 'workspace.read',
      input: quoteIdPayloadSchema,
      output: publicProductQuoteSnapshotSchema,
    },
  ),
  'product-billing.get_quote_by_task': moduleOperation(
    'product-billing',
    'get_quote_by_task',
    'query',
    {
      auth: 'workspace.read',
      input: taskIdPayloadSchema,
      output: publicProductQuoteSnapshotSchema,
    },
  ),
  'product-billing.get_usage': moduleOperation(
    'product-billing',
    'get_usage',
    'query',
    {
      auth: 'workspace.read',
      input: taskIdPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'product-billing.quote': moduleOperation(
    'product-billing',
    'quote',
    'command',
    {
      auth: 'content.create',
      input: p1ObjectPayloadSchema,
      output: publicProductQuoteSnapshotSchema,
    },
  ),
  'redemptions.create': moduleOperation('redemptions', 'create', 'command', {
    auth: 'account.commerce.govern',
    input: p1ObjectPayloadSchema,
    output: z.array(z.record(z.string(), p1JsonResultSchema)),
  }),
  'redemptions.list': moduleOperation('redemptions', 'list', 'query', {
    auth: 'account.commerce.govern',
    input: p1ObjectPayloadSchema,
    output: z.array(z.record(z.string(), p1JsonResultSchema)),
  }),
  'redemptions.redeem': moduleOperation('redemptions', 'redeem', 'command', {
    auth: 'workspace.billing.manage',
    input: redemptionCodePayloadSchema,
    output: z
      .object({
        creditGrant: z
          .object({
            originalCredits: z.number(),
            transactionType: z.string(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  }),
  'redemptions.void': moduleOperation('redemptions', 'void', 'command', {
    auth: 'account.commerce.govern',
    input: redemptionVoidPayloadSchema,
    output: p1JsonResultSchema,
  }),
  'result-delivery.actionable_inbox': moduleOperation(
    'result-delivery',
    'actionable_inbox',
    'query',
    {
      auth: 'workspace.read',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.adopt_into_content_package': moduleOperation(
    'result-delivery',
    'adopt_into_content_package',
    'command',
    {
      auth: 'content.review',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.assisted_consume_handoff': moduleOperation(
    'result-delivery',
    'assisted_consume_handoff',
    'command',
    {
      auth: 'publication.handoff',
      input: receiptIdPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.assisted_get': moduleOperation(
    'result-delivery',
    'assisted_get',
    'query',
    {
      auth: 'workspace.read',
      input: receiptIdPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.assisted_hand_over': moduleOperation(
    'result-delivery',
    'assisted_hand_over',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.assisted_list': moduleOperation(
    'result-delivery',
    'assisted_list',
    'query',
    {
      auth: 'workspace.read',
      input: p1ObjectPayloadSchema,
      output: z.array(
        z
          .object({
            receipt: z.record(z.string(), p1JsonResultSchema),
            revision: z.number(),
          })
          .passthrough(),
      ),
    },
  ),
  'result-delivery.assisted_mark_pending': moduleOperation(
    'result-delivery',
    'assisted_mark_pending',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.assisted_pending_confirm': moduleOperation(
    'result-delivery',
    'assisted_pending_confirm',
    'query',
    {
      auth: 'workspace.read',
      input: assistedPendingConfirmQuerySchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.assisted_prepare': moduleOperation(
    'result-delivery',
    'assisted_prepare',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.assisted_record_publish_result': moduleOperation(
    'result-delivery',
    'assisted_record_publish_result',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.delivery_consume': moduleOperation(
    'result-delivery',
    'delivery_consume',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.delivery_prepare_canonical_handoff': moduleOperation(
    'result-delivery',
    'delivery_prepare_canonical_handoff',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.delivery_prepare_package': moduleOperation(
    'result-delivery',
    'delivery_prepare_package',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.delivery_project_state': moduleOperation(
    'result-delivery',
    'delivery_project_state',
    'query',
    {
      auth: 'workspace.read',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.delivery_record_outcome': moduleOperation(
    'result-delivery',
    'delivery_record_outcome',
    'command',
    {
      auth: 'publication.handoff',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.recent_list': moduleOperation(
    'result-delivery',
    'recent_list',
    'query',
    {
      auth: 'workspace.read',
      input: recentListQuerySchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.result_adjust': moduleOperation(
    'result-delivery',
    'result_adjust',
    'command',
    {
      auth: 'content.review',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.result_adjust_prepare': moduleOperation(
    'result-delivery',
    'result_adjust_prepare',
    'command',
    {
      auth: 'content.review',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.result_adopt': moduleOperation(
    'result-delivery',
    'result_adopt',
    'command',
    {
      auth: 'content.review',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
  'result-delivery.result_export': moduleOperation(
    'result-delivery',
    'result_export',
    'command',
    {
      auth: 'content.review',
      input: p1ObjectPayloadSchema,
      output: z
        .object({
          downloadUrl: z.string(),
          receiptId: z.string().optional(),
        })
        .passthrough(),
    },
  ),
  'result-delivery.result_target_resolve': moduleOperation(
    'result-delivery',
    'result_target_resolve',
    'query',
    {
      auth: 'workspace.read',
      input: resultTargetResolveQuerySchema,
      output: resultTargetResolveOutcomeSchema,
    },
  ),
  'result-delivery.revise_content_package_visuals': moduleOperation(
    'result-delivery',
    'revise_content_package_visuals',
    'command',
    {
      auth: 'content.review',
      input: p1ObjectPayloadSchema,
      output: p1JsonResultSchema,
    },
  ),
} as const;

export type P1OperationKey = keyof typeof P1_OPERATIONS;

export class UnregisteredP1OperationError extends Error {
  readonly code = 'UNREGISTERED_OPERATION' as const;

  constructor(readonly operation: string) {
    super(`P1 operation ${operation} is not registered.`);
    this.name = 'UnregisteredP1OperationError';
  }
}

export function isP1OperationKey(value: string): value is P1OperationKey {
  return Object.hasOwn(P1_OPERATIONS, value);
}

export function resolveP1Operation(key: string) {
  if (!isP1OperationKey(key)) {
    throw new UnregisteredP1OperationError(key);
  }
  return P1_OPERATIONS[key];
}

export function resolveP1ModuleOperation(
  module: string,
  action: string,
  kind: 'query' | 'command',
) {
  const key = `${module}.${action}`;
  if (!isP1OperationKey(key)) {
    throw new UnregisteredP1OperationError(key);
  }
  const operation = P1_OPERATIONS[key];
  if (operation.kind !== kind || operation.module !== module) {
    throw new UnregisteredP1OperationError(key);
  }
  return operation;
}

export function lookupRegisteredP1Capability(
  kind: 'query' | 'command',
  module: P1Module,
  action: string,
):
  | { found: true; capability: ProductCapability | null }
  | { found: false } {
  const key = `${module}.${action}`;
  if (!isP1OperationKey(key)) return { found: false };
  const operation = P1_OPERATIONS[key];
  if (operation.kind !== kind || operation.module !== module) {
    return { found: false };
  }
  return { found: true, capability: operation.auth };
}

export function p1HttpPath(
  key: P1OperationKey,
  pathParams?: Record<string, string>,
) {
  let path = P1_OPERATIONS[key].http.path;
  if (pathParams) {
    for (const [name, value] of Object.entries(pathParams)) {
      path = path.replaceAll(`:${name}`, encodeURIComponent(value));
    }
  }
  return path;
}

export function createP1OperationRequest<K extends P1OperationKey>(
  key: K,
  payload: z.input<(typeof P1_OPERATIONS)[K]['input']>,
  options?: { idempotencyKey?: string; pathParams?: Record<string, string> },
) {
  const operation = resolveP1Operation(key);
  const parsed = operation.input.parse(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (operation.kind === 'command' && operation.idempotency === 'required') {
    if (!options?.idempotencyKey) {
      throw new Error(`P1 operation ${key} requires an idempotency key.`);
    }
    headers['idempotency-key'] = options.idempotencyKey;
  }
  if (operation.module === 'composer') {
    return {
      url: p1HttpPath(key, options?.pathParams),
      method: 'POST' as const,
      body: parsed,
      headers,
    };
  }
  return {
    url: operation.http.path,
    method: 'POST' as const,
    body: {
      module: operation.module,
      action: operation.action,
      payload: parsed,
    },
    headers,
  };
}

export type P1OperationInput<K extends P1OperationKey> = z.input<
  (typeof P1_OPERATIONS)[K]['input']
>;
export type P1OperationOutput<K extends P1OperationKey> = z.output<
  (typeof P1_OPERATIONS)[K]['output']
>;

type OperationKind<K extends P1OperationKey> = (typeof P1_OPERATIONS)[K]['kind'];
type OperationModule<K extends P1OperationKey> =
  (typeof P1_OPERATIONS)[K]['module'];
type OperationAction<K extends P1OperationKey> =
  (typeof P1_OPERATIONS)[K]['action'];

export type P1QueryKey = {
  [K in P1OperationKey]: OperationKind<K> extends 'query' ? K : never;
}[P1OperationKey];

export type P1CommandKey = {
  [K in P1OperationKey]: OperationKind<K> extends 'command' ? K : never;
}[P1OperationKey];

export type P1QueryAction<M extends P1RegistryOwnedModule> = {
  [K in P1OperationKey]: OperationModule<K> extends M
    ? OperationKind<K> extends 'query'
      ? OperationAction<K>
      : never
    : never;
}[P1OperationKey];

export type P1CommandAction<M extends P1RegistryOwnedModule> = {
  [K in P1OperationKey]: OperationModule<K> extends M
    ? OperationKind<K> extends 'command'
      ? OperationAction<K>
      : never
    : never;
}[P1OperationKey];

export type P1ModuleQueryOutput<
  M extends P1RegistryOwnedModule,
  A extends P1QueryAction<M>,
> = {
  [K in P1OperationKey]: OperationModule<K> extends M
    ? OperationKind<K> extends 'query'
      ? OperationAction<K> extends A
        ? P1OperationOutput<K>
        : never
      : never
    : never;
}[P1OperationKey];

export type P1ModuleCommandOutput<
  M extends P1RegistryOwnedModule,
  A extends P1CommandAction<M>,
> = {
  [K in P1OperationKey]: OperationModule<K> extends M
    ? OperationKind<K> extends 'command'
      ? OperationAction<K> extends A
        ? P1OperationOutput<K>
        : never
      : never
    : never;
}[P1OperationKey];
