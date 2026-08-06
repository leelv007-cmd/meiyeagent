import { isDeepStrictEqual } from 'node:util';

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';

import { P1DomainError } from '../foundation/domain.js';
import type { EvalRunRegistryPort } from '../harness/eval-run-registry.js';
import type {
  AuditedSkillBinding,
  SkillBinding,
  SkillCatalog,
  SkillChildEffect,
  SkillDeployment,
  SkillGovernanceReservation,
  SkillGovernanceRun,
  SkillInvocationReceipt,
  SkillReferenceEdge,
  SkillReferenceScope,
  SkillRevision,
  SkillSourceKind,
  SkillTier,
  SkillTriggerCondition,
} from './types.js';

export interface SkillRepository extends EvalRunRegistryPort {
  putCatalog(catalog: SkillCatalog): Promise<SkillCatalog>;
  getCatalog(skillId: string): Promise<SkillCatalog | null>;
  /**
   * Operator catalog read. Filters are columns rather than payload lookups
   * because the industry-tier corroboration metric aggregates over them.
   */
  listCatalogs(filter?: {
    tier?: SkillTier;
    sourceKind?: SkillSourceKind;
    limit?: number;
  }): Promise<SkillCatalog[]>;
  getCatalogStats(): Promise<{
    total: number;
    industryTierTotal: number;
    industryTierCorroborated: number;
  }>;
  putRevision(
    revision: SkillRevision,
    expectedRevision: number | null,
  ): Promise<SkillRevision>;
  acceptRevision(revision: SkillRevision): Promise<SkillRevision>;
  getRevision(skillRevisionRef: string): Promise<SkillRevision | null>;
  getRevisionHead(skillId: string): Promise<SkillRevision | null>;
  listRevisions(skillId: string, limit: number): Promise<SkillRevision[]>;
  compareAndSetPublishedRevision(
    input: CompareAndSetPublishedRevisionInput,
  ): Promise<SkillGovernanceRun>;
  retireRevision(
    input: RetireSkillRevisionInput,
  ): Promise<SkillGovernanceRun>;
  applyGovernanceDraft(input: {
    run: SkillGovernanceRun;
    draft: SkillRevision | null;
    expectedHeadRevision: number;
    casConflictRun: SkillGovernanceRun;
  }): Promise<SkillGovernanceRun>;
  reserveGovernanceRun(
    reservation: SkillGovernanceReservation,
  ): Promise<SkillGovernanceReservation>;
  getGovernanceReservation(
    runId: string,
  ): Promise<SkillGovernanceReservation | null>;
  completeGovernanceCancellation(
    run: SkillGovernanceRun,
  ): Promise<SkillGovernanceRun>;
  getGovernanceRun(runId: string): Promise<SkillGovernanceRun | null>;
  putBinding(binding: SkillBinding): Promise<SkillBinding>;
  supersedeBinding(
    sourceBindingId: string,
    replacement: SkillBinding,
  ): Promise<SkillBinding>;
  getBinding(bindingId: string): Promise<AuditedSkillBinding | null>;
  listBindings(
    workflowRevisionRef: string,
    triggerCondition: SkillTriggerCondition,
  ): Promise<SkillBinding[]>;
  /**
   * Active bindings for a workflow across all stages (merchant projection #378).
   * Excludes planner_selected; does not apply industry/tenant stage filters.
   */
  listActiveBindingsForWorkflow(
    workflowRevisionRef: string,
  ): Promise<SkillBinding[]>;
  retireLegacyPlannerSelectedBindings(retiredAt: string): Promise<number>;
  putDeployment(
    deployment: SkillDeployment,
    referenceScope?: SkillReferenceScope,
  ): Promise<SkillDeployment>;
  getDeployment(deploymentId: string): Promise<SkillDeployment | null>;
  putChildEffect(effect: SkillChildEffect): Promise<SkillChildEffect>;
  updateChildEffect(effect: SkillChildEffect): Promise<SkillChildEffect>;
  getChildEffect(effectId: string): Promise<SkillChildEffect | null>;
  putInvocationReceipt(
    receipt: SkillInvocationReceipt,
  ): Promise<SkillInvocationReceipt>;
  getInvocationReceipt(
    invocationId: string,
  ): Promise<SkillInvocationReceipt | null>;
  putReferenceEdge(edge: SkillReferenceEdge): Promise<SkillReferenceEdge>;
  listReferenceEdges(
    targetSkillRevisionRef: string,
  ): Promise<SkillReferenceEdge[]>;
  inspectReferenceEdges(
    targetSkillRevisionRef: string,
    viewerWorkspaceId: string,
  ): Promise<{
    visibleDependencies: SkillReferenceEdge[];
    hiddenCount: number;
  }>;
}

