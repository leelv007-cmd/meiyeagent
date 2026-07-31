export type IntegrationProvider = 'douyin' | 'feishu' | 'model';

export type ConnectionStatus =
  | 'pending_review'
  | 'available'
  | 'reauthorize_required'
  | 'permission_missing'
  | 'rate_limited'
  | 'degraded'
  | 'disabled'
  | 'revoked';

export interface IntegrationContext {
  workspaceId: string;
  userId: string;
  role: 'owner' | 'worker' | 'admin';
  correlationId: string;
}

export interface SecretContext {
  workspaceId: string;
  credentialId: string;
  version: number;
  provider: IntegrationProvider;
}

export interface SecretStorePort {
  reference(context: SecretContext): string;
  put(context: SecretContext, value: string): Promise<string>;
  use(secretRef: string, context: SecretContext): Promise<string>;
  revoke(secretRef: string, context: SecretContext): Promise<void>;
}

export interface CredentialMetadata {
  id: string;
  version: number;
  mask: '••••••••';
  scope: string[];
  expiresAt?: string;
  refreshExpiresAt?: string;
  lastUsedAt?: string;
  testedAt?: string;
  testStatus?:
    | 'passed'
    | 'unauthorized'
    | 'network_failed'
    | 'unknown'
    | 'not_wired';
  testErrorCode?: string;
  status: 'active' | 'revoked' | 'expired' | 'unverified';
}

export type CredentialTransition =
  | {
      kind: 'rotate';
      phase: 'staged' | 'old_secret_revoke_pending';
      operationId: string;
      payloadHash: string;
      previousSecretRef: string;
      previousVersion: number;
      targetVersion: number;
      finalCredentialStatus: CredentialMetadata['status'];
    }
  | {
      kind: 'disconnect';
      phase: 'secret_revoke_pending';
      operationId: string;
      payloadHash: string;
      previousSecretRef: string;
      previousVersion: number;
    };

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  identityMode: 'oauth_user' | 'service' | 'byok';
  requestedCapabilities: string[];
  grantedCapabilities: string[];
  degradedCapabilities: Record<string, string>;
  capabilityEvidence: Record<string, CapabilityActivationEvidence>;
  status: ConnectionStatus;
  subject?: string;
  secretRef: string;
  credential: CredentialMetadata;
  credentialTransition?: CredentialTransition;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityActivationEvidence {
  revision: string;
  verifiedAt: string;
  scopes: string[];
  endpoint?: string;
  fields?: string[];
  frequency?: string;
  qualified?: boolean;
}

export type DouyinCapability =
  | 'publish'
  | 'observe'
  | 'publish.poi'
  | 'publish.mini_program';

export interface DouyinPublishAnchor {
  kind: 'poi' | 'mini_program';
  id: string;
}

export interface CreateConnectionInput {
  id: string;
  provider: IntegrationProvider;
  identityMode: IntegrationConnection['identityMode'];
  requestedCapabilities: string[];
  grantedCapabilities: string[];
  subject?: string;
  credential: {
    value: string;
    scope: string[];
    expiresAt?: string;
    refreshExpiresAt?: string;
    status?: CredentialMetadata['status'];
  };
}

