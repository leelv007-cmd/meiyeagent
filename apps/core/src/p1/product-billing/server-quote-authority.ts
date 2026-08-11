import type {
  BuildProductQuoteInput,
  ComposerSubmissionSignedFields,
  ExecutionPlanPackageBilling,
} from '@meiye/contracts';
import { executionPlanPackageBillingSchema } from '@meiye/contracts';

export {
  toPublicProductQuoteSnapshot,
  type PublicProductQuoteSnapshot,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { CreditPricing } from '../model-supply/supply-contracts.js';
import { merchantExecutionInputHashes } from './durable-service.js';

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

/** Server-only package carrier vocabulary; never part of a browser intent. */
type PackageQuoteCarrier = 'note' | 'copy' | 'media';

export interface PublicProductQuoteIntent {
  aspectRatio?: '1:1' | '3:4' | '9:16';
  catalogModelId: string;
  executionInput?: {
    input: Record<string, unknown> | null;
    prompt: string;
  };
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

/**
 * A per-carrier authority issued by server-owned plan/route/rights domains.
 *
 * This is deliberately not a browser intent. The caller must have already
 * selected the operation, catalog model, route, and rights for this exact
 * carrier; package pricing never maps a carrier name to an operation itself.
 */
export interface ServerAuthenticatedPackageCarrierAuthority {
  allocationId: string;
  carrier: PackageQuoteCarrier;
  /** Explicit join key for the per-carrier Make; never inferred from carrier. */
  carrierUnitId?: string;
  catalogModelId: string;
  operation: PublicProductQuoteOperation;
  routeSnapshotRef: string;
  rightsRevisionRefs: readonly string[];
  /** Required by the server catalog when this authority prices video output. */
  targetSeconds?: number;
}

/**
 * Final server-compiled delivery count for one package carrier.
 *
 * The allocation id and carrier must exactly match a server authority. This
 * keeps a late plan change from reusing a quote for a different carrier.
 */
export interface FinalPackageCarrierDeliverable {
  allocationId: string;
  carrier: PackageQuoteCarrier;
  deliveryUnits: number;
}

export interface ServerPackageQuoteIntent {
  quoteId: string;
  workspaceId: string;
  carrierAuthorities: readonly ServerAuthenticatedPackageCarrierAuthority[];
  finalDeliverables: readonly FinalPackageCarrierDeliverable[];
}

/** Server-only authority for a heterogeneous, multi-carrier package quote. */
export interface PackageQuoteAuthority {
  resolvePackage(
    input: ServerPackageQuoteIntent,
  ): Promise<BuildProductQuoteInput>;
}

/**
 * Converts a priced package into the execution-plan allocation contract.
 * `carrierUnitId` is intentionally required here even though the quote
 * authority can price a package without knowing the eventual Make fan-out
 * identity. A compiler must never derive that join key from the carrier name.
 */
export function executionPlanPackageBillingFromQuote(input: {
  quote: BuildProductQuoteInput;
  carrierAuthorities: readonly ServerAuthenticatedPackageCarrierAuthority[];
}): ExecutionPlanPackageBilling {
  const packageContract = input.quote.packageContract;
  if (!packageContract) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Package billing requires a package quote contract.',
    );
  }
  const authorities = new Map<string, ServerAuthenticatedPackageCarrierAuthority>();
  for (const authority of input.carrierAuthorities) {
    const allocationId = authority.allocationId?.trim() ?? '';
    const carrierUnitId = authority.carrierUnitId?.trim() ?? '';
    if (!allocationId || !carrierUnitId || authorities.has(allocationId)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package billing requires one explicit carrier unit id per allocation.',
      );
    }
    authorities.set(allocationId, { ...authority, allocationId, carrierUnitId });
  }
  const allocations = packageContract.allocations.map((allocation) => {
    const authority = authorities.get(allocation.allocationId);
    if (!authority || authority.carrier !== allocation.carrier) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Package billing authority is missing for allocation ${allocation.allocationId}.`,
      );
    }
    return {
      carrierUnitId: authority.carrierUnitId!.trim(),
      ...allocation,
      rightsRevisionRefs: [...allocation.rightsRevisionRefs],
    };
  });
  if (authorities.size !== allocations.length) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Package billing authorities must exactly cover the quote allocations.',
    );
  }
  return executionPlanPackageBillingSchema.parse({
    contractHash: packageContract.contractHash,
    allocations,
  });
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
export class CatalogProductQuoteAuthority
  implements ProductQuoteAuthority, PackageQuoteAuthority
{
  constructor(
    private readonly catalog: ProductPricingCatalogPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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
    if (
      input.submission &&
      input.catalogModelId !== input.submission.catalogModel.id
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'catalogModelId must match the signed submission model.',
      );
    }
    const signedImageOperation = input.submission?.imageOperation;
    if (signedImageOperation && input.operation !== signedImageOperation) {
      throw new P1DomainError(
        'INVALID_STATE',
        'operation must match the signed image operation.',
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
    const expiresAt = new Date(
      this.clock().getTime() + 60 * 60 * 1000,
    ).toISOString();
    const billingMode = 'per_request' as const;
    const billableQuantity =
      input.operation === 'image.generate'
        ? input.submission?.deliverable.notePageBound ?? quantity
        : quantity;
    let unitCreditCost = pricing.creditCost;
    if (input.operation === 'video.generate') {
      const signedTargetSeconds = input.submission?.deliverable.durationSeconds;
      if (
        signedTargetSeconds !== undefined &&
        input.targetSeconds !== undefined &&
        input.targetSeconds !== signedTargetSeconds
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'targetSeconds must match the signed deliverable duration.',
        );
      }
      const targetSeconds = signedTargetSeconds ?? input.targetSeconds;
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
      currency: 'CREDITS',
      creditCost,
      failureRefundsCredits: pricing.failureRefundsCredits,
      outputCount: quantity,
      outputLabel,
      formulaExpression: `${unitCreditCost} credits × ${billableQuantity} = ${creditCost} credits`,
      ...(input.operation === 'video.generate'
        ? {
            targetSeconds:
              input.submission?.deliverable.durationSeconds ?? input.targetSeconds,
          }
        : {}),
      quoteId: input.quoteId,
      quotePolicyRevision: 'quote.policy@1',
      // Merchant execution requires a complete reserved credit quote contract,
      // including submissionContractHash. Composer quotes fingerprint the signed
      // submission; result_adjust / free+deep Selection AI quotes have no signed
      // Composer body — fingerprint the server-priced intent instead so reserve
      // + bind can still produce a complete contract.
      submissionContractHash: input.submission
        ? fingerprintValue(input.submission)
        : fingerprintValue({
            catalogModelId: model.id,
            operation: input.operation,
            quantity,
            quoteId: input.quoteId,
            workspaceId: input.workspaceId,
          }),
      ...(input.executionInput
        ? (() => {
            const hashes = merchantExecutionInputHashes(input.executionInput);
            return {
              submissionInputAssetsHash: hashes.inputAssetsHash,
              submissionPromptHash: hashes.promptHash,
              submissionReferenceAssetsHash: hashes.referenceAssetsHash,
            };
          })()
        : {}),
      unitRate: creditCost,
      workspaceId: input.workspaceId,
      expiresAt,
    };
  }

  /**
   * Builds a package root only from final deliverables paired with their
   * server-authenticated carrier authorities. A package has no representative
   * carrier: every allocation is catalog-priced independently and the root is
   * merely an exact total of those allocations.
   */
  async resolvePackage(
    input: ServerPackageQuoteIntent,
  ): Promise<BuildProductQuoteInput> {
    const quoteId = requireNonEmptyPackageField(input.quoteId, 'quoteId');
    const workspaceId = requireNonEmptyPackageField(
      input.workspaceId,
      'workspaceId',
    );
    if (
      !Array.isArray(input.carrierAuthorities) ||
      !Array.isArray(input.finalDeliverables)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote requires server carrier authorities and final deliverables.',
      );
    }
    const authorities = packageAuthoritiesByAllocation(
      input.carrierAuthorities,
    );
    const deliverables = packageDeliverablesByAllocation(
      input.finalDeliverables,
    );

    if (authorities.size === 0 || deliverables.size === 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote requires a server authority and final deliverable for every carrier.',
      );
    }
    if (authorities.size !== deliverables.size) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote carrier authorities must exactly cover final deliverables.',
      );
    }

    const allocations = await Promise.all(
      [...deliverables.values()]
        .sort((left, right) => left.allocationId.localeCompare(right.allocationId))
        .map(async (deliverable) => {
          const authority = authorities.get(deliverable.allocationId);
          if (!authority || authority.carrier !== deliverable.carrier) {
            throw new P1DomainError(
              'INVALID_STATE',
              `Package quote is missing the server authority for allocation ${deliverable.allocationId}.`,
            );
          }
          validatePackageCarrierAuthority(authority);
          const priced = await this.resolve({
            catalogModelId: authority.catalogModelId,
            operation: authority.operation,
            quantity: deliverable.deliveryUnits,
            quoteId: `${quoteId}:${authority.allocationId}`,
            ...(authority.targetSeconds !== undefined
              ? { targetSeconds: authority.targetSeconds }
              : {}),
            workspaceId,
          });

          if (
            priced.creditCost === undefined ||
            priced.failureRefundsCredits === undefined ||
            !priced.catalogModelRevision ||
            !priced.operation
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              `Catalog pricing did not produce a complete package allocation for ${authority.allocationId}.`,
            );
          }

          return {
            allocationId: authority.allocationId,
            carrier: authority.carrier,
            deliveryUnits: deliverable.deliveryUnits,
            creditCost: priced.creditCost,
            failureRefundsCredits: priced.failureRefundsCredits,
            operation: priced.operation,
            catalogModel: {
              id: priced.catalogModelId,
              revision: priced.catalogModelRevision,
            },
            routeSnapshotRef: authority.routeSnapshotRef.trim(),
            rightsRevisionRefs: authority.rightsRevisionRefs.map((reference) =>
              reference.trim(),
            ),
          };
        }),
    );

    const totalDeliveryUnits = allocations.reduce(
      (total, allocation) => total + allocation.deliveryUnits,
      0,
    );
    const totalCreditCost = allocations.reduce(
      (total, allocation) => total + allocation.creditCost,
      0,
    );
    if (
      !Number.isSafeInteger(totalDeliveryUnits) ||
      totalDeliveryUnits < 1 ||
      !Number.isSafeInteger(totalCreditCost) ||
      totalCreditCost < 1
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote allocations produced invalid root totals.',
      );
    }

    const packageContract = {
      allocations,
      contractHash: fingerprintValue({
        allocations,
        quoteId,
        schema: 'product_quote_package@1',
        workspaceId,
      }),
    };
    const expiresAt = new Date(
      this.clock().getTime() + 60 * 60 * 1000,
    ).toISOString();

    return {
      billingMode: 'per_request',
      catalogModelId: `package:${packageContract.contractHash}`,
      catalogModelRevision: `package:${packageContract.contractHash}`,
      creditCost: totalCreditCost,
      failureRefundsCredits: allocations.every(
        (allocation) => allocation.failureRefundsCredits,
      ),
      formulaExpression: `${totalDeliveryUnits} delivery units = ${totalCreditCost} credits`,
      operation: 'package.execute',
      outputCount: totalDeliveryUnits,
      outputLabel: `${totalDeliveryUnits} 项套餐交付`,
      packageContract,
      quoteId,
      quotePolicyRevision: 'quote.policy@1',
      submissionContractHash: fingerprintValue({
        contractHash: packageContract.contractHash,
        quoteId,
        schema: 'product_quote_package_submission@1',
        workspaceId,
      }),
      unitRate: totalCreditCost,
      workspaceId,
      expiresAt,
    };
  }
}

function requireNonEmptyPackageField(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Package quote requires ${field}.`,
    );
  }
  return normalized;
}