export type CompareAndSetPublishedRevisionInput = {
  expectedPublicationGeneration: number;
  expectedPublishedRevisionRef: string | null;
  publishedCatalog: SkillCatalog;
  publishedRun: SkillGovernanceRun;
  casConflictRun: SkillGovernanceRun;
  referenceEdge: SkillReferenceEdge;
};

export type RetireSkillRevisionInput = {
  targetSkillRevisionRef: string;
  appliedRun: SkillGovernanceRun;
  blockedRun: SkillGovernanceRun;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeCatalog(catalog: SkillCatalog): SkillCatalog {
  const legacy = catalog as SkillCatalog & {
    publicationGeneration?: number;
  };
  return {
    ...catalog,
    publicationGeneration:
      Number.isInteger(legacy.publicationGeneration) &&
      (legacy.publicationGeneration ?? -1) >= 0
        ? legacy.publicationGeneration!
        : 0,
  };
}

function putOnce<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  label: string,
): T {
  const existing = map.get(key);
  if (existing) {
    if (isDeepStrictEqual(existing, value)) return clone(existing);
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `${label} is already bound to different facts.`,
    );
  }
  map.set(key, clone(value));
  return clone(value);
}

function assertPutOnceCompatible<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  label: string,
) {
  const existing = map.get(key);
  if (existing && !isDeepStrictEqual(existing, value)) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `${label} is already bound to different facts.`,
    );
  }
}

function referenceEdgeId(
  consumerKind: SkillReferenceEdge['consumerKind'],
  consumerId: string,
  targetSkillRevisionRef: string,
) {
  return [
    'skill-reference',
    consumerKind,
    consumerId,
    targetSkillRevisionRef,
  ].join(':');
}

export function bindingReferenceEdge(
  binding: SkillBinding,
): SkillReferenceEdge {
  const workspaceId = binding.ownerWorkspaceId?.trim();
  return {
    edgeId: referenceEdgeId(
      'workflow_binding',
      binding.bindingId,
      binding.skillRevisionRef,
    ),
    targetSkillRevisionRef: binding.skillRevisionRef,
    consumerKind: 'workflow_binding',
    consumerId: binding.bindingId,
    consumerLabel: binding.workflowRevisionRef,
    scope: workspaceId ? { kind: 'workspace', workspaceId } : { kind: 'unknown' },
    createdAt: binding.createdAt,
  };
}

export function deploymentReferenceEdge(
  deployment: SkillDeployment,
  scope: SkillReferenceScope = { kind: 'unknown' },
): SkillReferenceEdge {
  return {
    edgeId: referenceEdgeId(
      'deployment',
      deployment.deploymentId,
      deployment.skillRevisionRef,
    ),
    targetSkillRevisionRef: deployment.skillRevisionRef,
    consumerKind: 'deployment',
    consumerId: deployment.deploymentId,
    consumerLabel: `${deployment.provider}/${deployment.channel}`,
    scope,
    createdAt: deployment.createdAt,
  };
}

export function invocationReceiptReferenceEdge(
  receipt: SkillInvocationReceipt,
): SkillReferenceEdge {
  return {
    edgeId: referenceEdgeId(
      'invocation_receipt',
      receipt.invocationId,
      receipt.skillRevisionRef,
    ),
    targetSkillRevisionRef: receipt.skillRevisionRef,
    consumerKind: 'invocation_receipt',
    consumerId: receipt.invocationId,
    consumerLabel: receipt.taskId,
    scope: receipt.workspaceId.trim()
      ? { kind: 'workspace', workspaceId: receipt.workspaceId.trim() }
      : { kind: 'unknown' },
    createdAt: receipt.createdAt,
  };
}

