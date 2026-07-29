import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { P1DomainError } from '../foundation/domain.js';
import type { SkillRepository } from './repository.js';
import {
  validateSkillFrontmatter,
  validateSkillPermissionAuthority,
} from './skill-format.js';
import { parseSkillGovernance } from './skill-governance.js';
import type {
  AuditedSkillBinding,
  LegacySkillRevisionManifest,
  SkillBinding,
  SkillCatalog,
  SkillChildEffect,
  SkillDeployment,
  SkillInvocationReceipt,
  SkillRevision,
  SkillTriggerCondition,
} from './types.js';

type PayloadRow<T> = { payload: T };
type RevisionRow = PayloadRow<Record<string, unknown>> & {
  format_version: number;
  frontmatter: unknown;
  governance_sidecar: unknown;
  prompt_name: string | null;
  prompt_version: string | null;
  prompt_content_hash: string | null;
  prompt_label: string | null;
  prompt_source: string | null;
  prompt_is_fallback: boolean | null;
  prompt_fallback_reason: string | null;
  prompt_fallback_content: string | null;
};
type BindingPayloadRow = PayloadRow<AuditedSkillBinding> & {
  stage: string;
};

const revisionPayloadV2Schema = z
  .object({
    formatVersion: z.literal(2),
    skillId: z.string().trim().min(1),
    revision: z.number().int().positive(),
    skillRevisionRef: z.string().trim().min(1),
    contentHash: z.string().trim().min(1),
    instruction: z.string().trim().min(1),
    packagePaths: z.array(z.string()),
    status: z.enum(['draft', 'accepted_frozen']),
    createdAt: z.string().trim().min(1),
    createdBy: z.string().trim().min(1),
    acceptedAt: z.string().trim().min(1).nullable(),
    acceptedBy: z.string().trim().min(1).nullable(),
    evalRunId: z.string().trim().min(1).nullable(),
  })
  .strict();
const persistedPromptSchema = z
  .object({
    contentHash: z.string().trim().min(1),
    fallbackContent: z.string(),
    isFallback: z.boolean(),
    label: z.string().trim().min(1),
    name: z.string().trim().min(1),
    source: z.enum(['langfuse', 'builtin']),
    version: z.string().trim().min(1),
    fallbackReason: z.string().trim().min(1).optional(),
  })
  .strict();
