import {
  type MARKETING_IDENTITY_ASSISTED_FIELDS,
  marketingIdentityAssetSchema,
  marketingIdentityDraftRequestSchema,
  marketingIdentityDraftResultSchema,
  marketingIdentityProjectionSchema,
  marketingIdentityQuerySchema,
  registerMarketingIdentityCommandSchema,
  rollbackDefaultMarketingIdentityCommandSchema,
  selectMarketingIdentityForSessionCommandSchema,
  setDefaultMarketingIdentityCommandSchema,
  transitionMarketingIdentityCommandSchema,
  type MarketingIdentityAsset,
  type MarketingIdentityDraftResult,
  type MarketingIdentityFieldProvenance,
  type MarketingIdentityProjection,
  type MarketingIdentityQuery,
  type MarketingIdentityReference,
  type RegisterMarketingIdentityCommand,
  type RollbackDefaultMarketingIdentityCommand,
  type SelectMarketingIdentityForSessionCommand,
  type SetDefaultMarketingIdentityCommand,
  type TransitionMarketingIdentityCommand,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type {
  MarketingIdentityDraftPort,
  ResolvedMarketingIdentityDraftRequest,
} from './marketing-identity-draft.js';

export interface StoredMarketingIdentityDraft
  extends MarketingIdentityDraftResult {
  workspaceId: string;
  actorId: string;
  kind: 'brand' | 'person';
  createdAt: string;
}

function parseStoredMarketingIdentityDraft(
  value: unknown
): StoredMarketingIdentityDraft {
  const metadata = z
    .object({
      workspaceId: z.string().trim().min(1),
      actorId: z.string().trim().min(1),
      kind: z.enum(['brand', 'person']),
      createdAt: z.iso.datetime(),
    })
    .passthrough()
    .parse(value);
  const result = marketingIdentityDraftResultSchema.parse({
    draftId: metadata.draftId,
    revision: metadata.revision,
    status: metadata.status,
    suggestion: metadata.suggestion,
    reference: metadata.reference,
    errorCode: metadata.errorCode,
  });
  return {
    ...result,
    workspaceId: metadata.workspaceId,
    actorId: metadata.actorId,
    kind: metadata.kind,
    createdAt: metadata.createdAt,
  };
}

export interface MarketingIdentityRepository {
  recordDraft(draft: StoredMarketingIdentityDraft): Promise<void>;
  getDraft(
    workspaceId: string,
    draftId: string,
    revision: number
  ): Promise<StoredMarketingIdentityDraft | null>;
  register(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: RegisterMarketingIdentityCommand;
  }): Promise<MarketingIdentityAsset>;
  transition(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: TransitionMarketingIdentityCommand;
  }): Promise<MarketingIdentityAsset>;
  list(
    workspaceId: string,
    query: MarketingIdentityQuery,
    at: string
  ): Promise<MarketingIdentityAsset[]>;
  listActive(
    workspaceId: string,
    at: string
  ): Promise<MarketingIdentityAsset[]>;
  setDefault(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: SetDefaultMarketingIdentityCommand;
  }): Promise<MarketingIdentityDecisionEvent>;
  selectForSession(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: SelectMarketingIdentityForSessionCommand;
  }): Promise<MarketingIdentityDecisionEvent>;
  rollbackDefault(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: RollbackDefaultMarketingIdentityCommand;
  }): Promise<MarketingIdentityDecisionEvent>;
  project(
    workspaceId: string,
    actorId: string,
    at: string
  ): Promise<MarketingIdentityProjection>;
  listDecisions(
    workspaceId: string,
    actorId: string
  ): Promise<MarketingIdentityDecisionEvent[]>;
}

export interface MarketingIdentityDecisionEvent {
  decisionId: string;
  decisionRevision: number;
  workspaceId: string;
  actorId: string;
  action:
    | 'set_default_marketing_identity'
    | 'rollback_default_marketing_identity'
    | 'select_marketing_identity_for_session';
  identity: MarketingIdentityReference | null;
  previousIdentity: MarketingIdentityReference | null;
  reason: string;
  rolledBackToDecisionRevision: number | null;
  sessionId: string | null;
  occurredAt: string;
}

export class MarketingIdentityVersionConflictError extends Error {
  readonly code = 'MARKETING_IDENTITY_VERSION_CONFLICT';
  readonly status = 409;

  constructor(
    readonly identityId: string,
    readonly expectedVersion: number,
    readonly currentVersion: number
  ) {
    super(
      `Marketing identity ${identityId} expected version ${expectedVersion}, current version is ${currentVersion}.`
    );
    this.name = 'MarketingIdentityVersionConflictError';
  }
}

function isActive(identity: MarketingIdentityAsset, at: string) {
  const timestamp = Date.parse(at);
  return (
    identity.status === 'active' &&
    Date.parse(identity.effectiveFrom) <= timestamp &&
    (identity.expiresAt === null || Date.parse(identity.expiresAt) > timestamp)
  );
}

