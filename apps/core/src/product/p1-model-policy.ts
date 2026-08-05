import {
  normalizeProductEntitlementPolicy,
  type ProductEntitlementPolicy,
  type ProductEntitlementPolicyPort,
} from '../p1/foundation/entitlement-policy.js';
import type {
  AssetDataClassResolverPort,
  CreativeGroundingResolverPort,
  CreativeGroundingResolution,
} from '../p1/operations/index.js';
import {
  hasCurrentRestrictedAssetAuthorization,
  type CreationMode,
} from '@meiye/contracts';
import type { PlanAllowances, ProductPlanConfig } from './plans.js';
import type { ProductRepository } from './repository.js';

export class ProductAssetDataClassResolver
  implements AssetDataClassResolverPort
{
  constructor(private readonly repository: ProductRepository) {}

  async resolve(workspaceId: string, assetId: string) {
    const state = await this.repository.load(workspaceId);
    const asset = state?.assets.find((candidate) => candidate.id === assetId);
    if (!asset) return null;
    const values = new Set<'contains_face' | 'pii' | 'medical'>();
    if (asset.containsPerson) values.add('contains_face');
    if (asset.containsSensitiveData) values.add('pii');
    if (state?.store?.regulated) values.add('medical');
    return [...values];
  }
}

export class ProductCreativeGroundingResolver
  implements CreativeGroundingResolverPort
{
  constructor(
    private readonly repository: ProductRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async resolve(
    workspaceId: string,
    sourceAssetIds: string[],
    creationMode: CreationMode = 'customized'
  ): Promise<CreativeGroundingResolution> {
    const state = await this.repository.load(workspaceId);
    const store = state?.store;
    const confirmedProjects =
      store?.projects.filter((project) => project.confirmed) ?? [];
    const requestedAssetIds = [...new Set(sourceAssetIds)];
    const assets = requestedAssetIds.map((assetId) =>
      state?.assets.find((asset) => asset.id === assetId)
    );
    const realAuthorizedAssets = assets.filter(
      (asset): asset is NonNullable<typeof asset> =>
        Boolean(
          asset &&
            asset.sourceType === 'real' &&
            asset.authorizationStatus === 'authorized' &&
            asset.consentScope !== 'internal_only' &&
            asset.rightsEvidence?.trim() &&
            hasCurrentRestrictedAssetAuthorization(asset, this.clock())
        )
    );
    const missing = new Set<
      | 'confirmed_store'
      | 'confirmed_project'
      | 'confirmed_qualification'
      | 'real_authorized_asset'
    >();
    // D-175: free creation carries no operating context, so store and project
    // facts are waived. Asset rights and regulated qualification are compliance
    // floors and stay enforced in both modes.
    const storeFactsRequired = creationMode !== 'free';
    const storeConfirmed = Boolean(store?.confirmedAt);
    if (storeFactsRequired) {
      if (!storeConfirmed) missing.add('confirmed_store');
      if (confirmedProjects.length === 0) missing.add('confirmed_project');
    }
    if (store?.regulated && !state?.qualification?.confirmed) {
      missing.add('confirmed_qualification');
    }
    if (
      requestedAssetIds.length > 0 &&
      realAuthorizedAssets.length !== requestedAssetIds.length
    ) {
      missing.add('real_authorized_asset');
    }
    if (missing.size > 0 || (storeFactsRequired && !storeConfirmed)) {
      return { missing: [...missing], status: 'missing' };
    }

    const qualification = state?.qualification?.confirmed
      ? {
          admitted: state.qualification.admitted,
          ...(state.qualification.institutionLicense
            ? { institutionLicense: state.qualification.institutionLicense }
            : {}),
          ...(state.qualification.treatmentScope
            ? { treatmentScope: state.qualification.treatmentScope }
            : {}),
          ...(state.qualification.platformCertification
            ? {
                platformCertification:
                  state.qualification.platformCertification,
              }
            : {}),
          ...(state.qualification.advertisingCertificate
            ? {
                advertisingCertificate:
                  state.qualification.advertisingCertificate,
              }
            : {}),
          ...(state.qualification.validUntil
            ? { validUntil: state.qualification.validUntil }
            : {}),
          ...(state.qualification.intakeAt
            ? { intakeAt: state.qualification.intakeAt }
            : {}),
          confirmed: true as const,
        }
      : undefined;
    return {
      snapshot: {
        assets: realAuthorizedAssets.map((asset) => ({
          authorizationStatus: 'authorized' as const,
          ...(asset.category ? { category: asset.category } : {}),
          consentScope: asset.consentScope,
          containsPerson: asset.containsPerson,
          containsSensitiveData: asset.containsSensitiveData,
          id: asset.id,
          minorStatus: asset.minorStatus,
          rightsEvidenceRecorded: true,
          sourceType: 'real' as const,
          tags: [...asset.tags],
        })),
        capturedAt: this.clock().toISOString(),
        ...(qualification ? { qualification } : {}),
        ...(store?.confirmedAt
          ? {
              store: {
                address: store.address,
                booking: store.booking,
                brandVoice: store.brandVoice,
                city: store.city,
                confirmedAt: store.confirmedAt,
                district: store.district,
                name: store.name,
                prohibitions: [...store.prohibitions],
                projects: confirmedProjects.map((project) => ({
                  durationMinutes: project.durationMinutes,
                  id: project.id,
                  name: project.name,
                  price: project.price,
                })),
                regulated: store.regulated,
              },
            }
          : {}),
      },
      status: 'ready',
    };
  }
}

/**
 * Opens Foundation usage from the current Product entitlement projection.
 * Add-ons/top-up remain empty until their Product facts exist; the ledger does
 * not synthesize purchases or charge capacity.
 */
export class ProductStateEntitlementPolicy
  implements ProductEntitlementPolicyPort
{
  constructor(
    private readonly repository: ProductRepository,
    private readonly plans: ProductPlanConfig
  ) {}

  async resolve(workspaceId: string): Promise<ProductEntitlementPolicy> {
    const state = await this.repository.load(workspaceId);
    const tier = (state?.entitlement.plan ??
      'starter') as ProductEntitlementPolicy['tier'];
    const configured = (
      this.plans as unknown as Record<string, PlanAllowances>
    )[tier] ?? this.plans.starter;
    const entitlement = state?.entitlement as unknown as
      | Record<string, { allowance?: number } | string | undefined>
      | undefined;
    const allowanceFor = (resource: string, fallback: number) => {
      const bucket = entitlement?.[resource];
      return typeof bucket === 'object' &&
        typeof bucket.allowance === 'number'
        ? bucket.allowance
        : fallback;
    };
    return normalizeProductEntitlementPolicy({
      addOns: [],
      allowance: {
        audio: 0,
        copy: allowanceFor('content', configured.content),
        image: allowanceFor(
          'image',
          allowanceFor('package', configured.package)
        ),
        video: allowanceFor('video', configured.video),
      },
      autoTopUp: {
        enabled: false,
        monthlyCapMicros: 0,
        spentThisMonthMicros: 0,
      },
      concurrencyLimit: configured.concurrencyLimit,
      queuePriority: configured.queuePriority,
      revision: `product-entitlement:${tier}:${state?.entitlement.sourceEventId ?? 'bootstrap'}`,
      supportLabel: configured.supportLabel,
      tier,
    });
  }
}
