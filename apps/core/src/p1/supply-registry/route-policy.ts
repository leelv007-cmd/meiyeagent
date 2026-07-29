/**
 * RoutePolicy versioned publish aggregate (G4 / D-059).
 *
 * Lifecycle: candidate → simulate → approve → publish → rollback
 * Precedent: model-supply CatalogRevisionRegistry + CAS head
 *            (foundation-module lifecycle/publish/rollback/CAS).
 *
 * One effective published head per (operation, qualityTier).
 * Thin catalog RouteRevision is bootstrapped into candidates only —
 * never a second concurrent effective head.
 */
import { randomUUID } from 'node:crypto';
import type { RoutePolicyRevision, SupplyOperation } from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import type { RouteRevision } from '../model-supply/catalog.js';

export type RoutePolicyStage =
  | 'candidate'
  | 'simulated'
  | 'approved'
  | 'published'
  | 'retired';

export type RoutePolicyQualityTier = 'quality' | 'balanced' | 'auto';

export interface RoutePolicyPayload {
  operation: SupplyOperation;
  qualityTier: RoutePolicyQualityTier;
  hardConstraints: string[];
  candidateDeploymentIds: string[];
  orderBands?: string[];
  maxAttempts: number;
  costBoundaryMicros?: number;
  fallbackAuthorized: boolean;
  modelSubstitutionDegradationSurfaces?: Record<string, string[]>;
}

export interface RoutePolicySimulationSummary {
  eligibleDeploymentIds: string[];
  excluded: Array<{ deploymentId: string; reasons: string[] }>;
  estimatedMaximumCostMicros: number | null;
  simulatedAt: string;
}

export interface RoutePolicyImpactPreview {
  operation: SupplyOperation;
  qualityTier: RoutePolicyQualityTier;
  currentHeadId: string | null;
  candidateRevisionId: string;
  addedDeploymentIds: string[];
  removedDeploymentIds: string[];
  maxAttemptsBefore: number | null;
  maxAttemptsAfter: number;
  fallbackAuthorizedBefore: boolean | null;
  fallbackAuthorizedAfter: boolean;
  hardConstraintsBefore: string[];
  hardConstraintsAfter: string[];
}

export interface RoutePolicyRevisionRecord {
  id: string;
  number: number;
  stage: RoutePolicyStage;
  previousRevisionId?: string;
  payload: RoutePolicyPayload;
  simulation?: RoutePolicySimulationSummary;
  createdAt: string;
  actorId?: string;
  correlationId?: string;
  reason?: string;
  publishedAt?: string;
}

export interface RoutePolicyAudit {
  actorId: string;
  correlationId: string;
  reason?: string;
}

export interface RoutePolicyRollbackAudit {
  id: string;
  kind: 'route_policy';
  operation: SupplyOperation;
  qualityTier: RoutePolicyQualityTier;
  actorId: string;
  correlationId: string;
  fromRevisionId: string | null;
  toRevisionId: string;
  reason: string;
  createdAt: string;
}

function headKey(
  operation: SupplyOperation,
  qualityTier: RoutePolicyQualityTier,
): string {
  return `${operation}::${qualityTier}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function copyPayload(payload: RoutePolicyPayload): RoutePolicyPayload {
  return structuredClone(payload);
}

function assertModelSubstitutionDegradationSurfaces(
  payload: RoutePolicyPayload,
) {
  const candidateIds = new Set(payload.candidateDeploymentIds);
  for (const [deploymentId, surfaces] of Object.entries(
    payload.modelSubstitutionDegradationSurfaces ?? {},
  )) {
    if (
      !candidateIds.has(deploymentId) ||
      surfaces.length === 0 ||
      surfaces.some((surface) => !surface.trim()) ||
      new Set(surfaces.map((surface) => surface.trim())).size !==
        surfaces.length
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Model substitution degradation surfaces are invalid for ${deploymentId}.`,
      );
    }
  }
}

/** Bootstrap a thin catalog RouteRevision into a RoutePolicy candidate payload. */
export function expandThinRouteRevision(
  route: RouteRevision,
  options: {
    qualityTier?: RoutePolicyQualityTier;
    candidateDeploymentIds?: string[];
    hardConstraints?: string[];
    maxAttempts?: number;
    fallbackAuthorized?: boolean;
    costBoundaryMicros?: number;
    orderBands?: string[];
    modelSubstitutionDegradationSurfaces?: Record<string, string[]>;
  } = {},
): RoutePolicyPayload {
  return {
    operation: route.operation as SupplyOperation,
    qualityTier: options.qualityTier ?? 'quality',
    hardConstraints: options.hardConstraints ?? [
      'deployment_active',
      'operation_supported',
      'data_class',
    ],
    candidateDeploymentIds: options.candidateDeploymentIds ?? [],
    ...(options.orderBands ? { orderBands: [...options.orderBands] } : {}),
    maxAttempts: options.maxAttempts ?? 2,
    ...(options.costBoundaryMicros !== undefined
      ? { costBoundaryMicros: options.costBoundaryMicros }
      : {}),
    fallbackAuthorized: options.fallbackAuthorized ?? true,
    ...(options.modelSubstitutionDegradationSurfaces
      ? {
          modelSubstitutionDegradationSurfaces: structuredClone(
            options.modelSubstitutionDegradationSurfaces,
          ),
        }
      : {}),
  };
}