function transitionStatus(
  transition: TransitionMarketingIdentityCommand['transition']
): MarketingIdentityAsset['status'] {
  if (transition === 'revoke') return 'revoked';
  if (transition === 'depart') return 'departed';
  return 'operator_changed';
}

export class MemoryMarketingIdentityRepository
  implements MarketingIdentityRepository
{
  private readonly identities = new Map<string, MarketingIdentityAsset[]>();
  private readonly decisions = new Map<
    string,
    MarketingIdentityDecisionEvent[]
  >();
  private readonly drafts = new Map<string, StoredMarketingIdentityDraft>();

  private key(workspaceId: string, identityId: string) {
    return `${workspaceId}\u0000${identityId}`;
  }

  async recordDraft(draft: StoredMarketingIdentityDraft) {
    const key = `${draft.workspaceId}\u0000${draft.draftId}\u0000${draft.revision}`;
    const current = this.drafts.get(key);
    if (current && JSON.stringify(current) !== JSON.stringify(draft)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Marketing identity draft id was reused with different content.'
      );
    }
    this.drafts.set(key, structuredClone(draft));
  }

  async getDraft(workspaceId: string, draftId: string, revision: number) {
    const draft = this.drafts.get(
      `${workspaceId}\u0000${draftId}\u0000${revision}`
    );
    return draft ? structuredClone(draft) : null;
  }

  async register(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: RegisterMarketingIdentityCommand;
  }) {
    const key = this.key(input.workspaceId, input.command.identityId);
    const current = this.identities.get(key) ?? [];
    if (current.length !== input.command.expectedVersion) {
      throw new MarketingIdentityVersionConflictError(
        input.command.identityId,
        input.command.expectedVersion,
        current.length
      );
    }
    const {
      expectedVersion: _expectedVersion,
      assistantDraft: _assistantDraft,
      ...attributes
    } = input.command;
    const identity = marketingIdentityAssetSchema.parse({
      ...attributes,
      workspaceId: input.workspaceId,
      version: 1,
      status: 'active',
      createdAt: input.occurredAt,
      createdBy: input.actorId,
    });
    this.identities.set(key, [identity]);
    return structuredClone(identity);
  }

  async transition(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: TransitionMarketingIdentityCommand;
  }) {
    const key = this.key(input.workspaceId, input.command.identityId);
    const history = this.identities.get(key) ?? [];
    const current = history.at(-1);
    if (!current) {
      throw new P1DomainError('NOT_FOUND', 'Marketing identity was not found.');
    }
    if (current.version !== input.command.expectedVersion) {
      throw new MarketingIdentityVersionConflictError(
        input.command.identityId,
        input.command.expectedVersion,
        current.version
      );
    }
    if (current.status !== 'active') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only an active marketing identity can change lifecycle state.'
      );
    }
    const next = marketingIdentityAssetSchema.parse({
      ...current,
      version: current.version + 1,
      status: transitionStatus(input.command.transition),
      createdAt: input.occurredAt,
      createdBy: input.actorId,
    });
    this.identities.set(key, [...history, next]);
    return structuredClone(next);
  }

  async list(workspaceId: string, query: MarketingIdentityQuery, at: string) {
    return [...this.identities.entries()]
      .filter(([key]) => key.startsWith(`${workspaceId}\u0000`))
      .map(([, history]) => history.at(-1))
      .filter((identity): identity is MarketingIdentityAsset =>
        Boolean(identity)
      )
      .filter(
        (identity) =>
          (!query.identityId || identity.identityId === query.identityId) &&
          (query.includeInactive || isActive(identity, at))
      )
      .map((identity) => structuredClone(identity));
  }

  listActive(workspaceId: string, at: string) {
    return this.list(workspaceId, { includeInactive: false }, at);
  }

  setDefault(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: SetDefaultMarketingIdentityCommand;
  }) {
    return this.recordDefaultDecision(input);
  }

  selectForSession(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: SelectMarketingIdentityForSessionCommand;
  }) {
    return this.recordDecision({
      ...input,
      action: 'select_marketing_identity_for_session',
      identity: input.command.identity,
      previousIdentity: null,
      reason: input.command.reason,
      rolledBackToDecisionRevision: null,
      sessionId: input.command.sessionId,
    });
  }

  rollbackDefault(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: RollbackDefaultMarketingIdentityCommand;
  }) {
    return this.recordDefaultDecision(input);
  }

  async project(workspaceId: string, actorId: string, at: string) {
    const identities = await this.listActive(workspaceId, at);
    const events = await this.listDecisions(workspaceId, actorId);
    const defaultEvent = latestDefaultDecision(events);
    const remembered = defaultEvent?.identity;
    const defaultIdentity =
      remembered &&
      identities.some(
        (identity) =>
          identity.identityId === remembered.identityId &&
          identity.version === remembered.version
      )
        ? remembered
        : null;
    return marketingIdentityProjectionSchema.parse({
      identities,
      defaultDecision: defaultEvent
        ? {
            decisionId: defaultEvent.decisionId,
            decisionRevision: defaultEvent.decisionRevision,
            identity: defaultEvent.identity,
          }
        : null,
      defaultIdentity,
      decisionRevision: events.at(-1)?.decisionRevision ?? 0,
    });
  }

  async listDecisions(workspaceId: string, actorId: string) {
    return structuredClone(
      this.decisions.get(this.decisionKey(workspaceId, actorId)) ?? []
    );
  }

  private decisionKey(workspaceId: string, actorId: string) {
    return `${workspaceId}\u0000${actorId}`;
  }

  private async recordDecision(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    action: MarketingIdentityDecisionEvent['action'];
    identity: MarketingIdentityReference | null;
    previousIdentity: MarketingIdentityReference | null;
    reason: string;
    rolledBackToDecisionRevision: number | null;
    sessionId: string | null;
  }) {
    if (input.identity) {
      await assertActiveIdentity(
        this,
        input.workspaceId,
        input.identity,
        input.occurredAt
      );
    }
    const key = this.decisionKey(input.workspaceId, input.actorId);
    const events = this.decisions.get(key) ?? [];
    const event: MarketingIdentityDecisionEvent = {
      decisionId: input.decisionId,
      decisionRevision: events.length + 1,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      identity: input.identity,
      previousIdentity: input.previousIdentity,
      reason: input.reason,
      rolledBackToDecisionRevision: input.rolledBackToDecisionRevision,
      sessionId: input.sessionId,
      occurredAt: input.occurredAt,
    };
    this.decisions.set(key, [...events, event]);
    return structuredClone(event);
  }

  private async recordDefaultDecision(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command:
      | SetDefaultMarketingIdentityCommand
      | RollbackDefaultMarketingIdentityCommand;
  }) {
    const key = this.decisionKey(input.workspaceId, input.actorId);
    const events = this.decisions.get(key) ?? [];
    const current = latestDefaultDecision(events);
    if (
      (current?.decisionRevision ?? 0) !==
      input.command.expectedDecisionRevision
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Marketing identity default changed before this decision was applied.'
      );
    }
    const targetRevision =
      'targetDecisionRevision' in input.command
        ? input.command.targetDecisionRevision
        : null;
    const target =
      targetRevision !== null
        ? events.find(
            (event) =>
              event.decisionRevision === targetRevision &&
              event.action !== 'select_marketing_identity_for_session'
          )
        : null;
    if (targetRevision !== null && !target) {
      throw new P1DomainError(
        'NOT_FOUND',
        'Marketing identity default decision was not found.'
      );
    }
    const identity =
      targetRevision !== null
        ? target!.identity
        : 'identity' in input.command
          ? input.command.identity
          : null;
    if (identity) {
      await assertActiveIdentity(
        this,
        input.workspaceId,
        identity,
        input.occurredAt
      );
    }
    return this.recordDecision({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      decisionId: input.decisionId,
      action:
        targetRevision !== null
          ? 'rollback_default_marketing_identity'
          : 'set_default_marketing_identity',
      identity,
      previousIdentity: current?.identity ?? null,
      reason: input.command.reason,
      rolledBackToDecisionRevision: targetRevision,
      sessionId: null,
    });
  }
}

