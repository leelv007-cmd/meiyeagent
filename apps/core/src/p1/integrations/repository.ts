import type {
  ConnectionCreateOperation,
  IntegrationAuditEvent,
  IntegrationConnection,
  ExternalActionIntent,
  FeishuToolActivity,
  FeishuToolLifecycleTarget,
  FeishuToolRevision,
  FeishuToolShortcut,
} from './contracts.js';

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
  listFeishuLifecycleTargets(): Promise<FeishuToolLifecycleTarget[]>;
  appendAudit(event: IntegrationAuditEvent): Promise<void>;
  listAudits(workspaceId: string): Promise<IntegrationAuditEvent[]>;
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
  private readonly idempotency = new Map<
    string,
    { payload: string; value: unknown }
  >();
  private readonly connectionCreateOperations = new Map<
    string,
    ConnectionCreateOperation
  >();
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