export function evalRunReferenceEdges(run: EvalRun): SkillReferenceEdge[] {
  const revisionRefs = [
    ...new Set(
      run.results.flatMap((result) =>
        result.skillRevisionRef ? [result.skillRevisionRef] : [],
      ),
    ),
  ].sort();
  return revisionRefs.map((targetSkillRevisionRef) => ({
    edgeId: referenceEdgeId(
      'eval_run',
      run.runId,
      targetSkillRevisionRef,
    ),
    targetSkillRevisionRef,
    consumerKind: 'eval_run',
    consumerId: run.runId,
    consumerLabel: `${run.suiteId}@${run.suiteRevision}`,
    scope: { kind: 'global', proof: 'evaluation' },
    createdAt: run.createdAt,
  }));
}

export function governanceReservationReferenceEdge(
  reservation: SkillGovernanceReservation,
): SkillReferenceEdge {
  return {
    edgeId: referenceEdgeId(
      'governance_run',
      reservation.runId,
      reservation.baseSkillRevisionRef,
    ),
    targetSkillRevisionRef: reservation.baseSkillRevisionRef,
    consumerKind: 'governance_run',
    consumerId: reservation.runId,
    consumerLabel: reservation.skillId,
    scope: reservation.workspaceId.trim()
      ? {
          kind: 'workspace',
          workspaceId: reservation.workspaceId.trim(),
        }
      : { kind: 'unknown' },
    createdAt: reservation.createdAt,
  };
}

export function governanceRunReferenceEdges(
  run: SkillGovernanceRun,
): SkillReferenceEdge[] {
  return [
    ...new Set(
      [run.baseSkillRevisionRef, run.draftSkillRevisionRef].filter(
        (reference): reference is string => Boolean(reference),
      ),
    ),
  ].map((targetSkillRevisionRef) => ({
    edgeId: referenceEdgeId(
      'governance_run',
      run.runId,
      targetSkillRevisionRef,
    ),
    targetSkillRevisionRef,
    consumerKind: 'governance_run',
    consumerId: run.runId,
    consumerLabel: run.skillId,
    scope: run.workspaceId.trim()
      ? { kind: 'workspace', workspaceId: run.workspaceId.trim() }
      : { kind: 'unknown' },
    createdAt: run.createdAt,
  }));
}

export function publishedLifecycleReferenceEdge(
  catalog: SkillCatalog,
): SkillReferenceEdge {
  const targetSkillRevisionRef = catalog.activeRevisionRef;
  if (!targetSkillRevisionRef) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Published Skill lifecycle edge requires an active revision.',
    );
  }
  return {
    edgeId: referenceEdgeId(
      'published_lifecycle',
      catalog.skillId,
      targetSkillRevisionRef,
    ),
    targetSkillRevisionRef,
    consumerKind: 'published_lifecycle',
    consumerId: catalog.skillId,
    consumerLabel: catalog.name,
    scope:
      catalog.tier === 'platform'
        ? { kind: 'global', proof: 'platform_catalog' }
        : catalog.tier === 'industry'
          ? { kind: 'global', proof: 'industry_catalog' }
          : { kind: 'unknown' },
    createdAt: catalog.updatedAt,
  };
}

export class MemorySkillRepository implements SkillRepository {
  private readonly catalogs = new Map<string, SkillCatalog>();
  private readonly revisions = new Map<string, SkillRevision>();
  private readonly governanceRuns = new Map<string, SkillGovernanceRun>();
  private readonly governanceReservations = new Map<
    string,
    SkillGovernanceReservation
  >();
  private readonly evalRuns = new Map<string, EvalRun>();
  private readonly bindings = new Map<string, AuditedSkillBinding>();
  private readonly deployments = new Map<string, SkillDeployment>();
  private readonly effects = new Map<string, SkillChildEffect>();
  private readonly receipts = new Map<string, SkillInvocationReceipt>();
  private readonly referenceEdges = new Map<string, SkillReferenceEdge>();

  async putCatalog(catalog: SkillCatalog) {
    const canonical = normalizeCatalog(catalog);
    this.catalogs.set(canonical.skillId, clone(canonical));
    return clone(canonical);
  }

  async getCatalog(skillId: string) {
    const value = this.catalogs.get(skillId);
    return value ? normalizeCatalog(clone(value)) : null;
  }

  async listCatalogs(filter?: {
    tier?: SkillTier;
    sourceKind?: SkillSourceKind;
    limit?: number;
  }) {
    const matches = [...this.catalogs.values()]
      .filter(
        (catalog) =>
          (filter?.tier === undefined || catalog.tier === filter.tier) &&
          (filter?.sourceKind === undefined ||
            catalog.sourceKind === filter.sourceKind),
      )
      .sort((left, right) => left.skillId.localeCompare(right.skillId));
    return matches
      .slice(0, filter?.limit ?? matches.length)
      .map((catalog) => normalizeCatalog(clone(catalog)));
  }

