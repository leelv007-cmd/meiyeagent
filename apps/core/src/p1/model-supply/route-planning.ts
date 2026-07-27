/**
 * S2a behavior-preserving extract: planModelSupplyCandidates + data-class helper.
 * Sorting/filter behavior intentionally unchanged (characterization locked by G4/G5).
 */
import type {
  CatalogModel,
  DataClass,
  ModelDeployment,
  ModelOperation,
} from './supply-contracts.js';
import type {
  RequestedSelection,
  RouteCandidateCostEstimate,
  RouteCandidateEvaluation,
  RouteCandidateExclusionReason,
} from './route-contracts.js';

export function deploymentAllowsDataClass(
  deployment: ModelDeployment,
  dataClass: DataClass[]
) {
  const regionalBoundary = new Set<'public' | DataClass>(
    deployment.region === 'domestic'
      ? ['public', 'contains_face', 'pii', 'medical']
      : ['public']
  );
  const declared = new Set(deployment.allowedDataClasses ?? regionalBoundary);
  const requested: Array<'public' | DataClass> =
    dataClass.length === 0 ? ['public'] : dataClass;
  return requested.every(
    (value) => regionalBoundary.has(value) && declared.has(value)
  );
}

interface RoutePlanningCatalog {
  modelById: Map<string, CatalogModel>;
  deployments: ModelDeployment[];
}

interface PlannedRouteCandidate {
  model: CatalogModel;
  deployment: ModelDeployment;
}

function recordedCostEstimate(
  operation: ModelOperation,
  region: ModelDeployment['region']
): RouteCandidateCostEstimate {
  const amountMicros =
    operation.startsWith('copy.') || operation === 'text.respond'
      ? 20_000
      : operation === 'video.generate'
        ? 500_000
        : 100_000;
  return {
    amountMicros,
    currency: region === 'domestic' ? 'CNY' : 'USD',
    source: 'recorded_estimate',
    unit: 'request',
  };
}

function routeCandidateCostEstimate(
  deployment: ModelDeployment,
  operation: ModelOperation
): RouteCandidateCostEstimate {
  return deployment.unitPrice
    ? {
        amountMicros: deployment.unitPrice.amountMicros,
        currency: deployment.unitPrice.currency,
        source: 'catalog',
        unit: deployment.unitPrice.unit,
      }
    : recordedCostEstimate(operation, deployment.region);
}

/**
 * Shared hard-filter and ranking function for real execution and the admin
 * simulator. Simulator-only availability overrides add exclusions; they never
 * mutate the published catalog.
 */
export function planModelSupplyCandidates(input: {
  catalog: RoutePlanningCatalog;
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: DataClass[];
  unavailableDeploymentIds?: readonly string[];
}) {
  const unavailable = new Set(input.unavailableDeploymentIds ?? []);
  const candidateEvaluations = input.catalog.deployments.map(
    (deployment): RouteCandidateEvaluation => {
      const model = input.catalog.modelById.get(deployment.catalogModelId);
      const exclusionReasons: RouteCandidateExclusionReason[] = [];
      if (!model) exclusionReasons.push('catalog_model_missing');
      if (deployment.status !== 'active') {
        exclusionReasons.push('deployment_inactive');
      }
      if (model && !model.operations.includes(input.operation)) {
        exclusionReasons.push('operation_unsupported');
      }
      if (
        input.selection.mode === 'fixed' &&
        model?.id !== input.selection.catalogModelId
      ) {
        exclusionReasons.push('fixed_model_mismatch');
      }
      if (
        input.selection.mode === 'auto' &&
        deployment.apiFamily === 'custom'
      ) {
        exclusionReasons.push('custom_requires_fixed_selection');
      }
      if (
        input.selection.mode === 'auto' &&
        (model?.selectionPolicy === 'manual_only' ||
          // Published catalog revisions created before selectionPolicy exist.
          model?.id === 'llm-openai')
      ) {
        exclusionReasons.push('manual_selection_required');
      }
      if (!deploymentAllowsDataClass(deployment, input.dataClass)) {
        exclusionReasons.push('data_class_disallowed');
      }
      if (unavailable.has(deployment.id)) {
        exclusionReasons.push('simulated_unavailable');
      }
      return {
        catalogModelId: deployment.catalogModelId,
        deploymentId: deployment.id,
        eligible: exclusionReasons.length === 0,
        exclusionReasons,
        qualityRank: model?.qualityRank ?? null,
        region: deployment.region,
        channel: deployment.channel,
        costEstimate: routeCandidateCostEstimate(deployment, input.operation),
      };
    }
  );
  const evaluationByDeploymentId = new Map(
    candidateEvaluations.map((evaluation) => [
      evaluation.deploymentId,
      evaluation,
    ])
  );
  const candidates = input.catalog.deployments.flatMap((deployment) => {
    const evaluation = evaluationByDeploymentId.get(deployment.id);
    const model = input.catalog.modelById.get(deployment.catalogModelId);
    return evaluation?.eligible && model ? [{ model, deployment }] : [];
  });
  if (input.selection.mode === 'auto') {
    candidates.sort(
      (left, right) => right.model.qualityRank - left.model.qualityRank
    );
  }
  return { candidateEvaluations, candidates };
}
