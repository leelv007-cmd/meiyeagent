import type { CreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { RouteSnapshot as FoundationRouteSnapshot } from '../foundation/domain.js';
import type { FoundationRepository } from '../foundation/ports.js';
import type {
  DataClass,
  ModelOperation,
  RouteSnapshot,
} from '../model-supply/index.js';
import { nativeSupplyOperation } from './image-intent-compiler.js';
import {
  HarnessAdmissionError,
  type HarnessFrozenRouteSnapshotResolver,
} from './task-admission.js';

interface FixedRouteFreezer {
  freezeFixedRouteForExecution(input: {
    catalogModelId: string;
    dataClass: DataClass[];
    operation: ModelOperation;
    workspaceId: string;
  }): Promise<RouteSnapshot>;
}

export class ProductionHarnessFrozenRouteSnapshotResolver
  implements HarnessFrozenRouteSnapshotResolver
{
  constructor(
    private readonly routes: Pick<FoundationRepository, 'getRouteSnapshot'>,
    private readonly freezer: FixedRouteFreezer,
  ) {}

  async resolve(snapshot: CreationExecutionSnapshot) {
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
    return structuredClone(frozen);
  }
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
