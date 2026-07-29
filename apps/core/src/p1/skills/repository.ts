import { isDeepStrictEqual } from 'node:util';

import { evalRunSchema, type EvalRun } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type { EvalRunRegistryPort } from '../harness/eval-run-registry.js';
import type {
  AuditedSkillBinding,
  SkillBinding,
  SkillCatalog,
  SkillChildEffect,
  SkillDeployment,
  SkillGovernanceRun,
  SkillInvocationReceipt,
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
  applyGovernanceDraft(input: {
    run: SkillGovernanceRun;
    draft: SkillRevision | null;
    expectedHeadRevision: number;
    casConflictRun: SkillGovernanceRun;
  }): Promise<SkillGovernanceRun>;
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
  retireLegacyPlannerSelectedBindings(retiredAt: string): Promise<number>;
  putDeployment(deployment: SkillDeployment): Promise<SkillDeployment>;
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
}

function clone<T>(value: T): T {
  return structuredClone(value);
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

export class MemorySkillRepository implements SkillRepository {
  private readonly catalogs = new Map<string, SkillCatalog>();
  private readonly revisions = new Map<string, SkillRevision>();
  private readonly governanceRuns = new Map<string, SkillGovernanceRun>();
  private readonly evalRuns = new Map<string, EvalRun>();
  private readonly bindings = new Map<string, AuditedSkillBinding>();
  private readonly deployments = new Map<string, SkillDeployment>();
  private readonly effects = new Map<string, SkillChildEffect>();
  private readonly receipts = new Map<string, SkillInvocationReceipt>();

  async putCatalog(catalog: SkillCatalog) {
    this.catalogs.set(catalog.skillId, clone(catalog));
    return clone(catalog);
  }

  async getCatalog(skillId: string) {
    const value = this.catalogs.get(skillId);
    return value ? clone(value) : null;
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
    return matches.slice(0, filter?.limit ?? matches.length).map(clone);
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
      return clone(existing);
    }
    if (!input.draft) {
      this.governanceRuns.set(input.run.runId, clone(input.run));
      return clone(input.run);
    }
    const head = this.revisionHead(input.draft.skillId);
    if (
      head?.revision !== input.expectedHeadRevision ||
      input.draft.revision !== input.expectedHeadRevision + 1
    ) {
      this.governanceRuns.set(
        input.casConflictRun.runId,
        clone(input.casConflictRun),
      );
      return clone(input.casConflictRun);
    }
    if (this.revisions.has(input.draft.skillRevisionRef)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Skill governance draft revision already exists.',
      );
    }
    this.revisions.set(input.draft.skillRevisionRef, clone(input.draft));
    this.governanceRuns.set(input.run.runId, clone(input.run));
    return clone(input.run);
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
    return putOnce(this.evalRuns, run.runId, run, 'Skill EvalRun');
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
    const stored = putOnce(
      this.bindings,
      canonical.bindingId,
      canonical,
      'Skill binding',
    );
    return stored as SkillBinding;
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

  async putDeployment(deployment: SkillDeployment) {
    return putOnce(
      this.deployments,
      deployment.deploymentId,
      deployment,
      'Skill deployment',
    );
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
    return putOnce(
      this.receipts,
      receipt.invocationId,
      receipt,
      'Skill invocation receipt',
    );
  }

  async getInvocationReceipt(invocationId: string) {
    const value = this.receipts.get(invocationId);
    return value ? clone(value) : null;
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
