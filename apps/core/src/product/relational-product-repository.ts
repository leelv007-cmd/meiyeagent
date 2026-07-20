import type { CommandResult, ProductContext, ProductState } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import { mapLegacyProductState } from '../p1/cutover/legacy-mapper.js';
import type { RelationFact } from '../p1/foundation/domain.js';
import type {
  IdempotentProductOutcome,
  ProductRepository,
} from './repository.js';
import {
  createProductRelationRevisionFacts,
  rebuildProductStateFromRelationFacts,
} from './relational-product-state.js';

export class PostgresRelationalProductRepository implements ProductRepository {
  constructor(
    private readonly pool: Pool,
    private readonly transactionClient?: PoolClient
  ) {}

  private get database() {
    return this.transactionClient ?? this.pool;
  }

  async migrate(client?: PoolClient) {
    await (client ?? this.database).query(`
      CREATE TABLE IF NOT EXISTS p1_relation_facts (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        kind text NOT NULL,
        parent_id text,
        legacy_sequence integer,
        data jsonb NOT NULL,
        legacy_source text,
        mapping_confidence text,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      ALTER TABLE p1_relation_facts
        ADD COLUMN IF NOT EXISTS legacy_sequence integer;
      CREATE INDEX IF NOT EXISTS p1_relation_product_kind_idx
        ON p1_relation_facts (workspace_id, kind, created_at);
      CREATE INDEX IF NOT EXISTS p1_relation_product_logical_revision_idx
        ON p1_relation_facts (
          workspace_id,
          (data->>'logicalFactId'),
          ((data->>'revisionNumber')::bigint) DESC
        )
        WHERE data->>'recordType' = 'product_entity_revision';
      CREATE INDEX IF NOT EXISTS p1_relation_product_meta_revision_idx
        ON p1_relation_facts (
          workspace_id,
          ((data->>'revisionNumber')::bigint) DESC
        )
        WHERE data->>'recordType' = 'product_projection_meta_revision';
      CREATE TABLE IF NOT EXISTS p1_product_command_results (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
    `);
  }

