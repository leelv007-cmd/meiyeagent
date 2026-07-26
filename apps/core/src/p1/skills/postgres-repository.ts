import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import type { SkillRepository } from './repository.js';
import type {
  SkillBinding,
  SkillCatalog,
  SkillChildEffect,
  SkillDeployment,
  SkillInvocationReceipt,
  SkillRevision,
  SkillStage,
} from './types.js';

type PayloadRow<T> = { payload: T };

export class PostgresSkillRepository implements SkillRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_skill_catalogs (
        skill_id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p1_skill_revision_heads (
        skill_id text PRIMARY KEY,
        revision bigint NOT NULL CHECK (revision >= 0)
      );
      CREATE TABLE IF NOT EXISTS p1_skill_revisions (
        skill_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        skill_revision_ref text NOT NULL UNIQUE,
        status text NOT NULL CHECK (status IN ('draft', 'accepted_frozen')),
        content_hash text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (skill_id, revision)
      );
      CREATE TABLE IF NOT EXISTS p1_skill_bindings (
        binding_id text PRIMARY KEY,
        workflow_revision_ref text NOT NULL,
        stage text NOT NULL,
        skill_revision_ref text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_skill_bindings_stage_idx
        ON p1_skill_bindings (workflow_revision_ref, stage, created_at, binding_id);
      CREATE TABLE IF NOT EXISTS p1_skill_deployments (
        deployment_id text PRIMARY KEY,
        skill_revision_ref text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p1_skill_child_effects (
        effect_id text PRIMARY KEY,
        invocation_id text NOT NULL,
        idempotency_key text NOT NULL UNIQUE,
        fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_skill_child_effects_invocation_idx
        ON p1_skill_child_effects (invocation_id, created_at, effect_id);
      CREATE TABLE IF NOT EXISTS p1_skill_invocation_receipts (
        invocation_id text PRIMARY KEY,
        skill_revision_ref text NOT NULL,
        input_fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
    `);
  }

  async putCatalog(catalog: SkillCatalog) {
    const result = await this.pool.query<PayloadRow<SkillCatalog>>(
      `INSERT INTO p1_skill_catalogs (skill_id, payload, updated_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (skill_id) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = EXCLUDED.updated_at
       RETURNING payload`,
      [catalog.skillId, JSON.stringify(catalog), catalog.updatedAt],
    );
    return cloneRow(result.rows[0]!);
  }

  async getCatalog(skillId: string) {
    return this.getOne<SkillCatalog>(
      'p1_skill_catalogs',
      'skill_id',
      skillId,
    );
  }

  async putRevision(
    revision: SkillRevision,
    expectedRevision: number | null,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO p1_skill_revision_heads (skill_id, revision)
         VALUES ($1, 0)
         ON CONFLICT (skill_id) DO NOTHING`,
        [revision.skillId],
      );
      const head = await client.query<{ revision: string }>(
        `SELECT revision::text AS revision
           FROM p1_skill_revision_heads
          WHERE skill_id = $1
          FOR UPDATE`,
        [revision.skillId],
      );
      const current = Number(head.rows[0]?.revision ?? 0);
      if (current !== (expectedRevision ?? 0) || revision.revision !== current + 1) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill revision head changed before the write.',
        );
      }
      await client.query(
        `INSERT INTO p1_skill_revisions
           (skill_id, revision, skill_revision_ref, status, content_hash, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [
          revision.skillId,
          revision.revision,
          revision.skillRevisionRef,
          revision.status,
          revision.contentHash,
          JSON.stringify(revision),
          revision.createdAt,
        ],
      );
      await client.query(
        `UPDATE p1_skill_revision_heads SET revision = $2 WHERE skill_id = $1`,
        [revision.skillId, revision.revision],
      );
      await client.query('COMMIT');
      return structuredClone(revision);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptRevision(revision: SkillRevision) {
    const result = await this.pool.query<PayloadRow<SkillRevision>>(
      `UPDATE p1_skill_revisions
          SET status = 'accepted_frozen',
              payload = $2::jsonb
        WHERE skill_revision_ref = $1
          AND status = 'draft'
          AND content_hash = $3
       RETURNING payload`,
      [
        revision.skillRevisionRef,
        JSON.stringify(revision),
        revision.contentHash,
      ],
    );
    if (!result.rows[0]) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only an unchanged draft Skill revision can be accepted and frozen.',
      );
    }
    return cloneRow(result.rows[0]);
  }

  async getRevision(skillRevisionRef: string) {
    return this.getOne<SkillRevision>(
      'p1_skill_revisions',
      'skill_revision_ref',
      skillRevisionRef,
    );
  }

  async getRevisionHead(skillId: string) {
    const result = await this.pool.query<PayloadRow<SkillRevision>>(
      `SELECT revisions.payload
         FROM p1_skill_revision_heads heads
         JOIN p1_skill_revisions revisions
           ON revisions.skill_id = heads.skill_id
          AND revisions.revision = heads.revision
        WHERE heads.skill_id = $1`,
      [skillId],
    );
    return result.rows[0] ? cloneRow(result.rows[0]) : null;
  }

  putBinding(binding: SkillBinding) {
    return this.putOnce(
      'p1_skill_bindings',
      'binding_id',
      binding.bindingId,
      binding,
      ['workflow_revision_ref', 'stage', 'skill_revision_ref', 'created_at'],
      [
        binding.workflowRevisionRef,
        binding.stage,
        binding.skillRevisionRef,
        binding.createdAt,
      ],
      'Skill binding',
    );
  }

  getBinding(bindingId: string) {
    return this.getOne<SkillBinding>(
      'p1_skill_bindings',
      'binding_id',
      bindingId,
    );
  }

  async listBindings(workflowRevisionRef: string, stage: SkillStage) {
    const result = await this.pool.query<PayloadRow<SkillBinding>>(
      `SELECT payload
         FROM p1_skill_bindings
        WHERE workflow_revision_ref = $1 AND stage = $2
        ORDER BY created_at, binding_id`,
      [workflowRevisionRef, stage],
    );
    return result.rows.map(cloneRow);
  }

  putDeployment(deployment: SkillDeployment) {
    return this.putOnce(
      'p1_skill_deployments',
      'deployment_id',
      deployment.deploymentId,
      deployment,
      ['skill_revision_ref', 'created_at'],
      [deployment.skillRevisionRef, deployment.createdAt],
      'Skill deployment',
    );
  }

  getDeployment(deploymentId: string) {
    return this.getOne<SkillDeployment>(
      'p1_skill_deployments',
      'deployment_id',
      deploymentId,
    );
  }

  putChildEffect(effect: SkillChildEffect) {
    return this.putOnce(
      'p1_skill_child_effects',
      'effect_id',
      effect.effectId,
      effect,
      [
        'invocation_id',
        'idempotency_key',
        'fingerprint',
        'created_at',
      ],
      [
        effect.invocationId,
        effect.idempotencyKey,
        effect.fingerprint,
        effect.createdAt,
      ],
      'Skill child effect',
    );
  }

  getChildEffect(effectId: string) {
    return this.getOne<SkillChildEffect>(
      'p1_skill_child_effects',
      'effect_id',
      effectId,
    );
  }

  putInvocationReceipt(receipt: SkillInvocationReceipt) {
    return this.putOnce(
      'p1_skill_invocation_receipts',
      'invocation_id',
      receipt.invocationId,
      receipt,
      ['skill_revision_ref', 'input_fingerprint', 'created_at'],
      [
        receipt.skillRevisionRef,
        receipt.inputFingerprint,
        receipt.createdAt,
      ],
      'Skill invocation receipt',
    );
  }

  getInvocationReceipt(invocationId: string) {
    return this.getOne<SkillInvocationReceipt>(
      'p1_skill_invocation_receipts',
      'invocation_id',
      invocationId,
    );
  }

  private async getOne<T>(
    table: string,
    idColumn: string,
    id: string,
  ): Promise<T | null> {
    const result = await this.pool.query<PayloadRow<T>>(
      `SELECT payload FROM ${table} WHERE ${idColumn} = $1`,
      [id],
    );
    return result.rows[0] ? cloneRow(result.rows[0]) : null;
  }

  private async putOnce<T>(
    table: string,
    idColumn: string,
    id: string,
    payload: T,
    extraColumns: string[],
    extraValues: unknown[],
    label: string,
  ): Promise<T> {
    const columns = [idColumn, 'payload', ...extraColumns];
    const parameters = columns.map((column, index) =>
      column === 'payload' ? `$${index + 1}::jsonb` : `$${index + 1}`,
    );
    const values = [id, JSON.stringify(payload), ...extraValues];
    const result = await this.pool.query<PayloadRow<T>>(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES (${parameters.join(', ')})
       ON CONFLICT (${idColumn}) DO NOTHING
       RETURNING payload`,
      values,
    );
    if (result.rows[0]) return cloneRow(result.rows[0]);
    const existing = await this.getOne<T>(table, idColumn, id);
    if (existing && isDeepStrictEqual(existing, payload)) return existing;
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `${label} is already bound to different facts.`,
    );
  }
}

function cloneRow<T>(row: PayloadRow<T>) {
  return structuredClone(row.payload);
}
