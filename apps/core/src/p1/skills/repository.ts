import { isDeepStrictEqual } from 'node:util';

import { P1DomainError } from '../foundation/domain.js';
import type {
  SkillBinding,
  SkillCatalog,
  SkillChildEffect,
  SkillDeployment,
  SkillInvocationReceipt,
  SkillRevision,
  SkillStage,
} from './types.js';

export interface SkillRepository {
  putCatalog(catalog: SkillCatalog): Promise<SkillCatalog>;
  getCatalog(skillId: string): Promise<SkillCatalog | null>;
  putRevision(
    revision: SkillRevision,
    expectedRevision: number | null,
  ): Promise<SkillRevision>;
  acceptRevision(revision: SkillRevision): Promise<SkillRevision>;
  getRevision(skillRevisionRef: string): Promise<SkillRevision | null>;
  getRevisionHead(skillId: string): Promise<SkillRevision | null>;
  putBinding(binding: SkillBinding): Promise<SkillBinding>;
  getBinding(bindingId: string): Promise<SkillBinding | null>;
  listBindings(
    workflowRevisionRef: string,
    stage: SkillStage,
  ): Promise<SkillBinding[]>;
  putDeployment(deployment: SkillDeployment): Promise<SkillDeployment>;
  getDeployment(deploymentId: string): Promise<SkillDeployment | null>;
  putChildEffect(effect: SkillChildEffect): Promise<SkillChildEffect>;
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
  private readonly bindings = new Map<string, SkillBinding>();
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
    const values = [...this.revisions.values()]
      .filter((revision) => revision.skillId === skillId)
      .sort((left, right) => right.revision - left.revision);
    return values[0] ? clone(values[0]) : null;
  }

  async putBinding(binding: SkillBinding) {
    return putOnce(
      this.bindings,
      binding.bindingId,
      binding,
      'Skill binding',
    );
  }

  async getBinding(bindingId: string) {
    const value = this.bindings.get(bindingId);
    return value ? clone(value) : null;
  }

  async listBindings(workflowRevisionRef: string, stage: SkillStage) {
    return [...this.bindings.values()]
      .filter(
        (binding) =>
          binding.workflowRevisionRef === workflowRevisionRef &&
          binding.stage === stage,
      )
      .map(clone);
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
