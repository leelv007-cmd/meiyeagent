import type {
  BuildProductQuoteInput,
  ComposerSubmissionSignedFields,
} from '@meiye/contracts';

export {
  toPublicProductQuoteSnapshot,
  type PublicProductQuoteSnapshot,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';

export const publicProductQuoteOperations = [
  'copy.generate',
  'copy.adapt',
  'image.generate',
  'video.generate',
] as const;

export type PublicProductQuoteOperation =
  (typeof publicProductQuoteOperations)[number];

export interface PublicProductQuoteIntent {
  aspectRatio?: '1:1' | '3:4' | '9:16';
  catalogModelId: string;
  operation: PublicProductQuoteOperation;
  quantity?: number;
  quoteId: string;
  submission?: ComposerSubmissionSignedFields;
  targetSeconds?: number;
  workspaceId: string;
}

export interface ProductQuoteAuthority {
  resolve(input: PublicProductQuoteIntent): Promise<BuildProductQuoteInput>;
}

export interface ProductPricingCatalogPort {
  getCatalog(
    workspaceId: string,
    operation: PublicProductQuoteOperation,
  ): Promise<{
    revisionId: string;
    models: Array<{
      id: string;
      unitPrice?: {
        amountMicros: number;
        currency: 'CNY' | 'USD';
        revision: string;
        unit: string;
      };
    }>;
  }>;
}

function debitUnitsFor(
  input: PublicProductQuoteIntent,
  quantity: number,
): BuildProductQuoteInput['debitUnits'] {
  switch (input.submission?.deliverable.kind) {
    case 'image_text_package':
    case 'note':
      return [
        { resource: 'copy', quantity: 1 },
        {
          resource: 'image',
          quantity: input.submission.deliverable.notePageBound ?? quantity,
        },
      ];
    case 'image_set':
    case 'poster':
      return [{ resource: 'image', quantity }];
    case 'video_package':
      return [{ resource: 'video', quantity }];
    case 'copy_document':
      return [{ resource: 'copy', quantity }];
    default:
      if (input.operation === 'image.generate') {
        return [{ resource: 'image', quantity }];
      }
      if (input.operation === 'video.generate') {
        return [{ resource: 'video', quantity }];
      }
      return [{ resource: 'copy', quantity }];
  }
}

/** Resolves every money and policy fact from the current server catalog. */
export class CatalogProductQuoteAuthority implements ProductQuoteAuthority {
  constructor(private readonly catalog: ProductPricingCatalogPort) {}

  async resolve(
    input: PublicProductQuoteIntent,
  ): Promise<BuildProductQuoteInput> {
    const view = await this.catalog.getCatalog(
      input.workspaceId,
      input.operation,
    );
    const model = view.models.find(
      (candidate) => candidate.id === input.catalogModelId,
    );
    if (!model) {
      throw new P1DomainError(
        'NOT_FOUND',
        `CatalogModel ${input.catalogModelId} is not available for ${input.operation}.`,
      );
    }
    if (!model.unitPrice) {
      throw new P1DomainError(
        'INVALID_STATE',
        `CatalogModel ${input.catalogModelId} has no server pricing revision.`,
      );
    }
    if (
      !Number.isSafeInteger(model.unitPrice.amountMicros) ||
      model.unitPrice.amountMicros < 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `CatalogModel ${input.catalogModelId} has invalid server pricing.`,
      );
    }
    if (
      input.quantity !== undefined &&
      input.submission !== undefined &&
      input.quantity !== input.submission.deliverable.quantity
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'quantity must match the signed deliverable quantity.',
      );
    }
    const quantity =
      input.submission?.deliverable.quantity ?? input.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new P1DomainError(
        'INVALID_STATE',
        'quantity must be an integer between 1 and 20.',
      );
    }
    const billingMode = 'per_request' as const;
    if (
      input.operation === 'video.generate' &&
      (input.targetSeconds === undefined ||
        !Number.isFinite(input.targetSeconds) ||
        input.targetSeconds <= 0)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'video.generate quotes require positive targetSeconds.',
      );
    }
    const baseUnitRate = model.unitPrice.amountMicros / 1_000_000;
    const outputLabel =
      input.operation === 'copy.generate'
        ? `${quantity} 条内容候选`
        : input.operation === 'copy.adapt'
          ? '三平台版本'
        : input.operation === 'image.generate'
          ? `${quantity} 张 ${input.aspectRatio ?? '3:4'} 图片`
          : `${quantity} 段竖屏视频`;
    const unitRate =
      input.operation === 'video.generate'
        ? baseUnitRate * (input.targetSeconds as number) * quantity
        : baseUnitRate * quantity;
    return {
      billingMode,
      catalogModelId: model.id,
      catalogModelRevision: view.revisionId,
      currency: model.unitPrice.currency,
      debitUnits: debitUnitsFor(input, quantity),
      outputCount: quantity,
      outputLabel,
      formulaExpression: `per_request × ${unitRate}`,
      ...(input.operation === 'video.generate'
        ? { targetSeconds: input.targetSeconds }
        : {}),
      quoteId: input.quoteId,
      // Product policy is code-owned. Supplier price revision is separate.
      quotePolicyRevision: 'quote.policy@1',
      ...(input.submission
        ? { submissionContractHash: fingerprintValue(input.submission) }
        : {}),
      unitRate,
      workspaceId: input.workspaceId,
    };
  }
}