/** Public published view matching contracts.RoutePolicyRevision. */
export function toPublicRoutePolicyRevision(
  record: RoutePolicyRevisionRecord,
): RoutePolicyRevision {
  return {
    id: record.id,
    operation: record.payload.operation,
    qualityTier: record.payload.qualityTier,
    hardConstraints: [...record.payload.hardConstraints],
    candidateDeploymentIds: [...record.payload.candidateDeploymentIds],
    ...(record.payload.orderBands
      ? { orderBands: [...record.payload.orderBands] }
      : {}),
    maxAttempts: record.payload.maxAttempts,
    ...(record.payload.costBoundaryMicros !== undefined
      ? { costBoundaryMicros: record.payload.costBoundaryMicros }
      : {}),
    fallbackAuthorized: record.payload.fallbackAuthorized,
    ...(record.payload.modelSubstitutionDegradationSurfaces
      ? {
          modelSubstitutionDegradationSurfaces: structuredClone(
            record.payload.modelSubstitutionDegradationSurfaces,
          ),
        }
      : {}),
    ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
    revisionId: `route-policy:${record.payload.operation}:${record.payload.qualityTier}:r${record.number}`,
  };
}

/**
 * In-memory RoutePolicy registry with CAS published heads.
 * Heads are keyed by (operation, qualityTier) — never a global weight table.
 */
export class RoutePolicyRegistry {
  private readonly revisions = new Map<string, RoutePolicyRevisionRecord>();
  private readonly publishedHeads = new Map<string, string>();
  private readonly rollbackAudits: RoutePolicyRollbackAudit[] = [];
  private sequence = 0;

  createCandidate(
    payload: RoutePolicyPayload,
    audit?: RoutePolicyAudit,
  ): RoutePolicyRevisionRecord {
    assertModelSubstitutionDegradationSurfaces(payload);
    return this.create('candidate', copyPayload(payload), undefined, audit);
  }

  /**
   * Attach a simulation summary and advance candidate → simulated.
   * Creates a new immutable revision (catalog registry precedent).
   */
  simulate(
    id: string,
    simulation: RoutePolicySimulationSummary,
    audit?: RoutePolicyAudit,
  ): RoutePolicyRevisionRecord {
    const current = this.require(id);
    if (current.stage !== 'candidate' && current.stage !== 'simulated') {
      throw new P1DomainError(
        'INVALID_STATE',
        `RoutePolicy revision must be candidate/simulated before simulate (was ${current.stage}).`,
      );
    }
    return this.create(
      'simulated',
      copyPayload(current.payload),
      current.id,
      audit,
      simulation,
    );
  }

  approve(id: string, audit?: RoutePolicyAudit): RoutePolicyRevisionRecord {
    const current = this.require(id);
    if (current.stage !== 'simulated') {
      throw new P1DomainError(
        'INVALID_STATE',
        'RoutePolicy revision must be simulated before approve.',
      );
    }
    return this.create(
      'approved',
      copyPayload(current.payload),
      current.id,
      audit,
      current.simulation,
    );
  }

