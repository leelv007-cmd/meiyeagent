import type {
  ConnectionCreateOperation,
  DouyinPublishConfirmation,
  DouyinPublishJob,
  DouyinObserveSnapshot,
  DouyinObserveState,
  DouyinOAuthLifecycleTarget,
  DouyinOAuthRefreshOperation,
  IntegrationAuditEvent,
  IntegrationConnection,
  ExternalActionIntent,
  FeishuToolActivity,
  FeishuToolLifecycleTarget,
  FeishuToolRevision,
  FeishuToolShortcut,
} from './contracts.js';

function oauthRefreshPhaseRank(
  phase: DouyinOAuthRefreshOperation['phase']
) {
  return { claimed: 0, credential_stored: 1, completed: 2 }[phase];
}

function connectionCreatePhaseRank(
  phase: ConnectionCreateOperation['phase']
) {
  return { claimed: 0, secret_stored: 1, completed: 2 }[phase];
}

export interface IntegrationRepository {
  saveConnection(connection: IntegrationConnection): Promise<void>;
  createConnectionIfAbsent(
    connection: IntegrationConnection
  ): Promise<{ created: boolean; connection: IntegrationConnection }>;
  compareAndSwapConnection(
    connection: IntegrationConnection,
    expected: { credentialVersion: number; updatedAt: string }
  ): Promise<boolean>;
  getConnection(
    workspaceId: string,
    id: string
  ): Promise<IntegrationConnection | undefined>;
  listConnections(workspaceId: string): Promise<IntegrationConnection[]>;
  listDouyinOAuthLifecycleTargets(): Promise<DouyinOAuthLifecycleTarget[]>;
  listFeishuLifecycleTargets(): Promise<FeishuToolLifecycleTarget[]>;
  appendAudit(event: IntegrationAuditEvent): Promise<void>;
  listAudits(workspaceId: string): Promise<IntegrationAuditEvent[]>;
  saveDouyinConfirmation(
    confirmation: DouyinPublishConfirmation
  ): Promise<void>;
  getDouyinConfirmation(
    workspaceId: string,
    id: string
  ): Promise<DouyinPublishConfirmation | undefined>;
  saveDouyinPublishJob(job: DouyinPublishJob): Promise<void>;
  claimDouyinPublishJob(
    job: DouyinPublishJob
  ): Promise<{ claimed: boolean; job: DouyinPublishJob }>;
  settleDouyinPublishJob(
    job: DouyinPublishJob,
    expectedStatus: DouyinPublishJob['status']
  ): Promise<{ settled: boolean; job: DouyinPublishJob }>;
  reconcileDouyinPublishJob(
    job: DouyinPublishJob,
    expectedUpdatedAt: string
  ): Promise<{ reconciled: boolean; job: DouyinPublishJob }>;
  getDouyinPublishJob(
    workspaceId: string,
    jobId: string
  ): Promise<DouyinPublishJob | undefined>;
  findDouyinPublishJobByItem(
    workspaceId: string,
    itemId: string
  ): Promise<DouyinPublishJob | undefined>;
  listDouyinPublishJobs(
    workspaceId: string,
    connectionId: string
  ): Promise<DouyinPublishJob[]>;
  listDouyinPublishPollingTargets(
    at: string,
    limit?: number
  ): Promise<Array<{ workspaceId: string; jobId: string }>>;
  getIdempotent<T>(
    workspaceId: string,
    key: string,
    payload: string
  ): Promise<{ matches: boolean; value: T } | undefined>;
  saveIdempotent<T>(
    workspaceId: string,
    key: string,
    payload: string,
    value: T
  ): Promise<void>;
  claimConnectionCreate(
    operation: ConnectionCreateOperation
  ): Promise<{ claimed: boolean; operation: ConnectionCreateOperation }>;
  advanceConnectionCreate(
    operation: ConnectionCreateOperation
  ): Promise<ConnectionCreateOperation>;
  getConnectionCreate(
    workspaceId: string,
    id: string
  ): Promise<ConnectionCreateOperation | undefined>;
  claimDouyinOAuthRefresh(
    operation: DouyinOAuthRefreshOperation
  ): Promise<{ claimed: boolean; operation: DouyinOAuthRefreshOperation }>;
  advanceDouyinOAuthRefresh(
    operation: DouyinOAuthRefreshOperation
  ): Promise<DouyinOAuthRefreshOperation>;
  getDouyinOAuthRefresh(
    workspaceId: string,
    id: string
  ): Promise<DouyinOAuthRefreshOperation | undefined>;
  getActiveDouyinOAuthRefresh(
    workspaceId: string,
    connectionId: string
  ): Promise<DouyinOAuthRefreshOperation | undefined>;
  saveDouyinObserveSnapshot(snapshot: DouyinObserveSnapshot): Promise<void>;
  listDouyinObserveSnapshots(
    workspaceId: string,
    connectionId: string
  ): Promise<DouyinObserveSnapshot[]>;
  saveDouyinObserveState(state: DouyinObserveState): Promise<void>;
  getDouyinObserveState(
    workspaceId: string,
    connectionId: string
  ): Promise<DouyinObserveState | undefined>;
  listDouyinObserveSyncTargets(
    at: string,
    limit?: number
  ): Promise<Array<{ workspaceId: string; connectionId: string }>>;
  hasProductPublishItem(workspaceId: string, itemId: string): Promise<boolean>;
  clearDouyinObserveSnapshots(
    workspaceId: string,
    connectionId: string
  ): Promise<void>;
  saveToolRevision(revision: FeishuToolRevision): Promise<void>;
  getToolRevision(
    toolId: string,
    revision: string
  ): Promise<FeishuToolRevision | undefined>;
  listToolRevisions(toolId?: string): Promise<FeishuToolRevision[]>;
  getPublishedTool(toolId: string): Promise<FeishuToolRevision | undefined>;
  saveIntent(intent: ExternalActionIntent): Promise<void>;
  claimIntent(
    intent: ExternalActionIntent
  ): Promise<{ claimed: boolean; intent: ExternalActionIntent }>;
  claimIntentExecution(
    intent: ExternalActionIntent,
    expectedStatus: ExternalActionIntent['status']
  ): Promise<{ claimed: boolean; intent: ExternalActionIntent }>;
  getIntent(
    workspaceId: string,
    id: string
  ): Promise<ExternalActionIntent | undefined>;
  listIntents(
    workspaceId: string,
    connectionId?: string
  ): Promise<ExternalActionIntent[]>;
  listFeishuReconciliationTargets(
    at: string,
    limit?: number
  ): Promise<Array<{ workspaceId: string; intentId: string }>>;
  appendActivity(activity: FeishuToolActivity): Promise<void>;
  listActivities(
    workspaceId: string,
    connectionId: string
  ): Promise<FeishuToolActivity[]>;
  saveShortcuts(
    workspaceId: string,
    connectionId: string,
    shortcuts: FeishuToolShortcut[]
  ): Promise<void>;
  listShortcuts(
    workspaceId: string,
    connectionId: string
  ): Promise<FeishuToolShortcut[]>;
  claimExternalEvent(
    workspaceId: string,
    provider: string,
    eventId: string
  ): Promise<boolean>;
}

