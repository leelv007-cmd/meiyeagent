import { isDeepStrictEqual } from 'node:util';

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { P1DomainError } from '../foundation/domain.js';
import { lockSkillReferenceTarget } from './reference-lock.js';
import {
  bindingReferenceEdge,
  deploymentReferenceEdge,
  evalRunReferenceEdges,
  governanceReservationReferenceEdge,
  governanceRunReferenceEdges,
  invocationReceiptReferenceEdge,
  type CompareAndSetPublishedRevisionInput,
  type RetireSkillRevisionInput,
  type SkillRepository,
} from './repository.js';
import { validateSkillFrontmatter } from './skill-format.js';
import {
  parseLegacySkillGovernance,
  parseSkillGovernance,
} from './skill-governance.js';
import type {
  AuditedSkillBinding,
  LegacySkillRevisionManifest,
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
    status: z.enum(['draft', 'accepted_frozen', 'retired']),
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
    content: z.string(),
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
    status: z.enum(['draft', 'accepted_frozen', 'retired']),
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
    const executor = client ?? this.pool;
    await executor.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-skill-repository-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_skill_catalogs (
        skill_id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL
      );
      -- Source and tier are promoted out of the payload because the operator
      -- catalog filters on them and the corroboration metric aggregates over
      -- them; a jsonb lookup can do neither with an index.
      ALTER TABLE p1_skill_catalogs
        ADD COLUMN IF NOT EXISTS source_kind text;
      ALTER TABLE p1_skill_catalogs
        ADD COLUMN IF NOT EXISTS tier text;
      ALTER TABLE p1_skill_catalogs
        ADD COLUMN IF NOT EXISTS publication_generation bigint NOT NULL
          DEFAULT 0;
      UPDATE p1_skill_catalogs
        SET source_kind = COALESCE(
              source_kind,
              payload->>'sourceKind',
              'authored'
            ),
            tier = COALESCE(tier, payload->>'tier', 'platform')
        WHERE source_kind IS NULL OR tier IS NULL;
      CREATE INDEX IF NOT EXISTS p1_skill_catalogs_tier_source_idx
        ON p1_skill_catalogs (tier, source_kind);
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
      CREATE TABLE IF NOT EXISTS p1_skill_governance_runs (
        run_id text PRIMARY KEY,
        input_fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p1_skill_governance_reservations (
        run_id text PRIMARY KEY,
        input_fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      ALTER TABLE p1_skill_revisions
        DROP CONSTRAINT IF EXISTS p1_skill_revisions_status_check;
      ALTER TABLE p1_skill_revisions
        ADD CONSTRAINT p1_skill_revisions_status_check
        CHECK (status IN ('draft', 'accepted_frozen', 'retired'));
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
      UPDATE p1_skill_catalogs catalogs
         SET payload = catalogs.payload || jsonb_build_object(
           'description',
           COALESCE(
             catalogs.payload->>'description',
             (
               SELECT COALESCE(
                 revisions.frontmatter->>'description',
                 revisions.payload->'manifest'->>'description'
               )
                 FROM p1_skill_revisions revisions
                WHERE revisions.skill_revision_ref =
                      catalogs.payload->>'activeRevisionRef'
                LIMIT 1
             ),
             catalogs.payload->>'name'
           ),
           'sourceKind',
           catalogs.source_kind,
           'tier',
           catalogs.tier,
           'publicationGeneration',
           catalogs.publication_generation
         )
       WHERE catalogs.payload->>'description' IS NULL
          OR catalogs.payload->>'sourceKind' IS NULL
          OR catalogs.payload->>'tier' IS NULL
          OR catalogs.payload->>'publicationGeneration' IS NULL;
      ALTER TABLE p1_skill_catalogs
        ALTER COLUMN source_kind SET NOT NULL,
        ALTER COLUMN tier SET NOT NULL;
      DO $$
      BEGIN
        ALTER TABLE p1_skill_catalogs
          ADD CONSTRAINT p1_skill_catalogs_source_kind_ck
          CHECK (source_kind IN ('harvested', 'authored', 'induced'));
        ALTER TABLE p1_skill_catalogs
          ADD CONSTRAINT p1_skill_catalogs_tier_ck
          CHECK (tier IN ('platform', 'industry', 'store'));
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
      CREATE TABLE IF NOT EXISTS p1_skill_eval_runs (
        run_id text PRIMARY KEY,
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
      CREATE TABLE IF NOT EXISTS p1_skill_reference_edges (
        edge_id text PRIMARY KEY,
        target_skill_revision_ref text NOT NULL,
        consumer_kind text NOT NULL CHECK (
          consumer_kind IN (
            'published_lifecycle',
            'workflow_binding',
            'recipe_revision',
            'deployment',
            'eval_run',
            'governance_run',
            'invocation_receipt'
          )
        ),
        consumer_id text NOT NULL,
        consumer_label text NOT NULL,
        scope_kind text NOT NULL CHECK (
          scope_kind IN ('workspace', 'global', 'unknown')
        ),
        owner_workspace_id text,
        global_proof text,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        CHECK (
          (scope_kind = 'workspace'
            AND owner_workspace_id IS NOT NULL
            AND global_proof IS NULL)
          OR (scope_kind = 'global'
            AND owner_workspace_id IS NULL
            AND global_proof IS NOT NULL)
          OR (scope_kind = 'unknown'
            AND owner_workspace_id IS NULL
            AND global_proof IS NULL)
        ),
        UNIQUE (consumer_kind, consumer_id, target_skill_revision_ref)
      );
      DELETE FROM p1_skill_reference_edges
       WHERE consumer_kind = 'traffic_target';
      ALTER TABLE p1_skill_reference_edges
        DROP CONSTRAINT IF EXISTS
          p1_skill_reference_edges_consumer_kind_check;
      ALTER TABLE p1_skill_reference_edges
        ADD CONSTRAINT p1_skill_reference_edges_consumer_kind_check
        CHECK (
          consumer_kind IN (
            'published_lifecycle',
            'workflow_binding',
            'recipe_revision',
            'deployment',
            'eval_run',
            'governance_run',
            'invocation_receipt'
          )
        );
      CREATE INDEX IF NOT EXISTS p1_skill_reference_edges_target_scope_idx
        ON p1_skill_reference_edges (
          target_skill_revision_ref,
          scope_kind,
          owner_workspace_id,
          consumer_kind,
          consumer_id
        );
      INSERT INTO p1_skill_reference_edges
        (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
         consumer_label, scope_kind, owner_workspace_id, global_proof,
         payload, created_at)
      SELECT concat(
               'skill-reference:published_lifecycle:',
               skill_id,
               ':',
               payload->>'activeRevisionRef'
             ),
             payload->>'activeRevisionRef',
             'published_lifecycle',
             skill_id,
             COALESCE(payload->>'name', skill_id),
             CASE
               WHEN tier IN ('platform', 'industry') THEN 'global'
               ELSE 'unknown'
             END,
             NULL,
             CASE
               WHEN tier = 'platform' THEN 'platform_catalog'
               WHEN tier = 'industry' THEN 'industry_catalog'
               ELSE NULL
             END,
             jsonb_build_object(
               'edgeId',
               concat(
                 'skill-reference:published_lifecycle:',
                 skill_id,
                 ':',
                 payload->>'activeRevisionRef'
               ),
               'targetSkillRevisionRef',
               payload->>'activeRevisionRef',
               'consumerKind',
               'published_lifecycle',
               'consumerId',
               skill_id,
               'consumerLabel',
               COALESCE(payload->>'name', skill_id),
               'scope',
               CASE
                 WHEN tier = 'platform'
                   THEN jsonb_build_object(
                     'kind',
                     'global',
                     'proof',
                     'platform_catalog'
                   )
                 WHEN tier = 'industry'
                   THEN jsonb_build_object(
                     'kind',
                     'global',
                     'proof',
                     'industry_catalog'
                   )
                 ELSE jsonb_build_object('kind', 'unknown')
               END,
               'createdAt',
               updated_at::text
             ),
             updated_at
        FROM p1_skill_catalogs
       WHERE NULLIF(payload->>'activeRevisionRef', '') IS NOT NULL
      ON CONFLICT DO NOTHING;
      DELETE FROM p1_skill_reference_edges edges
       WHERE edges.consumer_kind = 'published_lifecycle'
         AND NOT EXISTS (
           SELECT 1
             FROM p1_skill_catalogs catalogs
            WHERE catalogs.skill_id = edges.consumer_id
              AND NULLIF(
                    catalogs.payload->>'activeRevisionRef',
                    ''
                  ) = edges.target_skill_revision_ref
         );
      CREATE UNIQUE INDEX IF NOT EXISTS
        p1_skill_reference_edges_published_lifecycle_uq
        ON p1_skill_reference_edges (consumer_id)
        WHERE consumer_kind = 'published_lifecycle';
      INSERT INTO p1_skill_reference_edges
        (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
         consumer_label, scope_kind, owner_workspace_id, global_proof,
         payload, created_at)
      SELECT concat(
               'skill-reference:workflow_binding:',
               binding_id,
               ':',
               skill_revision_ref
             ),
             skill_revision_ref,
             'workflow_binding',
             binding_id,
             workflow_revision_ref,
             CASE
               WHEN NULLIF(payload->>'ownerWorkspaceId', '') IS NOT NULL
                 THEN 'workspace'
               ELSE 'unknown'
             END,
             NULLIF(payload->>'ownerWorkspaceId', ''),
             NULL,
             jsonb_build_object(
               'edgeId',
               concat(
                 'skill-reference:workflow_binding:',
                 binding_id,
                 ':',
                 skill_revision_ref
               ),
               'targetSkillRevisionRef',
               skill_revision_ref,
               'consumerKind',
               'workflow_binding',
               'consumerId',
               binding_id,
               'consumerLabel',
               workflow_revision_ref,
               'scope',
               CASE
                 WHEN NULLIF(payload->>'ownerWorkspaceId', '') IS NOT NULL
                   THEN jsonb_build_object(
                     'kind',
                     'workspace',
                     'workspaceId',
                     payload->>'ownerWorkspaceId'
                   )
                 ELSE jsonb_build_object('kind', 'unknown')
               END,
               'createdAt',
               created_at::text
             ),
             created_at
        FROM p1_skill_bindings
      ON CONFLICT DO NOTHING;
      INSERT INTO p1_skill_reference_edges
        (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
         consumer_label, scope_kind, owner_workspace_id, global_proof,
         payload, created_at)
      SELECT concat(
               'skill-reference:deployment:',
               deployment_id,
               ':',
               skill_revision_ref
             ),
             skill_revision_ref,
             'deployment',
             deployment_id,
             concat(
               COALESCE(payload->>'provider', 'unknown'),
               '/',
               COALESCE(payload->>'channel', 'unknown')
             ),
             'unknown',
             NULL,
             NULL,
             jsonb_build_object(
               'edgeId',
               concat(
                 'skill-reference:deployment:',
                 deployment_id,
                 ':',
                 skill_revision_ref
               ),
               'targetSkillRevisionRef',
               skill_revision_ref,
               'consumerKind',
               'deployment',
               'consumerId',
               deployment_id,
               'consumerLabel',
               concat(
                 COALESCE(payload->>'provider', 'unknown'),
                 '/',
                 COALESCE(payload->>'channel', 'unknown')
               ),
               'scope',
               jsonb_build_object('kind', 'unknown'),
               'createdAt',
               created_at::text
             ),
             created_at
        FROM p1_skill_deployments
      ON CONFLICT DO NOTHING;
      INSERT INTO p1_skill_reference_edges
        (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
         consumer_label, scope_kind, owner_workspace_id, global_proof,
         payload, created_at)
      SELECT concat(
               'skill-reference:invocation_receipt:',
               invocation_id,
               ':',
               skill_revision_ref
             ),
             skill_revision_ref,
             'invocation_receipt',
             invocation_id,
             COALESCE(payload->>'taskId', invocation_id),
             CASE
               WHEN NULLIF(payload->>'workspaceId', '') IS NOT NULL
                 THEN 'workspace'
               ELSE 'unknown'
             END,
             NULLIF(payload->>'workspaceId', ''),
             NULL,
             jsonb_build_object(
               'edgeId',
               concat(
                 'skill-reference:invocation_receipt:',
                 invocation_id,
                 ':',
                 skill_revision_ref
               ),
               'targetSkillRevisionRef',
               skill_revision_ref,
               'consumerKind',
               'invocation_receipt',
               'consumerId',
               invocation_id,
               'consumerLabel',
               COALESCE(payload->>'taskId', invocation_id),
               'scope',
               CASE
                 WHEN NULLIF(payload->>'workspaceId', '') IS NOT NULL
                   THEN jsonb_build_object(
                     'kind',
                     'workspace',
                     'workspaceId',
                     payload->>'workspaceId'
                   )
                 ELSE jsonb_build_object('kind', 'unknown')
               END,
               'createdAt',
               created_at::text
             ),
             created_at
        FROM p1_skill_invocation_receipts
      ON CONFLICT DO NOTHING;
      INSERT INTO p1_skill_reference_edges
        (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
         consumer_label, scope_kind, owner_workspace_id, global_proof,
         payload, created_at)
      SELECT DISTINCT
             concat(
               'skill-reference:eval_run:',
               runs.run_id,
               ':',
               result->>'skillRevisionRef'
             ),
             result->>'skillRevisionRef',
             'eval_run',
             runs.run_id,
             concat(
               COALESCE(runs.payload->>'suiteId', 'unknown'),
               '@',
               COALESCE(runs.payload->>'suiteRevision', 'unknown')
             ),
             'global',
             NULL,
             'evaluation',
             jsonb_build_object(
               'edgeId',
               concat(
                 'skill-reference:eval_run:',
                 runs.run_id,
                 ':',
                 result->>'skillRevisionRef'
               ),
               'targetSkillRevisionRef',
               result->>'skillRevisionRef',
               'consumerKind',
               'eval_run',
               'consumerId',
               runs.run_id,
               'consumerLabel',
               concat(
                 COALESCE(runs.payload->>'suiteId', 'unknown'),
                 '@',
                 COALESCE(runs.payload->>'suiteRevision', 'unknown')
               ),
               'scope',
               jsonb_build_object(
                 'kind',
                 'global',
                 'proof',
                 'evaluation'
               ),
               'createdAt',
               runs.created_at::text
             ),
             runs.created_at
        FROM p1_skill_eval_runs runs
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(runs.payload->'results', '[]'::jsonb)
        ) result
       WHERE NULLIF(result->>'skillRevisionRef', '') IS NOT NULL
      ON CONFLICT DO NOTHING;
      INSERT INTO p1_skill_reference_edges
        (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
         consumer_label, scope_kind, owner_workspace_id, global_proof,
         payload, created_at)
      SELECT concat(
               'skill-reference:governance_run:',
               reservation.run_id,
               ':',
               reservation.payload->>'baseSkillRevisionRef'
             ),
             reservation.payload->>'baseSkillRevisionRef',
             'governance_run',
             reservation.run_id,
             COALESCE(reservation.payload->>'skillId', reservation.run_id),
             CASE
               WHEN NULLIF(reservation.payload->>'workspaceId', '') IS NOT NULL
                 THEN 'workspace'
               ELSE 'unknown'
             END,
             NULLIF(reservation.payload->>'workspaceId', ''),
             NULL,
             jsonb_build_object(
               'edgeId',
               concat(
                 'skill-reference:governance_run:',
                 reservation.run_id,
                 ':',
                 reservation.payload->>'baseSkillRevisionRef'
               ),
               'targetSkillRevisionRef',
               reservation.payload->>'baseSkillRevisionRef',
               'consumerKind',
               'governance_run',
               'consumerId',
               reservation.run_id,
               'consumerLabel',
               COALESCE(
                 reservation.payload->>'skillId',
                 reservation.run_id
               ),
               'scope',
               CASE
                 WHEN NULLIF(
                   reservation.payload->>'workspaceId',
                   ''
                 ) IS NOT NULL
                   THEN jsonb_build_object(
                     'kind',
                     'workspace',
                     'workspaceId',
                     reservation.payload->>'workspaceId'
                   )
                 ELSE jsonb_build_object('kind', 'unknown')
               END,
               'createdAt',
               reservation.payload->>'createdAt'
             ),
             reservation.created_at
        FROM p1_skill_governance_reservations reservation
       WHERE NULLIF(
               reservation.payload->>'baseSkillRevisionRef',
               ''
             ) IS NOT NULL
      ON CONFLICT DO NOTHING;
      INSERT INTO p1_skill_reference_edges
        (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
         consumer_label, scope_kind, owner_workspace_id, global_proof,
         payload, created_at)
      SELECT DISTINCT
             concat(
               'skill-reference:governance_run:',
               run.run_id,
               ':',
               reference.skill_revision_ref
             ),
             reference.skill_revision_ref,
             'governance_run',
             run.run_id,
             COALESCE(run.payload->>'skillId', run.run_id),
             CASE
               WHEN NULLIF(run.payload->>'workspaceId', '') IS NOT NULL
                 THEN 'workspace'
               ELSE 'unknown'
             END,
             NULLIF(run.payload->>'workspaceId', ''),
             NULL,
             jsonb_build_object(
               'edgeId',
               concat(
                 'skill-reference:governance_run:',
                 run.run_id,
                 ':',
                 reference.skill_revision_ref
               ),
               'targetSkillRevisionRef',
               reference.skill_revision_ref,
               'consumerKind',
               'governance_run',
               'consumerId',
               run.run_id,
               'consumerLabel',
               COALESCE(run.payload->>'skillId', run.run_id),
               'scope',
               CASE
                 WHEN NULLIF(run.payload->>'workspaceId', '') IS NOT NULL
                   THEN jsonb_build_object(
                     'kind',
                     'workspace',
                     'workspaceId',
                     run.payload->>'workspaceId'
                   )
                 ELSE jsonb_build_object('kind', 'unknown')
               END,
               'createdAt',
               run.payload->>'createdAt'
             ),
             run.created_at
        FROM p1_skill_governance_runs run
        CROSS JOIN LATERAL (
          VALUES
            (run.payload->>'baseSkillRevisionRef'),
            (run.payload->>'draftSkillRevisionRef')
        ) reference(skill_revision_ref)
       WHERE NULLIF(reference.skill_revision_ref, '') IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);
    const creationCatalog = await executor.query<{ relation: string | null }>(
      `SELECT to_regclass('p1_creation_recipe_revisions')::text AS relation`,
    );
    if (creationCatalog.rows[0]?.relation) {
      await executor.query(`
        INSERT INTO p1_skill_reference_edges
          (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
           consumer_label, scope_kind, owner_workspace_id, global_proof,
           payload, created_at)
        SELECT DISTINCT
               concat(
                 'skill-reference:recipe_revision:',
                 COALESCE(
                   recipe.payload->>'revisionId',
                   concat(recipe.recipe_id, '@', recipe.revision::text)
                 ),
                 ':',
                 reference.skill_revision_ref
               ),
               reference.skill_revision_ref,
               'recipe_revision',
               COALESCE(
                 recipe.payload->>'revisionId',
                 concat(recipe.recipe_id, '@', recipe.revision::text)
               ),
               recipe.recipe_id,
               'global',
               NULL,
               'recipe_catalog',
               jsonb_build_object(
                 'edgeId',
                 concat(
                   'skill-reference:recipe_revision:',
                   COALESCE(
                     recipe.payload->>'revisionId',
                     concat(recipe.recipe_id, '@', recipe.revision::text)
                   ),
                   ':',
                   reference.skill_revision_ref
                 ),
                 'targetSkillRevisionRef',
                 reference.skill_revision_ref,
                 'consumerKind',
                 'recipe_revision',
                 'consumerId',
                 COALESCE(
                   recipe.payload->>'revisionId',
                   concat(recipe.recipe_id, '@', recipe.revision::text)
                 ),
                 'consumerLabel',
                 recipe.recipe_id,
                 'scope',
                 jsonb_build_object(
                   'kind',
                   'global',
                   'proof',
                   'recipe_catalog'
                 ),
                 'createdAt',
                 recipe.payload->>'createdAt'
               ),
               recipe.created_at
          FROM p1_creation_recipe_revisions recipe
          CROSS JOIN LATERAL jsonb_array_elements_text(
            COALESCE(recipe.payload->'skillRevisionRefs', '[]'::jsonb)
          ) reference(skill_revision_ref)
         WHERE NULLIF(reference.skill_revision_ref, '') IS NOT NULL
        ON CONFLICT DO NOTHING
      `);
    }
  }

  async putCatalog(catalog: SkillCatalog) {
    const canonical = normalizeCatalog(catalog);
    const result = await this.pool.query<PayloadRow<SkillCatalog>>(
      `INSERT INTO p1_skill_catalogs
         (skill_id, payload, updated_at, source_kind, tier,
          publication_generation)
       VALUES ($1, $2::jsonb, $3::timestamptz, $4, $5, $6)
       ON CONFLICT (skill_id) DO UPDATE
         SET payload = EXCLUDED.payload,
             updated_at = EXCLUDED.updated_at,
             source_kind = EXCLUDED.source_kind,
             tier = EXCLUDED.tier,
             publication_generation = EXCLUDED.publication_generation
       RETURNING payload`,
      [
        canonical.skillId,
        JSON.stringify(canonical),
        canonical.updatedAt,
        canonical.sourceKind,
        canonical.tier,
        canonical.publicationGeneration,
      ],
    );
    return normalizeCatalog(cloneRow(result.rows[0]!));
  }

  async getCatalog(skillId: string) {
    const catalog = await this.getOne<SkillCatalog>(
      'p1_skill_catalogs',
      'skill_id',
      skillId,
    );
    return catalog ? normalizeCatalog(catalog) : null;
  }

  async listCatalogs(filter?: {
    tier?: SkillTier;
    sourceKind?: SkillSourceKind;
    limit?: number;
  }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter?.tier !== undefined) {
      values.push(filter.tier);
      conditions.push(`tier = $${values.length}`);
    }
    if (filter?.sourceKind !== undefined) {
      values.push(filter.sourceKind);
      conditions.push(`source_kind = $${values.length}`);
    }
    // A hard ceiling keeps this from becoming a bulk-export surface.
    values.push(Math.min(filter?.limit ?? 200, 200));
    const result = await this.pool.query<PayloadRow<SkillCatalog>>(
      `SELECT payload FROM p1_skill_catalogs
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY skill_id
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => normalizeCatalog(cloneRow(row)));
  }

  async getCatalogStats() {
    const result = await this.pool.query<{
      total: string;
      industry_tier_total: string;
      industry_tier_corroborated: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE tier = 'industry')::text
                AS industry_tier_total,
              count(*) FILTER (
                WHERE tier = 'industry' AND source_kind = 'induced'
              )::text AS industry_tier_corroborated
         FROM p1_skill_catalogs`,
    );
    const row = result.rows[0]!;
    return {
      total: Number(row.total),
      industryTierTotal: Number(row.industry_tier_total),
      industryTierCorroborated: Number(row.industry_tier_corroborated),
    };
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
          revision.prompt.content,
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

  async listRevisions(skillId: string, limit: number) {
    const result = await this.pool.query<RevisionRow>(
      `${revisionSelect()}
        WHERE skill_id = $1
        ORDER BY revision DESC
        LIMIT $2`,
      [skillId, limit],
    );
    return result.rows.map(cloneRevisionRow);
  }

  async compareAndSetPublishedRevision(
    input: CompareAndSetPublishedRevisionInput,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [input.publishedRun.runId],
      );
      const existing = await client.query<
        PayloadRow<SkillGovernanceRun> & {
          input_fingerprint: string;
        }
      >(
        `SELECT input_fingerprint, payload
           FROM p1_skill_governance_runs
          WHERE run_id = $1`,
        [input.publishedRun.runId],
      );
      const persisted = existing.rows[0];
      if (persisted) {
        if (
          persisted.input_fingerprint !==
          input.publishedRun.inputFingerprint
        ) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Skill publication run is already bound to different facts.',
          );
        }
        await client.query('COMMIT');
        return cloneRow(persisted);
      }

      const currentResult = await client.query<PayloadRow<SkillCatalog>>(
        `SELECT payload
           FROM p1_skill_catalogs
          WHERE skill_id = $1
          FOR UPDATE`,
        [input.publishedCatalog.skillId],
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) {
        throw new P1DomainError('NOT_FOUND', 'Skill catalog does not exist.');
      }
      const current = normalizeCatalog(cloneRow(currentRow));
      if (
        current.activeRevisionRef !==
          input.expectedPublishedRevisionRef ||
        current.publicationGeneration !==
          input.expectedPublicationGeneration
      ) {
        await insertGovernanceRun(client, input.casConflictRun);
        await client.query('COMMIT');
        return structuredClone(input.casConflictRun);
      }

      const published = normalizeCatalog(input.publishedCatalog);
      await client.query(
        `UPDATE p1_skill_catalogs
            SET payload = $2::jsonb,
                updated_at = $3::timestamptz,
                source_kind = $4,
                tier = $5,
                publication_generation = $6
          WHERE skill_id = $1`,
        [
          published.skillId,
          JSON.stringify(published),
          published.updatedAt,
          published.sourceKind,
          published.tier,
          published.publicationGeneration,
        ],
      );
      await client.query(
        `DELETE FROM p1_skill_reference_edges
          WHERE consumer_kind = 'published_lifecycle'
            AND consumer_id = $1`,
        [published.skillId],
      );
      await this.insertReferenceEdge(client, input.referenceEdge);
      await insertGovernanceRun(client, input.publishedRun);
      await client.query('COMMIT');
      return structuredClone(input.publishedRun);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async retireRevision(input: RetireSkillRevisionInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [input.appliedRun.runId],
      );
      await lockSkillReferenceTarget(
        client,
        input.targetSkillRevisionRef,
      );
      const existing = await client.query<
        PayloadRow<SkillGovernanceRun> & {
          input_fingerprint: string;
        }
      >(
        `SELECT input_fingerprint, payload
           FROM p1_skill_governance_runs
          WHERE run_id = $1`,
        [input.appliedRun.runId],
      );
      const persisted = existing.rows[0];
      if (persisted) {
        if (
          persisted.input_fingerprint !== input.appliedRun.inputFingerprint
        ) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Skill retirement run is already bound to different facts.',
          );
        }
        await client.query('COMMIT');
        return cloneRow(persisted);
      }

      const revision = await client.query<{ status: string }>(
        `SELECT status
           FROM p1_skill_revisions
          WHERE skill_revision_ref = $1
          FOR UPDATE`,
        [input.targetSkillRevisionRef],
      );
      if (!revision.rows[0]) {
        throw new P1DomainError('NOT_FOUND', 'Skill revision does not exist.');
      }
      if (revision.rows[0].status !== 'accepted_frozen') {
        throw new P1DomainError(
          'INVALID_STATE',
          'Only an accepted frozen Skill revision can be retired.',
        );
      }
      const dependencies = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_skill_reference_edges
          WHERE target_skill_revision_ref = $1`,
        [input.targetSkillRevisionRef],
      );
      const blocked = Number(dependencies.rows[0]?.count ?? 0) > 0;
      const run = blocked ? input.blockedRun : input.appliedRun;
      if (!blocked) {
        await client.query(
          `UPDATE p1_skill_revisions
              SET status = 'retired',
                  payload = jsonb_set(
                    payload,
                    '{status}',
                    to_jsonb('retired'::text)
                  )
            WHERE skill_revision_ref = $1`,
          [input.targetSkillRevisionRef],
        );
      }
      await insertGovernanceRun(client, run);
      await client.query('COMMIT');
      return structuredClone(run);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async applyGovernanceDraft(input: {
    run: SkillGovernanceRun;
    draft: SkillRevision | null;
    expectedHeadRevision: number;
    casConflictRun: SkillGovernanceRun;
  }) {
    if (input.draft && input.draft.formatVersion !== 2) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Governance writes require storage format v2.',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [input.run.runId],
      );
      const existing = await client.query<
        PayloadRow<SkillGovernanceRun> & {
          input_fingerprint: string;
        }
      >(
        `SELECT input_fingerprint, payload
           FROM p1_skill_governance_runs
          WHERE run_id = $1`,
        [input.run.runId],
      );
      const persisted = existing.rows[0];
      if (persisted) {
        if (persisted.input_fingerprint !== input.run.inputFingerprint) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Skill governance run is already bound to different facts.',
          );
        }
        for (const edge of governanceRunReferenceEdges(cloneRow(persisted))) {
          await this.preserveOrInsertReferenceEdge(client, edge);
        }
        await client.query('COMMIT');
        return cloneRow(persisted);
      }
      if (!input.draft) {
        await insertGovernanceRun(client, input.run);
        for (const edge of governanceRunReferenceEdges(input.run)) {
          await this.preserveOrInsertReferenceEdge(client, edge);
        }
        await client.query('COMMIT');
        return structuredClone(input.run);
      }

      await client.query(
        `INSERT INTO p1_skill_revision_heads (skill_id, revision)
         VALUES ($1, 0)
         ON CONFLICT (skill_id) DO NOTHING`,
        [input.draft.skillId],
      );
      const head = await client.query<{ revision: string }>(
        `SELECT revision::text AS revision
           FROM p1_skill_revision_heads
          WHERE skill_id = $1
          FOR UPDATE`,
        [input.draft.skillId],
      );
      const current = Number(head.rows[0]?.revision ?? 0);
      if (
        current !== input.expectedHeadRevision ||
        input.draft.revision !== input.expectedHeadRevision + 1
      ) {
        await insertGovernanceRun(client, input.casConflictRun);
        for (const edge of governanceRunReferenceEdges(
          input.casConflictRun,
        )) {
          await this.preserveOrInsertReferenceEdge(client, edge);
        }
        await client.query('COMMIT');
        return structuredClone(input.casConflictRun);
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
          input.draft.skillId,
          input.draft.revision,
          input.draft.skillRevisionRef,
          input.draft.status,
          input.draft.contentHash,
          JSON.stringify(input.draft.manifest),
          JSON.stringify(input.draft.governance),
          input.draft.prompt.name,
          input.draft.prompt.version,
          input.draft.prompt.contentHash,
          input.draft.prompt.label,
          input.draft.prompt.source,
          input.draft.prompt.isFallback,
          input.draft.prompt.fallbackReason ?? null,
          input.draft.prompt.content,
          JSON.stringify(revisionPayloadV2(input.draft)),
          input.draft.createdAt,
        ],
      );
      await client.query(
        `UPDATE p1_skill_revision_heads SET revision = $2 WHERE skill_id = $1`,
        [input.draft.skillId, input.draft.revision],
      );
      await insertGovernanceRun(client, input.run);
      for (const edge of governanceRunReferenceEdges(input.run)) {
        await this.preserveOrInsertReferenceEdge(client, edge);
      }
      await client.query('COMMIT');
      return structuredClone(input.run);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reserveGovernanceRun(
    reservation: SkillGovernanceReservation,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<
        PayloadRow<SkillGovernanceReservation> & {
          input_fingerprint: string;
        }
      >(
        `INSERT INTO p1_skill_governance_reservations
           (run_id, input_fingerprint, payload, created_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)
         ON CONFLICT (run_id) DO NOTHING
         RETURNING input_fingerprint, payload`,
        [
          reservation.runId,
          reservation.inputFingerprint,
          JSON.stringify(reservation),
          reservation.createdAt,
        ],
      );
      const inserted = Boolean(result.rows[0]);
      const existing = inserted
        ? result
        : await client.query<
            PayloadRow<SkillGovernanceReservation> & {
              input_fingerprint: string;
            }
          >(
            `SELECT input_fingerprint, payload
               FROM p1_skill_governance_reservations
              WHERE run_id = $1`,
            [reservation.runId],
          );
      const stored = existing.rows[0];
      if (
        !stored ||
        stored.input_fingerprint !== reservation.inputFingerprint
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill governance reservation is already bound to different facts.',
        );
      }
      const edge = governanceReservationReferenceEdge(reservation);
      if (inserted) {
        await this.insertReferenceEdge(client, edge);
      } else {
        await this.preserveOrInsertReferenceEdge(client, edge);
      }
      await client.query('COMMIT');
      return cloneRow(stored);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getGovernanceReservation(runId: string) {
    return this.getOne<SkillGovernanceReservation>(
      'p1_skill_governance_reservations',
      'run_id',
      runId,
    );
  }

  async completeGovernanceCancellation(run: SkillGovernanceRun) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [run.runId],
      );
      const existing = await client.query<
        PayloadRow<SkillGovernanceRun> & {
          input_fingerprint: string;
        }
      >(
        `SELECT input_fingerprint, payload
           FROM p1_skill_governance_runs
          WHERE run_id = $1`,
        [run.runId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].input_fingerprint !== run.inputFingerprint) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Skill governance run is already bound to different facts.',
          );
        }
        for (const edge of governanceRunReferenceEdges(run)) {
          await this.preserveOrInsertReferenceEdge(client, edge);
        }
        await client.query('COMMIT');
        return cloneRow(existing.rows[0]);
      }
      const reservation = await client.query<{
        input_fingerprint: string;
      }>(
        `SELECT input_fingerprint
           FROM p1_skill_governance_reservations
          WHERE run_id = $1
          FOR UPDATE`,
        [run.runId],
      );
      if (
        reservation.rows[0]?.input_fingerprint !== run.inputFingerprint
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill governance cancellation does not match its reserved facts.',
        );
      }
      await insertGovernanceRun(client, run);
      for (const edge of governanceRunReferenceEdges(run)) {
        await this.preserveOrInsertReferenceEdge(client, edge);
      }
      await client.query('COMMIT');
      return structuredClone(run);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getGovernanceRun(runId: string) {
    const result = await this.pool.query<PayloadRow<SkillGovernanceRun>>(
      `SELECT payload
         FROM p1_skill_governance_runs
        WHERE run_id = $1`,
      [runId],
    );
    return result.rows[0] ? cloneRow(result.rows[0]) : null;
  }

  async putBinding(binding: SkillBinding) {
    const canonical = normalizeBindingCondition(binding) as SkillBinding;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PayloadRow<SkillBinding>>(
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
      const inserted = Boolean(result.rows[0]);
      let stored = result.rows[0]
        ? cloneRow(result.rows[0])
        : null;
      if (!stored) {
        const existing = await client.query<BindingPayloadRow>(
          `SELECT payload, stage
             FROM p1_skill_bindings
            WHERE binding_id = $1`,
          [canonical.bindingId],
        );
        const existingBinding = existing.rows[0]
          ? cloneBindingRow(existing.rows[0])
          : null;
        if (
          !existingBinding ||
          !isDeepStrictEqual(
            normalizeBindingCondition(existingBinding),
            canonical,
          )
        ) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Skill binding is already bound to different facts.',
          );
        }
        stored = existingBinding as SkillBinding;
      }
      const edge = bindingReferenceEdge(canonical);
      if (inserted) {
        await this.insertReferenceEdge(client, edge);
      } else {
        await this.preserveOrInsertReferenceEdge(client, edge);
      }
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
      await this.insertReferenceEdge(
        client,
        bindingReferenceEdge(replacement),
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

  async putDeployment(
    deployment: SkillDeployment,
    referenceScope: SkillReferenceScope = { kind: 'unknown' },
  ) {
    return this.putOnceWithReferenceEdge(
      'p1_skill_deployments',
      'deployment_id',
      deployment.deploymentId,
      deployment,
      ['skill_revision_ref', 'created_at'],
      [deployment.skillRevisionRef, deployment.createdAt],
      'Skill deployment',
      deploymentReferenceEdge(deployment, referenceScope),
      normalizeDeployment,
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

  async putImmutable(runId: string, input: EvalRun) {
    const run = evalRunSchema.parse(input);
    if (run.runId !== runId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Skill EvalRun ID must match the immutable registry key.',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<PayloadRow<EvalRun>>(
        `INSERT INTO p1_skill_eval_runs
           (run_id, payload, created_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (run_id) DO NOTHING
         RETURNING payload`,
        [runId, JSON.stringify(run), run.createdAt],
      );
      const stored = inserted.rows[0]
        ? cloneRow(inserted.rows[0])
        : await client
            .query<PayloadRow<EvalRun>>(
              'SELECT payload FROM p1_skill_eval_runs WHERE run_id = $1',
              [runId],
            )
            .then((result) =>
              result.rows[0] ? cloneRow(result.rows[0]) : null,
            );
      if (!stored || !isDeepStrictEqual(stored, run)) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Skill EvalRun is already bound to different facts.',
        );
      }
      for (const edge of evalRunReferenceEdges(run)) {
        if (inserted.rows[0]) {
          await this.insertReferenceEdge(client, edge);
        } else {
          await this.preserveOrInsertReferenceEdge(client, edge);
        }
      }
      await client.query('COMMIT');
      return structuredClone(run);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(runId: string) {
    const run = await this.getOne<unknown>(
      'p1_skill_eval_runs',
      'run_id',
      runId,
    );
    return run ? evalRunSchema.parse(run) : null;
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
    return this.putOnceWithReferenceEdge(
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
      invocationReceiptReferenceEdge(receipt),
    );
  }

  getInvocationReceipt(invocationId: string) {
    return this.getOne<SkillInvocationReceipt>(
      'p1_skill_invocation_receipts',
      'invocation_id',
      invocationId,
    );
  }

  async putReferenceEdge(edge: SkillReferenceEdge) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stored = await this.insertReferenceEdge(client, edge);
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listReferenceEdges(targetSkillRevisionRef: string) {
    const result = await this.pool.query<PayloadRow<SkillReferenceEdge>>(
      `SELECT payload
         FROM p1_skill_reference_edges
        WHERE target_skill_revision_ref = $1
        ORDER BY consumer_kind, consumer_id, edge_id`,
      [targetSkillRevisionRef],
    );
    return result.rows.map(cloneRow);
  }

  async inspectReferenceEdges(
    targetSkillRevisionRef: string,
    viewerWorkspaceId: string,
  ) {
    const [visible, hidden] = await Promise.all([
      this.pool.query<PayloadRow<SkillReferenceEdge>>(
        `SELECT payload
           FROM p1_skill_reference_edges
          WHERE target_skill_revision_ref = $1
            AND (
              scope_kind = 'global'
              OR (
                scope_kind = 'workspace'
                AND owner_workspace_id = $2
              )
            )
          ORDER BY consumer_kind, consumer_id, edge_id`,
        [targetSkillRevisionRef, viewerWorkspaceId],
      ),
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_skill_reference_edges
          WHERE target_skill_revision_ref = $1
            AND NOT (
              scope_kind = 'global'
              OR (
                scope_kind = 'workspace'
                AND owner_workspace_id = $2
              )
            )`,
        [targetSkillRevisionRef, viewerWorkspaceId],
      ),
    ]);
    return {
      visibleDependencies: visible.rows.map(cloneRow),
      hiddenCount: Number(hidden.rows[0]?.count ?? 0),
    };
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

  private async putOnceWithReferenceEdge<T>(
    table: string,
    idColumn: string,
    id: string,
    payload: T,
    extraColumns: string[],
    extraValues: unknown[],
    label: string,
    edge: SkillReferenceEdge,
    normalizeStored: (payload: T) => T = (payload) => payload,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const columns = [idColumn, 'payload', ...extraColumns];
      const parameters = columns.map((column, index) =>
        column === 'payload' ? `$${index + 1}::jsonb` : `$${index + 1}`,
      );
      const values = [id, JSON.stringify(payload), ...extraValues];
      const inserted = await client.query<PayloadRow<T>>(
        `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${parameters.join(', ')})
         ON CONFLICT (${idColumn}) DO NOTHING
         RETURNING payload`,
        values,
      );
      const factInserted = Boolean(inserted.rows[0]);
      let stored = inserted.rows[0] ? cloneRow(inserted.rows[0]) : null;
      if (!stored) {
        const existing = await client.query<PayloadRow<T>>(
          `SELECT payload FROM ${table} WHERE ${idColumn} = $1`,
          [id],
        );
        stored = existing.rows[0]
          ? normalizeStored(cloneRow(existing.rows[0]))
          : null;
        if (!stored || !isDeepStrictEqual(stored, payload)) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            `${label} is already bound to different facts.`,
          );
        }
      }
      if (factInserted) {
        await this.insertReferenceEdge(client, edge);
      } else {
        await this.preserveOrInsertReferenceEdge(client, edge);
      }
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertReferenceEdge(
    client: PoolClient,
    edge: SkillReferenceEdge,
  ) {
    await lockSkillReferenceTarget(
      client,
      edge.targetSkillRevisionRef,
    );
    const target = await client.query<{ status: string }>(
      `SELECT status
         FROM p1_skill_revisions
        WHERE skill_revision_ref = $1`,
      [edge.targetSkillRevisionRef],
    );
    if (target.rows[0]?.status === 'retired') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Retired Skill revisions cannot acquire new references.',
      );
    }
    const ownerWorkspaceId =
      edge.scope.kind === 'workspace' ? edge.scope.workspaceId : null;
    const globalProof =
      edge.scope.kind === 'global' ? edge.scope.proof : null;
    const inserted = await client.query<PayloadRow<SkillReferenceEdge>>(
      `INSERT INTO p1_skill_reference_edges
         (edge_id, target_skill_revision_ref, consumer_kind, consumer_id,
          consumer_label, scope_kind, owner_workspace_id, global_proof,
          payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
       ON CONFLICT (edge_id) DO NOTHING
       RETURNING payload`,
      [
        edge.edgeId,
        edge.targetSkillRevisionRef,
        edge.consumerKind,
        edge.consumerId,
        edge.consumerLabel,
        edge.scope.kind,
        ownerWorkspaceId,
        globalProof,
        JSON.stringify(edge),
        edge.createdAt,
      ],
    );
    if (inserted.rows[0]) return cloneRow(inserted.rows[0]);
    const existing = await client.query<PayloadRow<SkillReferenceEdge>>(
      `SELECT payload
         FROM p1_skill_reference_edges
        WHERE edge_id = $1`,
      [edge.edgeId],
    );
    const stored = existing.rows[0] ? cloneRow(existing.rows[0]) : null;
    if (stored && isDeepStrictEqual(stored, edge)) return stored;
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Skill reference edge is already bound to different facts.',
    );
  }

  private async preserveOrInsertReferenceEdge(
    client: PoolClient,
    edge: SkillReferenceEdge,
  ) {
    const existing = await client.query<PayloadRow<SkillReferenceEdge>>(
      `SELECT payload
         FROM p1_skill_reference_edges
        WHERE consumer_kind = $1
          AND consumer_id = $2
          AND target_skill_revision_ref = $3`,
      [
        edge.consumerKind,
        edge.consumerId,
        edge.targetSkillRevisionRef,
      ],
    );
    return existing.rows[0]
      ? cloneRow(existing.rows[0])
      : this.insertReferenceEdge(client, edge);
  }
}

function cloneRow<T>(row: PayloadRow<T>) {
  return structuredClone(row.payload);
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

async function insertGovernanceRun(
  client: PoolClient,
  run: SkillGovernanceRun,
) {
  await client.query(
    `INSERT INTO p1_skill_governance_runs
       (run_id, input_fingerprint, payload, created_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
    [
      run.runId,
      run.inputFingerprint,
      JSON.stringify(run),
      run.createdAt,
    ],
  );
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
      content: prompt.content,
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
      return {
        ...revisionPayloadV2Schema.parse(structuredClone(row.payload)),
        manifest,
        governance,
        prompt: persistedPromptSchema.parse({
          contentHash: row.prompt_content_hash,
          content: row.prompt_fallback_content,
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
          parseLegacySkillGovernance(legacy.governance),
        )
      : decodePersistedRevision(() =>
          parseLegacySkillGovernance(
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
      content: promptContent,
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