const legacyRevisionPayloadSchema = z
  .object({
    skillId: z.string().trim().min(1),
    revision: z.number().int().positive(),
    skillRevisionRef: z.string().trim().min(1),
    contentHash: z.string().trim().min(1),
    instruction: z.string().trim().min(1),
    packagePaths: z.array(z.string()).optional(),
    manifest: z.record(z.string(), z.unknown()),
    governance: z.record(z.string(), z.unknown()).optional(),
    prompt: z
      .object({
        contentHash: z.string().trim().min(1),
        content: z.string().optional(),
        fallbackContent: z.string().optional(),
        isFallback: z.boolean(),
        label: z.string().trim().min(1),
        name: z.string().trim().min(1),
        source: z.enum(['langfuse', 'builtin']),
        version: z.string().trim().min(1),
        fallbackReason: z.string().trim().min(1).optional(),
      })
      .strict(),
    status: z.enum(['draft', 'accepted_frozen']),
    createdAt: z.string().trim().min(1),
    createdBy: z.string().trim().min(1),
    acceptedAt: z.string().trim().min(1).nullable(),
    acceptedBy: z.string().trim().min(1).nullable(),
    evalRunId: z.string().trim().min(1).nullable(),
  })
  .strict();

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
      ALTER TABLE p1_skill_revisions
        ADD COLUMN IF NOT EXISTS format_version smallint NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS frontmatter jsonb,
        ADD COLUMN IF NOT EXISTS governance_sidecar jsonb,
        ADD COLUMN IF NOT EXISTS prompt_name text,
        ADD COLUMN IF NOT EXISTS prompt_version text,
        ADD COLUMN IF NOT EXISTS prompt_content_hash text,
        ADD COLUMN IF NOT EXISTS prompt_label text,
        ADD COLUMN IF NOT EXISTS prompt_source text,
        ADD COLUMN IF NOT EXISTS prompt_is_fallback boolean,
        ADD COLUMN IF NOT EXISTS prompt_fallback_reason text,
        ADD COLUMN IF NOT EXISTS prompt_fallback_content text;
      DO $$
      BEGIN
        ALTER TABLE p1_skill_revisions
          ADD CONSTRAINT p1_skill_revisions_format_sidecars_ck
          CHECK (
            format_version IN (1, 2)
            AND (
              format_version = 1
              OR (
                frontmatter IS NOT NULL
                AND governance_sidecar IS NOT NULL
                AND prompt_name IS NOT NULL
                AND prompt_version IS NOT NULL
                AND prompt_content_hash IS NOT NULL
                AND prompt_label IS NOT NULL
                AND prompt_source IS NOT NULL
                AND prompt_is_fallback IS NOT NULL
                AND prompt_fallback_content IS NOT NULL
              )
            )
          );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $$;
      CREATE TABLE IF NOT EXISTS p1_skill_bindings (
        binding_id text PRIMARY KEY,
        workflow_revision_ref text NOT NULL,
        stage text NOT NULL,
        skill_id text NOT NULL,
        skill_revision_ref text NOT NULL,
        status text NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'superseded')),
        superseded_at timestamptz,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      ALTER TABLE p1_skill_bindings
        ADD COLUMN IF NOT EXISTS skill_id text,
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
        ADD COLUMN IF NOT EXISTS trigger_condition jsonb;
      UPDATE p1_skill_bindings
         SET skill_id = regexp_replace(skill_revision_ref, '@[^@]+$', '')
       WHERE skill_id IS NULL;
      ALTER TABLE p1_skill_bindings
        ALTER COLUMN skill_id SET NOT NULL;
      UPDATE p1_skill_bindings
         SET trigger_condition = jsonb_build_object(
           'harnessStage',
           COALESCE(
             trigger_condition->>'harnessStage',
             payload->'triggerCondition'->>'harnessStage',
             stage
           ),
           'industryCategory',
           trigger_condition->'industryCategory',
           'tenantId',
           trigger_condition->'tenantId'
         );
      ALTER TABLE p1_skill_bindings
        ALTER COLUMN trigger_condition SET NOT NULL;
      UPDATE p1_skill_bindings
         SET status = 'superseded',
             superseded_at = COALESCE(superseded_at, now()),
             payload = jsonb_set(
               jsonb_set(payload, '{status}', '"superseded"'),
               '{supersededAt}',
               to_jsonb(COALESCE(superseded_at, now())::text)
             )
       WHERE status = 'active'
         AND payload->>'mode' = 'planner_selected';
      WITH ranked AS (
        SELECT binding_id,
               row_number() OVER (
                 PARTITION BY workflow_revision_ref, trigger_condition, skill_id
                 ORDER BY created_at DESC, binding_id DESC
               ) AS position
          FROM p1_skill_bindings
         WHERE status = 'active'
      )
      UPDATE p1_skill_bindings bindings
         SET status = 'superseded',
             superseded_at = COALESCE(bindings.superseded_at, now()),
             payload = jsonb_set(
               jsonb_set(bindings.payload, '{status}', '"superseded"'),
               '{supersededAt}',
               to_jsonb(COALESCE(bindings.superseded_at, now())::text)
             )
        FROM ranked
       WHERE bindings.binding_id = ranked.binding_id
         AND ranked.position > 1;
      CREATE INDEX IF NOT EXISTS p1_skill_bindings_trigger_idx
        ON p1_skill_bindings (
          workflow_revision_ref,
          (trigger_condition->>'harnessStage'),
          (trigger_condition->>'industryCategory'),
          (trigger_condition->>'tenantId'),
          created_at,
          binding_id
        );
      CREATE UNIQUE INDEX IF NOT EXISTS p1_skill_bindings_active_trigger_uq
        ON p1_skill_bindings (
          workflow_revision_ref,
          trigger_condition,
          skill_id
        )
        WHERE status = 'active';
      DROP INDEX IF EXISTS p1_skill_bindings_stage_idx;
      DROP INDEX IF EXISTS p1_skill_bindings_active_slot_uq;
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
    if (revision.formatVersion !== 2) {
      throw new P1DomainError(
        'INVALID_STATE',
        'New Skill revision writes require storage format v2.',
      );
    }
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
           (skill_id, revision, skill_revision_ref, status, content_hash,
            format_version, frontmatter, governance_sidecar,
            prompt_name, prompt_version, prompt_content_hash, prompt_label,
            prompt_source, prompt_is_fallback, prompt_fallback_reason,
            prompt_fallback_content, payload, created_at)
         VALUES (
           $1, $2, $3, $4, $5, 2, $6::jsonb, $7::jsonb,
           $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb,
           $17::timestamptz
         )`,
        [
          revision.skillId,
          revision.revision,
          revision.skillRevisionRef,
          revision.status,
          revision.contentHash,
          JSON.stringify(revision.manifest),
          JSON.stringify(revision.governance),
          revision.prompt.name,
          revision.prompt.version,
          revision.prompt.contentHash,
          revision.prompt.label,
          revision.prompt.source,
          revision.prompt.isFallback,
          revision.prompt.fallbackReason ?? null,
          revision.prompt.fallbackContent,
          JSON.stringify(revisionPayloadV2(revision)),
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
    const payload =
      revision.formatVersion === 2
        ? revisionPayloadV2(revision)
        : revisionPayloadV1(revision);
    const result = await this.pool.query<PayloadRow<Record<string, unknown>>>(
      `UPDATE p1_skill_revisions
          SET status = 'accepted_frozen',
              payload = $2::jsonb
        WHERE skill_revision_ref = $1
          AND status = 'draft'
          AND content_hash = $3
       RETURNING payload`,
      [
        revision.skillRevisionRef,
        JSON.stringify(payload),
        revision.contentHash,
      ],
    );
    if (!result.rows[0]) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only an unchanged draft Skill revision can be accepted and frozen.',
      );
    }
    return structuredClone(revision);
  }

  async getRevision(skillRevisionRef: string) {
    const result = await this.pool.query<RevisionRow>(
      `${revisionSelect()}
        WHERE skill_revision_ref = $1`,
      [skillRevisionRef],
    );
    return result.rows[0] ? cloneRevisionRow(result.rows[0]) : null;
  }

  async getRevisionHead(skillId: string) {
    const result = await this.pool.query<RevisionRow>(
      `SELECT revisions.*
         FROM p1_skill_revision_heads heads
         JOIN p1_skill_revisions revisions
           ON revisions.skill_id = heads.skill_id
          AND revisions.revision = heads.revision
        WHERE heads.skill_id = $1`,
      [skillId],
    );
    return result.rows[0] ? cloneRevisionRow(result.rows[0]) : null;
  }

  async putBinding(binding: SkillBinding) {
    const canonical = normalizeBindingCondition(binding) as SkillBinding;
    const result = await this.pool.query<PayloadRow<SkillBinding>>(
      `INSERT INTO p1_skill_bindings
         (binding_id, workflow_revision_ref, stage, trigger_condition, skill_id,
          skill_revision_ref, status, superseded_at, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::timestamptz, $9::jsonb, $10::timestamptz)
       ON CONFLICT (binding_id) DO NOTHING
       RETURNING payload`,
      [
        canonical.bindingId,
        canonical.workflowRevisionRef,
        canonical.triggerCondition.harnessStage,
        JSON.stringify(canonical.triggerCondition),
        canonical.skillId,
        canonical.skillRevisionRef,
        canonical.status,
        canonical.supersededAt,
        JSON.stringify(canonical),
        canonical.createdAt,
      ],
    );
    if (result.rows[0]) return cloneRow(result.rows[0]);
    const existing = await this.getBindingById(canonical.bindingId);
    if (
      existing &&
      isDeepStrictEqual(
        normalizeBindingCondition(existing),
        canonical,
      )
    ) {
      return existing as SkillBinding;
    }
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Skill binding is already bound to different facts.',
    );
  }

  async supersedeBinding(
    sourceBindingId: string,
    replacement: SkillBinding,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const superseded = await client.query(
        `UPDATE p1_skill_bindings
            SET status = 'superseded',
                superseded_at = $2::timestamptz,
                payload = jsonb_set(
                  jsonb_set(
                    jsonb_set(payload, '{status}', '"superseded"'),
                    '{supersededAt}',
                    to_jsonb($2::text)
                  ),
                  '{supersededByBindingId}',
                  to_jsonb($3::text)
                )
          WHERE binding_id = $1
            AND status = 'active'`,
        [sourceBindingId, replacement.createdAt, replacement.bindingId],
      );
      if (superseded.rowCount !== 1) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Only an active Skill binding can be superseded.',
        );
      }
      await client.query(
        `INSERT INTO p1_skill_bindings
           (binding_id, workflow_revision_ref, stage, trigger_condition, skill_id,
            skill_revision_ref, status, superseded_at, payload, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::timestamptz, $9::jsonb, $10::timestamptz)`,
        [
          replacement.bindingId,
          replacement.workflowRevisionRef,
          replacement.triggerCondition.harnessStage,
          JSON.stringify(replacement.triggerCondition),
          replacement.skillId,
          replacement.skillRevisionRef,
          replacement.status,
          replacement.supersededAt,
          JSON.stringify(replacement),
          replacement.createdAt,
        ],
      );
      await client.query('COMMIT');
      return structuredClone(replacement);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  getBinding(bindingId: string) {
    return this.getBindingById(bindingId);
  }

  async listBindings(
    workflowRevisionRef: string,
    triggerCondition: SkillTriggerCondition,
  ) {
    const result = await this.pool.query<BindingPayloadRow>(
      `SELECT payload, stage
         FROM p1_skill_bindings
        WHERE workflow_revision_ref = $1
          AND trigger_condition->>'harnessStage' = $2
          AND (
            trigger_condition->>'industryCategory' IS NULL
            OR trigger_condition->>'industryCategory' = $3
          )
          AND (
            trigger_condition->>'tenantId' IS NULL
            OR trigger_condition->>'tenantId' = $4
          )
          AND status = 'active'
          AND payload->>'mode' IS DISTINCT FROM 'planner_selected'
        ORDER BY created_at, binding_id`,
      [
        workflowRevisionRef,
        triggerCondition.harnessStage,
        triggerCondition.industryCategory ?? null,
        triggerCondition.tenantId ?? null,
      ],
    );
    return result.rows.map(cloneBindingRow) as SkillBinding[];
  }

  async retireLegacyPlannerSelectedBindings(retiredAt: string) {
    const result = await this.pool.query(
      `UPDATE p1_skill_bindings
          SET status = 'superseded',
              superseded_at = $1::timestamptz,
              payload = jsonb_set(
                jsonb_set(payload, '{status}', '"superseded"'),
                '{supersededAt}',
                to_jsonb($1::text)
              )
        WHERE status = 'active'
          AND payload->>'mode' = 'planner_selected'`,
      [retiredAt],
    );
    return result.rowCount ?? 0;
  }

  async putDeployment(deployment: SkillDeployment) {
    const result = await this.pool.query<PayloadRow<SkillDeployment>>(
      `INSERT INTO p1_skill_deployments
         (deployment_id, payload, skill_revision_ref, created_at)
       VALUES ($1, $2::jsonb, $3, $4::timestamptz)
       ON CONFLICT (deployment_id) DO NOTHING
       RETURNING payload`,
      [
        deployment.deploymentId,
        JSON.stringify(deployment),
        deployment.skillRevisionRef,
        deployment.createdAt,
      ],
    );
    if (result.rows[0]) return cloneRow(result.rows[0]);
    const existing = await this.getDeployment(deployment.deploymentId);
    if (existing && isDeepStrictEqual(existing, deployment)) return existing;
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Skill deployment is already bound to different facts.',
    );
  }

  async getDeployment(deploymentId: string) {
    const result = await this.pool.query<
      PayloadRow<SkillDeployment | LegacySkillDeployment>
    >(
      `SELECT payload
         FROM p1_skill_deployments
        WHERE deployment_id = $1`,
      [deploymentId],
    );
    return result.rows[0]
      ? normalizeDeployment(structuredClone(result.rows[0].payload))
      : null;
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

  async updateChildEffect(effect: SkillChildEffect) {
    const result = await this.pool.query<PayloadRow<SkillChildEffect>>(
      `UPDATE p1_skill_child_effects
          SET payload = $3::jsonb
        WHERE effect_id = $1
          AND fingerprint = $2
       RETURNING payload`,
      [effect.effectId, effect.fingerprint, JSON.stringify(effect)],
    );
    if (!result.rows[0]) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only the matching Skill child effect can advance its retry state.',
      );
    }
    return cloneRow(result.rows[0]);
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

  private async getBindingById(bindingId: string) {
    const result = await this.pool.query<BindingPayloadRow>(
      `SELECT payload, stage
         FROM p1_skill_bindings
        WHERE binding_id = $1`,
      [bindingId],
    );
    return result.rows[0] ? cloneBindingRow(result.rows[0]) : null;
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

function revisionSelect() {
  return `SELECT payload, format_version, frontmatter, governance_sidecar,
                 prompt_name, prompt_version, prompt_content_hash,
                 prompt_label, prompt_source, prompt_is_fallback,
                 prompt_fallback_reason, prompt_fallback_content
            FROM p1_skill_revisions`;
}

function revisionPayloadV2(revision: SkillRevision) {
  const {
    manifest: _manifest,
    governance: _governance,
    prompt: _prompt,
    ...payload
  } = revision;
  return payload;
}

function revisionPayloadV1(revision: SkillRevision) {
  const {
    formatVersion: _formatVersion,
    prompt,
    ...payload
  } = revision;
  return {
    ...payload,
    prompt: {
      content: prompt.fallbackContent,
      contentHash: prompt.contentHash,
      isFallback: prompt.isFallback,
      label: prompt.label,
      name: prompt.name,
      source: prompt.source,
      version: prompt.version,
      ...(prompt.fallbackReason
        ? { fallbackReason: prompt.fallbackReason }
        : {}),
    },
  };
}

function cloneRevisionRow(row: RevisionRow): SkillRevision {
  if (row.format_version === 2) {
    if (
      !row.frontmatter ||
      !row.governance_sidecar ||
      !row.prompt_name ||
      !row.prompt_version ||
      !row.prompt_content_hash ||
      !row.prompt_label ||
      !row.prompt_source ||
      row.prompt_is_fallback === null ||
      row.prompt_fallback_content === null
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Skill revision v2 sidecar columns are incomplete.',
      );
    }
    return decodePersistedRevision(() => {
      const manifest = validateSkillFrontmatter(
        structuredClone(row.frontmatter),
      );
      const governance = parseSkillGovernance(
        structuredClone(row.governance_sidecar),
      );
      validateSkillPermissionAuthority(manifest, governance.allowedTools);
      return {
        ...revisionPayloadV2Schema.parse(structuredClone(row.payload)),
        manifest,
        governance,
        prompt: persistedPromptSchema.parse({
          contentHash: row.prompt_content_hash,
          fallbackContent: row.prompt_fallback_content,
          isFallback: row.prompt_is_fallback,
          label: row.prompt_label,
          name: row.prompt_name,
          source: row.prompt_source,
          version: row.prompt_version,
          ...(row.prompt_fallback_reason
            ? { fallbackReason: row.prompt_fallback_reason }
            : {}),
        }),
      };
    });
  }
  return normalizeLegacyRevision(row.payload);
}

function normalizeLegacyRevision(
  payload: Record<string, unknown>,
): SkillRevision {
  const legacy = decodePersistedRevision(() =>
    legacyRevisionPayloadSchema.parse(structuredClone(payload)),
  );
  const legacyManifest = legacy.manifest;
  const promptContent =
    legacy.prompt.content ?? legacy.prompt.fallbackContent;
  if (!promptContent) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Legacy Skill revision payload is incomplete.',
    );
  }
  const frontmatter = tryDecodeSkillFrontmatter(legacyManifest);
  const governance =
    legacy.governance
      ? decodePersistedRevision(() =>
          parseSkillGovernance(legacy.governance),
        )
      : decodePersistedRevision(() =>
          parseSkillGovernance(
            governanceFromLegacyManifest(legacyManifest),
          ),
        );
  return {
    ...legacy,
    formatVersion: 1,
    governance,
    manifest:
      frontmatter ??
      (legacyManifest as unknown as LegacySkillRevisionManifest),
    prompt: {
      contentHash: legacy.prompt.contentHash,
      fallbackContent: promptContent,
      isFallback: legacy.prompt.isFallback,
      label: legacy.prompt.label,
      name: legacy.prompt.name,
      source: legacy.prompt.source,
      version: legacy.prompt.version,
      ...(legacy.prompt.fallbackReason
        ? { fallbackReason: legacy.prompt.fallbackReason }
        : {}),
    },
  };
}

function tryDecodeSkillFrontmatter(
  value: Record<string, unknown>,
) {
  try {
    return validateSkillFrontmatter(value);
  } catch {
    return null;
  }
}

function governanceFromLegacyManifest(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const compatibility =
    manifest.compatibility &&
    typeof manifest.compatibility === 'object' &&
    !Array.isArray(manifest.compatibility)
      ? (manifest.compatibility as Record<string, unknown>)
      : {};
  return {
    allowedTools: manifest.allowedTools,
    budget: manifest.budget,
    contextScopes: manifest.contextScopes,
    executionMode: manifest.executionMode,
    fallback: manifest.fallback,
    inputSchemaRef: manifest.inputSchemaRef,
    outputSchemaRef: manifest.outputSchemaRef,
    requiredModelCapabilities: manifest.requiredModelCapabilities,
    sideEffectClass: manifest.sideEffectClass,
    workflowRevisionRefs: compatibility.workflowRevisionRefs ?? [],
  };
}

function decodePersistedRevision<T>(decode: () => T): T {
  try {
    return decode();
  } catch {
    throw new P1DomainError(
      'INVALID_STATE',
      'Persisted Skill revision payload is invalid.',
    );
  }
}

type LegacySkillDeployment = Omit<SkillDeployment, 'packagePaths'> & {
  artifactType: 'instruction' | 'reference' | 'scripts' | 'sandbox';
};

function normalizeDeployment(
  deployment: SkillDeployment | LegacySkillDeployment,
): SkillDeployment {
  if ('packagePaths' in deployment) {
    return deployment;
  }
  const { artifactType, ...legacy } = deployment;
  return {
    ...legacy,
    packagePaths:
      artifactType === 'reference'
        ? ['SKILL.md', 'references/']
        : artifactType === 'scripts' || artifactType === 'sandbox'
          ? ['SKILL.md', 'scripts/']
          : ['SKILL.md'],
  };
}

function cloneBindingRow(row: BindingPayloadRow): AuditedSkillBinding {
  const payload = structuredClone(
    row.payload,
  ) as AuditedSkillBinding & { stage?: string };
  if (payload.triggerCondition) return payload;
  const { stage: _legacyStage, ...legacy } = payload;
  return {
    ...legacy,
    triggerCondition: {
      harnessStage: row.stage as SkillTriggerCondition['harnessStage'],
      industryCategory: null,
      tenantId: null,
    },
  };
}

function normalizeBindingCondition(
  binding: AuditedSkillBinding,
): AuditedSkillBinding {
  return {
    ...binding,
    triggerCondition: {
      harnessStage: binding.triggerCondition.harnessStage,
      industryCategory: binding.triggerCondition.industryCategory ?? null,
      tenantId: binding.triggerCondition.tenantId ?? null,
    },
  };
}