export class MemoryIntegrationRepository implements IntegrationRepository {
  private readonly connections = new Map<string, IntegrationConnection>();
  private readonly audits: IntegrationAuditEvent[] = [];
  private readonly confirmations = new Map<string, DouyinPublishConfirmation>();
  private readonly publishJobs = new Map<string, DouyinPublishJob>();
  private readonly idempotency = new Map<
    string,
    { payload: string; value: unknown }
  >();
  private readonly connectionCreateOperations = new Map<
    string,
    ConnectionCreateOperation
  >();
  private readonly oauthRefreshOperations = new Map<
    string,
    DouyinOAuthRefreshOperation
  >();
  private readonly observeSnapshots = new Map<string, DouyinObserveSnapshot>();
  private readonly observeStates = new Map<string, DouyinObserveState>();
  private readonly toolRevisions = new Map<string, FeishuToolRevision>();
  private readonly intents = new Map<string, ExternalActionIntent>();
  private readonly activities: FeishuToolActivity[] = [];
  private readonly shortcuts = new Map<string, FeishuToolShortcut[]>();
  private readonly externalEvents = new Set<string>();

  async saveConnection(connection: IntegrationConnection) {
    this.connections.set(
      `${connection.workspaceId}:${connection.id}`,
      structuredClone(connection)
    );
  }

  async createConnectionIfAbsent(connection: IntegrationConnection) {
    const key = `${connection.workspaceId}:${connection.id}`;
    const current = this.connections.get(key);
    if (current) {
      return { created: false, connection: structuredClone(current) };
    }
    this.connections.set(key, structuredClone(connection));
    return { created: true, connection: structuredClone(connection) };
  }

