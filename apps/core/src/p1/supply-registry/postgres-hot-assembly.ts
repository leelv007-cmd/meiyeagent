import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  CapabilityHotAssemblyRegistry,
  decideChannelAdmission,
  diffCapabilityRevisions,
  initialChannelLifecycle,
  HotAssemblyError,
  MemoryEffectiveCapabilityRevisionStore,
  projectCapabilityRevision,
  shouldInvalidateAssemblyCache,
  transitionChannelLifecycle,
  type ApplyCapabilityResult,
  type AdapterBindingDirectory,
  type AdapterBindingRecord,
  type AssembleCapabilityRequest,
  type AssembledCapabilityBinding,
  type CapabilityHotAssemblyPort,
  type ChannelAdmissionDecision,
  type ChannelAdmissionIntent,
  type ChannelLifecycleMode,
  type ChannelLifecycleState,
  type ChannelSubmissionAdmission,
  channelLifecycleRevisionId,
  type EffectiveRevisionReport,
  type RuntimeCapabilityMatchInput,
  type RuntimeCapabilityRevision,
} from './hot-assembly.js';
import { PostgresSupplyControlPlaneRepository } from './postgres-control-plane.js';
import type { CredentialSecretBrokerPort } from './secret-broker.js';

export const PLATFORM_SUPPLY_SCOPE_ID = '__platform_supply__';

interface ChannelLifecycleRow {
  state: ChannelLifecycleState;
  revision: string | number;
  in_flight_count?: string | number;
}

/** Exact-revision adapter metadata backed by the immutable PostgreSQL capability log. */
export class PostgresAdapterBindingDirectory
  implements AdapterBindingDirectory
{
  constructor(
    private readonly repository: PostgresSupplyControlPlaneRepository,
    private readonly workspaceId = PLATFORM_SUPPLY_SCOPE_ID,
  ) {}

  async get(
    deploymentId: string,
    lookup?: {
      capabilityRevisionId: string;
      adapterBindingRevision?: string;
    },
  ): Promise<AdapterBindingRecord | null> {
    const revision = lookup?.capabilityRevisionId
      ? await this.repository.getCapabilityRevision(
          this.workspaceId,
          lookup.capabilityRevisionId,
        )
      : await this.repository.getEffectiveCapabilityRevision(this.workspaceId);
    const entry = revision?.entries.find(
      (candidate) => candidate.deploymentId === deploymentId,
    );
    if (
      !entry ||
      (lookup?.adapterBindingRevision &&
        entry.adapterBindingRevision !== lookup.adapterBindingRevision)
    ) {
      return null;
    }
    return {
      deploymentId,
      adapterKey: entry.adapterKey,
      ...(entry.adapterBindingRevision
        ? { adapterBindingRevision: entry.adapterBindingRevision }
        : {}),
      ...(entry.executionChannelId
        ? { executionChannelId: entry.executionChannelId }
        : {}),
      ...(entry.adapterConfig
        ? { adapterConfig: structuredClone(entry.adapterConfig) }
        : {}),
    };
  }
}

