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
import type { CreditPricing } from '../model-supply/supply-contracts.js';

export const publicProductQuoteOperations = [
  'copy.generate',
  'copy.adapt',
  'image.generate',
  'image.edit',
  'image.reference_transform',
  'video.generate',
  'audio.speech',
  'audio.sfx',
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
      creditPricing?: CreditPricing;
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
    const pricing = model.creditPricing?.[input.operation];
    if (!pricing) {
      throw new P1DomainError(
        'INVALID_STATE',
        `CatalogModel ${input.catalogModelId} has no credit pricing for ${input.operation}.`,
      );
    }
    if (
      !Number.isSafeInteger(pricing.creditCost) ||
      pricing.creditCost < 1 ||
      typeof pricing.failureRefundsCredits !== 'boolean'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `CatalogModel ${input.catalogModelId} has invalid credit pricing.`,
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
    const billableQuantity =
      input.operation === 'image.generate'
        ? input.submission?.deliverable.notePageBound ?? quantity
        : quantity;
    let unitCreditCost = pricing.creditCost;
    if (input.operation === 'video.generate') {
      const targetSeconds = input.targetSeconds;
      if (
        targetSeconds === undefined ||
        !Number.isSafeInteger(targetSeconds) ||
        ![15, 30, 60].includes(targetSeconds)
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'video.generate quotes require a 15, 30, or 60 second target.',
        );
      }
      const durationPricing = pricing.videoCreditCosts?.[
        targetSeconds as 15 | 30 | 60
      ];
      if (
        durationPricing === undefined ||
        !Number.isSafeInteger(durationPricing) ||
        durationPricing < 1
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          `CatalogModel ${input.catalogModelId} has invalid video credit pricing.`,
        );
      }
      unitCreditCost = durationPricing as number;
    }
    const outputLabel = outputLabelFor(input, quantity);
    const creditCost = unitCreditCost * billableQuantity;
    if (!Number.isSafeInteger(creditCost) || creditCost < 1) {
      throw new P1DomainError(
        'INVALID_STATE',
        `CatalogModel ${input.catalogModelId} has an invalid quoted credit cost.`,
      );
    }
    return {
      billingMode,
      catalogModelId: model.id,
      operation: input.operation,
      catalogModelRevision: view.revisionId,
      creditCost,
      failureRefundsCredits: pricing.failureRefundsCredits,
      outputCount: quantity,
      outputLabel,
      formulaExpression: `${unitCreditCost} credits × ${billableQuantity} = ${creditCost} credits`,
      ...(input.operation === 'video.generate'
        ? { targetSeconds: input.targetSeconds }
        : {}),
      quoteId: input.quoteId,
      quotePolicyRevision: 'quote.policy@1',
      ...(input.submission
        ? { submissionContractHash: fingerprintValue(input.submission) }
        : {}),
      unitRate: creditCost,
      workspaceId: input.workspaceId,
    };
  }
}

function outputLabelFor(input: PublicProductQuoteIntent, quantity: number) {
  switch (input.operation) {
    case 'copy.generate':
      return `${quantity} 条内容候选`;
    case 'copy.adapt':
      return `${quantity} 组三平台版本`;
    case 'image.generate':
      return `${quantity} 张 ${input.aspectRatio ?? '3:4'} 图片`;
    case 'image.edit':
      return `${quantity} 张编辑图片`;
    case 'image.reference_transform':
      return `${quantity} 张参考变换图片`;
    case 'video.generate':
      return `${quantity} 段竖屏视频`;
    case 'audio.speech':
      return `${quantity} 段语音`;
    case 'audio.sfx':
      return `${quantity} 段音效`;
  }
}
