import {
  marketingPackageEvidenceSchema,
  type MarketingPackageEvidence,
} from '@meiye/contracts';

import type { IntentDeclaration } from './structured-nodes.js';
import type { HarnessContextSnapshot } from './workflow-core.js';

/**
 * A delivery receipt records only already-authorized, currently active facts.
 * Scene heuristics are intentionally not persisted as marketing evidence.
 */
export function createMarketingPackageEvidence(input: {
  declaration: IntentDeclaration;
  context: HarnessContextSnapshot;
  authorizedFactRefs: readonly string[];
  at: string;
}): MarketingPackageEvidence {
  const eligible = eligibleCurrentFactReferences(input.context, input.at);
  const authorized = new Set(input.authorizedFactRefs);
  return marketingPackageEvidenceSchema.parse({
    declaration: structuredDeclaration(input.declaration),
    contextBundle: {
      bundleId: input.context.bundle.bundleId,
      revision: input.context.bundle.revision,
      hash: input.context.bundle.hash,
    },
    factRefs: [...eligible].filter((reference) => authorized.has(reference)),
    rightsRefs: input.context.policyReferences.rightsRefs
      .filter((reference) => reference.status === 'authorized')
      .map((reference) => reference.assetId),
    identityRefs: input.context.policyReferences.identityRefs
      .filter((reference) => reference.status === 'registered')
      .map((reference) => reference.id),
  });
}

export function eligibleCurrentFactReferences(
  context: HarnessContextSnapshot,
  at: string,
) {
  const active = new Set(
    (context.activeFacts ?? [])
      .filter(
        (fact) =>
          Date.parse(fact.effectiveFrom) <= Date.parse(at) &&
          (fact.expiresAt === null || Date.parse(fact.expiresAt) > Date.parse(at)),
      )
      .map((fact) => fact.sourceRef),
  );
  return Object.values(context.bundle.dimensions.store_facts_assets)
    .filter(
      (contribution) =>
        contribution.layer === 'current_fact' &&
        contribution.pool === 'store_personal' &&
        contribution.factSnapshot !== undefined &&
        active.has(contribution.sourceRef),
    )
    .map((contribution) => contribution.sourceRef);
}

function structuredDeclaration(declaration: IntentDeclaration) {
  return {
    normalizedIntent: declaration.normalizedIntent,
    taskType: declaration.taskType,
    deliveryLayer: declaration.deliveryLayer,
    relevantAssetCategories: [...declaration.relevantAssetCategories],
    usedAssetCategories: [...declaration.usedAssetCategories],
    route: declaration.route,
    routingSource: declaration.routingSource,
    implicitConstraints: [...declaration.implicitConstraints],
  };
}
