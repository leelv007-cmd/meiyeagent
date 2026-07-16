export interface WorkspaceStateClient {
  query<T>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

export interface WorkspaceStatePool {
  connect(): Promise<WorkspaceStateClient>;
}

export interface WorkspaceStateMigrationPool {
  query(sql: string): Promise<unknown>;
}

interface WorkspaceStateRepositoryOptions<T> {
  createInitialState(): T;
  namespace: string;
}

interface StateRow<T> {
  state: T;
}

export class PostgresWorkspaceStateRepository<T> {
  constructor(
    private readonly pool: WorkspaceStatePool,
    private readonly options: WorkspaceStateRepositoryOptions<T>
  ) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(options.namespace)) {
      throw new Error('Workspace state namespace is invalid.');
    }
  }

  async read(workspaceId: string): Promise<T> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<StateRow<T>>(
        `SELECT state
				 FROM pro_studio_workspace_state
				 WHERE namespace = $1 AND workspace_id = $2`,
        [this.options.namespace, workspaceId]
      );
      return structuredClone(
        result.rows[0]?.state ?? this.options.createInitialState()
      );
    } finally {
      client.release();
    }
  }

  async transact<Result>(
    workspaceId: string,
    action: (state: T) => Result
  ): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO pro_studio_workspace_state
				   (namespace, workspace_id, state, updated_at)
				 VALUES ($1, $2, $3, now())
				 ON CONFLICT (namespace, workspace_id) DO NOTHING`,
        [this.options.namespace, workspaceId, this.options.createInitialState()]
      );
      const locked = await client.query<StateRow<T>>(
        `SELECT state
				 FROM pro_studio_workspace_state
				 WHERE namespace = $1 AND workspace_id = $2
				 FOR UPDATE`,
        [this.options.namespace, workspaceId]
      );
      const row = locked.rows[0];
      if (!row) throw new Error('Workspace state row was not created.');
      const draft = structuredClone(row.state);
      const result = action(draft);
      await client.query(
        `UPDATE pro_studio_workspace_state
				 SET state = $3, updated_at = now()
				 WHERE namespace = $1 AND workspace_id = $2`,
        [this.options.namespace, workspaceId, draft]
      );
      await client.query('COMMIT');
      return structuredClone(result);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function migrateProStudioWorkspaceState(
  pool: WorkspaceStateMigrationPool
) {
  await pool.query(`
		CREATE TABLE IF NOT EXISTS pro_studio_workspace_state (
			namespace text NOT NULL,
			workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			state jsonb NOT NULL,
			updated_at timestamptz NOT NULL,
			PRIMARY KEY (namespace, workspace_id),
			CHECK (namespace ~ '^[a-z][a-z0-9_]{0,63}$')
		);
		CREATE TABLE IF NOT EXISTS pro_studio_checkout_bindings (
			id text PRIMARY KEY,
			provider text NOT NULL,
			offer_id text NOT NULL,
			price_id text NOT NULL,
			payment_type text NOT NULL,
			interval text,
			workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
			owner_session_id text REFERENCES "session"(id) ON DELETE SET NULL,
			provider_checkout_id text,
			status text NOT NULL DEFAULT 'pending',
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now(),
			activated_at timestamptz,
			CHECK (status IN ('pending', 'checkout_created', 'failed'))
		);
		CREATE UNIQUE INDEX IF NOT EXISTS pro_studio_checkout_bindings_provider_checkout_uidx
		ON pro_studio_checkout_bindings (provider, provider_checkout_id);
		CREATE INDEX IF NOT EXISTS pro_studio_checkout_bindings_workspace_id_idx
		ON pro_studio_checkout_bindings (workspace_id);
		CREATE INDEX IF NOT EXISTS pro_studio_checkout_bindings_owner_user_id_idx
		ON pro_studio_checkout_bindings (owner_user_id);
		CREATE TABLE IF NOT EXISTS pro_studio_payment_claims (
			payment_id text PRIMARY KEY REFERENCES payment(id) ON DELETE CASCADE,
			payment_event_id text NOT NULL UNIQUE,
			provider text NOT NULL,
			provider_event_id text NOT NULL,
			provider_checkout_id text NOT NULL,
			offer_id text NOT NULL,
			workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
			owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
			price_id text NOT NULL,
			status text NOT NULL DEFAULT 'pending',
			activation_attempts integer NOT NULL DEFAULT 0,
			activation_available_at timestamptz NOT NULL DEFAULT now(),
			activation_lease_until timestamptz,
			last_activation_error text,
			activated_at timestamptz,
			claimed_at timestamptz NOT NULL DEFAULT now(),
			CHECK (length(trim(payment_event_id)) > 0),
			CHECK (length(trim(price_id)) > 0),
			CHECK (status IN ('pending', 'activating', 'active'))
		);
		ALTER TABLE pro_studio_checkout_bindings
			ADD COLUMN IF NOT EXISTS payment_type text,
			ADD COLUMN IF NOT EXISTS interval text;
		DELETE FROM pro_studio_checkout_bindings WHERE payment_type IS NULL;
		ALTER TABLE pro_studio_checkout_bindings
			ALTER COLUMN payment_type SET NOT NULL,
			ALTER COLUMN owner_session_id DROP NOT NULL,
			DROP COLUMN IF EXISTS plan_id;
		ALTER TABLE pro_studio_checkout_bindings
			DROP CONSTRAINT IF EXISTS pro_studio_checkout_bindings_owner_session_id_session_id_fk,
			DROP CONSTRAINT IF EXISTS pro_studio_checkout_bindings_owner_session_id_fkey;
		ALTER TABLE pro_studio_checkout_bindings
			ADD CONSTRAINT pro_studio_checkout_bindings_owner_session_id_session_id_fk
			FOREIGN KEY (owner_session_id) REFERENCES "session"(id) ON DELETE SET NULL;
		ALTER TABLE pro_studio_payment_claims
			ADD COLUMN IF NOT EXISTS provider text,
			ADD COLUMN IF NOT EXISTS provider_event_id text,
			ADD COLUMN IF NOT EXISTS provider_checkout_id text,
			ADD COLUMN IF NOT EXISTS offer_id text,
			ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
			ADD COLUMN IF NOT EXISTS activation_attempts integer DEFAULT 0,
			ADD COLUMN IF NOT EXISTS activation_available_at timestamptz DEFAULT now(),
			ADD COLUMN IF NOT EXISTS activation_lease_until timestamptz,
			ADD COLUMN IF NOT EXISTS last_activation_error text,
			ADD COLUMN IF NOT EXISTS activated_at timestamptz;
		DELETE FROM pro_studio_payment_claims
		WHERE provider IS NULL OR provider_event_id IS NULL
			OR provider_checkout_id IS NULL OR offer_id IS NULL;
		ALTER TABLE pro_studio_payment_claims
			ALTER COLUMN provider SET NOT NULL,
			ALTER COLUMN provider_event_id SET NOT NULL,
			ALTER COLUMN provider_checkout_id SET NOT NULL,
			ALTER COLUMN offer_id SET NOT NULL,
			ALTER COLUMN status SET NOT NULL,
			ALTER COLUMN activation_attempts SET NOT NULL,
			ALTER COLUMN activation_available_at SET NOT NULL;
		CREATE INDEX IF NOT EXISTS pro_studio_payment_claims_workspace_id_idx
		ON pro_studio_payment_claims (workspace_id);
		CREATE UNIQUE INDEX IF NOT EXISTS pro_studio_payment_claims_provider_event_uidx
		ON pro_studio_payment_claims (provider, provider_event_id);
		CREATE INDEX IF NOT EXISTS pro_studio_payment_claims_activation_due_idx
		ON pro_studio_payment_claims (status, activation_available_at);
		UPDATE pro_studio_workspace_state
		SET state = state - 'relations', updated_at = now()
		WHERE namespace = 'adoption_v1' AND state ? 'relations'
	`);
}