function packageAuthoritiesByAllocation(
  authorities: readonly ServerAuthenticatedPackageCarrierAuthority[],
): Map<string, ServerAuthenticatedPackageCarrierAuthority> {
  const byAllocation = new Map<
    string,
    ServerAuthenticatedPackageCarrierAuthority
  >();
  const carriers = new Set<PackageQuoteCarrier>();
  for (const authority of authorities) {
    const allocationId =
      typeof authority.allocationId === 'string'
        ? authority.allocationId.trim()
        : '';
    if (
      !allocationId ||
      byAllocation.has(allocationId) ||
      carriers.has(authority.carrier)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote requires one unique server authority per carrier allocation.',
      );
    }
    carriers.add(authority.carrier);
    byAllocation.set(allocationId, {
      ...authority,
      allocationId,
    });
  }
  return byAllocation;
}

function packageDeliverablesByAllocation(
  deliverables: readonly FinalPackageCarrierDeliverable[],
): Map<string, FinalPackageCarrierDeliverable> {
  const byAllocation = new Map<string, FinalPackageCarrierDeliverable>();
  const carriers = new Set<PackageQuoteCarrier>();
  for (const deliverable of deliverables) {
    const allocationId =
      typeof deliverable.allocationId === 'string'
        ? deliverable.allocationId.trim()
        : '';
    if (
      !allocationId ||
      byAllocation.has(allocationId) ||
      carriers.has(deliverable.carrier) ||
      !Number.isSafeInteger(deliverable.deliveryUnits) ||
      deliverable.deliveryUnits < 1 ||
      deliverable.deliveryUnits > 20
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Package quote requires one valid final deliverable per carrier allocation.',
      );
    }
    carriers.add(deliverable.carrier);
    byAllocation.set(allocationId, {
      ...deliverable,
      allocationId,
    });
  }
  return byAllocation;
}

function validatePackageCarrierAuthority(
  authority: ServerAuthenticatedPackageCarrierAuthority,
): void {
  if (
    !publicProductQuoteOperations.includes(authority.operation) ||
    typeof authority.catalogModelId !== 'string' ||
    !authority.catalogModelId.trim() ||
    typeof authority.routeSnapshotRef !== 'string' ||
    !authority.routeSnapshotRef.trim() ||
    !Array.isArray(authority.rightsRevisionRefs) ||
    authority.rightsRevisionRefs.length === 0 ||
    authority.rightsRevisionRefs.some(
      (reference) => typeof reference !== 'string' || !reference.trim(),
    )
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Package quote authority ${authority.allocationId} is incomplete.`,
    );
  }
  if (
    authority.operation !== 'video.generate' &&
    authority.targetSeconds !== undefined
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Package quote authority ${authority.allocationId} supplied video duration for a non-video operation.`,
    );
  }
}

function outputLabelFor(input: PublicProductQuoteIntent, quantity: number) {
  switch (input.operation) {
    case 'copy.generate':
      return `${quantity} 条内容候选`;
    case 'copy.adapt':
      return '三平台版本';
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
