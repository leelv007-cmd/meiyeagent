import {
  marketingPackageEvidenceSchema,
  PROMOTIONAL_MATERIAL_SPECS,
  type MarketingPackageEvidence,
  type MarketingScene,
  type StoreFactKind,
} from '@meiye/contracts';

import { deriveMarketingPackageCapabilities } from './marketing-capabilities.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import type { IntentDeclaration } from './structured-nodes.js';
import type { HarnessContextSnapshot } from './workflow-core.js';

type FactContribution =
  HarnessContextSnapshot['bundle']['dimensions']['store_facts_assets'][string];
type FrozenFact = NonNullable<FactContribution['factSnapshot']>;

export function projectCopyMarketingPackageEvidence(input: {
  declaration: IntentDeclaration;
  request: HarnessWorkflowInput;
  context: HarnessContextSnapshot;
  at: string;
  factRefs?: readonly string[];
  identityRefs?: readonly string[];
}): MarketingPackageEvidence {
  const scene = input.declaration.taskType satisfies MarketingScene;
  const factRefs = unique(
    input.factRefs ??
      input.context.policyReferences.sourceRefs
        .filter((reference) => reference.status === 'current')
        .map((reference) => reference.id),
  );
  const rightsRefs = unique(
    input.context.policyReferences.rightsRefs
      .filter((reference) => reference.status === 'authorized')
      .map((reference) => reference.assetId),
  );
  const identityRefs = unique(
    input.identityRefs ??
      input.context.policyReferences.identityRefs
        .filter((reference) => reference.status === 'registered')
        .map((reference) => reference.id),
  );
  const common = {
    scene,
    capabilities: deriveMarketingPackageCapabilities(),
    contextBundle: {
      bundleId: input.context.bundle.bundleId,
      revision: input.context.bundle.revision,
      hash: input.context.bundle.hash,
    },
    factRefs,
    rightsRefs,
    identityRefs,
    identityFallback:
      identityRefs.length === 0
        ? ('brand_official' as const)
        : ('none' as const),
  };

  if (scene === 'promotion_groupbuy_conversion') {
    return marketingPackageEvidenceSchema.parse({
      ...common,
      promotionOffer: promotionOffer(input.context, factRefs, input.at),
    });
  }
  if (scene === 'traffic_opportunity') {
    return marketingPackageEvidenceSchema.parse({
      ...common,
      opportunity: evergreenOpportunity(input.request, input.at),
    });
  }
  if (scene === 'routine_marketing_materials') {
    return marketingPackageEvidenceSchema.parse({
      ...common,
      materialSpecs: PROMOTIONAL_MATERIAL_SPECS,
    });
  }
  return marketingPackageEvidenceSchema.parse(common);
}

function promotionOffer(
  context: HarnessContextSnapshot,
  factRefs: readonly string[],
  at: string,
) {
  const allowed = new Set(factRefs);
  const facts = Object.values(context.bundle.dimensions.store_facts_assets)
    .filter(
      (contribution): contribution is FactContribution & {
        factSnapshot: FrozenFact;
      } =>
        contribution.layer === 'current_fact' &&
        contribution.factSnapshot !== undefined &&
        allowed.has(contribution.sourceRef),
    )
    .filter(
      ({ factSnapshot }) =>
        factSnapshot.revisionKind !== 'revocation' &&
        Date.parse(factSnapshot.effectiveFrom) <= Date.parse(at) &&
        (factSnapshot.expiresAt === null ||
          Date.parse(factSnapshot.expiresAt) > Date.parse(at)),
    )
    .map((contribution) => ({
      kind: contribution.factSnapshot.kind,
      value: contribution.value,
      sourceRef: contribution.sourceRef,
      effectiveFrom: contribution.factSnapshot.effectiveFrom,
      expiresAt: contribution.factSnapshot.expiresAt,
    }));
  const price = facts.find((fact) => fact.kind === 'price');
  const benefit = facts.find((fact) =>
    fact.kind === ('discount' satisfies StoreFactKind) ||
    fact.kind === ('group_buy' satisfies StoreFactKind),
  );
  const offerFacts = unique([price, benefit]);
  if (offerFacts.length === 0) {
    return {
      status: 'unpriced' as const,
      sourceRefs: [],
      callToAction: {
        kind: 'contact' as const,
        mode: 'manual' as const,
        label: '私信或到店了解当期价格与权益',
      },
    };
  }
  return {
    status: 'verified' as const,
    sourceRefs: offerFacts.map((fact) => fact.sourceRef),
    ...(price ? { priceText: scalarText(price.value) } : {}),
    ...(benefit ? { benefitText: scalarText(benefit.value) } : {}),
    effectiveFrom: offerFacts.map((fact) => fact.effectiveFrom).sort()[0],
    ...(offerFacts.some((fact) => fact.expiresAt)
      ? {
          expiresAt: offerFacts
            .map((fact) => fact.expiresAt)
            .filter((value): value is string => Boolean(value))
            .sort()[0],
        }
      : {}),
    callToAction: {
      kind: 'contact' as const,
      mode: 'manual' as const,
      label: '私信或到店确认预约',
    },
  };
}

function evergreenOpportunity(request: HarnessWorkflowInput, at: string) {
  return {
    opportunityId: `opportunity-${request.packageId}`,
    status: 'evergreen_fallback' as const,
    source: 'evergreen:store-service-education',
    sourceType: 'evergreen_fallback' as const,
    capturedAt: at,
    expiresAt: new Date(Date.parse(at) + 24 * 60 * 60 * 1_000).toISOString(),
    platforms: ['xiaohongshu' as const],
    region: request.factScope?.storeId ?? request.workspaceId,
    targetAudience: '当前门店服务范围内的目标顾客',
    matchedStoreReferences: [],
    relevanceExplanation: '缺少经过结构化核验的热点信号，不使用热点包装。',
    reusableMechanism: '仅复用话题结构和内容机制，不复制受保护表达。',
    expectedAction: '查看常青的项目选择指南。',
    evergreenFallback: '转为基于门店已核验事实的常青服务教育内容。',
    protectedExpressionCopied: false as const,
  };
}

function scalarText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const amount = record.amount ?? record.price ?? record.value;
    const currency = record.currency === 'CNY' ? '元' : record.currency;
    if (typeof amount === 'number' || typeof amount === 'string') {
      return `${amount}${currency ? ` ${String(currency)}` : ''}`;
    }
  }
  return JSON.stringify(value);
}

function unique<T>(values: ReadonlyArray<T | undefined>): T[] {
  return values.filter(
    (value, index): value is T =>
      value !== undefined && values.indexOf(value) === index,
  );
}
