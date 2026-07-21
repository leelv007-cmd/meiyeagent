import type { BuildProductQuoteInput } from '@meiye/contracts';

export {
  toPublicProductQuoteSnapshot,
  type PublicProductQuoteSnapshot,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

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
    const quantity = input.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new P1DomainError(
        'INVALID_STATE',
        'quantity must be an integer between 1 and 20.',
      );
    }
    const billingMode =
      input.operation === 'video.generate'
        ? ('per_output_second' as const)
        : ('per_request' as const);
    if (
      billingMode === 'per_output_second' &&
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
          : '1 段竖屏视频';
    return {
      billingMode,
      catalogModelId: model.id,
      catalogModelRevision: view.revisionId,
      currency: model.unitPrice.currency,
      outputCount: quantity,
      outputLabel,
      ...(billingMode === 'per_request'
        ? {
            formulaExpression: `per_request × ${baseUnitRate} × ${quantity} outputs`,
          }
        : {
            formulaExpression: `per_output_second × ${baseUnitRate} × billableSeconds`,
            minChargeSeconds: 2,
            roundingStepSeconds: 1,
            targetSeconds: input.targetSeconds,
          }),
      quoteId: input.quoteId,
      // Product policy is code-owned. Supplier price revision is separate.
      quotePolicyRevision: 'quote.policy@1',
      unitRate: billingMode === 'per_request' ? baseUnitRate * quantity : baseUnitRate,
      workspaceId: input.workspaceId,
    };
  }
}