  async getCatalogStats() {
    const catalogs = [...this.catalogs.values()];
    const industry = catalogs.filter((catalog) => catalog.tier === 'industry');
    return {
      total: catalogs.length,
      industryTierTotal: industry.length,
      industryTierCorroborated: industry.filter(
        (catalog) => catalog.sourceKind === 'induced',
      ).length,
    };
  }

  async putRevision(
    revision: SkillRevision,
    expectedRevision: number | null,
  ) {
    const head = await this.getRevisionHead(revision.skillId);
    if ((head?.revision ?? null) !== expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Skill revision head changed before the write.',
      );
    }
    return putOnce(
      this.revisions,
      revision.skillRevisionRef,
      revision,
      'Skill revision',
    );
  }

  async getRevision(skillRevisionRef: string) {
    const value = this.revisions.get(skillRevisionRef);
    return value ? clone(value) : null;
  }

  async acceptRevision(revision: SkillRevision) {
    const existing = this.revisions.get(revision.skillRevisionRef);
    if (
      !existing ||
      existing.status !== 'draft' ||
      revision.status !== 'accepted_frozen' ||
      existing.contentHash !== revision.contentHash
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only an unchanged draft Skill revision can be accepted and frozen.',
      );
    }
    this.revisions.set(revision.skillRevisionRef, clone(revision));
    return clone(revision);
  }

  async getRevisionHead(skillId: string) {
    return this.revisionHead(skillId);
  }

  private revisionHead(skillId: string) {
    const values = [...this.revisions.values()]
      .filter((revision) => revision.skillId === skillId)
      .sort((left, right) => right.revision - left.revision);
    return values[0] ? clone(values[0]) : null;
  }

  async listRevisions(skillId: string, limit: number) {
    return [...this.revisions.values()]
      .filter((revision) => revision.skillId === skillId)
      .sort((left, right) => right.revision - left.revision)
      .slice(0, limit)
      .map(clone);
  }

  async compareAndSetPublishedRevision(
    input: CompareAndSetPublishedRevisionInput,
  ) {
    const existingRun = this.governanceRuns.get(input.publishedRun.runId);
    if (existingRun) {
      if (
        existingRun.inputFingerprint !== input.publishedRun.inputFingerprint
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill publication run is already bound to different facts.',
        );
      }
      return clone(existingRun);
    }
    const catalog = this.catalogs.get(input.publishedCatalog.skillId);
    if (!catalog) {
      throw new P1DomainError('NOT_FOUND', 'Skill catalog does not exist.');
    }
    if (
      catalog.activeRevisionRef !== input.expectedPublishedRevisionRef ||
      catalog.publicationGeneration !== input.expectedPublicationGeneration
    ) {
      this.governanceRuns.set(
        input.casConflictRun.runId,
        clone(input.casConflictRun),
      );
      return clone(input.casConflictRun);
    }
    for (const [edgeId, edge] of this.referenceEdges) {
      if (
        edge.consumerKind === 'published_lifecycle' &&
        edge.consumerId === catalog.skillId
      ) {
        this.referenceEdges.delete(edgeId);
      }
    }
    this.catalogs.set(
      input.publishedCatalog.skillId,
      clone(input.publishedCatalog),
    );
    this.referenceEdges.set(
      input.referenceEdge.edgeId,
      clone(input.referenceEdge),
    );
    this.governanceRuns.set(
      input.publishedRun.runId,
      clone(input.publishedRun),
    );
    return clone(input.publishedRun);
  }

  async retireRevision(input: RetireSkillRevisionInput) {
    const existingRun = this.governanceRuns.get(input.appliedRun.runId);
    if (existingRun) {
      if (
        existingRun.inputFingerprint !== input.appliedRun.inputFingerprint
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill retirement run is already bound to different facts.',
        );
      }
      return clone(existingRun);
    }
    const revision = this.revisions.get(input.targetSkillRevisionRef);
    if (!revision) {
      throw new P1DomainError('NOT_FOUND', 'Skill revision does not exist.');
    }
    if (revision.status !== 'accepted_frozen') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only an accepted frozen Skill revision can be retired.',
      );
    }
    const blocked = [...this.referenceEdges.values()].some(
      (edge) =>
        edge.targetSkillRevisionRef === input.targetSkillRevisionRef,
    );
    const run = blocked ? input.blockedRun : input.appliedRun;
    if (!blocked) {
      this.revisions.set(input.targetSkillRevisionRef, {
        ...clone(revision),
        status: 'retired',
      });
    }
    this.governanceRuns.set(run.runId, clone(run));
    return clone(run);
  }

  async applyGovernanceDraft(input: {
    run: SkillGovernanceRun;
    draft: SkillRevision | null;
    expectedHeadRevision: number;
    casConflictRun: SkillGovernanceRun;
  }) {
    const existing = this.governanceRuns.get(input.run.runId);
    if (existing) {
      if (existing.inputFingerprint !== input.run.inputFingerprint) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill governance run is already bound to different facts.',
        );
      }
      for (const edge of governanceRunReferenceEdges(existing)) {
        assertPutOnceCompatible(
          this.referenceEdges,
          edge.edgeId,
          edge,
          'Skill reference edge',
        );
        this.referenceEdges.set(edge.edgeId, clone(edge));
      }
      return clone(existing);
    }
    if (!input.draft) {
      const edges = governanceRunReferenceEdges(input.run);
      for (const edge of edges) {
        assertPutOnceCompatible(
          this.referenceEdges,
          edge.edgeId,
          edge,
          'Skill reference edge',
        );
      }
      this.governanceRuns.set(input.run.runId, clone(input.run));
      for (const edge of edges) {
        this.referenceEdges.set(edge.edgeId, clone(edge));
      }
      return clone(input.run);
    }
    const head = this.revisionHead(input.draft.skillId);
    if (
      head?.revision !== input.expectedHeadRevision ||
      input.draft.revision !== input.expectedHeadRevision + 1
    ) {
      const edges = governanceRunReferenceEdges(input.casConflictRun);
      for (const edge of edges) {
        assertPutOnceCompatible(
          this.referenceEdges,
          edge.edgeId,
          edge,
          'Skill reference edge',
        );
      }
      this.governanceRuns.set(
        input.casConflictRun.runId,
        clone(input.casConflictRun),
      );
      for (const edge of edges) {
        this.referenceEdges.set(edge.edgeId, clone(edge));
      }
      return clone(input.casConflictRun);
    }
    if (this.revisions.has(input.draft.skillRevisionRef)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Skill governance draft revision already exists.',
      );
    }
    const edges = governanceRunReferenceEdges(input.run);
    for (const edge of edges) {
      assertPutOnceCompatible(
        this.referenceEdges,
        edge.edgeId,
        edge,
        'Skill reference edge',
      );
    }
    this.revisions.set(input.draft.skillRevisionRef, clone(input.draft));
    this.governanceRuns.set(input.run.runId, clone(input.run));
    for (const edge of edges) {
      this.referenceEdges.set(edge.edgeId, clone(edge));
    }
    return clone(input.run);
  }

  async reserveGovernanceRun(reservation: SkillGovernanceReservation) {
    const edge = governanceReservationReferenceEdge(reservation);
    const existing = this.governanceReservations.get(reservation.runId);
    if (existing) {
      if (existing.inputFingerprint !== reservation.inputFingerprint) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill governance reservation is already bound to different facts.',
        );
      }
      assertPutOnceCompatible(
        this.referenceEdges,
        edge.edgeId,
        edge,
        'Skill reference edge',
      );
      this.referenceEdges.set(edge.edgeId, clone(edge));
      return clone(existing);
    }
    assertPutOnceCompatible(
      this.referenceEdges,
      edge.edgeId,
      edge,
      'Skill reference edge',
    );
    this.governanceReservations.set(
      reservation.runId,
      clone(reservation),
    );
    this.referenceEdges.set(edge.edgeId, clone(edge));
    return clone(reservation);
  }

  async getGovernanceReservation(runId: string) {
    const value = this.governanceReservations.get(runId);
    return value ? clone(value) : null;
  }

  async completeGovernanceCancellation(run: SkillGovernanceRun) {
    const reservation = this.governanceReservations.get(run.runId);
    if (
      !reservation ||
      reservation.inputFingerprint !== run.inputFingerprint
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Skill governance cancellation does not match its reserved facts.',
      );
    }
    const edges = governanceRunReferenceEdges(run);
    for (const edge of edges) {
      assertPutOnceCompatible(
        this.referenceEdges,
        edge.edgeId,
        edge,
        'Skill reference edge',
      );
    }
    const stored = putOnce(
      this.governanceRuns,
      run.runId,
      run,
      'Skill governance run',
    );
    for (const edge of edges) {
      this.referenceEdges.set(edge.edgeId, clone(edge));
    }
    return stored;
  }

  async getGovernanceRun(runId: string) {
    const value = this.governanceRuns.get(runId);
    return value ? clone(value) : null;
  }

  async putImmutable(runId: string, input: EvalRun) {
    const run = evalRunSchema.parse(input);
    if (run.runId !== runId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Skill EvalRun ID must match the immutable registry key.',
      );
    }
    const edges = evalRunReferenceEdges(run);
    assertPutOnceCompatible(
      this.evalRuns,
      run.runId,
      run,
      'Skill EvalRun',
    );
    for (const edge of edges) {
      assertPutOnceCompatible(
        this.referenceEdges,
        edge.edgeId,
        edge,
        'Skill reference edge',
      );
    }
    this.evalRuns.set(run.runId, clone(run));
    for (const edge of edges) {
      this.referenceEdges.set(edge.edgeId, clone(edge));
    }
    return clone(run);
  }

  async get(runId: string) {
    const value = this.evalRuns.get(runId);
    return value ? evalRunSchema.parse(clone(value)) : null;
  }

  async putBinding(binding: SkillBinding) {
    const canonical: SkillBinding = {
      ...binding,
      triggerCondition: {
        harnessStage: binding.triggerCondition.harnessStage,
        industryCategory: binding.triggerCondition.industryCategory ?? null,
        tenantId: binding.triggerCondition.tenantId ?? null,
      },
    };
    this.assertBindingSlotAvailable(canonical);
    const edge = bindingReferenceEdge(canonical);
    assertPutOnceCompatible(
      this.bindings,
      canonical.bindingId,
      canonical,
      'Skill binding',
    );
    assertPutOnceCompatible(
      this.referenceEdges,
      edge.edgeId,
      edge,
      'Skill reference edge',
    );
    this.bindings.set(canonical.bindingId, clone(canonical));
    this.referenceEdges.set(edge.edgeId, clone(edge));
    return clone(canonical);
  }

  async supersedeBinding(
    sourceBindingId: string,
    replacement: SkillBinding,
  ) {
    const source = this.bindings.get(sourceBindingId);
    if (
      !source ||
      source.status !== 'active' ||
      source.mode === 'planner_selected'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only an active Skill binding can be superseded.',
      );
    }
    const superseded: SkillBinding = {
      ...source,
      status: 'superseded',
      supersededAt: replacement.createdAt,
      supersededByBindingId: replacement.bindingId,
      mode: source.mode,
    };
    this.bindings.set(sourceBindingId, clone(superseded));
    try {
      return await this.putBinding(replacement);
    } catch (error) {
      this.bindings.set(sourceBindingId, source);
      throw error;
    }
  }

  async getBinding(bindingId: string) {
    const value = this.bindings.get(bindingId);
    return value ? clone(value) : null;
  }

  async listBindings(
    workflowRevisionRef: string,
    triggerCondition: SkillTriggerCondition,
  ) {
    return [...this.bindings.values()]
      .filter(
        (binding): binding is SkillBinding =>
          binding.workflowRevisionRef === workflowRevisionRef &&
          triggerConditionMatches(binding.triggerCondition, triggerCondition) &&
          binding.status === 'active' &&
          binding.mode !== 'planner_selected',
      )
      .map(clone);
  }

  async listActiveBindingsForWorkflow(workflowRevisionRef: string) {
    return [...this.bindings.values()]
      .filter(
        (binding): binding is SkillBinding =>
          binding.workflowRevisionRef === workflowRevisionRef &&
          binding.status === 'active' &&
          binding.mode !== 'planner_selected',
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.bindingId.localeCompare(right.bindingId),
      )
      .map(clone);
  }

  async retireLegacyPlannerSelectedBindings(retiredAt: string) {
    let retired = 0;
    for (const [bindingId, binding] of this.bindings) {
      if (
        binding.status !== 'active' ||
        binding.mode !== 'planner_selected'
      ) {
        continue;
      }
      this.bindings.set(bindingId, {
        ...binding,
        status: 'superseded',
        supersededAt: retiredAt,
        supersededByBindingId: null,
      });
      retired += 1;
    }
    return retired;
  }

  private assertBindingSlotAvailable(binding: SkillBinding) {
    const conflict = [...this.bindings.values()].find(
      (candidate) =>
        candidate.status === 'active' &&
        candidate.workflowRevisionRef === binding.workflowRevisionRef &&
        isDeepStrictEqual(
          candidate.triggerCondition,
          binding.triggerCondition,
        ) &&
        candidate.skillId === binding.skillId,
    );
    if (conflict && conflict.bindingId !== binding.bindingId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Workflow stage already has an active binding for this Skill.',
      );
    }
  }

  async putDeployment(
    deployment: SkillDeployment,
    referenceScope: SkillReferenceScope = { kind: 'unknown' },
  ) {
    const edge = deploymentReferenceEdge(deployment, referenceScope);
    assertPutOnceCompatible(
      this.deployments,
      deployment.deploymentId,
      deployment,
      'Skill deployment',
    );
    assertPutOnceCompatible(
      this.referenceEdges,
      edge.edgeId,
      edge,
      'Skill reference edge',
    );
    this.deployments.set(deployment.deploymentId, clone(deployment));
    this.referenceEdges.set(edge.edgeId, clone(edge));
    return clone(deployment);
  }

  async getDeployment(deploymentId: string) {
    const value = this.deployments.get(deploymentId);
    return value ? clone(value) : null;
  }

  async putChildEffect(effect: SkillChildEffect) {
    return putOnce(this.effects, effect.effectId, effect, 'Skill child effect');
  }

  async updateChildEffect(effect: SkillChildEffect) {
    const existing = this.effects.get(effect.effectId);
    if (!existing || existing.fingerprint !== effect.fingerprint) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only the matching Skill child effect can advance its retry state.',
      );
    }
    this.effects.set(effect.effectId, clone(effect));
    return clone(effect);
  }

  async getChildEffect(effectId: string) {
    const value = this.effects.get(effectId);
    return value ? clone(value) : null;
  }

  async putInvocationReceipt(receipt: SkillInvocationReceipt) {
    const edge = invocationReceiptReferenceEdge(receipt);
    assertPutOnceCompatible(
      this.receipts,
      receipt.invocationId,
      receipt,
      'Skill invocation receipt',
    );
    assertPutOnceCompatible(
      this.referenceEdges,
      edge.edgeId,
      edge,
      'Skill reference edge',
    );
    this.receipts.set(receipt.invocationId, clone(receipt));
    this.referenceEdges.set(edge.edgeId, clone(edge));
    return clone(receipt);
  }

  async getInvocationReceipt(invocationId: string) {
    const value = this.receipts.get(invocationId);
    return value ? clone(value) : null;
  }

  async putReferenceEdge(edge: SkillReferenceEdge) {
    return putOnce(
      this.referenceEdges,
      edge.edgeId,
      edge,
      'Skill reference edge',
    );
  }

  async listReferenceEdges(targetSkillRevisionRef: string) {
    return [...this.referenceEdges.values()]
      .filter(
        (edge) => edge.targetSkillRevisionRef === targetSkillRevisionRef,
      )
      .sort(
        (left, right) =>
          left.consumerKind.localeCompare(right.consumerKind) ||
          left.consumerId.localeCompare(right.consumerId) ||
          left.edgeId.localeCompare(right.edgeId),
      )
      .map(clone);
  }

  async inspectReferenceEdges(
    targetSkillRevisionRef: string,
    viewerWorkspaceId: string,
  ) {
    const edges = await this.listReferenceEdges(targetSkillRevisionRef);
    const visibleDependencies = edges.filter(
      (edge) =>
        edge.scope.kind === 'global' ||
        (edge.scope.kind === 'workspace' &&
          edge.scope.workspaceId === viewerWorkspaceId),
    );
    return {
      visibleDependencies,
      hiddenCount: edges.length - visibleDependencies.length,
    };
  }
}

function triggerConditionMatches(
  binding: SkillTriggerCondition,
  query: SkillTriggerCondition,
) {
  return (
    binding.harnessStage === query.harnessStage &&
    (!binding.industryCategory ||
      binding.industryCategory === query.industryCategory) &&
    (!binding.tenantId || binding.tenantId === query.tenantId)
  );
}