  async withWorkspaceLock<T>(
    workspaceId: string,
    action: (repository: ProductRepository) => Promise<T>
  ): Promise<T> {
    if (this.transactionClient) return action(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        workspaceId,
      ]);
      const result = await action(
        new PostgresRelationalProductRepository(this.pool, client)
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async hasMembership(userId: string, workspaceId: string) {
    const result = await this.database.query(
      `SELECT 1 FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [workspaceId, userId]
    );
    return result.rowCount === 1;
  }

  async getMembershipRole(userId: string, workspaceId: string) {
    const result = await this.database.query<{ role: string }>(
      `SELECT role FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [workspaceId, userId]
    );
    return result.rows[0]?.role ?? null;
  }

  async getFutureWriteOwner(workspaceId: string) {
    const result = await this.database.query<{
      owner: 'legacy' | 'frozen' | 'p1';
    }>('SELECT owner FROM p1_write_ownership WHERE workspace_id = $1', [
      workspaceId,
    ]);
    return result.rows[0]?.owner ?? 'legacy';
  }

  async load(workspaceId: string) {
    const legacy = await this.database.query<{ state: ProductState }>(
      'SELECT state FROM product_states WHERE workspace_id = $1',
      [workspaceId]
    );
    const facts = await this.database.query<Pick<RelationFact, 'data'>>(
      `SELECT data FROM p1_relation_facts
        WHERE workspace_id = $1
          AND data->>'recordType' IN (
            'product_entity_revision',
            'product_projection_meta_revision'
          )`,
      [workspaceId]
    );
    return rebuildProductStateFromRelationFacts(
      legacy.rows[0]?.state ?? null,
      facts.rows
    );
  }

  async save(state: ProductState, context?: ProductContext) {
    await this.insertLegacyBaseline(state.workspaceId);
    const revision = await this.nextRevisionNumber(state.workspaceId);
    const writeContext: ProductContext = context ?? {
      actor: 'user',
      correlationId: `product-projection:${revision}`,
      userId: 'product-application',
      workspaceId: state.workspaceId,
    };
    const projection = createProductRelationRevisionFacts(
      state,
      revision,
      writeContext
    );
    const current = await this.currentEntityHashes(state.workspaceId);
    for (const fact of projection.entityFacts) {
      const logicalFactId = String(fact.data.logicalFactId);
      const hash = String(fact.data.valueHash);
      if (current.get(logicalFactId) === hash) continue;
      await this.insertFact(fact);
    }
    await this.insertFact(projection.metaFact);
    if (context && (await this.getFutureWriteOwner(state.workspaceId)) === 'legacy') {
      const recovery = await this.database.query(
        `SELECT 1 FROM p1_product_command_results
          WHERE workspace_id = $1
            AND result->>'kind' = 'pending'
            AND result->>'correlationId' = $2
          LIMIT 1`,
        [state.workspaceId, context.correlationId]
      );
      if (recovery.rowCount === 1) {
        await this.database.query(
          `UPDATE product_states
              SET state = $2::jsonb, updated_at = now()
            WHERE workspace_id = $1`,
          [state.workspaceId, JSON.stringify(state)]
        );
      }
    }
  }

  async loadIdempotent(
    workspaceId: string,
    key: string,
    payloadHash: string
  ) {
    const result = await this.database.query<{
      payload_hash: string;
      result: IdempotentProductOutcome;
    }>(
      `SELECT payload_hash, result FROM p1_product_command_results
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, key]
    );
    const row = result.rows[0];
    if (!row) return null;
    let outcome = row.result;
    const storedOutput =
      outcome.kind === 'success'
        ? (outcome as unknown as { result: { output?: CommandResult['output'] } })
            .result.output
        : undefined;
    if (outcome.kind === 'success' && !('state' in outcome.result)) {
      const state = await this.load(workspaceId);
      if (!state) return null;
      outcome = {
        kind: 'success',
        result: { output: storedOutput ?? {}, state },
      };
    }
    return { matches: row.payload_hash === payloadHash, outcome };
  }

  async saveIdempotent(
    workspaceId: string,
    key: string,
    payloadHash: string,
    result: IdempotentProductOutcome
  ) {
    const persisted =
      result.kind === 'success'
        ? { kind: 'success' as const, result: { output: result.result.output } }
        : result;
    await this.database.query(
      `INSERT INTO p1_product_command_results
         (workspace_id, idempotency_key, payload_hash, result)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (workspace_id, idempotency_key) DO UPDATE
       SET result = EXCLUDED.result
       WHERE p1_product_command_results.result->>'kind' = 'pending'
         AND p1_product_command_results.payload_hash = EXCLUDED.payload_hash`,
      [workspaceId, key, payloadHash, JSON.stringify(persisted)]
    );
  }

  private async insertLegacyBaseline(workspaceId: string) {
    const legacySource = `product_states:${workspaceId}`;
    const existing = await this.database.query(
      `SELECT 1 FROM p1_relation_facts
        WHERE workspace_id = $1 AND legacy_source = $2 LIMIT 1`,
      [workspaceId, legacySource]
    );
    if (existing.rowCount === 1) return;
    const result = await this.database.query<{ state: ProductState }>(
      'SELECT state FROM product_states WHERE workspace_id = $1',
      [workspaceId]
    );
    const state = result.rows[0]?.state;
    if (!state) return;
    const mapped = mapLegacyProductState(state);
    for (const fact of mapped.facts) {
      await this.database.query(
        `INSERT INTO p1_relation_facts
           (workspace_id, id, kind, parent_id, legacy_sequence, data,
            legacy_source, mapping_confidence, actor_id, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::timestamptz)
         ON CONFLICT (workspace_id, id) DO NOTHING`,
        [
          workspaceId,
          fact.id,
          fact.kind,
          fact.parentId ?? null,
          fact.sequence ?? null,
          JSON.stringify(fact.data),
          fact.legacySource,
          fact.mappingConfidence,
          'legacy-cutover',
          `legacy-baseline:${mapped.manifest.sourceRevision}`,
          fact.createdAt,
        ]
      );
    }
  }

  private async nextRevisionNumber(workspaceId: string) {
    const result = await this.database.query<{ revision: string }>(
      `SELECT COALESCE(
          MAX((data->>'revisionNumber')::bigint), 0
        ) + 1 AS revision
       FROM p1_relation_facts
       WHERE workspace_id = $1
         AND data->>'recordType' = 'product_projection_meta_revision'`,
      [workspaceId]
    );
    return Number(result.rows[0]?.revision ?? 1);
  }

  private async currentEntityHashes(workspaceId: string) {
    const result = await this.database.query<{
      logical_fact_id: string;
      value_hash: string;
    }>(
      `SELECT DISTINCT ON (data->>'logicalFactId')
          data->>'logicalFactId' AS logical_fact_id,
          data->>'valueHash' AS value_hash
       FROM p1_relation_facts
       WHERE workspace_id = $1
         AND data->>'recordType' = 'product_entity_revision'
       ORDER BY data->>'logicalFactId',
                (data->>'revisionNumber')::bigint DESC`,
      [workspaceId]
    );
    return new Map(
      result.rows.map((row) => [row.logical_fact_id, row.value_hash])
    );
  }

  private async insertFact(fact: RelationFact) {
    await this.database.query(
      `INSERT INTO p1_relation_facts
         (workspace_id, id, kind, parent_id, legacy_sequence, data,
          legacy_source, mapping_confidence, actor_id, correlation_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::timestamptz)`,
      [
        fact.workspaceId,
        fact.id,
        fact.kind,
        fact.parentId ?? null,
        typeof fact.data.sequence === 'number' ? fact.data.sequence : null,
        JSON.stringify(fact.data),
        fact.legacySource ?? null,
        fact.mappingConfidence ?? null,
        fact.actorId,
        fact.correlationId,
        fact.createdAt,
      ]
    );
  }
}