export class PostgresCapabilityHotAssemblyMigration
  implements PostgresSchemaMigrator
{
  async migrate(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_supply_channel_lifecycle (
        workspace_id text NOT NULL,
        channel_id text NOT NULL,
        state jsonb NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS p1_supply_channel_in_flight (
        workspace_id text NOT NULL,
        channel_id text NOT NULL,
        in_flight_id text NOT NULL,
        started_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, channel_id, in_flight_id)
      );

      CREATE INDEX IF NOT EXISTS p1_supply_channel_in_flight_channel_idx
        ON p1_supply_channel_in_flight (workspace_id, channel_id);
    `);
  }
}

/**
 * Request-boundary PostgreSQL hot assembly. Each read reloads the shared head,
 * so independently deployed HTTP and Worker processes observe the same
 * effective revision and channel admission state without restart.
 */
export class PostgresCapabilityHotAssemblyPort
  implements CapabilityHotAssemblyPort
{
  private catalogRevisionHead: string | null = null;
  private cacheGeneration = 0;
  private readonly adapters: AdapterBindingDirectory;

  constructor(
    private readonly pool: Pool,
    private readonly repository: PostgresSupplyControlPlaneRepository,
    private readonly workspaceId = PLATFORM_SUPPLY_SCOPE_ID,
    private readonly secrets?: CredentialSecretBrokerPort,
    adapters?: AdapterBindingDirectory,
  ) {
    this.adapters =
      adapters ?? new PostgresAdapterBindingDirectory(repository, workspaceId);
  }

  async seedIfEmpty(revision: RuntimeCapabilityRevision | null): Promise<void> {
    if (!revision) return;
    const current = await this.getEffectiveRevision();
    if (current) {
      if (
        current.reason === 'process_boot_from_runtime_capabilities' &&
        revision.reason === 'process_boot_from_runtime_capabilities' &&
        current.revisionId !== revision.revisionId
      ) {
        const refreshed = {
          ...revision,
          number: current.number + 1,
          previousRevisionId: current.revisionId,
        };
        try {
          await this.repository.setEffectiveCapabilityRevision(
            this.workspaceId,
            refreshed,
            current.revisionId,
          );
        } catch (error) {
          const winner = await this.getEffectiveRevision();
          if (winner?.revisionId !== refreshed.revisionId) throw error;
        }
        this.invalidateAssemblyCache();
        return;
      }
      await this.reconcileCredentialBindings(current, revision);
      return;
    }
    try {
      await this.repository.setEffectiveCapabilityRevision(
        this.workspaceId,
        projectCapabilityRevision(revision),
        null,
      );
    } catch (error) {
      if (!(await this.getEffectiveRevision())) throw error;
    }
  }

  private async reconcileCredentialBindings(
    current: RuntimeCapabilityRevision,
    boot: RuntimeCapabilityRevision,
  ): Promise<void> {
    const bootByDeploymentId = new Map(
      boot.entries.map((entry) => [entry.deploymentId, entry]),
    );
    let changed = false;
    const entries = current.entries.map((entry) => {
      const desired = bootByDeploymentId.get(entry.deploymentId);
      if (!desired?.credentialAccountId) return entry;
      if (
        entry.credentialAccountId === desired.credentialAccountId &&
        entry.credentialVersion === desired.credentialVersion
      ) {
        return entry;
      }
      changed = true;
      return {
        ...entry,
        credentialAccountId: desired.credentialAccountId,
        ...(desired.credentialVersion
          ? { credentialVersion: desired.credentialVersion }
          : {}),
      };
    });
    if (!changed) return;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          entries
            .map((entry) => ({
              deploymentId: entry.deploymentId,
              credentialAccountId: entry.credentialAccountId ?? null,
              credentialVersion: entry.credentialVersion ?? null,
            }))
            .sort((left, right) =>
              left.deploymentId.localeCompare(right.deploymentId),
            ),
        ),
      )
      .digest('hex')
      .slice(0, 16);
    const next: RuntimeCapabilityRevision = {
      ...current,
      revisionId: `${current.revisionId}:credential-bindings:${fingerprint}`,
      number: current.number + 1,
      entries,
      previousRevisionId: current.revisionId,
      publishedAt: new Date().toISOString(),
      reason: 'reconcile_postgres_credential_account_bindings',
    };
    try {
      await this.repository.setEffectiveCapabilityRevision(
        this.workspaceId,
        next,
        current.revisionId,
      );
    } catch (error) {
      const winner = await this.getEffectiveRevision();
      const desiredById = new Map(
        entries.map((entry) => [entry.deploymentId, entry]),
      );
      const reconciled = winner?.entries.every((entry) => {
        const desired = desiredById.get(entry.deploymentId);
        return (
          !desired?.credentialAccountId ||
          (entry.credentialAccountId === desired.credentialAccountId &&
            entry.credentialVersion === desired.credentialVersion)
        );
      });
      if (!reconciled) throw error;
    }
  }

  getEffectiveRevision(): Promise<RuntimeCapabilityRevision | null> {
    return this.repository.getEffectiveCapabilityRevision(this.workspaceId);
  }

  async getEffectiveRevisionId(): Promise<string | null> {
    return (await this.getEffectiveRevision())?.revisionId ?? null;
  }

  async applyCapabilityRevision(
    revision: RuntimeCapabilityRevision,
  ): Promise<ApplyCapabilityResult> {
    const validated = projectCapabilityRevision(revision);
    const previous = await this.getEffectiveRevision();
    await this.repository.setEffectiveCapabilityRevision(
      this.workspaceId,
      validated,
      previous?.revisionId ?? null,
    );
    const cacheInvalidated = shouldInvalidateAssemblyCache(previous, validated);
    if (cacheInvalidated) this.invalidateAssemblyCache();
    return {
      previousRevisionId: previous?.revisionId ?? null,
      appliedRevisionId: validated.revisionId,
      diff: diffCapabilityRevisions(previous, validated),
      cacheInvalidated,
    };
  }

  async supportsDeployment(
    deployment: RuntimeCapabilityMatchInput,
  ): Promise<boolean> {
    return (await this.runtimeRegistry()).supportsDeployment(deployment);
  }

  async assertCompatible(
    deployments: RuntimeCapabilityMatchInput[],
  ): Promise<void> {
    (await this.runtimeRegistry()).assertCompatible(deployments);
  }

  async assembleForRequest(
    request: AssembleCapabilityRequest,
  ): Promise<AssembledCapabilityBinding> {
    const registry = await this.runtimeRegistry();
    const revision = request.frozenCapabilityRevisionId
      ? await this.repository.getCapabilityRevision(
          this.workspaceId,
          request.frozenCapabilityRevisionId,
        )
      : await this.getEffectiveRevision();
    const entry = revision?.entries.find(
      (candidate) => candidate.deploymentId === request.deploymentId,
    );
    const channelId = entry?.executionChannelId ?? request.deploymentId;
    const lifecycle = await this.getChannelLifecycle(channelId);
    if (lifecycle.mode === 'isolated') {
      registry.isolateChannel(channelId, lifecycle.reason, {
        now: lifecycle.startedAt,
        inFlightCount: lifecycle.inFlightCount,
      });
    } else if (lifecycle.mode === 'draining') {
      registry.startChannelDrain(channelId, lifecycle.reason, {
        now: lifecycle.startedAt,
        inFlightCount: lifecycle.inFlightCount,
      });
    }
    return registry.assembleForRequest(request);
  }

  isolateChannel(
    channelId: string,
    reason: string,
    options: {
      now?: string;
      inFlightCount?: number;
      expectedLifecycleRevision?: string;
    } = {},
  ): Promise<ChannelLifecycleState> {
    return this.transition(channelId, { kind: 'isolate', reason }, options);
  }

  startChannelDrain(
    channelId: string,
    reason: string,
    options: {
      now?: string;
      inFlightCount?: number;
      expectedLifecycleRevision?: string;
    } = {},
  ): Promise<ChannelLifecycleState> {
    return this.transition(channelId, { kind: 'start_drain', reason }, options);
  }

  completeChannelDrain(
    channelId: string,
    reason: string,
    options: { now?: string; expectedLifecycleRevision?: string } = {},
  ): Promise<ChannelLifecycleState> {
    return this.transition(channelId, { kind: 'complete_drain', reason }, options);
  }

  restoreChannel(
    channelId: string,
    reason: string,
    options: { now?: string; expectedLifecycleRevision?: string } = {},
  ): Promise<ChannelLifecycleState> {
    return this.transition(channelId, { kind: 'restore', reason }, options);
  }

  async getChannelLifecycle(channelId: string): Promise<ChannelLifecycleState> {
    const result = await this.pool.query<ChannelLifecycleRow>(
      `SELECT lifecycle.state,
              lifecycle.revision,
              (SELECT count(*)::bigint
                 FROM p1_supply_channel_in_flight AS flight
                WHERE flight.workspace_id = $1
                  AND flight.channel_id = $2) AS in_flight_count
         FROM p1_supply_channel_lifecycle AS lifecycle
        WHERE lifecycle.workspace_id = $1 AND lifecycle.channel_id = $2`,
      [this.workspaceId, channelId],
    );
    const row = result.rows[0];
    if (!row) {
      return initialChannelLifecycle(channelId, new Date(0).toISOString());
    }
    return {
      ...row.state,
      lifecycleRevision: channelLifecycleRevisionId(
        channelId,
        Number(row.revision),
      ),
      inFlightCount: Number(row.in_flight_count ?? 0),
    };
  }

  async decideAdmission(
    channelId: string,
    intent: ChannelAdmissionIntent,
  ): Promise<ChannelAdmissionDecision> {
    return decideChannelAdmission(await this.getChannelLifecycle(channelId), intent);
  }

  async acquireChannelSubmission(
    channelId: string,
    inFlightId: string,
  ): Promise<ChannelSubmissionAdmission> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockChannel(client, channelId);
      const current = await this.readLockedLifecycle(client, channelId);
      const state = this.lifecycleState(channelId, current);
      const existing = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM p1_supply_channel_in_flight
            WHERE workspace_id = $1 AND channel_id = $2
              AND in_flight_id = $3
         ) AS exists`,
        [this.workspaceId, channelId, inFlightId],
      );
      if (existing.rows[0]?.exists) {
        const replay = decideChannelAdmission(state, 'in_flight');
        await client.query('COMMIT');
        return {
          ...replay,
          inFlightId,
          inFlightCount: state.inFlightCount,
          lifecycleRevision: state.lifecycleRevision,
          newlyAcquired: false,
        };
      }
      const decision = decideChannelAdmission(state, 'new_submit');
      if (!decision.admitted) {
        await client.query('COMMIT');
        return {
          ...decision,
          inFlightId,
          inFlightCount: state.inFlightCount,
          lifecycleRevision: state.lifecycleRevision,
          newlyAcquired: false,
        };
      }
      await client.query(
        `INSERT INTO p1_supply_channel_in_flight
           (workspace_id, channel_id, in_flight_id)
         VALUES ($1, $2, $3)`,
        [this.workspaceId, channelId, inFlightId],
      );
      const nextRevision = Number(current?.revision ?? 0) + 1;
      const next = transitionChannelLifecycle(
        state,
        { kind: 'set_in_flight', count: state.inFlightCount + 1 },
        {
          channelId,
          lifecycleRevision: channelLifecycleRevisionId(
            channelId,
            nextRevision,
          ),
        },
      );
      await this.writeLifecycle(client, channelId, next, nextRevision);
      await client.query('COMMIT');
      this.invalidateAssemblyCache();
      return {
        ...decision,
        inFlightId,
        inFlightCount: next.inFlightCount,
        lifecycleRevision: next.lifecycleRevision,
        newlyAcquired: true,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseChannelSubmission(
    channelId: string,
    inFlightId: string,
  ): Promise<ChannelLifecycleState> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockChannel(client, channelId);
      const current = await this.readLockedLifecycle(client, channelId);
      const state = this.lifecycleState(channelId, current);
      const removed = await client.query(
        `DELETE FROM p1_supply_channel_in_flight
          WHERE workspace_id = $1 AND channel_id = $2
            AND in_flight_id = $3`,
        [this.workspaceId, channelId, inFlightId],
      );
      if (removed.rowCount === 0) {
        await client.query('COMMIT');
        return state;
      }
      const nextRevision = Number(current?.revision ?? 0) + 1;
      const next = transitionChannelLifecycle(
        state,
        { kind: 'set_in_flight', count: Math.max(0, state.inFlightCount - 1) },
        {
          channelId,
          lifecycleRevision: channelLifecycleRevisionId(
            channelId,
            nextRevision,
          ),
        },
      );
      await this.writeLifecycle(client, channelId, next, nextRevision);
      await client.query('COMMIT');
      this.invalidateAssemblyCache();
      return next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  invalidateAssemblyCache(): void {
    this.cacheGeneration += 1;
  }

  getAssemblyCacheStats(): { size: number; generation: number } {
    return { size: 0, generation: this.cacheGeneration };
  }

  applyCatalogRevisionHead(catalogRevisionId: string): void {
    this.catalogRevisionHead = catalogRevisionId;
  }

  getCatalogRevisionHead(): string | null {
    return this.catalogRevisionHead;
  }

  async reportProcessView(
    processKind: 'http' | 'job-worker',
  ): Promise<EffectiveRevisionReport> {
    const [effective, channels] = await Promise.all([
      this.getEffectiveRevision(),
      this.pool.query<{ channel_id: string; state: ChannelLifecycleState }>(
        `SELECT channel_id, state
           FROM p1_supply_channel_lifecycle
          WHERE workspace_id = $1
          ORDER BY channel_id`,
        [this.workspaceId],
      ),
    ]);
    return {
      processKind,
      effectiveCapabilityRevisionId: effective?.revisionId ?? null,
      effectiveCatalogRevisionId: this.catalogRevisionHead,
      capabilityRevisionNumber: effective?.number ?? null,
      channelModes: Object.fromEntries(
        channels.rows.map(({ channel_id, state }) => [
          channel_id,
          state.mode as ChannelLifecycleMode,
        ]),
      ),
      cacheGeneration: this.cacheGeneration,
    };
  }

  private async runtimeRegistry(): Promise<CapabilityHotAssemblyRegistry> {
    const [history, head] = await Promise.all([
      this.repository.listCapabilityRevisions(this.workspaceId),
      this.getEffectiveRevision(),
    ]);
    const store = new MemoryEffectiveCapabilityRevisionStore();
    for (const revision of history) store.set(revision);
    if (head) store.set(head);
    const registry = new CapabilityHotAssemblyRegistry(
      store,
      this.secrets,
      this.adapters,
    );
    if (this.catalogRevisionHead) {
      registry.applyCatalogRevisionHead(this.catalogRevisionHead);
    }
    return registry;
  }

  private async transition(
    channelId: string,
    command:
      | { kind: 'isolate'; reason: string }
      | { kind: 'start_drain'; reason: string }
      | { kind: 'complete_drain'; reason: string }
      | { kind: 'restore'; reason: string },
    options: {
      now?: string;
      inFlightCount?: number;
      expectedLifecycleRevision?: string;
    },
  ): Promise<ChannelLifecycleState> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockChannel(client, channelId);
      const current = await this.readLockedLifecycle(client, channelId);
      const currentState = this.lifecycleState(channelId, current);
      if (
        options.expectedLifecycleRevision &&
        currentState.lifecycleRevision !== options.expectedLifecycleRevision
      ) {
        throw new HotAssemblyError(
          'LIFECYCLE_REVISION_CONFLICT',
          `Channel ${channelId} lifecycle changed from ${options.expectedLifecycleRevision} to ${currentState.lifecycleRevision}.`,
        );
      }
      const nextRevision = Number(current?.revision ?? 0) + 1;
      const next = transitionChannelLifecycle(
        currentState,
        command,
        {
          channelId,
          ...options,
          inFlightCount: Number(current?.in_flight_count ?? 0),
          lifecycleRevision: channelLifecycleRevisionId(
            channelId,
            nextRevision,
          ),
        },
      );
      await this.writeLifecycle(client, channelId, next, nextRevision);
      await client.query('COMMIT');
      this.invalidateAssemblyCache();
      return next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private lockChannel(client: PoolClient, channelId: string) {
    return client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [this.workspaceId, channelId],
    );
  }

  private async readLockedLifecycle(
    client: PoolClient,
    channelId: string,
  ): Promise<ChannelLifecycleRow | null> {
    const current = await client.query<ChannelLifecycleRow>(
      `SELECT lifecycle.state,
              lifecycle.revision,
              (SELECT count(*)::bigint
                 FROM p1_supply_channel_in_flight AS flight
                WHERE flight.workspace_id = $1
                  AND flight.channel_id = $2) AS in_flight_count
         FROM p1_supply_channel_lifecycle AS lifecycle
        WHERE lifecycle.workspace_id = $1 AND lifecycle.channel_id = $2
        FOR UPDATE`,
      [this.workspaceId, channelId],
    );
    if (current.rows[0]) return current.rows[0];
    const count = await client.query<{ in_flight_count: string | number }>(
      `SELECT count(*)::bigint AS in_flight_count
         FROM p1_supply_channel_in_flight
        WHERE workspace_id = $1 AND channel_id = $2`,
      [this.workspaceId, channelId],
    );
    return count.rows[0] && Number(count.rows[0].in_flight_count) > 0
      ? {
          state: initialChannelLifecycle(channelId, new Date(0).toISOString()),
          revision: 0,
          in_flight_count: count.rows[0].in_flight_count,
        }
      : null;
  }

  private lifecycleState(
    channelId: string,
    row: ChannelLifecycleRow | null,
  ): ChannelLifecycleState {
    if (!row) {
      return initialChannelLifecycle(channelId, new Date(0).toISOString());
    }
    return {
      ...row.state,
      lifecycleRevision: channelLifecycleRevisionId(
        channelId,
        Number(row.revision),
      ),
      inFlightCount: Number(row.in_flight_count ?? 0),
    };
  }

  private writeLifecycle(
    client: PoolClient,
    channelId: string,
    next: ChannelLifecycleState,
    nextRevision: number,
  ) {
    return client.query(
      `INSERT INTO p1_supply_channel_lifecycle
         (workspace_id, channel_id, state, revision, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (workspace_id, channel_id) DO UPDATE
         SET state = EXCLUDED.state,
             revision = EXCLUDED.revision,
             updated_at = now()`,
      [this.workspaceId, channelId, JSON.stringify(next), nextRevision],
    );
  }
}
