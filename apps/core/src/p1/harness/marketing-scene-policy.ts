import {
  marketingPackageEvidenceSchema,
  PROMOTIONAL_MATERIAL_SPECS,
  type MarketingPackageEvidence,
  type MarketingScene,
} from '@meiye/contracts';

import type { HarnessWorkflowInput } from './task-admission.js';
import type { IntentDeclaration } from './structured-nodes.js';
import type { HarnessContextSnapshot } from './workflow-core.js';
import { deriveMarketingPackageCapabilities } from './marketing-capabilities.js';

const URL_PATTERN = /https?:\/\/[^\s]+/iu;
const PRICE_KEY_PATTERN = /(?:price|amount|cost|fee|价格|价钱|售价|团购价)/iu;
const BENEFIT_KEY_PATTERN = /(?:benefit|discount|offer|group.?buy|权益|优惠|折扣|团购)/iu;
const ENDPOINT_KEY_PATTERN = /(?:endpoint|booking.?url|voucher.?url|cta.?url|预约链接|购券链接)/iu;

export function projectMarketingPackageEvidence(input: {
  declaration: IntentDeclaration;
  request: HarnessWorkflowInput;
  context: HarnessContextSnapshot;
  at: string;
}): MarketingPackageEvidence {
  const scene = input.declaration.taskType satisfies MarketingScene;
  const factRefs = input.context.policyReferences.sourceRefs
    .filter((reference) => reference.status === 'current')
    .map((reference) => reference.id);
  const rightsRefs = input.context.policyReferences.rightsRefs
    .filter((reference) => reference.status === 'authorized')
    .map((reference) => reference.assetId);
  const identityRefs = input.context.policyReferences.identityRefs
    .filter((reference) => reference.status === 'registered')
    .map((reference) => reference.id);
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
      promotionOffer: promotionOffer(input.context, input.at),
    });
  }
  if (scene === 'traffic_opportunity') {
    return marketingPackageEvidenceSchema.parse({
      ...common,
      opportunity: opportunityCard(input.request, factRefs, input.at),
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

function promotionOffer(context: HarnessContextSnapshot, at: string) {
  const facts = (context.activeFacts ?? []).filter(
    (fact) => fact.expiresAt === null || Date.parse(fact.expiresAt) > Date.parse(at),
  );
  const price = facts.find((fact) => PRICE_KEY_PATTERN.test(fact.key));
  const benefit = facts.find((fact) => BENEFIT_KEY_PATTERN.test(fact.key));
  const endpoint = facts.find((fact) => ENDPOINT_KEY_PATTERN.test(fact.key));
  const offerFacts = uniqueFacts([price, benefit]);
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
  const endpointValue = endpoint ? scalarText(endpoint.value) : undefined;
  const actionableEndpoint = endpointValue?.match(URL_PATTERN)?.[0];
  const sourceFacts = uniqueFacts([
    ...offerFacts,
    ...(actionableEndpoint ? [endpoint] : []),
  ]);
  return {
    status: 'verified' as const,
    sourceRefs: sourceFacts.map((fact) => fact.sourceRef),
    ...(price ? { priceText: scalarText(price.value) } : {}),
    ...(benefit ? { benefitText: scalarText(benefit.value) } : {}),
    effectiveFrom: offerFacts
      .map((fact) => fact.effectiveFrom)
      .sort()[0],
    ...(offerFacts.some((fact) => fact.expiresAt)
      ? {
          expiresAt: offerFacts
            .map((fact) => fact.expiresAt)
            .filter((value): value is string => Boolean(value))
            .sort()[0],
        }
      : {}),
    callToAction:
      actionableEndpoint
        ? {
            kind: 'appointment' as const,
            mode: 'actionable' as const,
            label: '立即预约',
            endpoint: actionableEndpoint,
          }
        : {
            kind: 'contact' as const,
            mode: 'manual' as const,
            label: '私信或到店确认预约',
          },
  };
}

function opportunityCard(
  request: HarnessWorkflowInput,
  factRefs: string[],
  at: string,
) {
  const sourceText = [request.rawInput, ...request.intent.context.sourceSummaries]
    .find((value) => URL_PATTERN.test(value));
  const screenshotAssetId = request.intent.assetReferences.find((assetId) =>
    /(?:screenshot|screen-shot|截图)/iu.test(assetId),
  );
  const active = Boolean((sourceText || screenshotAssetId) && factRefs.length > 0);
  const capturedAt = at;
  const expiresAt = new Date(Date.parse(at) + 24 * 60 * 60 * 1_000).toISOString();
  const source = sourceText?.match(URL_PATTERN)?.[0] ?? screenshotAssetId;
  return {
    opportunityId: `opportunity-${request.packageId}`,
    status: active ? ('active' as const) : ('evergreen_fallback' as const),
    source: source ?? 'evergreen:store-service-education',
    sourceType: sourceText
      ? ('user_link' as const)
      : screenshotAssetId
        ? ('user_screenshot' as const)
        : ('evergreen_fallback' as const),
    capturedAt,
    expiresAt,
    platforms: ['xiaohongshu' as const],
    region: request.factScope?.storeId ?? request.workspaceId,
    targetAudience: '当前门店服务范围内的目标顾客',
    matchedStoreReferences: active ? factRefs : [],
    relevanceExplanation: active
      ? '用户提供了可追溯信号，且能与当前门店事实匹配。'
      : '缺少可追溯或可匹配的热点信号，不使用热点包装。',
    reusableMechanism: '仅复用话题结构和内容机制，不复制受保护表达。',
    expectedAction: active
      ? '查看与本店项目相关的原创解读。'
      : '查看常青的项目选择指南。',
    evergreenFallback: '转为基于门店已核验事实的常青服务教育内容。',
    protectedExpressionCopied: false as const,
  };
}

function scalarText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
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

function uniqueFacts<T>(values: Array<T | undefined>): T[] {
  return values.filter(
    (value, index): value is T =>
      value !== undefined && values.indexOf(value) === index,
  );
}
