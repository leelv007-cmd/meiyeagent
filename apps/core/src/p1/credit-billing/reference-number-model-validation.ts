import type { CreditPricing } from '../model-supply/supply-contracts.js';
import type { CreditPlanReferenceNumbers } from './credit-plan-catalog.js';

type ReferenceCategory = 'copy' | 'image' | 'video';
type ReferenceOperation = 'copy.generate' | 'image.generate' | 'video.generate';

interface ReferenceModelCatalogPort {
  getCatalog(
    workspaceId: string,
    operation: ReferenceOperation
  ): Promise<{
    models: Array<{ creditPricing?: CreditPricing; id: string }>;
  }>;
}

const referenceRequirements: ReadonlyArray<{
  category: ReferenceCategory;
  operation: ReferenceOperation;
}> = [
  { category: 'copy', operation: 'copy.generate' },
  { category: 'image', operation: 'image.generate' },
  { category: 'video', operation: 'video.generate' },
];

/** Reject a publication that cannot produce truthful suggestions from its catalog model. */
export async function assertReferenceModelsArePriced(
  referenceNumbers: CreditPlanReferenceNumbers,
  catalog: ReferenceModelCatalogPort,
  workspaceId = '__platform_supply__'
) {
  for (const requirement of referenceRequirements) {
    const modelId = referenceNumbers.referenceModels[requirement.category];
    const model = (
      await catalog.getCatalog(workspaceId, requirement.operation)
    ).models.find((candidate) => candidate.id === modelId);
    if (!model) {
      throw new Error(
        `${requirement.category} reference model is not available for ${requirement.operation}.`
      );
    }
    const pricing = model.creditPricing?.[requirement.operation];
    if (!pricing || !positiveInteger(pricing.creditCost)) {
      throw new Error(
        `${requirement.category} reference model has no valid credit price.`
      );
    }
    if (
      requirement.category === 'video' &&
      !positiveInteger(pricing.videoCreditCosts?.[15])
    ) {
      throw new Error(
        'Video reference model requires a 15-second video credit price.'
      );
    }
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