export class PostgresMarketingIdentityRepository
  implements MarketingIdentityRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_marketing_identity_versions (
        workspace_id text NOT NULL,
        identity_id text NOT NULL,
        version bigint NOT NULL CHECK (version > 0),
        status text NOT NULL CHECK (
          status IN ('active', 'revoked', 'departed', 'operator_changed')
        ),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, identity_id, version)
      );

      CREATE INDEX IF NOT EXISTS p1_marketing_identity_latest_idx
        ON p1_marketing_identity_versions (workspace_id, identity_id, version DESC);

      CREATE TABLE IF NOT EXISTS p1_marketing_identity_assistant_drafts (
        workspace_id text NOT NULL,
        draft_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        actor_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('brand', 'person')),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, draft_id, revision)
      );

      CREATE TABLE IF NOT EXISTS p1_marketing_identity_decisions (
        workspace_id text NOT NULL,
        actor_id text NOT NULL,
        decision_id text NOT NULL,
        decision_revision bigint NOT NULL CHECK (decision_revision > 0),
        action text NOT NULL CHECK (
          action IN (
            'set_default_marketing_identity',
            'rollback_default_marketing_identity',
            'select_marketing_identity_for_session'
          )
        ),
        identity_id text,
        identity_version bigint CHECK (identity_version > 0),
        previous_identity_id text,
        previous_identity_version bigint CHECK (previous_identity_version > 0),
        reason text NOT NULL,
        rolled_back_to_decision_revision bigint,
        session_id text,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, actor_id, decision_id),
        UNIQUE (workspace_id, actor_id, decision_revision),
        CHECK ((identity_id IS NULL) = (identity_version IS NULL)),
        CHECK (
          (previous_identity_id IS NULL) = (previous_identity_version IS NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS p1_marketing_identity_default_heads (
        workspace_id text NOT NULL,
        actor_id text NOT NULL,
        decision_revision bigint NOT NULL CHECK (decision_revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, actor_id)
      );

      ALTER TABLE p1_marketing_identity_decisions
        ADD COLUMN IF NOT EXISTS previous_identity_id text,
        ADD COLUMN IF NOT EXISTS previous_identity_version bigint,
        ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'legacy decision',
        ADD COLUMN IF NOT EXISTS rolled_back_to_decision_revision bigint;
      ALTER TABLE p1_marketing_identity_decisions
        ALTER COLUMN reason DROP DEFAULT;
      ALTER TABLE p1_marketing_identity_decisions
        DROP CONSTRAINT IF EXISTS p1_marketing_identity_decisions_action_check;
      ALTER TABLE p1_marketing_identity_decisions
        ADD CONSTRAINT p1_marketing_identity_decisions_action_check CHECK (
          action IN (
            'set_default_marketing_identity',
            'rollback_default_marketing_identity',
            'select_marketing_identity_for_session'
          )
        );
      INSERT INTO p1_marketing_identity_default_heads (
        workspace_id, actor_id, decision_revision
      )
      SELECT DISTINCT ON (workspace_id, actor_id)
        workspace_id, actor_id, decision_revision
      FROM p1_marketing_identity_decisions
      WHERE action <> 'select_marketing_identity_for_session'
      ORDER BY workspace_id, actor_id, decision_revision DESC
      ON CONFLICT (workspace_id, actor_id) DO NOTHING;

      CREATE INDEX IF NOT EXISTS p1_marketing_identity_decision_projection_idx
        ON p1_marketing_identity_decisions (
          workspace_id, actor_id, decision_revision DESC
        );
    `);
  }

  async recordDraft(draft: StoredMarketingIdentityDraft) {
    const result = await this.pool.query<{ payload: unknown }>(
      `INSERT INTO p1_marketing_identity_assistant_drafts (
         workspace_id, draft_id, revision, actor_id, kind, payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (workspace_id, draft_id, revision) DO NOTHING
       RETURNING payload`,
      [
        draft.workspaceId,
        draft.draftId,
        draft.revision,
        draft.actorId,
        draft.kind,
        JSON.stringify(draft),
        draft.createdAt,
      ]
    );
    if (result.rowCount === 1) return;
    const current = await this.getDraft(
      draft.workspaceId,
      draft.draftId,
      draft.revision
    );
    if (!current || JSON.stringify(current) !== JSON.stringify(draft)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Marketing identity draft id was reused with different content.'
      );
    }
  }

  async getDraft(workspaceId: string, draftId: string, revision: number) {
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT payload
         FROM p1_marketing_identity_assistant_drafts
        WHERE workspace_id = $1 AND draft_id = $2 AND revision = $3`,
      [workspaceId, draftId, revision]
    );
    return result.rows[0]
      ? parseStoredMarketingIdentityDraft(result.rows[0].payload)
      : null;
  }

  async register(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: RegisterMarketingIdentityCommand;
  }) {
    return this.write(
      input.workspaceId,
      input.command.identityId,
      async (client, current) => {
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== input.command.expectedVersion) {
          throw new MarketingIdentityVersionConflictError(
            input.command.identityId,
            input.command.expectedVersion,
            currentVersion
          );
        }
        const {
          expectedVersion: _expectedVersion,
          assistantDraft: _assistantDraft,
          ...attributes
        } = input.command;
        return marketingIdentityAssetSchema.parse({
          ...attributes,
          workspaceId: input.workspaceId,
          version: 1,
          status: 'active',
          createdAt: input.occurredAt,
          createdBy: input.actorId,
        });
      }
    );
  }

  async transition(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: TransitionMarketingIdentityCommand;
  }) {
    return this.write(
      input.workspaceId,
      input.command.identityId,
      async (_client, current) => {
        if (!current) {
          throw new P1DomainError(
            'NOT_FOUND',
            'Marketing identity was not found.'
          );
        }
        if (current.version !== input.command.expectedVersion) {
          throw new MarketingIdentityVersionConflictError(
            input.command.identityId,
            input.command.expectedVersion,
            current.version
          );
        }
        if (current.status !== 'active') {
          throw new P1DomainError(
            'INVALID_STATE',
            'Only an active marketing identity can change lifecycle state.'
          );
        }
        return marketingIdentityAssetSchema.parse({
          ...current,
          version: current.version + 1,
          status: transitionStatus(input.command.transition),
          createdAt: input.occurredAt,
          createdBy: input.actorId,
        });
      }
    );
  }

  async list(workspaceId: string, query: MarketingIdentityQuery, at: string) {
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT DISTINCT ON (identity_id) payload
         FROM p1_marketing_identity_versions
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR identity_id = $2)
        ORDER BY identity_id, version DESC`,
      [workspaceId, query.identityId ?? null]
    );
    return result.rows
      .map((row) => marketingIdentityAssetSchema.parse(row.payload))
      .filter((identity) => query.includeInactive || isActive(identity, at));
  }

  listActive(workspaceId: string, at: string) {
    return this.list(workspaceId, { includeInactive: false }, at);
  }

  setDefault(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: SetDefaultMarketingIdentityCommand;
  }) {
    return this.recordDefaultDecision(input);
  }

  selectForSession(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: SelectMarketingIdentityForSessionCommand;
  }) {
    return this.recordDecision({
      ...input,
      action: 'select_marketing_identity_for_session',
      identity: input.command.identity,
      previousIdentity: null,
      reason: input.command.reason,
      rolledBackToDecisionRevision: null,
      sessionId: input.command.sessionId,
    });
  }

  rollbackDefault(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command: RollbackDefaultMarketingIdentityCommand;
  }) {
    return this.recordDefaultDecision(input);
  }

  async project(workspaceId: string, actorId: string, at: string) {
    const identities = await this.listActive(workspaceId, at);
    const events = await this.listDecisions(workspaceId, actorId);
    const defaultEvent = latestDefaultDecision(events);
    const remembered = defaultEvent?.identity;
    const defaultIdentity =
      remembered &&
      identities.some(
        (identity) =>
          identity.identityId === remembered.identityId &&
          identity.version === remembered.version
      )
        ? remembered
        : null;
    return marketingIdentityProjectionSchema.parse({
      identities,
      defaultDecision: defaultEvent
        ? {
            decisionId: defaultEvent.decisionId,
            decisionRevision: defaultEvent.decisionRevision,
            identity: defaultEvent.identity,
          }
        : null,
      defaultIdentity,
      decisionRevision: events.at(-1)?.decisionRevision ?? 0,
    });
  }

  async listDecisions(workspaceId: string, actorId: string) {
    const result = await this.pool.query<{
      decision_id: string;
      decision_revision: string;
      action: MarketingIdentityDecisionEvent['action'];
      identity_id: string | null;
      identity_version: string | null;
      previous_identity_id: string | null;
      previous_identity_version: string | null;
      reason: string;
      rolled_back_to_decision_revision: string | null;
      session_id: string | null;
      occurred_at: Date;
    }>(
      `SELECT decision_id, decision_revision, action, identity_id,
              identity_version, previous_identity_id,
              previous_identity_version, reason,
              rolled_back_to_decision_revision, session_id, occurred_at
         FROM p1_marketing_identity_decisions
        WHERE workspace_id = $1 AND actor_id = $2
        ORDER BY decision_revision`,
      [workspaceId, actorId]
    );
    return result.rows.map((row) => ({
      decisionId: row.decision_id,
      decisionRevision: Number(row.decision_revision),
      workspaceId,
      actorId,
      action: row.action,
      identity:
        row.identity_id && row.identity_version
          ? {
              identityId: row.identity_id,
              version: Number(row.identity_version),
            }
          : null,
      previousIdentity:
        row.previous_identity_id && row.previous_identity_version
          ? {
              identityId: row.previous_identity_id,
              version: Number(row.previous_identity_version),
            }
          : null,
      reason: row.reason,
      rolledBackToDecisionRevision:
        row.rolled_back_to_decision_revision === null
          ? null
          : Number(row.rolled_back_to_decision_revision),
      sessionId: row.session_id,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  private async recordDecision(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    action: MarketingIdentityDecisionEvent['action'];
    identity: MarketingIdentityReference | null;
    previousIdentity: MarketingIdentityReference | null;
    reason: string;
    rolledBackToDecisionRevision: number | null;
    sessionId: string | null;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:${input.actorId}:marketing-identity-decision`,
      ]);
      await this.assertActiveIdentityWithClient(
        client,
        input.workspaceId,
        input.identity,
        input.occurredAt
      );
      const event: MarketingIdentityDecisionEvent = {
        decisionId: input.decisionId,
        decisionRevision: await this.nextDecisionRevision(
          client,
          input.workspaceId,
          input.actorId
        ),
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: input.action,
        identity: input.identity,
        previousIdentity: input.previousIdentity,
        reason: input.reason,
        rolledBackToDecisionRevision: input.rolledBackToDecisionRevision,
        sessionId: input.sessionId,
        occurredAt: input.occurredAt,
      };
      await this.insertDecision(client, event);
      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordDefaultDecision(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    decisionId: string;
    command:
      | SetDefaultMarketingIdentityCommand
      | RollbackDefaultMarketingIdentityCommand;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:${input.actorId}:marketing-identity-decision`,
      ]);
      await client.query(
        `INSERT INTO p1_marketing_identity_default_heads (
           workspace_id, actor_id, decision_revision
         ) VALUES ($1, $2, 0)
         ON CONFLICT (workspace_id, actor_id) DO NOTHING`,
        [input.workspaceId, input.actorId]
      );
      const headResult = await client.query<{ decision_revision: string }>(
        `SELECT decision_revision
           FROM p1_marketing_identity_default_heads
          WHERE workspace_id = $1 AND actor_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.actorId]
      );
      const currentRevision = Number(
        headResult.rows[0]?.decision_revision ?? 0
      );
      if (currentRevision !== input.command.expectedDecisionRevision) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Marketing identity default changed before this decision was applied.'
        );
      }
      const previousIdentity =
        currentRevision === 0
          ? null
          : await this.identityForDecisionRevision(
              client,
              input.workspaceId,
              input.actorId,
              currentRevision
            );
      const targetRevision =
        'targetDecisionRevision' in input.command
          ? input.command.targetDecisionRevision
          : null;
      const identity =
        targetRevision !== null
          ? await this.identityForDecisionRevision(
              client,
              input.workspaceId,
              input.actorId,
              targetRevision
            )
          : 'identity' in input.command
            ? input.command.identity
            : null;
      if (targetRevision !== null && !identity) {
        throw new P1DomainError(
          'NOT_FOUND',
          'Marketing identity default decision was not found.'
        );
      }
      await this.assertActiveIdentityWithClient(
        client,
        input.workspaceId,
        identity,
        input.occurredAt
      );
      const event: MarketingIdentityDecisionEvent = {
        decisionId: input.decisionId,
        decisionRevision: await this.nextDecisionRevision(
          client,
          input.workspaceId,
          input.actorId
        ),
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action:
          targetRevision !== null
            ? 'rollback_default_marketing_identity'
            : 'set_default_marketing_identity',
        identity,
        previousIdentity,
        reason: input.command.reason,
        rolledBackToDecisionRevision: targetRevision,
        sessionId: null,
        occurredAt: input.occurredAt,
      };
      await this.insertDecision(client, event);
      await client.query(
        `UPDATE p1_marketing_identity_default_heads
            SET decision_revision = $3, updated_at = now()
          WHERE workspace_id = $1 AND actor_id = $2`,
        [input.workspaceId, input.actorId, event.decisionRevision]
      );
      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async identityForDecisionRevision(
    client: PoolClient,
    workspaceId: string,
    actorId: string,
    decisionRevision: number
  ): Promise<MarketingIdentityReference | null> {
    const result = await client.query<{
      action: MarketingIdentityDecisionEvent['action'];
      identity_id: string | null;
      identity_version: string | null;
    }>(
      `SELECT action, identity_id, identity_version
         FROM p1_marketing_identity_decisions
        WHERE workspace_id = $1
          AND actor_id = $2
          AND decision_revision = $3`,
      [workspaceId, actorId, decisionRevision]
    );
    const row = result.rows[0];
    if (
      !row ||
      row.action === 'select_marketing_identity_for_session' ||
      !row.identity_id ||
      !row.identity_version
    ) {
      return null;
    }
    return {
      identityId: row.identity_id,
      version: Number(row.identity_version),
    };
  }

  private async assertActiveIdentityWithClient(
    client: PoolClient,
    workspaceId: string,
    reference: MarketingIdentityReference | null,
    at: string
  ) {
    if (!reference) return;
    const result = await client.query<{ payload: unknown }>(
      `SELECT payload
         FROM p1_marketing_identity_versions
        WHERE workspace_id = $1 AND identity_id = $2
        ORDER BY version DESC
        LIMIT 1`,
      [workspaceId, reference.identityId]
    );
    const identity = result.rows[0]
      ? marketingIdentityAssetSchema.parse(result.rows[0].payload)
      : null;
    if (
      !identity ||
      identity.version !== reference.version ||
      !isActive(identity, at)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Marketing identity is missing, inactive, or at a different revision.'
      );
    }
  }

  private async nextDecisionRevision(
    client: PoolClient,
    workspaceId: string,
    actorId: string
  ) {
    const result = await client.query<{ revision: string }>(
      `SELECT (COALESCE(MAX(decision_revision), 0) + 1)::text AS revision
         FROM p1_marketing_identity_decisions
        WHERE workspace_id = $1 AND actor_id = $2`,
      [workspaceId, actorId]
    );
    return Number(result.rows[0]?.revision ?? 1);
  }

  private async insertDecision(
    client: PoolClient,
    event: MarketingIdentityDecisionEvent
  ) {
    await client.query(
      `INSERT INTO p1_marketing_identity_decisions (
         workspace_id, actor_id, decision_id, decision_revision, action,
         identity_id, identity_version, previous_identity_id,
         previous_identity_version, reason, rolled_back_to_decision_revision,
         session_id, occurred_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       )`,
      [
        event.workspaceId,
        event.actorId,
        event.decisionId,
        event.decisionRevision,
        event.action,
        event.identity?.identityId ?? null,
        event.identity?.version ?? null,
        event.previousIdentity?.identityId ?? null,
        event.previousIdentity?.version ?? null,
        event.reason,
        event.rolledBackToDecisionRevision,
        event.sessionId,
        event.occurredAt,
      ]
    );
  }

  private async write(
    workspaceId: string,
    identityId: string,
    create: (
      client: PoolClient,
      current: MarketingIdentityAsset | null
    ) => Promise<MarketingIdentityAsset>
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${workspaceId}:marketing-identity`,
      ]);
      const result = await client.query<{ payload: unknown }>(
        `SELECT payload
           FROM p1_marketing_identity_versions
          WHERE workspace_id = $1 AND identity_id = $2
          ORDER BY version DESC
          LIMIT 1
          FOR UPDATE`,
        [workspaceId, identityId]
      );
      const current = result.rows[0]
        ? marketingIdentityAssetSchema.parse(result.rows[0].payload)
        : null;
      const identity = await create(client, current);
      await client.query(
        `INSERT INTO p1_marketing_identity_versions (
           workspace_id, identity_id, version, status, payload, created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          workspaceId,
          identityId,
          identity.version,
          identity.status,
          JSON.stringify(identity),
          identity.createdAt,
        ]
      );
      await client.query(
        `INSERT INTO p1_context_source_revisions (
           workspace_id, source_key, revision
         ) VALUES ($1, 'identity', 1)
         ON CONFLICT (workspace_id, source_key)
         DO UPDATE SET revision = p1_context_source_revisions.revision + 1,
                       updated_at = now()`,
        [workspaceId]
      );
      await client.query('COMMIT');
      return identity;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function action(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A marketing identity action is required.'
    );
  }
  return input.action;
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A marketing identity payload is required.'
    );
  }
  return value;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Invalid marketing identity payload.'
    );
  }
  return parsed.data;
}

