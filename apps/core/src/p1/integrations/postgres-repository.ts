import type { Pool, PoolClient } from 'pg';
import type {
  ConnectionCreateOperation,
  ExternalActionIntent,
  FeishuToolActivity,
  FeishuToolLifecycleTarget,
  FeishuToolRevision,
  FeishuToolShortcut,
  IntegrationAuditEvent,
  IntegrationConnection,
} from './contracts.js';
import type { IntegrationRepository } from './repository.js';

function connectionCreatePhaseRank(
  phase: ConnectionCreateOperation['phase']
) {
  return { claimed: 0, secret_stored: 1, completed: 2 }[phase];
}

export class PostgresIntegrationRepository implements IntegrationRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS integration_connections (
        workspace_id text NOT NULL,
        id text NOT NULL,
        provider text NOT NULL,
        status text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS integration_connections_workspace_status_idx
        ON integration_connections (workspace_id, status);

      CREATE TABLE IF NOT EXISTS integration_credential_bindings (
        workspace_id text NOT NULL,
        connection_id text NOT NULL,
        credential_id text NOT NULL,
        provider text NOT NULL,
        active_version integer NOT NULL,
        secret_ref text NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, connection_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS integration_credential_binding_owner_idx
        ON integration_credential_bindings (workspace_id, credential_id);

      CREATE TABLE IF NOT EXISTS integration_credential_versions (
        workspace_id text NOT NULL,
        credential_id text NOT NULL,
        version integer NOT NULL,
        provider text NOT NULL,
        secret_ref text NOT NULL,
        metadata jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, credential_id, version)
      );

      CREATE TABLE IF NOT EXISTS integration_audit_events (
        workspace_id text NOT NULL,
        id text NOT NULL,
        connection_id text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );

      CREATE TABLE IF NOT EXISTS integration_idempotency (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS integration_connection_create_operations (
        workspace_id text NOT NULL,
        id text NOT NULL,
        connection_id text NOT NULL,
        phase text NOT NULL,
        phase_rank integer NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      DROP INDEX IF EXISTS integration_connection_create_active_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS integration_connection_create_owner_idx
        ON integration_connection_create_operations (workspace_id, connection_id);

      CREATE TABLE IF NOT EXISTS integration_tool_revisions (
        tool_id text NOT NULL,
        revision text NOT NULL,
        schema_hash text NOT NULL,
        status text NOT NULL,
        published_at timestamptz,
        data jsonb NOT NULL,
        PRIMARY KEY (tool_id, revision)
      );
      CREATE INDEX IF NOT EXISTS integration_tool_published_idx
        ON integration_tool_revisions (tool_id, published_at DESC)
        WHERE status = 'published';

      CREATE TABLE IF NOT EXISTS integration_external_intents (
        workspace_id text NOT NULL,
        id text NOT NULL,
        connection_id text NOT NULL,
        tool_id text NOT NULL,
        status text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );

      CREATE TABLE IF NOT EXISTS integration_tool_activities (
        workspace_id text NOT NULL,
        id text NOT NULL,
        connection_id text NOT NULL,
        tool_id text NOT NULL,
        status text NOT NULL,
        data jsonb NOT NULL,
        executed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );

      CREATE TABLE IF NOT EXISTS integration_tool_shortcuts (
        workspace_id text NOT NULL,
        connection_id text NOT NULL,
        tool_id text NOT NULL,
        display_order integer NOT NULL,
        hidden boolean NOT NULL,
        PRIMARY KEY (workspace_id, connection_id, tool_id)
      );

      CREATE TABLE IF NOT EXISTS integration_external_events (
        workspace_id text NOT NULL,
        provider text NOT NULL,
        event_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, provider, event_id)
      );
    `);
  }

  async saveConnection(connection: IntegrationConnection) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.persistConnection(client, connection);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createConnectionIfAbsent(connection: IntegrationConnection) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const created = await this.persistConnection(client, connection, false);
      if (!created) {
        await client.query('ROLLBACK');
        const current = await this.getConnection(
          connection.workspaceId,
          connection.id
        );
        if (!current) {
          throw new Error('Connection create conflict could not be resolved.');
        }
        return { created: false, connection: current };
      }
      await client.query('COMMIT');
      return { created: true, connection };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async compareAndSwapConnection(
    connection: IntegrationConnection,
    expected: { credentialVersion: number; updatedAt: string }
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{
        active_version: number;
        updated_at: Date | string;
      }>(
        `SELECT c.updated_at, b.active_version
           FROM integration_connections c
           JOIN integration_credential_bindings b
             ON b.workspace_id = c.workspace_id AND b.connection_id = c.id
          WHERE c.workspace_id = $1 AND c.id = $2
          FOR UPDATE OF c, b`,
        [connection.workspaceId, connection.id]
      );
      const current = locked.rows[0];
      const currentUpdatedAt =
        current?.updated_at instanceof Date
          ? current.updated_at.toISOString()
          : current?.updated_at;
      if (
        !current ||
        current.active_version !== expected.credentialVersion ||
        currentUpdatedAt !== new Date(expected.updatedAt).toISOString()
      ) {
        await client.query('ROLLBACK');
        return false;
      }
      await this.persistConnection(client, connection);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistConnection(
    client: PoolClient,
    connection: IntegrationConnection,
    overwrite = true
  ) {
    const { credential, secretRef, ...connectionData } = connection;
    const persisted = await client.query(
      `INSERT INTO integration_connections
         (workspace_id, id, provider, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, id) ${
         overwrite
           ? `DO UPDATE SET
         provider = EXCLUDED.provider,
         status = EXCLUDED.status,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at`
           : 'DO NOTHING'
       }
       RETURNING id`,
      [
        connection.workspaceId,
        connection.id,
        connection.provider,
        connection.status,
        connectionData,
        connection.createdAt,
        connection.updatedAt,
      ]
    );
    if ((persisted.rowCount ?? 0) === 0) return false;
    await client.query(
      `INSERT INTO integration_credential_bindings
         (workspace_id, connection_id, credential_id, provider, active_version, secret_ref, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, connection_id) DO UPDATE SET
         credential_id = EXCLUDED.credential_id,
         provider = EXCLUDED.provider,
         active_version = EXCLUDED.active_version,
         secret_ref = EXCLUDED.secret_ref,
         updated_at = EXCLUDED.updated_at`,
      [
        connection.workspaceId,
        connection.id,
        credential.id,
        connection.provider,
        credential.version,
        secretRef,
        connection.updatedAt,
      ]
    );
    await client.query(
      `INSERT INTO integration_credential_versions
         (workspace_id, credential_id, version, provider, secret_ref, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, credential_id, version) DO UPDATE SET
         secret_ref = EXCLUDED.secret_ref,
         metadata = EXCLUDED.metadata`,
      [
        connection.workspaceId,
        credential.id,
        credential.version,
        connection.provider,
        secretRef,
        credential,
      ]
    );
    return true;
  }

  async getConnection(workspaceId: string, id: string) {
    const result = await this.pool.query(
      `SELECT c.data AS connection_data, b.secret_ref, v.metadata AS credential
         FROM integration_connections c
         JOIN integration_credential_bindings b
           ON b.workspace_id = c.workspace_id AND b.connection_id = c.id
         JOIN integration_credential_versions v
           ON v.workspace_id = b.workspace_id
          AND v.credential_id = b.credential_id
          AND v.version = b.active_version
        WHERE c.workspace_id = $1 AND c.id = $2`,
      [workspaceId, id]
    );
    const row = result.rows[0] as
      | {
          connection_data: Omit<
            IntegrationConnection,
            'credential' | 'secretRef'
          >;
          secret_ref: string;
          credential: IntegrationConnection['credential'];
        }
      | undefined;
    return row
      ? ({
          ...row.connection_data,
          secretRef: row.secret_ref,
          credential: row.credential,
        } as IntegrationConnection)
      : undefined;
  }

  async listConnections(workspaceId: string) {
    const result = await this.pool.query(
      `SELECT c.data AS connection_data, b.secret_ref, v.metadata AS credential
         FROM integration_connections c
         JOIN integration_credential_bindings b
           ON b.workspace_id = c.workspace_id AND b.connection_id = c.id
         JOIN integration_credential_versions v
           ON v.workspace_id = b.workspace_id
          AND v.credential_id = b.credential_id
          AND v.version = b.active_version
        WHERE c.workspace_id = $1
        ORDER BY c.created_at, c.id`,
      [workspaceId]
    );
    return result.rows.map((row) => ({
      ...row.connection_data,
      secretRef: row.secret_ref,
      credential: row.credential,
    })) as IntegrationConnection[];
  }

  async listFeishuLifecycleTargets() {
    const result = await this.pool.query(
      `SELECT c.workspace_id, c.id AS connection_id
         FROM integration_connections c
         JOIN integration_credential_bindings b
           ON b.workspace_id = c.workspace_id AND b.connection_id = c.id
         JOIN integration_credential_versions v
           ON v.workspace_id = b.workspace_id
          AND v.credential_id = b.credential_id
          AND v.version = b.active_version
        WHERE c.provider = 'feishu'
          AND c.status IN ('available', 'degraded', 'rate_limited')
          AND v.metadata ->> 'status' = 'active'
          AND c.data -> 'requestedCapabilities' ? 'mcp.tools'
        ORDER BY c.workspace_id, c.id`
    );
    return result.rows.map((row) => ({
      connectionId: row.connection_id,
      workspaceId: row.workspace_id,
    })) as FeishuToolLifecycleTarget[];
  }

  async appendAudit(event: IntegrationAuditEvent) {
    await this.pool.query(
      `INSERT INTO integration_audit_events
         (workspace_id, id, connection_id, data, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [event.workspaceId, event.id, event.connectionId, event, event.createdAt]
    );
  }

  async listAudits(workspaceId: string) {
    const result = await this.pool.query(
      `SELECT data FROM integration_audit_events
        WHERE workspace_id = $1 ORDER BY created_at, id`,
      [workspaceId]
    );
    return result.rows.map((row) => row.data as IntegrationAuditEvent);
  }

  async getIdempotent<T>(workspaceId: string, key: string, payload: string) {
    const result = await this.pool.query(
      `SELECT payload_hash, result FROM integration_idempotency
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, key]
    );
    const row = result.rows[0] as
      | { payload_hash: string; result: T }
      | undefined;
    return row
      ? { matches: row.payload_hash === payload, value: row.result }
      : undefined;
  }

  async saveIdempotent<T>(
    workspaceId: string,
    key: string,
    payload: string,
    value: T
  ) {
    await this.pool.query(
      `INSERT INTO integration_idempotency
         (workspace_id, idempotency_key, payload_hash, result)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
      [workspaceId, key, payload, value]
    );
  }

  async claimConnectionCreate(operation: ConnectionCreateOperation) {
    const result = await this.pool.query<{ data: ConnectionCreateOperation }>(
      `INSERT INTO integration_connection_create_operations
         (workspace_id, id, connection_id, phase, phase_rank, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING
       RETURNING data`,
      [
        operation.workspaceId,
        operation.id,
        operation.connectionId,
        operation.phase,
        connectionCreatePhaseRank(operation.phase),
        operation,
        operation.createdAt,
        operation.updatedAt,
      ]
    );
    if (result.rows[0]) {
      return { claimed: true, operation: result.rows[0].data };
    }
    const existing = await this.getConnectionCreate(
      operation.workspaceId,
      operation.id
    );
    if (existing) return { claimed: false, operation: existing };
    const owner = await this.pool.query<{ data: ConnectionCreateOperation }>(
      `SELECT data FROM integration_connection_create_operations
        WHERE workspace_id = $1 AND connection_id = $2
        ORDER BY created_at, id LIMIT 1`,
      [operation.workspaceId, operation.connectionId]
    );
    if (owner.rows[0]) {
      return { claimed: false, operation: owner.rows[0].data };
    }
    throw new Error('Connection create operation conflict could not be resolved.');
  }

  async advanceConnectionCreate(operation: ConnectionCreateOperation) {
    const result = await this.pool.query<{ data: ConnectionCreateOperation }>(
      `UPDATE integration_connection_create_operations
          SET phase = $3, phase_rank = $4, data = $5, updated_at = $6
        WHERE workspace_id = $1 AND id = $2 AND phase_rank <= $4
        RETURNING data`,
      [
        operation.workspaceId,
        operation.id,
        operation.phase,
        connectionCreatePhaseRank(operation.phase),
        operation,
        operation.updatedAt,
      ]
    );
    if (result.rows[0]) return result.rows[0].data;
    const existing = await this.getConnectionCreate(
      operation.workspaceId,
      operation.id
    );
    if (!existing) {
      throw new Error('Connection create operation was not claimed.');
    }
    return existing;
  }

  async getConnectionCreate(workspaceId: string, id: string) {
    const result = await this.pool.query<{ data: ConnectionCreateOperation }>(
      `SELECT data FROM integration_connection_create_operations
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id]
    );
    return result.rows[0]?.data;
  }

  async saveToolRevision(revision: FeishuToolRevision) {
    await this.pool.query(
      `INSERT INTO integration_tool_revisions
         (tool_id, revision, schema_hash, status, published_at, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tool_id, revision) DO UPDATE SET
         schema_hash = EXCLUDED.schema_hash,
         status = EXCLUDED.status,
         published_at = EXCLUDED.published_at,
         data = EXCLUDED.data`,
      [
        revision.id,
        revision.revision,
        revision.schemaHash,
        revision.status,
        revision.publishedAt ?? null,
        revision,
      ]
    );
  }

  async getToolRevision(toolId: string, revision: string) {
    const result = await this.pool.query(
      `SELECT data FROM integration_tool_revisions WHERE tool_id = $1 AND revision = $2`,
      [toolId, revision]
    );
    return result.rows[0]?.data as FeishuToolRevision | undefined;
  }

  async listToolRevisions(toolId?: string) {
    const result = toolId
      ? await this.pool.query(
          `SELECT data FROM integration_tool_revisions WHERE tool_id = $1`,
          [toolId]
        )
      : await this.pool.query(`SELECT data FROM integration_tool_revisions`);
    return result.rows.map((row) => row.data as FeishuToolRevision);
  }

  async getPublishedTool(toolId: string) {
    const result = await this.pool.query(
      `SELECT data FROM integration_tool_revisions
        WHERE tool_id = $1 AND status = 'published'
        ORDER BY published_at DESC LIMIT 1`,
      [toolId]
    );
    return result.rows[0]?.data as FeishuToolRevision | undefined;
  }

  async saveIntent(intent: ExternalActionIntent) {
    await this.pool.query(
      `INSERT INTO integration_external_intents
         (workspace_id, id, connection_id, tool_id, status, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, id) DO UPDATE SET
         status = EXCLUDED.status,
         data = EXCLUDED.data`,
      [
        intent.workspaceId,
        intent.id,
        intent.connectionId,
        intent.toolId,
        intent.status,
        intent,
        intent.createdAt,
      ]
    );
  }

  async claimIntent(intent: ExternalActionIntent) {
    const inserted = await this.pool.query<{ data: ExternalActionIntent }>(
      `INSERT INTO integration_external_intents
         (workspace_id, id, connection_id, tool_id, status, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, id) DO NOTHING
       RETURNING data`,
      [
        intent.workspaceId,
        intent.id,
        intent.connectionId,
        intent.toolId,
        intent.status,
        intent,
        intent.createdAt,
      ]
    );
    if (inserted.rows[0]) {
      return { claimed: true, intent: inserted.rows[0].data };
    }
    const existing = await this.getIntent(intent.workspaceId, intent.id);
    if (!existing) throw new Error('Feishu intent claim disappeared.');
    return { claimed: false, intent: existing };
  }

  async claimIntentExecution(
    intent: ExternalActionIntent,
    expectedStatus: ExternalActionIntent['status']
  ) {
    const claimed = await this.pool.query<{ data: ExternalActionIntent }>(
      `UPDATE integration_external_intents
          SET status = $3, data = $4
        WHERE workspace_id = $1 AND id = $2 AND status = $5
        RETURNING data`,
      [intent.workspaceId, intent.id, intent.status, intent, expectedStatus]
    );
    if (claimed.rows[0]) {
      return { claimed: true, intent: claimed.rows[0].data };
    }
    const existing = await this.getIntent(intent.workspaceId, intent.id);
    return { claimed: false, intent: existing ?? intent };
  }

  async getIntent(workspaceId: string, id: string) {
    const result = await this.pool.query(
      `SELECT data FROM integration_external_intents WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id]
    );
    return result.rows[0]?.data as ExternalActionIntent | undefined;
  }

  async listIntents(workspaceId: string, connectionId?: string) {
    const result = await this.pool.query(
      `SELECT data FROM integration_external_intents
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR connection_id = $2)
        ORDER BY created_at DESC`,
      [workspaceId, connectionId ?? null]
    );
    return result.rows.map((row) => row.data as ExternalActionIntent);
  }

  async listFeishuReconciliationTargets(at: string, limit = 100) {
    const result = await this.pool.query(
      `SELECT workspace_id, id AS intent_id
         FROM integration_external_intents
        WHERE status = 'unknown'
          AND data ->> 'effectState' = 'reconciliation_required'
          AND data ->> 'sideEffect' <> 'read'
          AND (
            data ->> 'nextReconcileAt' IS NULL
            OR (data ->> 'nextReconcileAt')::timestamptz <= $1::timestamptz
          )
        ORDER BY COALESCE(
          (data ->> 'nextReconcileAt')::timestamptz,
          created_at
        ), workspace_id, id
        LIMIT $2`,
      [at, limit]
    );
    return result.rows.map((row) => ({
      intentId: row.intent_id as string,
      workspaceId: row.workspace_id as string,
    }));
  }

  async appendActivity(activity: FeishuToolActivity) {
    await this.pool.query(
      `INSERT INTO integration_tool_activities
         (workspace_id, id, connection_id, tool_id, status, data, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        activity.workspaceId,
        activity.id,
        activity.connectionId,
        activity.toolId,
        activity.status,
        activity,
        activity.executedAt,
      ]
    );
  }

  async listActivities(workspaceId: string, connectionId: string) {
    const result = await this.pool.query(
      `SELECT data FROM integration_tool_activities
        WHERE workspace_id = $1 AND connection_id = $2 ORDER BY executed_at, id`,
      [workspaceId, connectionId]
    );
    return result.rows.map((row) => row.data as FeishuToolActivity);
  }

  async saveShortcuts(
    workspaceId: string,
    connectionId: string,
    shortcuts: FeishuToolShortcut[]
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM integration_tool_shortcuts
          WHERE workspace_id = $1 AND connection_id = $2`,
        [workspaceId, connectionId]
      );
      for (const shortcut of shortcuts) {
        await client.query(
          `INSERT INTO integration_tool_shortcuts
             (workspace_id, connection_id, tool_id, display_order, hidden)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            workspaceId,
            connectionId,
            shortcut.toolId,
            shortcut.order,
            shortcut.hidden,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listShortcuts(workspaceId: string, connectionId: string) {
    const result = await this.pool.query(
      `SELECT tool_id, display_order, hidden FROM integration_tool_shortcuts
        WHERE workspace_id = $1 AND connection_id = $2 ORDER BY display_order, tool_id`,
      [workspaceId, connectionId]
    );
    return result.rows.map((row) => ({
      toolId: row.tool_id as string,
      order: row.display_order as number,
      hidden: row.hidden as boolean,
    }));
  }

  async claimExternalEvent(
    workspaceId: string,
    provider: string,
    eventId: string
  ) {
    const result = await this.pool.query(
      `INSERT INTO integration_external_events (workspace_id, provider, event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING event_id`,
      [workspaceId, provider, eventId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteWorkspaceFacts(workspaceId: string) {
    const tables = [
      'integration_external_events',
      'integration_connection_create_operations',
      'integration_tool_shortcuts',
      'integration_tool_activities',
      'integration_external_intents',
      'integration_idempotency',
      'integration_audit_events',
      'integration_credential_versions',
      'integration_credential_bindings',
      'integration_connections',
    ];
    // The archived 代发 face (D-155) no longer creates these, but databases
    // provisioned before the archival still carry their rows, and a workspace
    // purge must not leave them behind.
    const retiredTables = [
      'douyin_oauth_refresh_operations',
      'douyin_observe_states',
      'douyin_observe_snapshots',
      'douyin_publish_jobs',
      'douyin_publish_confirmations',
    ];
    for (const table of tables) {
      await this.pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [
        workspaceId,
      ]);
    }
    for (const table of retiredTables) {
      const present = await this.pool.query<{ exists: string | null }>(
        'SELECT to_regclass($1) AS exists',
        [table]
      );
      if (!present.rows[0]?.exists) continue;
      await this.pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [
        workspaceId,
      ]);
    }
  }
}