export interface ConnectionCreateOperation {
  id: string;
  workspaceId: string;
  connectionId: string;
  payloadHash: string;
  phase: 'claimed' | 'secret_stored' | 'completed';
  connection: IntegrationConnection;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationAuditEvent {
  id: string;
  workspaceId: string;
  actorId: string;
  connectionId: string;
  action: string;
  correlationId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ControlledEndpointProfile {
  id: string;
  apiFamily: string;
  endpoint: string;
  permittedModels: string[];
  region?: 'cn' | 'global';
}

export interface StrictByokExecutionRequest {
  endpoint: string;
  catalogModelId: string;
  prompt: string;
  credential: string;
}

export interface StrictByokExecutionPort {
  execute(
    request: StrictByokExecutionRequest
  ): Promise<
    | { status: 'completed'; output: string }
    | { status: 'unauthorized' | 'failed' }
  >;
}

export interface SubmitStrictByokInput {
  connectionId: string;
  endpointProfileId: string;
  catalogModelId: string;
  prompt: string;
  idempotencyKey: string;
}

/**
 * Public Strict BYOK route facts (no silent fallback).
 * S2b: maps onto CanonicalRouteSnapshot via `fromStrictByokRouteSnapshot`
 * (single candidate, fallbackConsent=false, no-fallback chain).
 */
export interface StrictByokRouteSnapshot {
  id: string;
  workspaceId: string;
  endpointProfileId: string;
  catalogModelId: string;
  credentialMode: 'byok_strict';
  credentialVersion: number;
  fallbackConsent: false;
}

export type StrictByokSubmissionResult =
  | {
      status: 'completed';
      output: string;
      routeSnapshot: StrictByokRouteSnapshot;
      usage: {
        resource: 'copy';
        amount: 1;
        status: 'committed';
        available: number;
      };
      providerCost: { status: 'externally_billed'; billedTo: 'workspace' };
    }
  | {
      status: 'failed';
      routeSnapshot: StrictByokRouteSnapshot;
      usage: {
        resource: 'copy';
        amount: 1;
        status: 'refunded';
        available: number;
      };
      providerCost: { status: 'unknown'; billedTo: 'workspace' };
    }
  | {
      status: 'unknown';
      routeSnapshot: StrictByokRouteSnapshot;
      usage: {
        resource: 'copy';
        amount: 1;
        status: 'reserved';
        available: number;
      };
      providerCost: { status: 'unknown'; billedTo: 'workspace' };
    };

export interface StrictByokLedgerPort {
  getUsageProjection(context: IntegrationContext): Promise<{
    allowance: number;
    reserved: number;
    committed: number;
    available: number;
  }>;
  prepare(input: {
    context: IntegrationContext;
    idempotencyKey: string;
    endpointProfileId: string;
    catalogModelId: string;
    credentialVersion: number;
    region: 'cn' | 'global';
  }): Promise<
    | {
        decision: 'execute';
        jobId: string;
        attemptId: string;
        routeSnapshot: StrictByokRouteSnapshot;
      }
    | { decision: 'recovered'; result: StrictByokSubmissionResult }
  >;
  settle(input: {
    context: IntegrationContext;
    idempotencyKey: string;
    jobId: string;
    attemptId: string;
    routeSnapshot: StrictByokRouteSnapshot;
    outcome:
      | { status: 'completed'; output: string }
      | { status: 'unauthorized' | 'failed' };
  }): Promise<StrictByokSubmissionResult>;
}

export interface DouyinPublishConfirmation {
  id: string;
  workspaceId: string;
  connectionId: string;
  accountSubject: string;
  contentSnapshotId: string;
  contentSnapshotRevision: string;
  scheduledAt: string;
  confirmedBy: string;
  confirmedAt: string;
  anchor?: DouyinPublishAnchor;
}

export interface PublishableContentSnapshot {
  id: string;
  revision: string;
  source: 'product_handoff';
  contentId: string;
  contentVersionId: string;
  artifactId: string;
  platform: 'douyin';
  title: string;
  createdAt: string;
}

export interface PublishContentSnapshotPort {
  list(workspaceId: string): Promise<PublishableContentSnapshot[]>;
  resolve(
    workspaceId: string,
    snapshotId: string
  ): Promise<PublishableContentSnapshot | undefined>;
}

export interface DouyinPublishJob {
  id: string;
  workspaceId: string;
  connectionId: string;
  confirmationId: string;
  status:
    | 'draft'
    | 'confirmation_pending'
    | 'submitting'
    | 'submitted'
    | 'reviewing'
    | 'published'
    | 'failed'
    | 'unknown'
    | 'manual_required';
  itemId?: string;
  videoId?: string;
  acceptance?: 'rejected_before_accept' | 'accepted' | 'acceptance_unknown';
  payloadHash?: string;
  effectState?: 'claimed' | 'settled' | 'reconciliation_required';
  providerEventId?: string;
  providerOccurredAt?: string;
  pollAttempts?: number;
  pollLimit?: number;
  pollDeadlineAt?: string;
  nextPollAt?: string;
  pollingState?: 'scheduled' | 'exhausted' | 'completed';
  lastErrorCode?: string;
  anchor?: DouyinPublishAnchor;
  fallback?: { kind: 'l3_handoff'; contentSnapshotId: string; reason: string };
  createdAt: string;
  updatedAt: string;
}

export interface DouyinPublishAdapterPort {
  submit(request: {
    connectionId: string;
    accountSubject: string;
    contentSnapshotId: string;
    contentSnapshotRevision: string;
    scheduledAt: string;
    credential: string;
    idempotencyKey: string;
    anchor?: DouyinPublishAnchor;
  }): Promise<{
    acceptance: 'rejected_before_accept' | 'accepted' | 'acceptance_unknown';
    status:
      | 'submitted'
      | 'reviewing'
      | 'published'
      | 'failed'
      | 'unknown'
      | 'rate_limited';
    itemId?: string;
    videoId?: string;
    errorCode?: string;
  }>;
}

export interface DouyinPublishStatusEvent {
  eventId: string;
  connectionId: string;
  jobId?: string;
  itemId?: string;
  videoId?: string;
  status: 'reviewing' | 'published' | 'failed' | 'unknown';
  occurredAt: string;
  errorCode?: string;
}

export interface DouyinObserveItem {
  externalId: string;
  platformTime: string;
  fields: Record<string, unknown>;
  missingReasons: Record<string, string>;
}

export interface DouyinObserveSnapshot extends DouyinObserveItem {
  workspaceId: string;
  connectionId: string;
  source: 'product' | 'external';
  observedAt: string;
  evidenceRevision: string;
}

export interface DouyinObserveState {
  workspaceId: string;
  connectionId: string;
  status: 'available' | 'empty' | 'unavailable' | 'unknown';
  reason?: string;
  evidenceRevision: string;
  lastAttemptAt: string;
  lastSuccessfulAt?: string;
  nextSyncAt?: string;
}

export interface DouyinOAuthRefreshOperation {
  id: string;
  workspaceId: string;
  connectionId: string;
  payloadHash: string;
  effectIdempotencyKey: string;
  phase: 'claimed' | 'credential_stored' | 'completed';
  subject: string;
  sourceCredentialId: string;
  sourceCredentialVersion: number;
  sourceSecretRef: string;
  target?: {
    credentialVersion: number;
    secretRef: string;
    valueHash: string;
    scope: string[];
    expiresAt: string;
    refreshExpiresAt: string;
  };
  result?: IntegrationConnection;
  providerStatus?: 'ok' | 'reauthorization_required' | 'failed';
  providerErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DouyinOAuthLifecycleTarget {
  connectionId: string;
  credentialVersion: number;
  expiresAt?: string;
  refreshExpiresAt?: string;
  workspaceId: string;
}

export interface DouyinObserveAdapterPort {
  observe(request: {
    connectionId: string;
    accountSubject: string;
    endpoint: string;
    scopes: string[];
    fields: string[];
    credential: string;
  }): Promise<
    | { status: 'ok'; observedAt: string; items: DouyinObserveItem[] }
    | { status: 'rate_limited'; retryAfterSeconds?: number }
    | { status: 'unauthorized' | 'forbidden' | 'failed'; errorCode?: string }
  >;
}

export interface DouyinAdapterPort
  extends DouyinPublishAdapterPort,
    DouyinObserveAdapterPort {
  readonly executionMode: 'recorded' | 'live';
  refreshOAuth(request: {
    connectionId: string;
    subject: string;
    refreshToken: string;
    /** Stable across retries; the adapter/provider must replay one logical effect. */
    effectIdempotencyKey: string;
  }): Promise<
    | {
        status: 'ok';
        accessToken: string;
        refreshToken: string;
        scopes: string[];
        accessExpiresAt: string;
        refreshExpiresAt: string;
      }
    | { status: 'reauthorization_required' | 'failed'; errorCode?: string }
  >;
  inspectPublish(request: {
    connectionId: string;
    itemId: string;
    credential: string;
  }): Promise<{
    status: 'reviewing' | 'published' | 'failed' | 'unknown' | 'rate_limited';
    errorCode?: string;
  }>;
}

export type ToolRisk = 'read' | 'write' | 'destructive' | 'open_world';

export interface FeishuRemoteTool {
  id: string;
  remoteRevision: string;
  source: string;
  risk: ToolRisk;
  inputSchema: Record<string, unknown>;
}

export interface FeishuToolRevision extends FeishuRemoteTool {
  revision: string;
  schemaHash: string;
  status: 'draft' | 'published' | 'retired';
  discoveredAt: string;
  publishedAt?: string;
  compatibility?: {
    status: 'compatible' | 'incompatible';
    checkedAt: string;
    reason?: string;
  };
}

export interface FeishuToolLifecycleTarget {
  connectionId: string;
  workspaceId: string;
}

export type FeishuToolCallResult =
  | {
      status: 'ok';
      objectId?: string;
      externalUrl?: string;
      content?: string;
      output?: Record<string, unknown>;
    }
  | { status: 'rate_limited'; retryAfterSeconds?: number }
  | {
      status: 'unauthorized' | 'forbidden' | 'unknown' | 'failed';
      errorCode?: string;
    };

export type FeishuReconciliationResult =
  | {
      status: 'completed';
      objectId?: string;
      externalUrl?: string;
      providerLogId?: string;
    }
  | { status: 'not_found'; providerLogId?: string }
  | {
      status: 'unknown' | 'failed';
      errorCode?: string;
      providerLogId?: string;
    };

export interface FeishuMcpAdapterPort {
  discover(request: { uat: string }): Promise<FeishuRemoteTool[]>;
  call(request: {
    uat: string;
    toolId: string;
    allowedTools: string[];
    arguments: Record<string, unknown>;
  }): Promise<FeishuToolCallResult>;
  reconcile?(request: {
    uat: string;
    intentId: string;
    toolId: string;
    toolRevision: string;
    schemaHash: string;
    sideEffect: ExternalActionIntent['sideEffect'];
    targetObjectId?: string;
    fields: string[];
    argumentHash: string;
  }): Promise<FeishuReconciliationResult>;
}

export interface ConfirmationTaskPort {
  /** Must be idempotent for the same workspaceId and intentId. */
  create(input: {
    workspaceId: string;
    userId: string;
    correlationId: string;
    intentId: string;
    title: string;
    dueAt: string;
  }): Promise<{ taskId: string }>;
  confirm(input: {
    workspaceId: string;
    userId: string;
    correlationId: string;
    taskId: string;
    intentId: string;
  }): Promise<void>;
}

export interface IntegrationAnomalyTaskPort {
  /** Must be idempotent while one anomaly task for the connection is active. */
  report(input: {
    workspaceId: string;
    userId: string;
    correlationId: string;
    connectionId: string;
    provider: IntegrationProvider;
    status: Extract<
      ConnectionStatus,
      'reauthorize_required' | 'rate_limited' | 'degraded' | 'revoked'
    >;
    reason: string;
  }): Promise<{ taskId: string }>;
  /** Archives the active anomaly task so a later incident starts a new task. */
  resolve(input: {
    workspaceId: string;
    userId: string;
    correlationId: string;
    connectionId: string;
  }): Promise<void>;
}

export interface ExternalActionIntent {
  id: string;
  workspaceId: string;
  connectionId: string;
  toolId: string;
  toolRevision: string;
  schemaHash: string;
  sideEffect: 'read' | 'create' | 'edit' | 'send' | 'delete' | 'overwrite';
  source: 'explicit_user' | 'autonomous';
  targetObjectId?: string;
  fields: string[];
  argumentHash: string;
  confirmationTaskId?: string;
  effectState?: 'claimed' | 'settled' | 'reconciliation_required';
  outcomeStatus?: 'completed' | 'failed' | 'unknown';
  lastErrorCode?: string;
  reconciliationAttempts?: number;
  nextReconcileAt?: string;
  lastReconciledAt?: string;
  status:
    | 'authorized'
    | 'confirmation_pending'
    | 'executed'
    | 'failed'
    | 'unknown';
  createdBy: string;
  createdAt: string;
}

export interface FeishuToolActivity {
  id: string;
  workspaceId: string;
  connectionId: string;
  toolId: string;
  intentId: string;
  objectId?: string;
  externalUrl?: string;
  status: 'completed' | 'failed' | 'unknown';
  providerLogId?: string;
  executedAt: string;
}

export interface FeishuToolShortcut {
  toolId: string;
  order: number;
  hidden: boolean;
}

export class IntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}
