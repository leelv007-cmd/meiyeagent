import {
  marketingIdentityAssetSchema,
  marketingIdentityQuerySchema,
  registerMarketingIdentityCommandSchema,
  transitionMarketingIdentityCommandSchema,
  type MarketingIdentityAsset,
  type MarketingIdentityQuery,
  type RegisterMarketingIdentityCommand,
  type TransitionMarketingIdentityCommand,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';

export interface MarketingIdentityRepository {
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
    at: string,
  ): Promise<MarketingIdentityAsset[]>;
  listActive(workspaceId: string, at: string): Promise<MarketingIdentityAsset[]>;
}

export class MarketingIdentityVersionConflictError extends Error {
  readonly code = 'MARKETING_IDENTITY_VERSION_CONFLICT';
  readonly status = 409;

  constructor(
    readonly identityId: string,
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super(
      `Marketing identity ${identityId} expected version ${expectedVersion}, current version is ${currentVersion}.`,
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
  transition: TransitionMarketingIdentityCommand['transition'],
): MarketingIdentityAsset['status'] {
  if (transition === 'revoke') return 'revoked';
  if (transition === 'depart') return 'departed';
  return 'operator_changed';
}

export class MemoryMarketingIdentityRepository
  implements MarketingIdentityRepository
{
  private readonly identities = new Map<string, MarketingIdentityAsset[]>();

  private key(workspaceId: string, identityId: string) {
    return `${workspaceId}\u0000${identityId}`;
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
        current.length,
      );
    }
    const { expectedVersion: _expectedVersion, ...attributes } = input.command;
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
        current.version,
      );
    }
    if (current.status !== 'active') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only an active marketing identity can change lifecycle state.',
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

  async list(
    workspaceId: string,
    query: MarketingIdentityQuery,
    at: string,
  ) {
    return [...this.identities.entries()]
      .filter(([key]) => key.startsWith(`${workspaceId}\u0000`))
      .map(([, history]) => history.at(-1))
      .filter((identity): identity is MarketingIdentityAsset => Boolean(identity))
      .filter(
        (identity) =>
          (!query.identityId || identity.identityId === query.identityId) &&
          (query.includeInactive || isActive(identity, at)),
      )
      .map((identity) => structuredClone(identity));
  }

  listActive(workspaceId: string, at: string) {
    return this.list(workspaceId, { includeInactive: false }, at);
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
    `);
  }

  async register(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: RegisterMarketingIdentityCommand;
  }) {
    return this.write(input.workspaceId, input.command.identityId, async (client, current) => {
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== input.command.expectedVersion) {
        throw new MarketingIdentityVersionConflictError(
          input.command.identityId,
          input.command.expectedVersion,
          currentVersion,
        );
      }
      const { expectedVersion: _expectedVersion, ...attributes } = input.command;
      return marketingIdentityAssetSchema.parse({
        ...attributes,
        workspaceId: input.workspaceId,
        version: 1,
        status: 'active',
        createdAt: input.occurredAt,
        createdBy: input.actorId,
      });
    });
  }

  async transition(input: {
    workspaceId: string;
    actorId: string;
    occurredAt: string;
    command: TransitionMarketingIdentityCommand;
  }) {
    return this.write(input.workspaceId, input.command.identityId, async (_client, current) => {
      if (!current) {
        throw new P1DomainError('NOT_FOUND', 'Marketing identity was not found.');
      }
      if (current.version !== input.command.expectedVersion) {
        throw new MarketingIdentityVersionConflictError(
          input.command.identityId,
          input.command.expectedVersion,
          current.version,
        );
      }
      if (current.status !== 'active') {
        throw new P1DomainError(
          'INVALID_STATE',
          'Only an active marketing identity can change lifecycle state.',
        );
      }
      return marketingIdentityAssetSchema.parse({
        ...current,
        version: current.version + 1,
        status: transitionStatus(input.command.transition),
        createdAt: input.occurredAt,
        createdBy: input.actorId,
      });
    });
  }

  async list(
    workspaceId: string,
    query: MarketingIdentityQuery,
    at: string,
  ) {
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT DISTINCT ON (identity_id) payload
         FROM p1_marketing_identity_versions
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR identity_id = $2)
        ORDER BY identity_id, version DESC`,
      [workspaceId, query.identityId ?? null],
    );
    return result.rows
      .map((row) => marketingIdentityAssetSchema.parse(row.payload))
      .filter((identity) => query.includeInactive || isActive(identity, at));
  }

  listActive(workspaceId: string, at: string) {
    return this.list(workspaceId, { includeInactive: false }, at);
  }

  private async write(
    workspaceId: string,
    identityId: string,
    create: (
      client: PoolClient,
      current: MarketingIdentityAsset | null,
    ) => Promise<MarketingIdentityAsset>,
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
        [workspaceId, identityId],
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
        ],
      );
      await client.query(
        `INSERT INTO p1_context_source_revisions (
           workspace_id, source_key, revision
         ) VALUES ($1, 'identity', 1)
         ON CONFLICT (workspace_id, source_key)
         DO UPDATE SET revision = p1_context_source_revisions.revision + 1,
                       updated_at = now()`,
        [workspaceId],
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
    throw new P1DomainError('INVALID_STATE', 'A marketing identity action is required.');
  }
  return input.action;
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError('INVALID_STATE', 'A marketing identity payload is required.');
  }
  return value;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError('INVALID_STATE', 'Invalid marketing identity payload.');
  }
  return parsed.data;
}

export class MarketingIdentityFoundationModule implements P1OperationModule {
  readonly name = 'marketing-identity';

  constructor(
    private readonly identities: MarketingIdentityRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    if (name === 'register_marketing_identity') {
      return this.identities.register({
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        occurredAt: this.now(),
        command: parse(registerMarketingIdentityCommandSchema, payload(args.input)),
      });
    }
    if (name === 'transition_marketing_identity') {
      return this.identities.transition({
        workspaceId: args.context.workspaceId,
        actorId: args.context.userId,
        occurredAt: this.now(),
        command: parse(transitionMarketingIdentityCommandSchema, payload(args.input)),
      });
    }
    throw new P1DomainError('INVALID_STATE', `Unknown marketing identity command ${name}.`);
  }

  query(args: { context: P1Context; input: Record<string, unknown> }) {
    if (action(args.input) !== 'marketing_identities') {
      throw new P1DomainError('INVALID_STATE', 'Unknown marketing identity query.');
    }
    return this.identities.list(
      args.context.workspaceId,
      parse(marketingIdentityQuerySchema, payload(args.input)),
      this.now(),
    );
  }
}