export interface MarketingIdentityReferenceDraftResolver {
  resolve(input: {
    workspaceId: string;
    draftId: string;
    revision: number;
  }): Promise<ResolvedMarketingIdentityDraftRequest['reference']>;
}

function draftLines(value: string) {
  return value
    .split(/[,\n，]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function registeredAssistedValue(
  command: RegisterMarketingIdentityCommand,
  field: (typeof MARKETING_IDENTITY_ASSISTED_FIELDS)[number]
) {
  if (field === 'displayName' || field === 'owner') return command[field];
  if (field === 'professionalBoundaries' || field === 'expressionSamples') {
    return command[field];
  }
  if (field === 'brandClaims') {
    return command.kind === 'brand' ? command.brandClaims : undefined;
  }
  if (field === 'realWorldRole') {
    return command.kind === 'person' ? command.realWorldRole : undefined;
  }
  if (
    field === 'forbiddenClaims' ||
    field === 'visualPrinciples' ||
    field === 'seriesAnchors'
  ) {
    return command.kind === 'brand' ? command[field] : undefined;
  }
  return undefined;
}

function suggestedAssistedValue(
  draft: StoredMarketingIdentityDraft,
  field: (typeof MARKETING_IDENTITY_ASSISTED_FIELDS)[number]
): {
  value: string | string[];
  provenance: MarketingIdentityFieldProvenance;
} | null {
  const suggested =
    field === 'brandClaims' || field === 'realWorldRole'
      ? draft.suggestion.primaryClaimOrRole
      : draft.suggestion[field];
  if (!suggested) return null;
  return {
    value:
      field === 'displayName' || field === 'owner' || field === 'realWorldRole'
        ? suggested.value.trim()
        : draftLines(suggested.value),
    provenance: suggested.provenance,
  };
}

async function assertRevisionBoundDraft(
  identities: MarketingIdentityRepository,
  workspaceId: string,
  actorId: string,
  command: RegisterMarketingIdentityCommand
) {
  const reference = command.assistantDraft;
  if (!reference) return;
  const draft = await identities.getDraft(
    workspaceId,
    reference.draftId,
    reference.revision
  );
  if (
    !draft ||
    draft.actorId !== actorId ||
    draft.kind !== command.kind ||
    draft.status !== 'suggested'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'The confirmed assistant draft is missing or no longer matches this identity.'
    );
  }
  for (const field of reference.confirmedFields) {
    const provenance = command.fieldProvenance?.[field];
    const suggested = suggestedAssistedValue(draft, field);
    const registered = registeredAssistedValue(command, field);
    if (
      provenance === 'user' ||
      !suggested ||
      suggested.provenance !== provenance ||
      JSON.stringify(suggested.value) !== JSON.stringify(registered)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Confirmed assistant field ${field} does not match draft revision ${draft.revision}.`
      );
    }
  }
}

export class MarketingIdentityFoundationModule implements P1OperationModule {
  readonly name = 'marketing-identity';

  constructor(
    private readonly identities: MarketingIdentityRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly drafter?: MarketingIdentityDraftPort,
    private readonly referenceDrafts?: MarketingIdentityReferenceDraftResolver
  ) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    if (name === 'draft_marketing_identity') {
      const request = parse(
        marketingIdentityDraftRequestSchema,
        payload(args.input)
      );
      const reference = request.referenceDraft
        ? ((await this.referenceDrafts?.resolve({
            workspaceId: args.context.workspaceId,
            draftId: request.referenceDraft.draftId,
            revision: request.referenceDraft.revision,
          })) ?? null)
        : null;
      if (request.referenceDraft && !reference) {
        throw new P1DomainError(
          'INVALID_STATE',
          'The referenced parsed draft is unavailable.'
        );
      }
      const outcome = this.drafter
        ? await this.drafter.suggest({
            workspaceId: args.context.workspaceId,
            actorId: args.context.userId,
            effectIdempotencyKey: args.idempotencyKey,
            request: {
              background: request.background,
              kind: request.kind,
              reference,
            },
          })
        : {
            status: 'unavailable' as const,
            suggestion: {
              displayName: null,
              owner: null,
              primaryClaimOrRole: null,
              professionalBoundaries: null,
              expressionSamples: null,
              forbiddenClaims: null,
              visualPrinciples: null,
              seriesAnchors: null,
            },
            errorCode: 'model_unavailable' as const,
          };
      const result = marketingIdentityDraftResultSchema.parse({
        draftId: `marketing-identity-draft:${args.idempotencyKey}`,
        revision: 1,
        ...outcome,
        reference: reference
          ? {
              draftId: reference.draftId,
              draftRevision: reference.draftRevision,
              parsedDocumentId: reference.parsedDocumentId,
            }
          : null,
      });
      await this.identities.recordDraft({
        ...result,
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        kind: request.kind,
        createdAt: this.now(),
      });
      return result;
    }
    if (name === 'register_marketing_identity') {
      const command = parse(
        registerMarketingIdentityCommandSchema,
        payload(args.input)
      );
      await assertRevisionBoundDraft(
        this.identities,
        args.context.workspaceId,
        args.context.userId,
        command
      );
      return this.identities.register({
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        occurredAt: this.now(),
        command,
      });
    }
    if (name === 'transition_marketing_identity') {
      return this.identities.transition({
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        occurredAt: this.now(),
        command: parse(
          transitionMarketingIdentityCommandSchema,
          payload(args.input)
        ),
      });
    }
    if (name === 'set_default_marketing_identity') {
      return this.identities.setDefault({
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        occurredAt: this.now(),
        decisionId: args.idempotencyKey,
        command: parse(
          setDefaultMarketingIdentityCommandSchema,
          payload(args.input)
        ),
      });
    }
    if (name === 'select_marketing_identity_for_session') {
      return this.identities.selectForSession({
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        occurredAt: this.now(),
        decisionId: args.idempotencyKey,
        command: parse(
          selectMarketingIdentityForSessionCommandSchema,
          payload(args.input)
        ),
      });
    }
    if (name === 'rollback_default_marketing_identity') {
      return this.identities.rollbackDefault({
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        occurredAt: this.now(),
        decisionId: args.idempotencyKey,
        command: parse(
          rollbackDefaultMarketingIdentityCommandSchema,
          payload(args.input)
        ),
      });
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown marketing identity command ${name}.`
    );
  }

  query(args: { context: P1Context; input: Record<string, unknown> }) {
    const name = action(args.input);
    if (name === 'marketing_identity_projection') {
      parse(z.object({}).strict(), payload(args.input));
      return this.identities.project(
        args.context.workspaceId,
        args.context.userId,
        this.now()
      );
    }
    if (name === 'marketing_identity_decisions') {
      parse(z.object({}).strict(), payload(args.input));
      return this.identities.listDecisions(
        args.context.workspaceId,
        args.context.userId
      );
    }
    if (name !== 'marketing_identities') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Unknown marketing identity query.'
      );
    }
    return this.identities.list(
      args.context.workspaceId,
      parse(marketingIdentityQuerySchema, payload(args.input)),
      this.now()
    );
  }
}

function latestDefaultDecision(events: MarketingIdentityDecisionEvent[]) {
  return events
    .filter((event) => event.action !== 'select_marketing_identity_for_session')
    .at(-1);
}

async function assertActiveIdentity(
  repository: Pick<MarketingIdentityRepository, 'listActive'>,
  workspaceId: string,
  reference: MarketingIdentityReference,
  at: string
) {
  const identities = await repository.listActive(workspaceId, at);
  if (
    !identities.some(
      (identity) =>
        identity.identityId === reference.identityId &&
        identity.version === reference.version
    )
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Marketing identity is missing, inactive, or at a different revision.'
    );
  }
}