  async compareAndSwapConnection(
    connection: IntegrationConnection,
    expected: { credentialVersion: number; updatedAt: string }
  ) {
    const key = `${connection.workspaceId}:${connection.id}`;
    const current = this.connections.get(key);
    if (
      !current ||
      current.credential.version !== expected.credentialVersion ||
      current.updatedAt !== expected.updatedAt
    ) {
      return false;
    }
    this.connections.set(key, structuredClone(connection));
    return true;
  }

  async getConnection(workspaceId: string, id: string) {
    const connection = this.connections.get(`${workspaceId}:${id}`);
    return connection ? structuredClone(connection) : undefined;
  }

  async listConnections(workspaceId: string) {
    return [...this.connections.values()]
      .filter((connection) => connection.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((connection) => structuredClone(connection));
  }

  async listDouyinOAuthLifecycleTargets() {
    return [...this.connections.values()]
      .filter((connection) => {
        const hasActiveOperation = [...this.oauthRefreshOperations.values()].some(
          (operation) =>
            operation.workspaceId === connection.workspaceId &&
            operation.connectionId === connection.id &&
            operation.phase !== 'completed'
        );
        const normalCandidate =
          connection.credential.status === 'active' &&
          typeof connection.credential.expiresAt === 'string' &&
          Number.isFinite(Date.parse(connection.credential.expiresAt));
        return (
          connection.provider === 'douyin' &&
          connection.identityMode === 'oauth_user' &&
          Boolean(connection.subject) &&
          connection.status !== 'revoked' &&
          (hasActiveOperation ||
            (connection.status !== 'disabled' &&
              connection.status !== 'reauthorize_required' &&
              normalCandidate))
        );
      })
      .map((connection) => ({
        connectionId: connection.id,
        credentialVersion: connection.credential.version,
        ...(connection.credential.expiresAt
          ? { expiresAt: connection.credential.expiresAt }
          : {}),
        ...(connection.credential.refreshExpiresAt
          ? { refreshExpiresAt: connection.credential.refreshExpiresAt }
          : {}),
        workspaceId: connection.workspaceId,
      }))
      .sort((left, right) =>
        left.workspaceId === right.workspaceId
          ? left.connectionId.localeCompare(right.connectionId)
          : left.workspaceId.localeCompare(right.workspaceId)
      );
  }

  async listFeishuLifecycleTargets() {
    return [...this.connections.values()]
      .filter(
        (connection) =>
          connection.provider === 'feishu' &&
          ['available', 'degraded', 'rate_limited'].includes(
            connection.status
          ) &&
          connection.credential.status === 'active' &&
          connection.requestedCapabilities.includes('mcp.tools')
      )
      .map((connection) => ({
        connectionId: connection.id,
        workspaceId: connection.workspaceId,
      }))
      .sort((left, right) =>
        left.workspaceId === right.workspaceId
          ? left.connectionId.localeCompare(right.connectionId)
          : left.workspaceId.localeCompare(right.workspaceId)
      );
  }

  async appendAudit(event: IntegrationAuditEvent) {
    if (
      !this.audits.some(
        (candidate) =>
          candidate.workspaceId === event.workspaceId &&
          candidate.id === event.id
      )
    ) {
      this.audits.push(structuredClone(event));
    }
  }

  async listAudits(workspaceId: string) {
    return this.audits
      .filter((event) => event.workspaceId === workspaceId)
      .map((event) => structuredClone(event));
  }

  async saveDouyinConfirmation(confirmation: DouyinPublishConfirmation) {
    this.confirmations.set(
      `${confirmation.workspaceId}:${confirmation.id}`,
      structuredClone(confirmation)
    );
  }

  async getDouyinConfirmation(workspaceId: string, id: string) {
    const value = this.confirmations.get(`${workspaceId}:${id}`);
    return value ? structuredClone(value) : undefined;
  }

  async saveDouyinPublishJob(job: DouyinPublishJob) {
    this.publishJobs.set(`${job.workspaceId}:${job.id}`, structuredClone(job));
  }

  async claimDouyinPublishJob(job: DouyinPublishJob) {
    const key = `${job.workspaceId}:${job.id}`;
    const existing = this.publishJobs.get(key);
    if (existing) {
      return { claimed: false, job: structuredClone(existing) };
    }
    this.publishJobs.set(key, structuredClone(job));
    return { claimed: true, job: structuredClone(job) };
  }

  async settleDouyinPublishJob(
    job: DouyinPublishJob,
    expectedStatus: DouyinPublishJob['status']
  ) {
    const key = `${job.workspaceId}:${job.id}`;
    const current = this.publishJobs.get(key);
    if (!current || current.status !== expectedStatus) {
      return {
        settled: false,
        job: structuredClone(current ?? job),
      };
    }
    this.publishJobs.set(key, structuredClone(job));
    return { settled: true, job: structuredClone(job) };
  }

  async reconcileDouyinPublishJob(
    job: DouyinPublishJob,
    expectedUpdatedAt: string
  ) {
    const key = `${job.workspaceId}:${job.id}`;
    const current = this.publishJobs.get(key);
    if (!current || current.updatedAt !== expectedUpdatedAt) {
      return {
        reconciled: false,
        job: structuredClone(current ?? job),
      };
    }
    this.publishJobs.set(key, structuredClone(job));
    return { reconciled: true, job: structuredClone(job) };
  }

  async getDouyinPublishJob(workspaceId: string, jobId: string) {
    const value = this.publishJobs.get(`${workspaceId}:${jobId}`);
    return value ? structuredClone(value) : undefined;
  }

  async findDouyinPublishJobByItem(workspaceId: string, itemId: string) {
    const value = [...this.publishJobs.values()].find(
      (job) => job.workspaceId === workspaceId && job.itemId === itemId
    );
    return value ? structuredClone(value) : undefined;
  }

  async listDouyinPublishJobs(workspaceId: string, connectionId: string) {
    return [...this.publishJobs.values()]
      .filter(
        (job) =>
          job.workspaceId === workspaceId && job.connectionId === connectionId
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((job) => structuredClone(job));
  }

  async listDouyinPublishPollingTargets(at: string, limit = 100) {
    return [...this.publishJobs.values()]
      .filter(
        (job) =>
          job.pollingState === 'scheduled' &&
          Boolean(job.nextPollAt) &&
          Date.parse(job.nextPollAt!) <= Date.parse(at)
      )
      .sort((left, right) => left.nextPollAt!.localeCompare(right.nextPollAt!))
      .slice(0, limit)
      .map((job) => ({ jobId: job.id, workspaceId: job.workspaceId }));
  }

  async getIdempotent<T>(workspaceId: string, key: string, payload: string) {
    const value = this.idempotency.get(`${workspaceId}:${key}`);
    if (!value) return undefined;
    return {
      matches: value.payload === payload,
      value: structuredClone(value.value) as T,
    };
  }

  async saveIdempotent<T>(
    workspaceId: string,
    key: string,
    payload: string,
    value: T
  ) {
    this.idempotency.set(`${workspaceId}:${key}`, {
      payload,
      value: structuredClone(value),
    });
  }

  async claimConnectionCreate(operation: ConnectionCreateOperation) {
    const key = `${operation.workspaceId}:${operation.id}`;
    const existing = this.connectionCreateOperations.get(key);
    if (existing) {
      return { claimed: false, operation: structuredClone(existing) };
    }
    const owner = [...this.connectionCreateOperations.values()].find(
      (candidate) =>
        candidate.workspaceId === operation.workspaceId &&
        candidate.connectionId === operation.connectionId
    );
    if (owner) {
      return { claimed: false, operation: structuredClone(owner) };
    }
    this.connectionCreateOperations.set(key, structuredClone(operation));
    return { claimed: true, operation: structuredClone(operation) };
  }

  async advanceConnectionCreate(operation: ConnectionCreateOperation) {
    const key = `${operation.workspaceId}:${operation.id}`;
    const existing = this.connectionCreateOperations.get(key);
    if (!existing) {
      throw new Error('Connection create operation was not claimed.');
    }
    if (
      connectionCreatePhaseRank(operation.phase) >=
      connectionCreatePhaseRank(existing.phase)
    ) {
      this.connectionCreateOperations.set(key, structuredClone(operation));
      return structuredClone(operation);
    }
    return structuredClone(existing);
  }

  async getConnectionCreate(workspaceId: string, id: string) {
    const operation = this.connectionCreateOperations.get(
      `${workspaceId}:${id}`
    );
    return operation ? structuredClone(operation) : undefined;
  }

  async claimDouyinOAuthRefresh(operation: DouyinOAuthRefreshOperation) {
    const key = `${operation.workspaceId}:${operation.id}`;
    const existing = this.oauthRefreshOperations.get(key);
    if (existing) {
      return { claimed: false, operation: structuredClone(existing) };
    }
    const active = [...this.oauthRefreshOperations.values()].find(
      (candidate) =>
        candidate.workspaceId === operation.workspaceId &&
        candidate.connectionId === operation.connectionId &&
        candidate.phase !== 'completed'
    );
    if (active) {
      return { claimed: false, operation: structuredClone(active) };
    }
    this.oauthRefreshOperations.set(key, structuredClone(operation));
    return { claimed: true, operation: structuredClone(operation) };
  }

  async advanceDouyinOAuthRefresh(operation: DouyinOAuthRefreshOperation) {
    const key = `${operation.workspaceId}:${operation.id}`;
    const existing = this.oauthRefreshOperations.get(key);
    if (
      existing &&
      oauthRefreshPhaseRank(existing.phase) > oauthRefreshPhaseRank(operation.phase)
    ) {
      return structuredClone(existing);
    }
    this.oauthRefreshOperations.set(key, structuredClone(operation));
    return structuredClone(operation);
  }

  async getDouyinOAuthRefresh(workspaceId: string, id: string) {
    const operation = this.oauthRefreshOperations.get(`${workspaceId}:${id}`);
    return operation ? structuredClone(operation) : undefined;
  }

  async getActiveDouyinOAuthRefresh(
    workspaceId: string,
    connectionId: string
  ) {
    const operation = [...this.oauthRefreshOperations.values()].find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.connectionId === connectionId &&
        candidate.phase !== 'completed'
    );
    return operation ? structuredClone(operation) : undefined;
  }

  async saveDouyinObserveSnapshot(snapshot: DouyinObserveSnapshot) {
    const key = `${snapshot.workspaceId}:${snapshot.connectionId}:${snapshot.externalId}`;
    const current = this.observeSnapshots.get(key);
    if (!current || current.observedAt < snapshot.observedAt) {
      this.observeSnapshots.set(key, structuredClone(snapshot));
    }
  }

  async listDouyinObserveSnapshots(workspaceId: string, connectionId: string) {
    return [...this.observeSnapshots.values()]
      .filter(
        (snapshot) =>
          snapshot.workspaceId === workspaceId &&
          snapshot.connectionId === connectionId
      )
      .sort((left, right) => left.externalId.localeCompare(right.externalId))
      .map((snapshot) => structuredClone(snapshot));
  }

  async saveDouyinObserveState(state: DouyinObserveState) {
    const key = `${state.workspaceId}:${state.connectionId}`;
    const current = this.observeStates.get(key);
    if (!current || current.lastAttemptAt <= state.lastAttemptAt) {
      this.observeStates.set(key, structuredClone(state));
    }
  }

  async getDouyinObserveState(workspaceId: string, connectionId: string) {
    const state = this.observeStates.get(`${workspaceId}:${connectionId}`);
    return state ? structuredClone(state) : undefined;
  }

  async listDouyinObserveSyncTargets(at: string, limit = 100) {
    const atMs = Date.parse(at);
    return [...this.connections.values()]
      .filter((connection) => {
        if (
          connection.provider !== 'douyin' ||
          !['available', 'degraded', 'rate_limited'].includes(
            connection.status
          ) ||
          connection.credential.status !== 'active' ||
          !connection.grantedCapabilities.includes('observe') ||
          !connection.capabilityEvidence.observe?.endpoint
        ) {
          return false;
        }
        const degraded = connection.degradedCapabilities.observe;
        if (
          degraded &&
          !['rate_limited', 'failed'].includes(degraded)
        ) {
          return false;
        }
        const state = this.observeStates.get(
          `${connection.workspaceId}:${connection.id}`
        );
        return !state?.nextSyncAt || Date.parse(state.nextSyncAt) <= atMs;
      })
      .sort((left, right) =>
        `${left.workspaceId}:${left.id}`.localeCompare(
          `${right.workspaceId}:${right.id}`
        )
      )
      .slice(0, limit)
      .map((connection) => ({
        connectionId: connection.id,
        workspaceId: connection.workspaceId,
      }));
  }

  async hasProductPublishItem(workspaceId: string, itemId: string) {
    return [...this.publishJobs.values()].some(
      (job) => job.workspaceId === workspaceId && job.itemId === itemId
    );
  }

  async clearDouyinObserveSnapshots(workspaceId: string, connectionId: string) {
    for (const [key, snapshot] of this.observeSnapshots) {
      if (
        snapshot.workspaceId === workspaceId &&
        snapshot.connectionId === connectionId
      ) {
        this.observeSnapshots.delete(key);
      }
    }
    this.observeStates.delete(`${workspaceId}:${connectionId}`);
  }

  async saveToolRevision(revision: FeishuToolRevision) {
    this.toolRevisions.set(
      `${revision.id}:${revision.revision}`,
      structuredClone(revision)
    );
  }

  async getToolRevision(toolId: string, revision: string) {
    const value = this.toolRevisions.get(`${toolId}:${revision}`);
    return value ? structuredClone(value) : undefined;
  }

  async listToolRevisions(toolId?: string) {
    return [...this.toolRevisions.values()]
      .filter((revision) => !toolId || revision.id === toolId)
      .map((revision) => structuredClone(revision));
  }

  async getPublishedTool(toolId: string) {
    const published = [...this.toolRevisions.values()]
      .filter(
        (revision) => revision.id === toolId && revision.status === 'published'
      )
      .sort((left, right) =>
        right.publishedAt!.localeCompare(left.publishedAt!)
      )[0];
    return published ? structuredClone(published) : undefined;
  }

  async saveIntent(intent: ExternalActionIntent) {
    this.intents.set(
      `${intent.workspaceId}:${intent.id}`,
      structuredClone(intent)
    );
  }

  async claimIntent(intent: ExternalActionIntent) {
    const key = `${intent.workspaceId}:${intent.id}`;
    const existing = this.intents.get(key);
    if (existing) {
      return { claimed: false, intent: structuredClone(existing) };
    }
    this.intents.set(key, structuredClone(intent));
    return { claimed: true, intent: structuredClone(intent) };
  }

  async claimIntentExecution(
    intent: ExternalActionIntent,
    expectedStatus: ExternalActionIntent['status']
  ) {
    const key = `${intent.workspaceId}:${intent.id}`;
    const current = this.intents.get(key);
    if (!current || current.status !== expectedStatus) {
      return {
        claimed: false,
        intent: structuredClone(current ?? intent),
      };
    }
    this.intents.set(key, structuredClone(intent));
    return { claimed: true, intent: structuredClone(intent) };
  }

  async getIntent(workspaceId: string, id: string) {
    const value = this.intents.get(`${workspaceId}:${id}`);
    return value ? structuredClone(value) : undefined;
  }

  async listIntents(workspaceId: string, connectionId?: string) {
    return [...this.intents.values()]
      .filter(
        (intent) =>
          intent.workspaceId === workspaceId &&
          (!connectionId || intent.connectionId === connectionId)
      )
      .map((intent) => structuredClone(intent));
  }

  async listFeishuReconciliationTargets(at: string, limit = 100) {
    const atMs = Date.parse(at);
    return [...this.intents.values()]
      .filter(
        (intent) =>
          intent.status === 'unknown' &&
          intent.effectState === 'reconciliation_required' &&
          intent.sideEffect !== 'read' &&
          (!intent.nextReconcileAt ||
            Date.parse(intent.nextReconcileAt) <= atMs)
      )
      .sort((left, right) =>
        (left.nextReconcileAt ?? left.createdAt).localeCompare(
          right.nextReconcileAt ?? right.createdAt
        )
      )
      .slice(0, limit)
      .map((intent) => ({
        intentId: intent.id,
        workspaceId: intent.workspaceId,
      }));
  }

  async appendActivity(activity: FeishuToolActivity) {
    if (
      !this.activities.some(
        (candidate) =>
          candidate.workspaceId === activity.workspaceId &&
          candidate.id === activity.id
      )
    ) {
      this.activities.push(structuredClone(activity));
    }
  }

  async listActivities(workspaceId: string, connectionId: string) {
    return this.activities
      .filter(
        (activity) =>
          activity.workspaceId === workspaceId &&
          activity.connectionId === connectionId
      )
      .map((activity) => structuredClone(activity));
  }

  async saveShortcuts(
    workspaceId: string,
    connectionId: string,
    shortcuts: FeishuToolShortcut[]
  ) {
    this.shortcuts.set(
      `${workspaceId}:${connectionId}`,
      structuredClone(shortcuts).sort((left, right) => left.order - right.order)
    );
  }

  async listShortcuts(workspaceId: string, connectionId: string) {
    return structuredClone(
      this.shortcuts.get(`${workspaceId}:${connectionId}`) ?? []
    );
  }

  async claimExternalEvent(
    workspaceId: string,
    provider: string,
    eventId: string
  ) {
    const key = `${workspaceId}:${provider}:${eventId}`;
    if (this.externalEvents.has(key)) return false;
    this.externalEvents.add(key);
    return true;
  }
}