  /**
   * Publish an approved revision as the sole effective head for its
   * (operation, qualityTier). CAS on expectedHeadRevisionId.
   */
  publish(
    id: string,
    expectedHeadRevisionId: string | null,
    audit?: RoutePolicyAudit,
  ): RoutePolicyRevisionRecord {
    const current = this.require(id);
    if (current.stage !== 'approved') {
      throw new P1DomainError(
        'INVALID_STATE',
        'RoutePolicy revision must be approved before publish.',
      );
    }
    const key = headKey(
      current.payload.operation,
      current.payload.qualityTier,
    );
    const head = this.publishedHeads.get(key) ?? null;
    if (head !== expectedHeadRevisionId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'RoutePolicy head changed before publication could be applied.',
      );
    }
    const published = this.create(
      'published',
      copyPayload(current.payload),
      current.id,
      audit,
      current.simulation,
      new Date().toISOString(),
    );
    this.publishedHeads.set(key, published.id);
    return published;
  }

  /**
   * Roll back the effective head to a retained published revision (or clear).
   * CAS on expectedHeadRevisionId.
   */
  rollback(input: {
    operation: SupplyOperation;
    qualityTier: RoutePolicyQualityTier;
    targetRevisionId: string | null;
    expectedHeadRevisionId: string | null;
    reason: string;
    actorId: string;
    correlationId: string;
  }): {
    current: RoutePolicyRevisionRecord | null;
    audit: RoutePolicyRollbackAudit;
  } {
    const key = headKey(input.operation, input.qualityTier);
    const head = this.publishedHeads.get(key) ?? null;
    if (head !== input.expectedHeadRevisionId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'RoutePolicy head changed before rollback could be applied.',
      );
    }
    let target: RoutePolicyRevisionRecord | null = null;
    if (input.targetRevisionId) {
      target = this.require(input.targetRevisionId);
      if (target.stage !== 'published') {
        throw new P1DomainError(
          'NOT_FOUND',
          'RoutePolicy rollback target must be a retained published revision.',
        );
      }
      if (
        target.payload.operation !== input.operation ||
        target.payload.qualityTier !== input.qualityTier
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'RoutePolicy rollback target operation/qualityTier mismatch.',
        );
      }
      this.publishedHeads.set(key, target.id);
    } else {
      this.publishedHeads.delete(key);
    }
    const audit: RoutePolicyRollbackAudit = {
      id: randomUUID(),
      kind: 'route_policy',
      operation: input.operation,
      qualityTier: input.qualityTier,
      actorId: input.actorId,
      correlationId: input.correlationId,
      fromRevisionId: head,
      toRevisionId: input.targetRevisionId ?? 'cleared',
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };
    this.rollbackAudits.push(audit);
    return {
      current: target ? structuredClone(target) : null,
      audit: structuredClone(audit),
    };
  }

  get(id: string): RoutePolicyRevisionRecord | undefined {
    const revision = this.revisions.get(id);
    return revision ? structuredClone(revision) : undefined;
  }

  /** Sole effective head for (operation, qualityTier). */
  getEffectiveHead(
    operation: SupplyOperation,
    qualityTier: RoutePolicyQualityTier = 'quality',
  ): RoutePolicyRevisionRecord | null {
    const id = this.publishedHeads.get(headKey(operation, qualityTier));
    if (!id) return null;
    const revision = this.revisions.get(id);
    return revision && revision.stage === 'published'
      ? structuredClone(revision)
      : null;
  }

  list(): RoutePolicyRevisionRecord[] {
    return [...this.revisions.values()]
      .sort((left, right) => left.number - right.number)
      .map((revision) => structuredClone(revision));
  }

  listRollbackAudits(): RoutePolicyRollbackAudit[] {
    return structuredClone(this.rollbackAudits);
  }

  previewImpact(id: string): RoutePolicyImpactPreview {
    const candidate = this.require(id);
    const current = this.getEffectiveHead(
      candidate.payload.operation,
      candidate.payload.qualityTier,
    );
    const before = new Set(current?.payload.candidateDeploymentIds ?? []);
    const after = new Set(candidate.payload.candidateDeploymentIds);
    return {
      operation: candidate.payload.operation,
      qualityTier: candidate.payload.qualityTier,
      currentHeadId: current?.id ?? null,
      candidateRevisionId: candidate.id,
      addedDeploymentIds: [...after].filter((id) => !before.has(id)),
      removedDeploymentIds: [...before].filter((id) => !after.has(id)),
      maxAttemptsBefore: current?.payload.maxAttempts ?? null,
      maxAttemptsAfter: candidate.payload.maxAttempts,
      fallbackAuthorizedBefore: current?.payload.fallbackAuthorized ?? null,
      fallbackAuthorizedAfter: candidate.payload.fallbackAuthorized,
      hardConstraintsBefore: current?.payload.hardConstraints ?? [],
      hardConstraintsAfter: [...candidate.payload.hardConstraints],
    };
  }

  private require(id: string): RoutePolicyRevisionRecord {
    const current = this.revisions.get(id);
    if (!current) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Unknown RoutePolicy revision ${id}.`,
      );
    }
    return current;
  }

  private create(
    stage: RoutePolicyStage,
    payload: RoutePolicyPayload,
    previousRevisionId?: string,
    audit?: RoutePolicyAudit,
    simulation?: RoutePolicySimulationSummary,
    publishedAt?: string,
  ): RoutePolicyRevisionRecord {
    const revision = deepFreeze<RoutePolicyRevisionRecord>({
      id: randomUUID(),
      number: ++this.sequence,
      stage,
      ...(previousRevisionId ? { previousRevisionId } : {}),
      payload,
      ...(simulation ? { simulation: structuredClone(simulation) } : {}),
      createdAt: new Date().toISOString(),
      ...(audit
        ? {
            actorId: audit.actorId,
            correlationId: audit.correlationId,
            ...(audit.reason ? { reason: audit.reason } : {}),
          }
        : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
    this.revisions.set(revision.id, revision);
    return structuredClone(revision);
  }
}
