import type { CreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { ModelCapabilityRequirementAxis } from '@meiye/contracts';
import type { RouteSnapshot as FoundationRouteSnapshot } from '../foundation/domain.js';
import type { FoundationRepository } from '../foundation/ports.js';
import type {
  DataClass,
  ModelOperation,
  RouteSnapshot,
} from '../model-supply/index.js';
import { nativeSupplyOperation } from './image-intent-compiler.js';
import {
  matchRuntimeCapabilityRequirement,
  type RuntimeCapabilityRequirementDecision,
} from '../supply-registry/hot-assembly.js';
import {
  HarnessAdmissionError,
  type HarnessFrozenRouteSnapshotResolver,
} from './task-admission.js';

interface FixedRouteFreezer {
  freezeFixedRouteForExecution(input: {
    catalogModelId: string;
    dataClass: DataClass[];
    deploymentId?: string;
    operation: ModelOperation;
    workspaceId: string;
  }): Promise<RouteSnapshot>;
}

export interface HarnessConservativePlatformDefaultResolver {
  resolve(operation: ModelOperation): Promise<{
    catalogModelId: string;
    deploymentId: string;
    activationEvidenceStatus: 'live_verified';
    activationEvidenceRef?: string;
    configurationRevision?: string;
  }>;
}

export class ProductionHarnessFrozenRouteSnapshotResolver
  implements HarnessFrozenRouteSnapshotResolver
{
  constructor(
    private readonly routes: Pick<FoundationRepository, 'getRouteSnapshot'>,
    private readonly freezer: FixedRouteFreezer,
    private readonly platformDefaults?: HarnessConservativePlatformDefaultResolver,
  ) {}

  async resolve(
    snapshot: CreationExecutionSnapshot,
    input: { requirements: ModelCapabilityRequirementAxis[] } = {
      requirements: [],
    },
  ) {
    const checkpoint = await this.routes.getRouteSnapshot(
      snapshot.workspaceId,
      snapshot.route.id,
    );
    if (!checkpoint) {
      throw frozenRouteMismatch('The confirmed model route is unavailable.');
    }
    if (
      checkpoint.catalogRevision !== snapshot.route.revision ||
      checkpoint.catalogRevision !== snapshot.catalogModel.revision ||
      checkpoint.requestedCatalogModelId !== snapshot.catalogModel.id ||
      checkpoint.selectionMode !== 'fixed'
    ) {
      throw frozenRouteMismatch(
        'The confirmed model route does not match the admitted task.',
      );
    }
    const dataClass = modelSupplyDataClass(checkpoint);
    const frozen = await this.freezer.freezeFixedRouteForExecution({
      catalogModelId: snapshot.catalogModel.id,
      dataClass,
      operation: nativeSupplyOperation(snapshot.operation),
      workspaceId: snapshot.workspaceId,
    });
    const executionCandidate = frozen.allowedCandidates?.find(
      (candidate) =>
        candidate.catalogModelId === frozen.actualCatalogModelId &&
        candidate.deploymentId === frozen.deploymentId,
    );
    if (
      frozen.id !== snapshot.route.id ||
      frozen.catalogRevisionId !== snapshot.route.revision ||
      !frozen.capabilityRevisionId?.trim() ||
      frozen.actualCatalogModelId !== snapshot.catalogModel.id ||
      frozen.requestedSelection.mode !== 'fixed' ||
      frozen.requestedSelection.catalogModelId !== snapshot.catalogModel.id ||
      !sameDataClass(frozen.dataClass, dataClass) ||
      !executionCandidate ||
      !isCompleteExecutionCandidate(executionCandidate)
    ) {
      throw frozenRouteMismatch(
        'The confirmed model route no longer matches the admitted task.',
      );
    }
    if (input.requirements.length === 0) {
      return structuredClone(frozen);
    }
    const decisions = input.requirements.map((requirement) =>
      matchFrozenCandidate(executionCandidate, requirement),
    );
    const denied = decisions.find(
      (decision) => decision.outcome === 'ineligible',
    );
    if (denied) {
      throw frozenRouteMismatch(
        `The confirmed model route does not satisfy ${denied.axisId}: ${denied.reasons.join(', ')}.`,
      );
    }
    const conservative = decisions.filter(
      (decision) => decision.outcome === 'conservative_fallback',
    );
    let frozenRoute = frozen;
    let fallbackFacts: RouteSnapshot['capabilityFallbackFacts'];
    if (conservative.length > 0) {
      if (!this.platformDefaults) {
        throw frozenRouteMismatch(
          'Capability matching requires the platform-default fallback resolver.',
        );
      }
      const platformDefault = await this.platformDefaults.resolve(
        nativeSupplyOperation(snapshot.operation),
      );
      if (platformDefault.activationEvidenceStatus !== 'live_verified') {
        throw frozenRouteMismatch(
          'The conservative platform default is not live verified.',
        );
      }
      if (
        platformDefault.catalogModelId !== frozen.actualCatalogModelId ||
        platformDefault.deploymentId !== frozen.deploymentId
      ) {
        const refrozen = await this.freezer.freezeFixedRouteForExecution({
          catalogModelId: platformDefault.catalogModelId,
          dataClass,
          deploymentId: platformDefault.deploymentId,
          operation: nativeSupplyOperation(snapshot.operation),
          workspaceId: snapshot.workspaceId,
        });
        const fallbackCandidate = refrozen.allowedCandidates?.find(
          (candidate) =>
            candidate.catalogModelId === platformDefault.catalogModelId &&
            candidate.deploymentId === platformDefault.deploymentId,
        );
        if (
          refrozen.catalogRevisionId !== frozen.catalogRevisionId ||
          !refrozen.capabilityRevisionId?.trim() ||
          refrozen.actualCatalogModelId !== platformDefault.catalogModelId ||
          refrozen.deploymentId !== platformDefault.deploymentId ||
          refrozen.requestedSelection.mode !== 'fixed' ||
          refrozen.requestedSelection.catalogModelId !==
            platformDefault.catalogModelId ||
          !sameDataClass(refrozen.dataClass, dataClass) ||
          !fallbackCandidate ||
          !isCompleteExecutionCandidate(fallbackCandidate)
        ) {
          throw frozenRouteMismatch(
            'The conservative platform default could not be frozen for execution.',
          );
        }
        frozenRoute = refrozen;
      }
      fallbackFacts = conservative.map((decision) => ({
        axisId: decision.axisId,
        deploymentId: decision.deploymentId,
        reason: decision.reasons.includes('vocabulary_version_unknown')
          ? 'vocabulary_version_unknown'
          : 'capability_unknown',
        platformDefaultDeploymentId: platformDefault.deploymentId,
        ...(platformDefault.activationEvidenceRef
          ? {
              activationEvidenceRef:
                platformDefault.activationEvidenceRef,
            }
          : {}),
        ...(platformDefault.configurationRevision
          ? {
              configurationRevision:
                platformDefault.configurationRevision,
            }
          : {}),
      }));
    }
    return {
      ...structuredClone(frozenRoute),
      capabilityRequirements: structuredClone(input.requirements),
      capabilityMatches: structuredClone(decisions),
      ...(fallbackFacts
        ? { capabilityFallbackFacts: structuredClone(fallbackFacts) }
        : {}),
    };
  }
}

function matchFrozenCandidate(
  candidate: NonNullable<RouteSnapshot['allowedCandidates']>[number],
  requirement: ModelCapabilityRequirementAxis,
): RuntimeCapabilityRequirementDecision {
  return matchRuntimeCapabilityRequirement(
    {
      id: candidate.deploymentId,
      catalogModelId: candidate.catalogModelId,
      apiFamily: candidate.apiFamily,
      channel: candidate.channel,
      region: candidate.region,
      status: candidate.deploymentStatus,
      executionChannelId: candidate.executionChannelId ?? undefined,
      providerModel: candidate.providerModel ?? undefined,
      endpointRevision: candidate.endpointRevision ?? undefined,
      lifecycleRevision:
        candidate.deploymentLifecycleRevision ?? undefined,
      credentialVersion: candidate.credentialVersion,
      capabilityProfile: candidate.capabilityProfile ?? undefined,
    },
    requirement,
  );
}

function isCompleteExecutionCandidate(
  candidate: NonNullable<RouteSnapshot['allowedCandidates']>[number],
) {
  return (
    Boolean(candidate.apiFamily) &&
    Boolean(candidate.channel) &&
    Boolean(candidate.modelModality) &&
    Array.isArray(candidate.modelOperations) &&
    Boolean(candidate.modelDisplayName) &&
    Number.isFinite(candidate.modelQualityRank) &&
    'modelManufacturer' in candidate &&
    'modelCapabilities' in candidate &&
    Boolean(candidate.deploymentStatus) &&
    'allowedDataClasses' in candidate &&
    'stableModelName' in candidate &&
    'modelVersion' in candidate
  );
}

function modelSupplyDataClass(route: FoundationRouteSnapshot): DataClass[] {
  return [...new Set(route.dataClasses ?? [route.dataClass])]
    .filter((value): value is DataClass => value !== 'public')
    .sort();
}

function sameDataClass(left: DataClass[], right: DataClass[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function frozenRouteMismatch(message: string) {
  return new HarnessAdmissionError('FROZEN_ROUTE_MISMATCH', message);
}
