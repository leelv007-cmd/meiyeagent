import { createHash } from 'node:crypto';
import type {
  ConnectionCreateOperation,
  CreateConnectionInput,
  ConfirmationTaskPort,
  ControlledEndpointProfile,
  CapabilityActivationEvidence,
  DouyinAdapterPort,
  DouyinCapability,
  DouyinPublishAnchor,
  DouyinPublishConfirmation,
  DouyinPublishJob,
  DouyinObserveState,
  DouyinPublishStatusEvent,
  DouyinOAuthRefreshOperation,
  ExternalActionIntent,
  FeishuMcpAdapterPort,
  FeishuToolRevision,
  FeishuToolShortcut,
  IntegrationConnection,
  IntegrationContext,
  IntegrationAnomalyTaskPort,
  PublishContentSnapshotPort,
  SecretContext,
  SecretStorePort,
  StrictByokExecutionPort,
  StrictByokLedgerPort,
  StrictByokSubmissionResult,
  SubmitStrictByokInput,
} from './contracts.js';
import { IntegrationError } from './contracts.js';
import {
  vendorFeishuTool,
  type FeishuToolLifecycleSummary,
} from './feishu-tool-lifecycle.js';
import type { IntegrationRepository } from './repository.js';
import type {
  ProviderConnectivityProbePort,
  ProviderCredentialSlot,
} from './provider-connectivity.js';

const DOUYIN_PUBLISH_POLL_LIMIT = 12;
const DOUYIN_PUBLISH_POLL_DEADLINE_MS = 6 * 60 * 60 * 1000;
const DOUYIN_PUBLISH_POLL_BASE_MS = 60 * 1000;
const DOUYIN_PUBLISH_POLL_MAX_DELAY_MS = 15 * 60 * 1000;
const FEISHU_RECONCILIATION_BASE_MS = 5 * 60 * 1000;
const FEISHU_RECONCILIATION_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

interface DouyinAuthorizationEvent {
  connectionId: string;
  eventId: string;
  type:
    | 'authorize'
    | 'unauthorize'
    | 'contract_authorize'
    | 'contract_unauthorize';
  capability?: DouyinCapability;
  evidence?: CapabilityActivationEvidence;
}

interface StoredFeishuIntentResult {
  status: string;
  confirmationTaskId?: string;
  content?: string;
  output?: Record<string, unknown>;
  intent: ExternalActionIntent;
}

export class IntegrationApplicationService {
  constructor(
    private readonly dependencies: {
      repository: IntegrationRepository;
      secrets: SecretStorePort;
      byok?: StrictByokExecutionPort;
      byokExecutionMode?: 'recorded' | 'live';
      byokLedger?: StrictByokLedgerPort;
      endpointProfiles?: ControlledEndpointProfile[];
      douyin?: DouyinAdapterPort;
      contentSnapshots?: PublishContentSnapshotPort;
      feishu?: FeishuMcpAdapterPort;
      confirmationTasks?: ConfirmationTaskPort;
      anomalyTasks?: IntegrationAnomalyTaskPort;
      providerConnectivity?: ProviderConnectivityProbePort;
    }
  ) {}

  attachConfirmationTaskPort(port: ConfirmationTaskPort) {
    if (this.dependencies.confirmationTasks) {
      throw new IntegrationError(
        'CONFIRMATION_TASK_PORT_ALREADY_ATTACHED',
        'Confirmation task adapter is already attached.',
        409
      );
    }
    this.dependencies.confirmationTasks = port;
  }

  attachAnomalyTaskPort(port: IntegrationAnomalyTaskPort) {
    if (this.dependencies.anomalyTasks) {
      throw new IntegrationError(
        'ANOMALY_TASK_PORT_ALREADY_ATTACHED',
        'Integration anomaly task adapter is already attached.',
        409
      );
    }
    this.dependencies.anomalyTasks = port;
  }

  private anomalyStatus(connection: IntegrationConnection) {
    if (
      connection.status === 'reauthorize_required' ||
      connection.status === 'rate_limited' ||
      connection.status === 'revoked'
    ) {
      return connection.status;
    }
    if (
      connection.status === 'degraded' &&
      (Object.values(connection.degradedCapabilities).length === 0 ||
        Object.values(connection.degradedCapabilities).some(
          (reason) => reason !== 'disabled_by_owner'
        ))
    ) {
      return 'degraded' as const;
    }
    return undefined;
  }

  private async saveConnection(
    context: Pick<
      IntegrationContext,
      'workspaceId' | 'userId' | 'correlationId'
    >,
    connection: IntegrationConnection,
    reason?: string,
    expected?: { credentialVersion: number; updatedAt: string }
  ) {
    if (connection.credentialTransition) {
      throw new IntegrationError(
        'CREDENTIAL_TRANSITION_IN_PROGRESS',
        'The connection credential is being changed.',
        409
      );
    }
    if (expected) {
      connection.updatedAt = this.nextConnectionUpdatedAt(
        Date.parse(connection.updatedAt) > Date.parse(expected.updatedAt)
          ? connection.updatedAt
          : expected.updatedAt
      );
      const saved =
        await this.dependencies.repository.compareAndSwapConnection(
          connection,
          expected
        );
      if (!saved) {
        throw new IntegrationError(
          'CONNECTION_WRITE_CONFLICT',
          'The connection changed while the operation was in progress.',
          409
        );
      }
    } else {
      await this.dependencies.repository.saveConnection(connection);
    }
    await this.syncConnectionAnomaly(context, connection, reason);
  }

  private async syncConnectionAnomaly(
    context: Pick<
      IntegrationContext,
      'workspaceId' | 'userId' | 'correlationId'
    >,
    connection: IntegrationConnection,
    reason?: string
  ) {
    if (!this.dependencies.anomalyTasks) return;
    const status = this.anomalyStatus(connection);
    if (status) {
      const degradedReason = Object.values(
        connection.degradedCapabilities
      ).join(', ');
      await this.dependencies.anomalyTasks.report({
        connectionId: connection.id,
        correlationId: context.correlationId,
        provider: connection.provider,
        reason: (reason ?? degradedReason) || status,
        status,
        userId: context.userId,
        workspaceId: context.workspaceId,
      });
      return;
    }
    await this.dependencies.anomalyTasks.resolve({
      connectionId: connection.id,
      correlationId: context.correlationId,
      userId: context.userId,
      workspaceId: context.workspaceId,
    });
  }

  private requireOwner(context: IntegrationContext) {
    if (
      context.role !== 'owner' &&
      !(context.role === 'admin' && context.workspaceId === '__global__')
    ) {
      throw new IntegrationError(
        'FORBIDDEN',
        'Only the workspace owner or platform admin may manage connections.',
        403
      );
    }
  }

  private requireOwnerOrAdmin(context: IntegrationContext) {
    if (context.role !== 'owner' && context.role !== 'admin') {
      throw new IntegrationError(
        'FORBIDDEN',
        'Only the workspace owner or platform admin may inspect integration status.',
        403,
      );
    }
  }

  private requireAdmin(context: IntegrationContext) {
    if (context.role !== 'admin') {
      throw new IntegrationError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
  }

  private requireContentSnapshots() {
    if (!this.dependencies.contentSnapshots) {
      throw new IntegrationError(
        'CONTENT_SNAPSHOT_PORT_MISSING',
        'The Product content snapshot source is unavailable.',
        503
      );
    }
    return this.dependencies.contentSnapshots;
  }

  private requireUsableCredential(
    connection: IntegrationConnection,
    options: { allowUnverified?: boolean; capability?: string } = {}
  ) {
    if (connection.credentialTransition) {
      throw new IntegrationError(
        'CONNECTION_UNAVAILABLE',
        'The connection credential is being changed.',
        409
      );
    }
    const expiresAt = connection.credential.expiresAt
      ? Date.parse(connection.credential.expiresAt)
      : undefined;
    if (
      connection.status === 'revoked' ||
      connection.status === 'disabled' ||
      connection.status === 'reauthorize_required' ||
      connection.credential.status === 'revoked' ||
      connection.credential.status === 'expired' ||
      (expiresAt !== undefined &&
        (!Number.isFinite(expiresAt) || expiresAt <= Date.now()))
    ) {
      throw new IntegrationError(
        'CONNECTION_UNAVAILABLE',
        'The connection credential is unavailable.',
        409
      );
    }
    if (
      !options.allowUnverified &&
      connection.credential.status !== 'active'
    ) {
      throw new IntegrationError(
        'CREDENTIAL_UNVERIFIED',
        'The connection credential has not been verified.',
        409
      );
    }
    if (
      options.capability &&
      (!connection.grantedCapabilities.includes(options.capability) ||
        !connection.capabilityEvidence[options.capability] ||
        connection.degradedCapabilities[options.capability])
    ) {
      throw new IntegrationError(
        'CAPABILITY_UNAVAILABLE',
        `The ${options.capability} capability is unavailable.`,
        409
      );
    }
  }

  private requireRefreshableCredential(connection: IntegrationConnection) {
    if (
      connection.credentialTransition ||
      connection.status === 'revoked' ||
      connection.status === 'disabled' ||
      connection.status === 'reauthorize_required' ||
      connection.credential.status === 'revoked' ||
      connection.credential.status === 'unverified'
    ) {
      throw new IntegrationError(
        'CONNECTION_UNAVAILABLE',
        'The OAuth credential cannot be refreshed.',
        409
      );
    }
  }

  async createConnection(
    context: IntegrationContext,
    input: CreateConnectionInput,
    idempotencyKey: string
  ) {
    this.requireOwner(context);
    const payload = this.hash({
      command: 'connection.create',
      ...input,
      credential: {
        ...input.credential,
        value: undefined,
        valueHash: this.hash(input.credential.value),
      },
    });
    const replay =
      await this.dependencies.repository.getIdempotent<IntegrationConnection>(
        context.workspaceId,
        idempotencyKey,
        payload
      );
    if (replay && !replay.matches) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency payload changed.',
        409
      );
    }
    if (replay) return replay.value;

    const operationId = `connection-create:${this.hash({
      idempotencyKey,
      workspaceId: context.workspaceId,
    })}`;
    const existingOperation =
      await this.dependencies.repository.getConnectionCreate(
        context.workspaceId,
        operationId
      );
    if (existingOperation) {
      if (
        existingOperation.payloadHash !== payload ||
        existingOperation.connectionId !== input.id
      ) {
        throw new IntegrationError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency payload changed.',
          409
        );
      }
      return this.resumeConnectionCreate(
        context,
        existingOperation,
        input.credential.value,
        idempotencyKey
      );
    }

    if (
      await this.dependencies.repository.getConnection(
        context.workspaceId,
        input.id
      )
    ) {
      throw new IntegrationError(
        'CONNECTION_ALREADY_EXISTS',
        'A connection with this identifier already exists.',
        409
      );
    }

    const now = new Date().toISOString();
    const credentialId = `${input.id}:credential`;
    const secretContext: SecretContext = {
      workspaceId: context.workspaceId,
      credentialId,
      version: 1,
      provider: input.provider,
    };
    const connection: IntegrationConnection = {
      id: input.id,
      workspaceId: context.workspaceId,
      provider: input.provider,
      identityMode: input.identityMode,
      requestedCapabilities: [...input.requestedCapabilities],
      grantedCapabilities: [...input.grantedCapabilities],
      degradedCapabilities: {},
      capabilityEvidence: {},
      status: 'available',
      subject: input.subject,
      secretRef: this.dependencies.secrets.reference(secretContext),
      credential: {
        id: credentialId,
        version: 1,
        mask: '••••••••',
        scope: [...input.credential.scope],
        expiresAt: input.credential.expiresAt,
        refreshExpiresAt: input.credential.refreshExpiresAt,
        status: input.credential.status ?? 'active',
      },
      createdAt: now,
      updatedAt: now,
    };
    const claimed = await this.dependencies.repository.claimConnectionCreate({
      id: operationId,
      workspaceId: context.workspaceId,
      connectionId: input.id,
      payloadHash: payload,
      phase: 'claimed',
      connection,
      createdAt: now,
      updatedAt: now,
    });
    if (
      claimed.operation.id !== operationId ||
      claimed.operation.payloadHash !== payload
    ) {
      throw new IntegrationError(
        'CONNECTION_CREATE_IN_PROGRESS',
        'This connection is already being created.',
        409
      );
    }
    return this.resumeConnectionCreate(
      context,
      claimed.operation,
      input.credential.value,
      idempotencyKey
    );
  }

  private async resumeConnectionCreate(
    context: IntegrationContext,
    initialOperation: ConnectionCreateOperation,
    credentialValue: string,
    idempotencyKey: string
  ) {
    if (initialOperation.phase === 'completed') {
      return structuredClone(initialOperation.connection);
    }
    let operation = initialOperation;
    const secretContext: SecretContext = {
      workspaceId: operation.workspaceId,
      credentialId: operation.connection.credential.id,
      version: 1,
      provider: operation.connection.provider,
    };
    try {
      const secretRef = await this.dependencies.secrets.put(
        secretContext,
        credentialValue
      );
      if (secretRef !== operation.connection.secretRef) {
        throw new IntegrationError(
          'SECRET_REF_INVALID',
          'Secret storage returned an unexpected reference.',
          500
        );
      }
      operation =
        await this.dependencies.repository.advanceConnectionCreate({
          ...operation,
          phase: 'secret_stored',
          updatedAt: new Date().toISOString(),
        });

      const persisted =
        await this.dependencies.repository.createConnectionIfAbsent(
          operation.connection
        );
      if (
        !this.connectionBelongsToCreateOperation(
          persisted.connection,
          operation.connection
        )
      ) {
        throw new IntegrationError(
          'CONNECTION_ALREADY_EXISTS',
          'A connection with this identifier already exists.',
          409
        );
      }
      const connection = persisted.connection;
      await this.dependencies.repository.appendAudit({
        id: `${operation.id}:connection-created`,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        connectionId: connection.id,
        action: 'connection.created',
        correlationId: context.correlationId,
        details: {
          provider: connection.provider,
          credentialVersion: connection.credential.version,
          grantedCapabilities: connection.grantedCapabilities,
        },
        createdAt: operation.createdAt,
      });
      await this.dependencies.repository.saveIdempotent(
        context.workspaceId,
        idempotencyKey,
        operation.payloadHash,
        connection
      );
      operation =
        await this.dependencies.repository.advanceConnectionCreate({
          ...operation,
          phase: 'completed',
          connection,
          updatedAt: new Date().toISOString(),
        });
      return structuredClone(operation.connection);
    } catch (error) {
      await this.cleanupUnboundConnectionCreateSecret(operation, secretContext);
      throw error;
    }
  }

  private connectionBelongsToCreateOperation(
    connection: IntegrationConnection,
    expected: IntegrationConnection
  ) {
    return (
      connection.workspaceId === expected.workspaceId &&
      connection.id === expected.id &&
      connection.provider === expected.provider &&
      connection.identityMode === expected.identityMode &&
      connection.credential.id === expected.credential.id &&
      connection.createdAt === expected.createdAt
    );
  }

  private async cleanupUnboundConnectionCreateSecret(
    operation: ConnectionCreateOperation,
    secretContext: SecretContext
  ) {
    let current: IntegrationConnection | undefined;
    try {
      current = await this.dependencies.repository.getConnection(
        operation.workspaceId,
        operation.connectionId
      );
    } catch {
      return;
    }
    if (current) return;
    try {
      await this.dependencies.secrets.revoke(
        operation.connection.secretRef,
        secretContext
      );
    } catch {
      // The durable operation keeps ownership of this deterministic reference
      // so a later retry can overwrite or revoke it safely.
    }
  }

  async getConnection(context: IntegrationContext, id: string) {
    const connection = await this.dependencies.repository.getConnection(
      context.workspaceId,
      id
    );
    if (!connection)
      throw new IntegrationError('NOT_FOUND', 'Connection was not found.', 404);
    return connection;
  }

  async listConnections(context: IntegrationContext) {
    this.requireOwner(context);
    const at = new Date().toISOString();
    return (
      await this.dependencies.repository.listConnections(context.workspaceId)
    ).map((connection) =>
      connection.provider === 'douyin'
        ? {
            ...connection,
            refreshReauthorizationReminder:
              this.refreshReauthorizationReminder(connection, at),
          }
        : connection
    );
  }

  async testProviderConnection(
    context: IntegrationContext,
    connectionId: string,
  ) {
    this.requireOwner(context);
    const probe = this.dependencies.providerConnectivity;
    if (!probe) {
      throw new IntegrationError(
        'PROVIDER_CONNECTIVITY_PROBE_MISSING',
        'Provider connectivity testing is unavailable.',
        503,
      );
    }
    const connection = await this.getConnection(context, connectionId);
    this.requireUsableCredential(connection, { allowUnverified: true });
    const slot = connection.subject;
    if (
      slot !== 'model.direct' &&
      slot !== 'ark.media' &&
      slot !== 'douyin.platform'
    ) {
      throw new IntegrationError(
        'INVALID_PROVIDER_CREDENTIAL_SLOT',
        'The connection is not a platform provider credential.',
        400,
      );
    }
    const credential =
      slot === 'douyin.platform'
        ? ''
        : await this.dependencies.secrets.use(connection.secretRef, {
            workspaceId: connection.workspaceId,
            credentialId: connection.credential.id,
            version: connection.credential.version,
            provider: connection.provider,
          });
    const result = await probe.probe({
      credential,
      slot: slot satisfies ProviderCredentialSlot,
    });
    const testedAt = new Date().toISOString();
    const tested = structuredClone(connection);
    tested.credential.testedAt = testedAt;
    tested.credential.testStatus = result.status;
    tested.credential.testErrorCode = result.errorCode;
    tested.updatedAt = this.nextConnectionUpdatedAt(connection.updatedAt);
    await this.saveConnection(context, tested, undefined, {
      credentialVersion: connection.credential.version,
      updatedAt: connection.updatedAt,
    });
    await this.dependencies.repository.appendAudit({
      id: `provider-connectivity:${connection.id}:${this.hash({
        testedAt,
        result,
      })}`,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      connectionId: connection.id,
      action: 'provider.connection_tested',
      correlationId: context.correlationId,
      details: {
        credentialVersion: connection.credential.version,
        errorCode: result.errorCode,
        status: result.status,
      },
      createdAt: testedAt,
    });
    return structuredClone(tested);
  }

  async rotateConnectionCredential(
    context: IntegrationContext,
    connectionId: string,
    credential: CreateConnectionInput['credential'],
    idempotencyKey: string
  ) {
    this.requireOwner(context);
    if (
      await this.dependencies.repository.getActiveDouyinOAuthRefresh(
        context.workspaceId,
        connectionId
      )
    ) {
      throw new IntegrationError(
        'OAUTH_REFRESH_IN_PROGRESS',
        'OAuth refresh must finish before a manual credential rotation.',
        409
      );
    }
    return this.executeConnectionCredentialRotation(
      context,
      connectionId,
      credential,
      idempotencyKey
    );
  }

  private async executeConnectionCredentialRotation(
    context: IntegrationContext,
    connectionId: string,
    credential: CreateConnectionInput['credential'],
    idempotencyKey: string
  ) {
    const payload = this.hash({
      command: 'connection.rotate_credential',
      connectionId,
      credential: {
        ...credential,
        value: undefined,
        valueHash: this.hash(credential.value),
      },
    });
    const operationId = this.hash({
      command: 'connection.rotate_credential',
      connectionId,
      idempotencyKey,
      workspaceId: context.workspaceId,
    });
    const replay =
      await this.dependencies.repository.getIdempotent<IntegrationConnection>(
        context.workspaceId,
        idempotencyKey,
        payload
      );
    if (replay && !replay.matches) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency payload changed.',
        409
      );
    }

    let connection = await this.getConnection(context, connectionId);
    if (replay && !connection.credentialTransition) {
      if (
        connection.credential.version !== replay.value.credential.version ||
        connection.secretRef !== replay.value.secretRef ||
        connection.status !== replay.value.status ||
        connection.credential.status !== replay.value.credential.status
      ) {
        return structuredClone(replay.value);
      }
      await this.syncConnectionAnomaly(context, connection);
      return structuredClone(connection);
    }

    if (!connection.credentialTransition) {
      const staged = structuredClone(connection);
      staged.status = 'disabled';
      staged.credentialTransition = {
        kind: 'rotate',
        phase: 'staged',
        operationId,
        payloadHash: payload,
        previousSecretRef: connection.secretRef,
        previousVersion: connection.credential.version,
        targetVersion: connection.credential.version + 1,
        finalCredentialStatus: credential.status ?? 'active',
      };
      staged.updatedAt = this.nextConnectionUpdatedAt(connection.updatedAt);
      let stagedSaved = false;
      let stagingError: unknown;
      try {
        stagedSaved =
          await this.dependencies.repository.compareAndSwapConnection(staged, {
            credentialVersion: connection.credential.version,
            updatedAt: connection.updatedAt,
          });
      } catch (error) {
        stagingError = error;
      }
      if (stagedSaved) {
        connection = staged;
      } else {
        const observed = await this.getConnection(context, connectionId);
        if (
          observed.credentialTransition?.kind !== 'rotate' ||
          observed.credentialTransition.payloadHash !== payload ||
          observed.credentialTransition.operationId !== operationId
        ) {
          if (stagingError) throw stagingError;
          throw new IntegrationError(
            'CREDENTIAL_VERSION_CONFLICT',
            'Another credential change won the connection version.',
            409
          );
        }
        connection = observed;
      }
    }

    const transition = connection.credentialTransition;
    if (
      transition?.kind !== 'rotate' ||
      transition.payloadHash !== payload ||
      transition.operationId !== operationId
    ) {
      throw new IntegrationError(
        'CREDENTIAL_TRANSITION_IN_PROGRESS',
        'Another credential change is already in progress.',
        409
      );
    }

    if (transition.phase === 'staged') {
      const nextContext: SecretContext = {
        workspaceId: connection.workspaceId,
        credentialId: connection.credential.id,
        version: transition.targetVersion,
        provider: connection.provider,
      };
      const expectedNextRef = this.dependencies.secrets.reference(nextContext);
      let nextRef: string;
      try {
        nextRef = await this.dependencies.secrets.put(
          nextContext,
          credential.value
        );
      } catch (error) {
        try {
          await this.dependencies.secrets.revoke(expectedNextRef, nextContext);
        } catch {
          // The staged DB state keeps the connection unavailable for retry.
        }
        throw error;
      }
      if (nextRef !== expectedNextRef) {
        await this.dependencies.secrets.revoke(nextRef, nextContext);
        throw new IntegrationError(
          'SECRET_REF_MISMATCH',
          'The secret store returned a non-canonical reference.',
          500
        );
      }

      const switched = structuredClone(connection);
      switched.secretRef = nextRef;
      switched.credential = {
        ...switched.credential,
        version: transition.targetVersion,
        scope: [...credential.scope],
        expiresAt: credential.expiresAt,
        refreshExpiresAt: credential.refreshExpiresAt,
        lastUsedAt: undefined,
        testedAt: undefined,
        testStatus: undefined,
        testErrorCode: undefined,
        status: 'unverified',
      };
      switched.credentialTransition = {
        ...transition,
        phase: 'old_secret_revoke_pending',
      };
      switched.updatedAt = this.nextConnectionUpdatedAt(connection.updatedAt);

      let switchedSaved = false;
      let switchError: unknown;
      try {
        switchedSaved =
          await this.dependencies.repository.compareAndSwapConnection(
            switched,
            {
              credentialVersion: transition.previousVersion,
              updatedAt: connection.updatedAt,
            }
          );
      } catch (error) {
        switchError = error;
      }
      if (switchedSaved) {
        connection = switched;
      } else {
        const observed = await this.getConnection(context, connectionId);
        const observedTransition = observed.credentialTransition;
        if (
          observedTransition?.kind === 'rotate' &&
          observedTransition.payloadHash === payload &&
          observedTransition.operationId === operationId &&
          observedTransition.phase === 'old_secret_revoke_pending' &&
          observed.secretRef === nextRef &&
          observed.credential.version === transition.targetVersion
        ) {
          connection = observed;
        } else if (
          !observedTransition &&
          observed.secretRef === nextRef &&
          observed.credential.version === transition.targetVersion
        ) {
          await this.dependencies.repository.saveIdempotent(
            context.workspaceId,
            idempotencyKey,
            payload,
            observed
          );
          await this.syncConnectionAnomaly(context, observed);
          return structuredClone(observed);
        } else {
          await this.dependencies.secrets.revoke(nextRef, nextContext);
          if (switchError) throw switchError;
          throw new IntegrationError(
            'CREDENTIAL_VERSION_CONFLICT',
            'Another credential change won the connection version.',
            409
          );
        }
      }
    }

    const pending = connection.credentialTransition;
    if (
      pending?.kind !== 'rotate' ||
      pending.phase !== 'old_secret_revoke_pending' ||
      pending.payloadHash !== payload ||
      pending.operationId !== operationId
    ) {
      throw new IntegrationError(
        'CREDENTIAL_TRANSITION_IN_PROGRESS',
        'The credential rotation cannot be resumed from its current state.',
        409
      );
    }
    await this.dependencies.secrets.revoke(pending.previousSecretRef, {
      workspaceId: connection.workspaceId,
      credentialId: connection.credential.id,
      version: pending.previousVersion,
      provider: connection.provider,
    });

    const finalized = structuredClone(connection);
    delete finalized.credentialTransition;
    finalized.status = 'available';
    finalized.credential.status = pending.finalCredentialStatus;
    finalized.updatedAt = this.nextConnectionUpdatedAt(connection.updatedAt);
    await this.dependencies.repository.appendAudit({
      id: `${pending.operationId}:credential-rotated:${pending.targetVersion}`,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      connectionId,
      action: 'credential.rotated',
      correlationId: context.correlationId,
      details: {
        provider: finalized.provider,
        previousVersion: pending.previousVersion,
        credentialVersion: pending.targetVersion,
        scope: finalized.credential.scope,
      },
      createdAt: finalized.updatedAt,
    });
    await this.dependencies.repository.saveIdempotent(
      context.workspaceId,
      idempotencyKey,
      payload,
      finalized
    );
    let finalizedSaved = false;
    let finalizationError: unknown;
    try {
      finalizedSaved =
        await this.dependencies.repository.compareAndSwapConnection(finalized, {
          credentialVersion: connection.credential.version,
          updatedAt: connection.updatedAt,
        });
    } catch (error) {
      finalizationError = error;
    }
    if (!finalizedSaved) {
      const observed = await this.getConnection(context, connectionId);
      if (
        observed.credentialTransition ||
        observed.secretRef !== finalized.secretRef ||
        observed.credential.version !== finalized.credential.version ||
        observed.status !== finalized.status ||
        observed.credential.status !== finalized.credential.status
      ) {
        if (finalizationError) throw finalizationError;
        throw new IntegrationError(
          'CREDENTIAL_VERSION_CONFLICT',
          'The rotated credential could not be activated.',
          409
        );
      }
      connection = observed;
    } else {
      connection = finalized;
    }
    await this.syncConnectionAnomaly(context, connection);
    return structuredClone(connection);
  }

  async disconnectConnection(
    context: IntegrationContext,
    connectionId: string,
    idempotencyKey: string
  ) {
    this.requireOwner(context);
    const payload = this.hash({
      command: 'connection.disconnect',
      connectionId,
    });
    const replay =
      await this.dependencies.repository.getIdempotent<IntegrationConnection>(
        context.workspaceId,
        idempotencyKey,
        payload
      );
    if (replay && !replay.matches) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency payload changed.',
        409
      );
    }

    let connection = await this.getConnection(context, connectionId);
    if (replay && !connection.credentialTransition) {
      if (
        connection.status !== 'revoked' ||
        connection.credential.version !== replay.value.credential.version ||
        connection.secretRef !== replay.value.secretRef
      ) {
        return structuredClone(replay.value);
      }
      await this.syncConnectionAnomaly(
        context,
        connection,
        'connection_revoked'
      );
      return structuredClone(connection);
    }
    if (
      connection.credentialTransition &&
      connection.credentialTransition.kind !== 'disconnect'
    ) {
      throw new IntegrationError(
        'CREDENTIAL_TRANSITION_IN_PROGRESS',
        'A credential rotation must finish before disconnecting.',
        409
      );
    }
    if (!connection.credentialTransition && connection.status === 'revoked') {
      await this.dependencies.repository.saveIdempotent(
        context.workspaceId,
        idempotencyKey,
        payload,
        connection
      );
      await this.syncConnectionAnomaly(
        context,
        connection,
        'connection_revoked'
      );
      return structuredClone(connection);
    }

    if (!connection.credentialTransition) {
      const staged = structuredClone(connection);
      staged.status = 'revoked';
      staged.credential.status = 'revoked';
      staged.grantedCapabilities = [];
      staged.credentialTransition = {
        kind: 'disconnect',
        phase: 'secret_revoke_pending',
        operationId: this.hash({
          command: 'connection.disconnect',
          connectionId,
          idempotencyKey,
          workspaceId: context.workspaceId,
        }),
        payloadHash: payload,
        previousSecretRef: connection.secretRef,
        previousVersion: connection.credential.version,
      };
      staged.updatedAt = this.nextConnectionUpdatedAt(connection.updatedAt);
      let stagedSaved = false;
      let stagingError: unknown;
      try {
        stagedSaved =
          await this.dependencies.repository.compareAndSwapConnection(staged, {
            credentialVersion: connection.credential.version,
            updatedAt: connection.updatedAt,
          });
      } catch (error) {
        stagingError = error;
      }
      if (stagedSaved) {
        connection = staged;
      } else {
        const observed = await this.getConnection(context, connectionId);
        if (observed.credentialTransition?.kind !== 'disconnect') {
          if (stagingError) throw stagingError;
          throw new IntegrationError(
            'CREDENTIAL_VERSION_CONFLICT',
            'Another credential change won the connection version.',
            409
          );
        }
        connection = observed;
      }
    }

    const pending = connection.credentialTransition;
    if (pending?.kind !== 'disconnect') {
      throw new IntegrationError(
        'CREDENTIAL_TRANSITION_IN_PROGRESS',
        'The disconnect cannot be resumed from its current state.',
        409
      );
    }
    await this.syncConnectionAnomaly(
      context,
      connection,
      'connection_revoked'
    );
    await this.dependencies.secrets.revoke(pending.previousSecretRef, {
      workspaceId: connection.workspaceId,
      credentialId: connection.credential.id,
      version: pending.previousVersion,
      provider: connection.provider,
    });
    if (connection.provider === 'douyin') {
      await this.dependencies.repository.clearDouyinObserveSnapshots(
        context.workspaceId,
        connectionId
      );
    }
    const finalized = structuredClone(connection);
    delete finalized.credentialTransition;
    finalized.updatedAt = this.nextConnectionUpdatedAt(connection.updatedAt);
    await this.dependencies.repository.appendAudit({
      id: `${pending.operationId}:connection-disconnected`,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      connectionId,
      action: 'connection.disconnected',
      correlationId: context.correlationId,
      details: {
        provider: finalized.provider,
        credentialVersion: finalized.credential.version,
      },
      createdAt: finalized.updatedAt,
    });
    await this.dependencies.repository.saveIdempotent(
      context.workspaceId,
      idempotencyKey,
      payload,
      finalized
    );
    let finalizedSaved = false;
    let finalizationError: unknown;
    try {
      finalizedSaved =
        await this.dependencies.repository.compareAndSwapConnection(finalized, {
          credentialVersion: connection.credential.version,
          updatedAt: connection.updatedAt,
        });
    } catch (error) {
      finalizationError = error;
    }
    if (!finalizedSaved) {
      const observed = await this.getConnection(context, connectionId);
      if (
        observed.credentialTransition ||
        observed.status !== 'revoked' ||
        observed.credential.status !== 'revoked'
      ) {
        if (finalizationError) throw finalizationError;
        throw new IntegrationError(
          'CREDENTIAL_VERSION_CONFLICT',
          'The disconnected connection could not be finalized.',
          409
        );
      }
      connection = observed;
    } else {
      connection = finalized;
    }
    await this.syncConnectionAnomaly(
      context,
      connection,
      'connection_revoked'
    );
    return structuredClone(connection);
  }

  async listIntegrationAudit(context: IntegrationContext) {
    this.requireOwner(context);
    return this.dependencies.repository.listAudits(context.workspaceId);
  }

  getDouyinIntegrationStatus(context: IntegrationContext) {
    this.requireOwnerOrAdmin(context);
    const executionMode = this.dependencies.douyin?.executionMode ?? 'recorded';
    return {
      provider: 'douyin' as const,
      integrated: executionMode === 'live',
      executionMode,
    };
  }

  async submitStrictByok(
    context: IntegrationContext,
    input: SubmitStrictByokInput
  ): Promise<StrictByokSubmissionResult> {
    this.requireOwner(context);
    if (!input.prompt.trim()) {
      throw new IntegrationError('INVALID_PROMPT', 'Prompt is required.');
    }
    const payload = this.hash({ command: 'byok.submit', ...input });
    const replay =
      await this.dependencies.repository.getIdempotent<StrictByokSubmissionResult>(
        context.workspaceId,
        input.idempotencyKey,
        payload
      );
    if (replay && !replay.matches) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency payload changed.',
        409
      );
    }
    if (replay) return replay.value;
    const connection = await this.getConnection(context, input.connectionId);
    const connectionWrite = this.connectionWriteExpectation(connection);
    if (connection.identityMode !== 'byok' || connection.provider !== 'model') {
      throw new IntegrationError(
        'BYOK_REQUIRED',
        'A workspace BYOK connection is required.'
      );
    }
    this.requireUsableCredential(connection, { allowUnverified: true });
    const profile = this.dependencies.endpointProfiles?.find(
      (candidate) => candidate.id === input.endpointProfileId
    );
    if (!profile || !profile.permittedModels.includes(input.catalogModelId)) {
      throw new IntegrationError(
        'ENDPOINT_PROFILE_DENIED',
        'The controlled endpoint profile does not publish this model.',
        403
      );
    }
    if (!this.dependencies.byok || !this.dependencies.byokLedger) {
      throw new IntegrationError(
        'BYOK_ADAPTER_MISSING',
        'BYOK execution and Product Usage ledger adapters are required.',
        503
      );
    }
    const credential = await this.dependencies.secrets.use(
      connection.secretRef,
      {
        workspaceId: connection.workspaceId,
        credentialId: connection.credential.id,
        version: connection.credential.version,
        provider: connection.provider,
      }
    );
    const prepared = await this.dependencies.byokLedger.prepare({
      context,
      idempotencyKey: input.idempotencyKey,
      endpointProfileId: profile.id,
      catalogModelId: input.catalogModelId,
      credentialVersion: connection.credential.version,
      region: profile.region ?? 'global',
    });
    let completed: StrictByokSubmissionResult;
    if (prepared.decision === 'recovered') {
      completed = prepared.result;
    } else {
      let result: Awaited<ReturnType<StrictByokExecutionPort['execute']>>;
      try {
        result = await this.dependencies.byok.execute({
          endpoint: profile.endpoint,
          catalogModelId: input.catalogModelId,
          prompt: input.prompt,
          credential,
        });
      } catch {
        result = { status: 'failed' };
      }
      completed = await this.dependencies.byokLedger.settle({
        context,
        idempotencyKey: input.idempotencyKey,
        jobId: prepared.jobId,
        attemptId: prepared.attemptId,
        routeSnapshot: prepared.routeSnapshot,
        outcome: result,
      });
    }
    const timestamp = new Date().toISOString();
    connection.status =
      completed.status === 'completed'
        ? 'available'
        : completed.status === 'failed'
          ? 'permission_missing'
          : 'degraded';
    connection.credential.status =
      completed.status === 'failed'
        ? 'unverified'
        : completed.status === 'completed'
          ? 'active'
          : connection.credential.status;
    if (completed.status === 'completed') {
      connection.credential.lastUsedAt = timestamp;
    }
    connection.updatedAt = timestamp;
    await this.saveConnection(context, connection, undefined, connectionWrite);
    await this.dependencies.repository.appendAudit({
      id: `${context.correlationId}:byok:${this.hash(input.idempotencyKey).slice(0, 20)}`,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      connectionId: connection.id,
      action: `byok.${completed.status}`,
      correlationId: context.correlationId,
      details: {
        endpointProfileId: profile.id,
        catalogModelId: input.catalogModelId,
        credentialVersion: connection.credential.version,
        usageStatus: completed.usage.status,
        providerCostStatus: completed.providerCost.status,
      },
      createdAt: timestamp,
    });
    await this.dependencies.repository.saveIdempotent(
      context.workspaceId,
      input.idempotencyKey,
      payload,
      completed
    );
    return completed;
  }

  async getStrictByokOptions(context: IntegrationContext) {
    this.requireOwner(context);
    if (!this.dependencies.byokLedger) {
      throw new IntegrationError(
        'BYOK_LEDGER_MISSING',
        'Product Usage ledger is unavailable.',
        503
      );
    }
    return {
      executionMode: this.dependencies.byokExecutionMode ?? 'recorded',
      profiles: (this.dependencies.endpointProfiles ?? []).map((profile) => ({
        id: profile.id,
        apiFamily: profile.apiFamily,
        permittedModels: [...profile.permittedModels],
      })),
      usage: {
        resource: 'copy' as const,
        ...(await this.dependencies.byokLedger.getUsageProjection(context)),
      },
      billingNotice:
        '本次调用消耗产品文案额度；模型供应商费用由工作区 Key 对应账户另行结算。',
    };
  }

  async activateDouyinCapability(
    context: IntegrationContext,
    input: {
      connectionId: string;
      capability: DouyinCapability;
    }
  ) {
    this.requireOwner(context);
    const connection = await this.getConnection(context, input.connectionId);
    const connectionWrite = this.connectionWriteExpectation(connection);
    if (connection.provider !== 'douyin') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not a Douyin account.'
      );
    }
    if (!connection.grantedCapabilities.includes(input.capability)) {
      throw new IntegrationError(
        'CAPABILITY_NOT_GRANTED',
        `Douyin ${input.capability} has not been granted.`,
        403
      );
    }
    if (!connection.capabilityEvidence[input.capability]) {
      throw new IntegrationError(
        'CAPABILITY_EVIDENCE_MISSING',
        `Douyin ${input.capability} has no verified provider authorization evidence.`,
        409
      );
    }
    delete connection.degradedCapabilities[input.capability];
    connection.status = 'available';
    connection.updatedAt = new Date().toISOString();
    await this.saveConnection(context, connection, undefined, connectionWrite);
    return connection;
  }

  async deactivateDouyinCapability(
    context: IntegrationContext,
    input: {
      connectionId: string;
      capability: DouyinCapability;
    }
  ) {
    this.requireOwner(context);
    const connection = await this.getConnection(context, input.connectionId);
    const connectionWrite = this.connectionWriteExpectation(connection);
    if (connection.provider !== 'douyin') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not a Douyin account.'
      );
    }
    connection.degradedCapabilities[input.capability] = 'disabled_by_owner';
    connection.status = 'degraded';
    connection.updatedAt = new Date().toISOString();
    await this.saveConnection(context, connection, undefined, connectionWrite);
    await this.dependencies.repository.appendAudit({
      action: 'douyin.capability_deactivated',
      actorId: context.userId,
      connectionId: connection.id,
      correlationId: context.correlationId,
      createdAt: connection.updatedAt,
      details: { capability: input.capability },
      id: `${context.correlationId}:douyin:${input.capability}:deactivated`,
      workspaceId: context.workspaceId,
    });
    return connection;
  }

  async getDouyinConnectionProjection(
    context: IntegrationContext,
    connectionId: string,
    at = new Date().toISOString()
  ) {
    const connection = await this.getConnection(context, connectionId);
    if (connection.provider !== 'douyin') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not Douyin.'
      );
    }
    return {
      ...connection,
      refreshReauthorizationReminder: this.refreshReauthorizationReminder(
        connection,
        at
      ),
    };
  }

  async refreshDouyinOAuth(
    context: IntegrationContext,
    connectionId: string,
    idempotencyKey: string
  ) {
    this.requireOwner(context);
    return this.executeDouyinOAuthRefresh(
      context,
      connectionId,
      idempotencyKey
    );
  }

  async runDouyinOAuthLifecycle(
    context: IntegrationContext,
    connectionId: string,
    at = new Date().toISOString()
  ) {
    if (context.role !== 'owner' && context.role !== 'worker') {
      throw new IntegrationError(
        'FORBIDDEN',
        'Only a workspace owner or trusted worker may run OAuth lifecycle.',
        403
      );
    }
    const atTime = Date.parse(at);
    if (!Number.isFinite(atTime)) {
      throw new IntegrationError(
        'INVALID_TIMESTAMP',
        'OAuth lifecycle time must be a valid timestamp.'
      );
    }
    const active =
      await this.dependencies.repository.getActiveDouyinOAuthRefresh(
        context.workspaceId,
        connectionId
      );
    const connection = await this.getConnection(context, connectionId);
    if (connection.provider !== 'douyin') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not Douyin.'
      );
    }
    const expiresAt = connection.credential.expiresAt;
    const due =
      active ||
      (expiresAt !== undefined &&
        Number.isFinite(Date.parse(expiresAt)) &&
        Date.parse(expiresAt) <= atTime + 5 * 60 * 1000);
    if (!due) {
      return {
        connectionId,
        credentialVersion: connection.credential.version,
        expiresAt,
        status: 'not_due' as const,
      };
    }
    const sourceVersion =
      active?.sourceCredentialVersion ?? connection.credential.version;
    const refreshed = await this.executeDouyinOAuthRefresh(
      context,
      connectionId,
      this.douyinOAuthLifecycleKey(
        context.workspaceId,
        connectionId,
        sourceVersion
      )
    );
    return {
      connectionId,
      credentialVersion: refreshed.credential.version,
      expiresAt: refreshed.credential.expiresAt,
      status:
        refreshed.status === 'reauthorize_required'
          ? ('reauthorization_required' as const)
          : ('refreshed' as const),
    };
  }

  private async executeDouyinOAuthRefresh(
    context: IntegrationContext,
    connectionId: string,
    idempotencyKey: string
  ) {
    const payloadHash = this.hash({
      command: 'douyin.oauth_refresh',
      connectionId,
    });
    const operationId = this.hash({
      command: 'douyin.oauth_refresh.idempotency',
      idempotencyKey,
      workspaceId: context.workspaceId,
    });
    let operation = await this.dependencies.repository.getDouyinOAuthRefresh(
      context.workspaceId,
      operationId
    );

    if (!operation) {
      const connection = await this.getConnection(context, connectionId);
      if (
        connection.provider !== 'douyin' ||
        !connection.subject ||
        !this.dependencies.douyin
      ) {
        throw new IntegrationError(
          'DOUYIN_ADAPTER_MISSING',
          'Douyin OAuth is unavailable.',
          503
        );
      }
      this.requireRefreshableCredential(connection);
      const now = new Date().toISOString();
      operation = (
        await this.dependencies.repository.claimDouyinOAuthRefresh({
          connectionId,
          createdAt: now,
          effectIdempotencyKey: this.hash({
            command: 'douyin.oauth_refresh.effect',
            connectionId,
            idempotencyKey,
            workspaceId: context.workspaceId,
          }),
          id: operationId,
          payloadHash,
          phase: 'claimed',
          sourceCredentialId: connection.credential.id,
          sourceCredentialVersion: connection.credential.version,
          sourceSecretRef: connection.secretRef,
          subject: connection.subject,
          updatedAt: now,
          workspaceId: context.workspaceId,
        })
      ).operation;
    }

    if (operation.id !== operationId) {
      throw new IntegrationError(
        'OAUTH_REFRESH_IN_PROGRESS',
        'Another OAuth refresh is already in progress for this connection.',
        409
      );
    }
    if (
      operation.payloadHash !== payloadHash ||
      operation.connectionId !== connectionId
    ) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency payload changed.',
        409
      );
    }
    if (operation.phase === 'completed') {
      if (!operation.result) {
        throw new IntegrationError(
          'OAUTH_REFRESH_STATE_INVALID',
          'The OAuth refresh result is unavailable.',
          500
        );
      }
      return structuredClone(operation.result);
    }
    if (operation.phase === 'credential_stored') {
      return this.resumeDouyinOAuthRefresh(
        context,
        operation,
        idempotencyKey
      );
    }
    if (!this.dependencies.douyin) {
      throw new IntegrationError(
        'DOUYIN_ADAPTER_MISSING',
        'Douyin OAuth is unavailable.',
        503
      );
    }

    const connection = await this.getConnection(context, connectionId);
    if (
      connection.provider !== 'douyin' ||
      connection.subject !== operation.subject ||
      connection.credential.id !== operation.sourceCredentialId ||
      connection.credential.version !== operation.sourceCredentialVersion ||
      connection.secretRef !== operation.sourceSecretRef ||
      connection.credentialTransition
    ) {
      throw new IntegrationError(
        'OAUTH_REFRESH_SOURCE_CHANGED',
        'The OAuth credential changed after the refresh was claimed.',
        409
      );
    }
    this.requireRefreshableCredential(connection);
    const raw = await this.dependencies.secrets.use(
      operation.sourceSecretRef,
      {
        credentialId: operation.sourceCredentialId,
        provider: 'douyin',
        version: operation.sourceCredentialVersion,
        workspaceId: operation.workspaceId,
      }
    );
    const current = JSON.parse(raw) as { refreshToken?: string };
    if (!current.refreshToken) {
      throw new IntegrationError(
        'REFRESH_TOKEN_MISSING',
        'Douyin refresh token is missing.'
      );
    }
    const result = await this.dependencies.douyin.refreshOAuth({
      connectionId,
      effectIdempotencyKey: operation.effectIdempotencyKey,
      refreshToken: current.refreshToken,
      subject: operation.subject,
    });
    if (result.status !== 'ok') {
      const connectionWrite = this.connectionWriteExpectation(connection);
      connection.status =
        result.status === 'reauthorization_required'
          ? 'reauthorize_required'
          : 'degraded';
      connection.updatedAt = new Date().toISOString();
      let resultConnection = connection;
      try {
        await this.saveConnection(
          context,
          connection,
          result.status,
          connectionWrite
        );
      } catch (error) {
        if (
          !(error instanceof IntegrationError) ||
          error.code !== 'CONNECTION_WRITE_CONFLICT'
        ) {
          throw error;
        }
        resultConnection = await this.getConnection(context, connectionId);
      }
      const completed = await this.dependencies.repository.advanceDouyinOAuthRefresh({
        ...operation,
        phase: 'completed',
        providerErrorCode: result.errorCode,
        providerStatus: result.status,
        result: structuredClone(resultConnection),
        updatedAt: this.nextConnectionUpdatedAt(operation.updatedAt),
      });
      return structuredClone(completed.result ?? resultConnection);
    }

    const credentialValue = JSON.stringify({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    const targetVersion = operation.sourceCredentialVersion + 1;
    const targetContext: SecretContext = {
      credentialId: operation.sourceCredentialId,
      provider: 'douyin',
      version: targetVersion,
      workspaceId: operation.workspaceId,
    };
    const targetSecretRef = await this.dependencies.secrets.put(
      targetContext,
      credentialValue
    );
    const expectedTargetRef = this.dependencies.secrets.reference(targetContext);
    if (targetSecretRef !== expectedTargetRef) {
      await this.dependencies.secrets.revoke(targetSecretRef, targetContext);
      throw new IntegrationError(
        'SECRET_REF_MISMATCH',
        'The secret store returned a non-canonical reference.',
        500
      );
    }
    operation = await this.dependencies.repository.advanceDouyinOAuthRefresh({
      ...operation,
      phase: 'credential_stored',
      providerStatus: 'ok',
      target: {
        credentialVersion: targetVersion,
        expiresAt: result.accessExpiresAt,
        refreshExpiresAt: result.refreshExpiresAt,
        scope: [...result.scopes],
        secretRef: targetSecretRef,
        valueHash: this.hash(credentialValue),
      },
      updatedAt: this.nextConnectionUpdatedAt(operation.updatedAt),
    });
    if (operation.phase === 'completed') {
      return structuredClone(operation.result!);
    }
    return this.resumeDouyinOAuthRefresh(context, operation, idempotencyKey);
  }

  private async resumeDouyinOAuthRefresh(
    context: IntegrationContext,
    operation: DouyinOAuthRefreshOperation,
    idempotencyKey: string
  ) {
    const target = operation.target;
    if (!target) {
      throw new IntegrationError(
        'OAUTH_REFRESH_STATE_INVALID',
        'The stored OAuth credential metadata is unavailable.',
        500
      );
    }
    const targetContext: SecretContext = {
      credentialId: operation.sourceCredentialId,
      provider: 'douyin',
      version: target.credentialVersion,
      workspaceId: operation.workspaceId,
    };
    const credentialValue = await this.dependencies.secrets.use(
      target.secretRef,
      targetContext
    );
    if (this.hash(credentialValue) !== target.valueHash) {
      throw new IntegrationError(
        'SECRET_CONTEXT_MISMATCH',
        'The stored OAuth credential does not match its recovery metadata.',
        409
      );
    }
    const current = await this.getConnection(context, operation.connectionId);
    if (
      current.status === 'revoked' ||
      current.credential.status === 'revoked' ||
      current.credentialTransition?.kind === 'disconnect'
    ) {
      await this.dependencies.secrets.revoke(target.secretRef, targetContext);
      const completed =
        await this.dependencies.repository.advanceDouyinOAuthRefresh({
          ...operation,
          phase: 'completed',
          providerStatus: 'ok',
          result: structuredClone(current),
          updatedAt: this.nextConnectionUpdatedAt(operation.updatedAt),
        });
      return structuredClone(completed.result ?? current);
    }
    const rotated = await this.executeConnectionCredentialRotation(
      context,
      operation.connectionId,
      {
        expiresAt: target.expiresAt,
        refreshExpiresAt: target.refreshExpiresAt,
        scope: [...target.scope],
        value: credentialValue,
      },
      idempotencyKey
    );
    const completed = await this.dependencies.repository.advanceDouyinOAuthRefresh({
      ...operation,
      phase: 'completed',
      providerStatus: 'ok',
      result: structuredClone(rotated),
      updatedAt: this.nextConnectionUpdatedAt(operation.updatedAt),
    });
    return structuredClone(completed.result ?? rotated);
  }

  async handleDouyinAuthorizationEvent(
    context: IntegrationContext,
    event: DouyinAuthorizationEvent
  ) {
    this.requireOwner(context);
    const connection = await this.getConnection(context, event.connectionId);
    const connectionWrite = this.connectionWriteExpectation(connection);
    this.validateDouyinAuthorizationEvent(connection, event);
    if (
      !(await this.dependencies.repository.claimExternalEvent(
        context.workspaceId,
        'douyin',
        event.eventId
      ))
    ) {
      if (
        event.type === 'unauthorize' &&
        connection.credentialTransition?.kind === 'disconnect'
      ) {
        return this.disconnectConnection(
          context,
          event.connectionId,
          event.eventId
        );
      }
      return connection;
    }
    if (event.type === 'unauthorize') {
      return this.disconnectConnection(
        context,
        event.connectionId,
        event.eventId
      );
    }
    if (event.type === 'authorize' || event.type === 'contract_authorize') {
      connection.credential.status = 'active';
    }
    if (event.type === 'authorize') {
      connection.status = 'available';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(context, connection, undefined, connectionWrite);
    }
    if (event.type === 'contract_authorize' && event.capability) {
      if (!connection.grantedCapabilities.includes(event.capability)) {
        connection.grantedCapabilities.push(event.capability);
      }
      connection.capabilityEvidence[event.capability] = structuredClone(
        event.evidence!
      );
      connection.degradedCapabilities[event.capability] = 'disabled_by_owner';
      connection.status = 'degraded';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(context, connection, undefined, connectionWrite);
    }
    if (event.type === 'contract_unauthorize' && event.capability) {
      connection.grantedCapabilities = connection.grantedCapabilities.filter(
        (capability) => capability !== event.capability
      );
      delete connection.capabilityEvidence[event.capability];
      connection.degradedCapabilities[event.capability] =
        'authorization_revoked';
      connection.status = 'degraded';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(
        context,
        connection,
        `authorization_revoked:${event.capability}`,
        connectionWrite
      );
    }
    return connection;
  }

  private validateDouyinAuthorizationEvent(
    connection: IntegrationConnection,
    event: DouyinAuthorizationEvent
  ) {
    if (connection.provider !== 'douyin') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not a Douyin account.'
      );
    }
    if (
      typeof event.eventId !== 'string' ||
      event.eventId.trim().length === 0 ||
      event.eventId.length > 512 ||
      ![
        'authorize',
        'unauthorize',
        'contract_authorize',
        'contract_unauthorize',
      ].includes(event.type)
    ) {
      throw new IntegrationError(
        'EXTERNAL_EVENT_INVALID',
        'Douyin authorization event envelope is invalid.'
      );
    }
    const isContractEvent =
      event.type === 'contract_authorize' ||
      event.type === 'contract_unauthorize';
    if (isContractEvent && !event.capability) {
      throw new IntegrationError(
        'CAPABILITY_EVENT_INVALID',
        'A contract authorization event must identify its capability.'
      );
    }
    if (
      event.capability &&
      isContractEvent &&
      !connection.requestedCapabilities.includes(event.capability)
    ) {
      throw new IntegrationError(
        'CAPABILITY_NOT_REQUESTED',
        'The provider event refers to a capability that this connection did not request.',
        409
      );
    }
    if (event.type !== 'contract_authorize') return;
    const evidence = event.evidence;
    if (
      !evidence ||
      evidence.revision.trim().length === 0 ||
      !Number.isFinite(Date.parse(evidence.verifiedAt)) ||
      evidence.scopes.length === 0 ||
      evidence.scopes.some((scope) => scope.trim().length === 0)
    ) {
      throw new IntegrationError(
        'CAPABILITY_EVIDENCE_MISSING',
        'Valid provider authorization evidence is required for a capability grant.',
        409
      );
    }
  }

  async confirmDouyinPublish(
    context: IntegrationContext,
    input: {
      connectionId: string;
      contentSnapshotId: string;
      scheduledAt: string;
      accountSubject: string;
      anchor?: DouyinPublishAnchor;
    }
  ) {
    this.requireOwner(context);
    const connection = await this.getConnection(context, input.connectionId);
    if (
      connection.provider !== 'douyin' ||
      connection.subject !== input.accountSubject
    ) {
      throw new IntegrationError(
        'DOUYIN_ACCOUNT_MISMATCH',
        'The confirmed account does not match.'
      );
    }
    this.assertDouyinPublishAnchor(connection, input.anchor);
    const contentSnapshot = await this.requireContentSnapshots().resolve(
      context.workspaceId,
      input.contentSnapshotId
    );
    if (!contentSnapshot) {
      throw new IntegrationError(
        'CONTENT_SNAPSHOT_NOT_PUBLISHABLE',
        'The selected Product video snapshot is unavailable or no longer publishable.',
        409
      );
    }
    const confirmation: DouyinPublishConfirmation = {
      id: `douyin-confirmation:${this.hash({
        accountSubject: input.accountSubject,
        connectionId: input.connectionId,
        contentSnapshotId: contentSnapshot.id,
        contentSnapshotRevision: contentSnapshot.revision,
        anchor: input.anchor,
        scheduledAt: input.scheduledAt,
        workspaceId: context.workspaceId,
      })}`,
      workspaceId: context.workspaceId,
      connectionId: input.connectionId,
      accountSubject: input.accountSubject,
      contentSnapshotId: contentSnapshot.id,
      contentSnapshotRevision: contentSnapshot.revision,
      scheduledAt: input.scheduledAt,
      confirmedBy: context.userId,
      confirmedAt: new Date().toISOString(),
      ...(input.anchor ? { anchor: structuredClone(input.anchor) } : {}),
    };
    await this.dependencies.repository.saveDouyinConfirmation(confirmation);
    return structuredClone(confirmation);
  }

  async listDouyinContentSnapshots(context: IntegrationContext) {
    this.requireOwner(context);
    return structuredClone(
      await this.requireContentSnapshots().list(context.workspaceId)
    );
  }

  async submitDouyinPublish(
    context: IntegrationContext,
    input: {
      confirmationId: string;
      contentSnapshotId: string;
      scheduledAt: string;
      idempotencyKey: string;
    }
  ) {
    this.requireOwner(context);
    const confirmation =
      await this.dependencies.repository.getDouyinConfirmation(
        context.workspaceId,
        input.confirmationId
      );
    if (
      !confirmation ||
      confirmation.contentSnapshotId !== input.contentSnapshotId ||
      confirmation.scheduledAt !== input.scheduledAt
    ) {
      throw new IntegrationError(
        'PUBLISH_CONFIRMATION_INVALID',
        'Account, content snapshot, or schedule changed after confirmation.',
        409
      );
    }
    const currentSnapshot = await this.requireContentSnapshots().resolve(
      context.workspaceId,
      confirmation.contentSnapshotId
    );
    if (
      !currentSnapshot ||
      currentSnapshot.revision !== confirmation.contentSnapshotRevision
    ) {
      throw new IntegrationError(
        'PUBLISH_CONFIRMATION_INVALID',
        'The Product content snapshot changed or disappeared after confirmation.',
        409
      );
    }
    const payload = this.hash({
      command: 'douyin.publish',
      confirmationId: input.confirmationId,
      contentSnapshotId: input.contentSnapshotId,
      contentSnapshotRevision: confirmation.contentSnapshotRevision,
      anchor: confirmation.anchor,
      scheduledAt: input.scheduledAt,
    });
    const replay =
      await this.dependencies.repository.getIdempotent<DouyinPublishJob>(
        context.workspaceId,
        input.idempotencyKey,
        payload
      );
    if (replay && !replay.matches) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency payload changed.',
        409
      );
    }
    if (replay) return replay.value;
    const connection = await this.getConnection(
      context,
      confirmation.connectionId
    );
    if (
      connection.provider !== 'douyin' ||
      connection.subject !== confirmation.accountSubject
    ) {
      throw new IntegrationError(
        'PUBLISH_CONFIRMATION_INVALID',
        'The connected Douyin account changed after confirmation.',
        409
      );
    }
    this.requireUsableCredential(connection);
    const existingForConfirmation =
      await this.dependencies.repository.getDouyinPublishJob(
        context.workspaceId,
        `${confirmation.id}:publish`
      );
    const protectsExternalEffect =
      existingForConfirmation &&
      (existingForConfirmation.acceptance === 'accepted' ||
        existingForConfirmation.acceptance === 'acceptance_unknown' ||
        existingForConfirmation.status === 'submitting' ||
        existingForConfirmation.status === 'unknown');
    if (protectsExternalEffect) {
      const recovered = await this.recoverDouyinPublishClaim(
        existingForConfirmation
      );
      await this.dependencies.repository.saveIdempotent(
        context.workspaceId,
        input.idempotencyKey,
        payload,
        recovered
      );
      return recovered;
    }
    this.assertDouyinPublishAnchor(connection, confirmation.anchor);
    if (connection.degradedCapabilities.publish === 'disabled_by_owner') {
      const manual = this.manualDouyinJob(
        context,
        confirmation,
        'publish_disabled_by_owner'
      );
      await this.dependencies.repository.saveDouyinPublishJob(manual);
      await this.dependencies.repository.saveIdempotent(
        context.workspaceId,
        input.idempotencyKey,
        payload,
        manual
      );
      return manual;
    }
    const evidence = connection.capabilityEvidence.publish;
    if (
      !evidence ||
      !connection.grantedCapabilities.includes('publish') ||
      !evidence.scopes.includes('video.create.bind')
    ) {
      const manual = this.manualDouyinJob(
        context,
        confirmation,
        'publish_capability_unavailable'
      );
      await this.dependencies.repository.saveDouyinPublishJob(manual);
      await this.dependencies.repository.saveIdempotent(
        context.workspaceId,
        input.idempotencyKey,
        payload,
        manual
      );
      return manual;
    }
    if (!this.dependencies.douyin) {
      throw new IntegrationError(
        'DOUYIN_ADAPTER_MISSING',
        'Douyin adapter is unavailable.',
        503
      );
    }
    const credential = await this.dependencies.secrets.use(
      connection.secretRef,
      {
        workspaceId: connection.workspaceId,
        credentialId: connection.credential.id,
        version: connection.credential.version,
        provider: 'douyin',
      }
    );
    const now = new Date().toISOString();
    const claimedJob: DouyinPublishJob = {
      acceptance: 'acceptance_unknown',
      confirmationId: confirmation.id,
      connectionId: connection.id,
      createdAt: now,
      effectState: 'claimed',
      id: `${confirmation.id}:publish`,
      ...(confirmation.anchor
        ? { anchor: structuredClone(confirmation.anchor) }
        : {}),
      payloadHash: payload,
      status: 'submitting',
      updatedAt: now,
      workspaceId: context.workspaceId,
    };
    const claim =
      await this.dependencies.repository.claimDouyinPublishJob(claimedJob);
    if (!claim.claimed) {
      if (claim.job.payloadHash && claim.job.payloadHash !== payload) {
        throw new IntegrationError(
          'PUBLISH_CLAIM_CONFLICT',
          'The persisted publish claim belongs to another payload.',
          409
        );
      }
      return this.recoverDouyinPublishClaim(claim.job);
    }
    let result: Awaited<ReturnType<DouyinAdapterPort['submit']>>;
    try {
      result = await this.dependencies.douyin.submit({
        accountSubject: confirmation.accountSubject,
        connectionId: connection.id,
        contentSnapshotId: confirmation.contentSnapshotId,
        contentSnapshotRevision: confirmation.contentSnapshotRevision,
        credential,
        idempotencyKey: claimedJob.id,
        ...(confirmation.anchor
          ? { anchor: structuredClone(confirmation.anchor) }
          : {}),
        scheduledAt: confirmation.scheduledAt,
      });
    } catch {
      result = {
        acceptance: 'acceptance_unknown',
        errorCode: 'publish_transport_unknown',
        status: 'unknown',
      };
    }
    const status =
      result.acceptance === 'rejected_before_accept'
        ? 'manual_required'
        : result.status === 'rate_limited'
          ? 'submitted'
          : result.status;
    const job: DouyinPublishJob = this.updateDouyinPublishPolling(
      {
        ...claimedJob,
        status,
        itemId: result.itemId,
        videoId: result.videoId,
        acceptance: result.acceptance,
        effectState:
          result.acceptance === 'acceptance_unknown' ||
          result.status === 'unknown'
            ? 'reconciliation_required'
            : 'settled',
        ...(result.errorCode ? { lastErrorCode: result.errorCode } : {}),
        fallback:
          result.acceptance === 'rejected_before_accept'
            ? {
                kind: 'l3_handoff',
                contentSnapshotId: confirmation.contentSnapshotId,
                reason: result.errorCode ?? 'rejected_before_accept',
              }
            : undefined,
        updatedAt: now,
      },
      now,
      'submit'
    );
    const settlement =
      await this.dependencies.repository.settleDouyinPublishJob(
        job,
        'submitting'
      );
    const durableJob = settlement.job;
    await this.dependencies.repository.saveIdempotent(
      context.workspaceId,
      input.idempotencyKey,
      payload,
      durableJob
    );
    return structuredClone(durableJob);
  }

  private async recoverDouyinPublishClaim(job: DouyinPublishJob) {
    if (job.status !== 'submitting') return structuredClone(job);
    const recovered: DouyinPublishJob = {
      ...job,
      acceptance: 'acceptance_unknown',
      effectState: 'reconciliation_required',
      lastErrorCode: 'process_interrupted_after_effect_claim',
      status: 'unknown',
      updatedAt: new Date().toISOString(),
    };
    await this.dependencies.repository.saveDouyinPublishJob(recovered);
    return recovered;
  }

  private manualDouyinJob(
    context: IntegrationContext,
    confirmation: DouyinPublishConfirmation,
    reason: string
  ): DouyinPublishJob {
    const now = new Date().toISOString();
    return {
      id: `${confirmation.id}:manual`,
      workspaceId: context.workspaceId,
      connectionId: confirmation.connectionId,
      confirmationId: confirmation.id,
      status: 'manual_required',
      fallback: {
        kind: 'l3_handoff',
        contentSnapshotId: confirmation.contentSnapshotId,
        reason,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  private assertDouyinPublishAnchor(
    connection: IntegrationConnection,
    anchor?: DouyinPublishAnchor
  ) {
    if (!anchor) return;
    if (!anchor.id.trim()) {
      throw new IntegrationError(
        'PUBLISH_ANCHOR_INVALID',
        'The selected publish anchor is invalid.',
        400
      );
    }
    const capability: DouyinCapability =
      anchor.kind === 'poi' ? 'publish.poi' : 'publish.mini_program';
    const evidence = connection.capabilityEvidence[capability];
    if (
      !connection.grantedCapabilities.includes(capability) ||
      evidence?.qualified !== true ||
      connection.degradedCapabilities[capability]
    ) {
      throw new IntegrationError(
        'PUBLISH_ANCHOR_UNAVAILABLE',
        'The selected publish anchor is not granted and qualified for this account.',
        403
      );
    }
  }

  async refreshDouyinPublishStatus(context: IntegrationContext, jobId: string) {
    this.requireOwner(context);
    return this.inspectDouyinPublishStatus(
      context,
      jobId,
      new Date().toISOString(),
      'manual'
    );
  }

  async pollDouyinPublishStatus(
    context: IntegrationContext,
    jobId: string,
    at = new Date().toISOString()
  ) {
    if (context.role !== 'owner' && context.role !== 'worker') {
      throw new IntegrationError(
        'FORBIDDEN',
        'Only a workspace owner or trusted worker may poll Douyin publish status.',
        403
      );
    }
    if (!Number.isFinite(Date.parse(at))) {
      throw new IntegrationError('INVALID_TIMESTAMP', 'Publish polling time is invalid.');
    }
    const current = await this.dependencies.repository.getDouyinPublishJob(
      context.workspaceId,
      jobId
    );
    if (!current) {
      throw new IntegrationError(
        'PUBLISH_JOB_NOT_FOUND',
        'Publish job was not found.',
        404
      );
    }
    if (
      current.pollingState !== 'scheduled' ||
      !current.nextPollAt ||
      Date.parse(current.nextPollAt) > Date.parse(at)
    ) {
      return current;
    }
    if (
      (current.pollAttempts ?? 0) >=
        (current.pollLimit ?? DOUYIN_PUBLISH_POLL_LIMIT) ||
      (current.pollDeadlineAt &&
        Date.parse(current.pollDeadlineAt) <= Date.parse(at))
    ) {
      const exhausted = this.updateDouyinPublishPolling(current, at, 'poll');
      await this.dependencies.repository.saveDouyinPublishJob(exhausted);
      return exhausted;
    }
    return this.inspectDouyinPublishStatus(context, jobId, at, 'poll');
  }

  private async inspectDouyinPublishStatus(
    context: IntegrationContext,
    jobId: string,
    at: string,
    source: 'manual' | 'poll'
  ) {
    const job = await this.dependencies.repository.getDouyinPublishJob(
      context.workspaceId,
      jobId
    );
    if (!job)
      throw new IntegrationError(
        'PUBLISH_JOB_NOT_FOUND',
        'Publish job was not found.',
        404
      );
    if (
      job.status === 'published' ||
      job.status === 'failed' ||
      job.status === 'manual_required'
    ) {
      return job;
    }
    if (!job.itemId) {
      job.status = 'unknown';
      job.acceptance = 'acceptance_unknown';
      job.effectState = 'reconciliation_required';
      job.lastErrorCode = 'publish_item_pending_reconciliation';
      job.updatedAt = at;
      Object.assign(job, this.updateDouyinPublishPolling(job, at, source));
      await this.dependencies.repository.saveDouyinPublishJob(job);
      return job;
    }
    const connection = await this.getConnection(context, job.connectionId);
    const connectionWrite = this.connectionWriteExpectation(connection);
    this.requireUsableCredential(connection);
    if (!this.dependencies.douyin) {
      throw new IntegrationError(
        'DOUYIN_ADAPTER_MISSING',
        'Douyin adapter is unavailable.',
        503
      );
    }
    const credential = await this.dependencies.secrets.use(
      connection.secretRef,
      {
        workspaceId: connection.workspaceId,
        credentialId: connection.credential.id,
        version: connection.credential.version,
        provider: 'douyin',
      }
    );
    const result = await this.dependencies.douyin.inspectPublish({
      connectionId: connection.id,
      itemId: job.itemId,
      credential,
    });
    if (result.status === 'rate_limited') {
      connection.status = 'rate_limited';
      connection.degradedCapabilities.publish = 'rate_limited';
      connection.updatedAt = at;
      await this.saveConnection(
        context,
        connection,
        'rate_limited:publish',
        connectionWrite
      );
      job.effectState = 'reconciliation_required';
      job.lastErrorCode = result.errorCode ?? 'rate_limited';
      job.updatedAt = at;
      Object.assign(job, this.updateDouyinPublishPolling(job, at, source));
      await this.dependencies.repository.saveDouyinPublishJob(job);
      return job;
    }
    delete connection.degradedCapabilities.publish;
    connection.status = Object.keys(connection.degradedCapabilities).length
      ? 'degraded'
      : 'available';
    connection.updatedAt = at;
    await this.saveConnection(context, connection, undefined, connectionWrite);
    job.status = result.status;
    job.effectState =
      result.status === 'unknown' ? 'reconciliation_required' : 'settled';
    if (result.errorCode) job.lastErrorCode = result.errorCode;
    else delete job.lastErrorCode;
    job.updatedAt = at;
    const updated = this.updateDouyinPublishPolling(job, at, source);
    await this.dependencies.repository.saveDouyinPublishJob(updated);
    return updated;
  }

  private updateDouyinPublishPolling(
    input: DouyinPublishJob,
    at: string,
    source: 'submit' | 'manual' | 'poll' | 'callback'
  ): DouyinPublishJob {
    const job = structuredClone(input);
    if (
      job.status === 'published' ||
      job.status === 'failed' ||
      job.status === 'manual_required'
    ) {
      job.pollingState = 'completed';
      delete job.nextPollAt;
      return job;
    }
    if (!job.itemId) {
      job.pollingState = 'exhausted';
      delete job.nextPollAt;
      return job;
    }
    job.pollAttempts =
      (job.pollAttempts ?? 0) + (source === 'poll' ? 1 : 0);
    job.pollLimit = job.pollLimit ?? DOUYIN_PUBLISH_POLL_LIMIT;
    job.pollDeadlineAt =
      job.pollDeadlineAt ??
      new Date(Date.parse(at) + DOUYIN_PUBLISH_POLL_DEADLINE_MS).toISOString();
    if (
      job.pollAttempts >= job.pollLimit ||
      Date.parse(at) >= Date.parse(job.pollDeadlineAt)
    ) {
      job.pollingState = 'exhausted';
      delete job.nextPollAt;
      return job;
    }
    const delay = Math.min(
      DOUYIN_PUBLISH_POLL_MAX_DELAY_MS,
      DOUYIN_PUBLISH_POLL_BASE_MS * 2 ** Math.min(job.pollAttempts, 4)
    );
    job.nextPollAt = new Date(Date.parse(at) + delay).toISOString();
    job.pollingState = 'scheduled';
    return job;
  }

  async handleDouyinPublishStatusEvent(
    context: IntegrationContext,
    event: DouyinPublishStatusEvent
  ) {
    this.requireOwner(context);
    if (
      !event.eventId?.trim() ||
      !event.connectionId?.trim() ||
      (!event.jobId && !event.itemId) ||
      !['reviewing', 'published', 'failed', 'unknown'].includes(event.status) ||
      !Number.isFinite(Date.parse(event.occurredAt))
    ) {
      throw new IntegrationError(
        'DOUYIN_PUBLISH_EVENT_INVALID',
        'Douyin publish callback envelope is invalid.'
      );
    }
    let job = event.jobId
      ? await this.dependencies.repository.getDouyinPublishJob(
          context.workspaceId,
          event.jobId
        )
      : await this.dependencies.repository.findDouyinPublishJobByItem(
          context.workspaceId,
          event.itemId!
        );
    if (!job || job.connectionId !== event.connectionId) {
      throw new IntegrationError(
        'PUBLISH_JOB_NOT_FOUND',
        'Publish callback does not match a known job.',
        404
      );
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (job.itemId && event.itemId && job.itemId !== event.itemId) {
        throw new IntegrationError(
          'PUBLISH_ITEM_MISMATCH',
          'Publish callback item does not match the claimed job.',
          409
        );
      }
      if (job.providerEventId === event.eventId) {
        await this.recordDouyinPublishEvent(context, event, job);
        return structuredClone(job);
      }
      const terminal = job.status === 'published' || job.status === 'failed';
      if (terminal && (job.status !== event.status || job.providerEventId)) {
        return structuredClone(job);
      }
      if (
        job.providerOccurredAt &&
        Date.parse(event.occurredAt) < Date.parse(job.providerOccurredAt)
      ) {
        return structuredClone(job);
      }
      let reconciledJob: DouyinPublishJob = {
        ...job,
        acceptance:
          event.status === 'reviewing' || event.status === 'published'
            ? 'accepted'
            : 'acceptance_unknown',
        effectState:
          event.status === 'unknown' ? 'reconciliation_required' : 'settled',
        providerEventId: event.eventId,
        providerOccurredAt: event.occurredAt,
        status: event.status,
        updatedAt:
          Date.parse(event.occurredAt) > Date.parse(job.updatedAt)
            ? event.occurredAt
            : job.updatedAt,
        ...(job.itemId || !event.itemId ? {} : { itemId: event.itemId }),
        ...(job.videoId || !event.videoId ? {} : { videoId: event.videoId }),
      };
      if (event.errorCode) reconciledJob.lastErrorCode = event.errorCode;
      else delete reconciledJob.lastErrorCode;
      reconciledJob = this.updateDouyinPublishPolling(
        reconciledJob,
        event.occurredAt,
        'callback'
      );
      const reconciliation =
        await this.dependencies.repository.reconcileDouyinPublishJob(
          reconciledJob,
          job.updatedAt
        );
      if (reconciliation.reconciled) {
        await this.recordDouyinPublishEvent(context, event, reconciliation.job);
        return structuredClone(reconciliation.job);
      }
      job = reconciliation.job;
    }
    throw new IntegrationError(
      'PUBLISH_RECONCILIATION_CONFLICT',
      'Publish callback reconciliation is busy; retry the event.',
      409
    );
  }

  private async recordDouyinPublishEvent(
    context: IntegrationContext,
    event: DouyinPublishStatusEvent,
    job: DouyinPublishJob
  ) {
    await this.dependencies.repository.appendAudit({
      action: 'douyin.publish_callback_reconciled',
      actorId: context.userId,
      connectionId: job.connectionId,
      correlationId: context.correlationId,
      createdAt: event.occurredAt,
      details: {
        eventId: event.eventId,
        jobId: job.id,
        status: event.status,
      },
      id: `${job.id}:douyin-publish:${event.eventId}`,
      workspaceId: context.workspaceId,
    });
    await this.dependencies.repository.claimExternalEvent(
      context.workspaceId,
      'douyin-publish',
      event.eventId
    );
  }

  async getDouyinOperationsSnapshot(
    context: IntegrationContext,
    connectionId: string
  ) {
    this.requireOwner(context);
    const connection = await this.getConnection(context, connectionId);
    if (connection.provider !== 'douyin') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not Douyin.'
      );
    }
    const [publishJobs, observeSnapshots, observeState] = await Promise.all([
      this.dependencies.repository.listDouyinPublishJobs(
        context.workspaceId,
        connectionId
      ),
      this.dependencies.repository.listDouyinObserveSnapshots(
        context.workspaceId,
        connectionId
      ),
      this.dependencies.repository.getDouyinObserveState(
        context.workspaceId,
        connectionId
      ),
    ]);
    return {
      connectionId,
      observeSnapshots,
      observeState,
      publishJobs,
      refreshedAt: new Date().toISOString(),
    };
  }

  async syncDouyinObserve(
    context: IntegrationContext,
    connectionId: string,
    at = new Date().toISOString()
  ) {
    if (context.role !== 'owner' && context.role !== 'worker') {
      throw new IntegrationError(
        'FORBIDDEN',
        'Only a workspace owner or trusted worker may synchronize Douyin Observe.',
        403
      );
    }
    if (!Number.isFinite(Date.parse(at))) {
      throw new IntegrationError('INVALID_TIMESTAMP', 'Observe time is invalid.');
    }
    const connection = await this.getConnection(context, connectionId);
    const connectionWrite = this.connectionWriteExpectation(connection);
    const currentState =
      await this.dependencies.repository.getDouyinObserveState(
        context.workspaceId,
        connectionId
      );
    const evidence = connection.capabilityEvidence.observe;
    if (
      connection.provider !== 'douyin' ||
      !connection.grantedCapabilities.includes('observe') ||
      connection.degradedCapabilities.observe === 'disabled_by_owner' ||
      !evidence?.endpoint
    ) {
      await this.saveDouyinObserveState({
        workspaceId: context.workspaceId,
        connectionId,
        evidenceRevision: evidence?.revision ?? 'unavailable',
        lastAttemptAt: at,
        ...(currentState?.lastSuccessfulAt
          ? { lastSuccessfulAt: currentState.lastSuccessfulAt }
          : {}),
        status: 'unavailable',
        reason:
          connection.degradedCapabilities.observe ??
          'observe_capability_unavailable',
      });
      throw new IntegrationError(
        'OBSERVE_CAPABILITY_UNAVAILABLE',
        'Douyin Observe is not activated by current console evidence.',
        403
      );
    }
    this.requireUsableCredential(connection);
    if (
      currentState?.nextSyncAt &&
      Date.parse(currentState.nextSyncAt) > Date.parse(at)
    ) {
      return this.dependencies.repository.listDouyinObserveSnapshots(
        context.workspaceId,
        connectionId
      );
    }
    if (!connection.subject || !this.dependencies.douyin) {
      throw new IntegrationError(
        'DOUYIN_ADAPTER_MISSING',
        'Douyin Observe is unavailable.',
        503
      );
    }
    const credential = await this.dependencies.secrets.use(
      connection.secretRef,
      {
        workspaceId: connection.workspaceId,
        credentialId: connection.credential.id,
        version: connection.credential.version,
        provider: 'douyin',
      }
    );
    const result = await this.dependencies.douyin.observe({
      connectionId,
      accountSubject: connection.subject,
      endpoint: evidence.endpoint,
      scopes: evidence.scopes,
      fields: evidence.fields ?? [],
      credential,
    });
    if (result.status === 'rate_limited') {
      connection.degradedCapabilities.observe = 'rate_limited';
      connection.status = 'rate_limited';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(
        context,
        connection,
        'rate_limited:observe',
        connectionWrite
      );
      await this.saveDouyinObserveState({
        workspaceId: context.workspaceId,
        connectionId,
        evidenceRevision: evidence.revision,
        lastAttemptAt: at,
        ...(currentState?.lastSuccessfulAt
          ? { lastSuccessfulAt: currentState.lastSuccessfulAt }
          : {}),
        nextSyncAt: new Date(
          Date.parse(at) +
            (result.retryAfterSeconds ?? this.observeFrequencySeconds(evidence.frequency)) *
              1000
        ).toISOString(),
        reason: 'rate_limited',
        status: 'unknown',
      });
      return this.dependencies.repository.listDouyinObserveSnapshots(
        context.workspaceId,
        connectionId
      );
    }
    if (result.status !== 'ok') {
      connection.degradedCapabilities.observe = result.status;
      connection.status =
        result.status === 'unauthorized' ? 'reauthorize_required' : 'degraded';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(
        context,
        connection,
        result.status,
        connectionWrite
      );
      await this.saveDouyinObserveState({
        workspaceId: context.workspaceId,
        connectionId,
        evidenceRevision: evidence.revision,
        lastAttemptAt: at,
        ...(currentState?.lastSuccessfulAt
          ? { lastSuccessfulAt: currentState.lastSuccessfulAt }
          : {}),
        ...(result.status === 'failed'
          ? {
              nextSyncAt: new Date(
                Date.parse(at) +
                  this.observeFrequencySeconds(evidence.frequency) * 1000
              ).toISOString(),
            }
          : {}),
        reason: result.errorCode ?? result.status,
        status:
          result.status === 'unauthorized' || result.status === 'forbidden'
            ? 'unavailable'
            : 'unknown',
      });
      return this.dependencies.repository.listDouyinObserveSnapshots(
        context.workspaceId,
        connectionId
      );
    }
    delete connection.degradedCapabilities.observe;
    connection.status = Object.keys(connection.degradedCapabilities).length
      ? 'degraded'
      : 'available';
    connection.updatedAt = new Date().toISOString();
    await this.saveConnection(context, connection, undefined, connectionWrite);
    for (const item of result.items) {
      const isProductPublish =
        await this.dependencies.repository.hasProductPublishItem(
          context.workspaceId,
          item.externalId
        );
      await this.dependencies.repository.saveDouyinObserveSnapshot({
        ...structuredClone(item),
        workspaceId: context.workspaceId,
        connectionId,
        source: isProductPublish ? 'product' : 'external',
        observedAt: result.observedAt,
        evidenceRevision: evidence.revision,
      });
    }
    await this.saveDouyinObserveState({
      workspaceId: context.workspaceId,
      connectionId,
      evidenceRevision: evidence.revision,
      lastAttemptAt: at,
      lastSuccessfulAt: result.observedAt,
      nextSyncAt: new Date(
        Date.parse(at) + this.observeFrequencySeconds(evidence.frequency) * 1000
      ).toISOString(),
      status: result.items.length === 0 ? 'empty' : 'available',
    });
    return this.dependencies.repository.listDouyinObserveSnapshots(
      context.workspaceId,
      connectionId
    );
  }

  private saveDouyinObserveState(state: DouyinObserveState) {
    return this.dependencies.repository.saveDouyinObserveState(state);
  }

  private observeFrequencySeconds(frequency?: string) {
    const normalized = frequency?.trim().toLowerCase() ?? '';
    if (normalized.includes('daily')) return 24 * 60 * 60;
    if (normalized.includes('hourly')) return 60 * 60;
    const iso = /^pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(normalized);
    if (iso) {
      const seconds =
        Number(iso[1] ?? 0) * 60 * 60 +
        Number(iso[2] ?? 0) * 60 +
        Number(iso[3] ?? 0);
      if (seconds > 0) return seconds;
    }
    const compact = /^(\d+)(s|m|h|d)$/.exec(normalized);
    if (compact) {
      const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[
        compact[2] as 's' | 'm' | 'h' | 'd'
      ];
      return Math.max(1, Number(compact[1])) * multiplier;
    }
    return 15 * 60;
  }

  async syncFeishuToolCatalog(
    context: IntegrationContext,
    connectionId: string
  ) {
    this.requireAdmin(context);
    const { tools } = await this.discoverAndActivateFeishu(
      context,
      connectionId
    );
    return (await this.persistDiscoveredFeishuTools(tools)).revisions;
  }

  async syncAndPublishFeishuToolCatalog(
    context: IntegrationContext,
    connectionId: string
  ) {
    this.requireFeishuCatalogActor(context);
    const { tools } = await this.discoverAndActivateFeishu(
      context,
      connectionId
    );
    const synced = await this.persistDiscoveredFeishuTools(tools);
    let publishedRevisionCount = 0;
    for (const revision of synced.revisions) {
      if (
        revision.compatibility?.status === 'incompatible' ||
        revision.status === 'published'
      ) {
        continue;
      }
      const published = await this.publishFeishuToolRevisionRecord(revision);
      if (published.published) publishedRevisionCount += 1;
    }
    return {
      incompatibleToolCount: synced.incompatibleToolCount,
      publishedRevisionCount,
      revisions: synced.revisions,
    };
  }

  async runFeishuToolLifecycle(
    context: IntegrationContext
  ): Promise<FeishuToolLifecycleSummary> {
    this.requireFeishuCatalogActor(context);
    const targets =
      await this.dependencies.repository.listFeishuLifecycleTargets();
    const summary: FeishuToolLifecycleSummary = {
      connectionCount: targets.length,
      failedConnectionCount: 0,
      incompatibleToolCount: 0,
      publishedRevisionCount: 0,
    };
    for (const target of targets) {
      const targetContext: IntegrationContext = {
        ...context,
        correlationId: `${context.correlationId}:${target.connectionId}`,
        workspaceId: target.workspaceId,
      };
      try {
        const result = await this.syncAndPublishFeishuToolCatalog(
          targetContext,
          target.connectionId
        );
        summary.incompatibleToolCount += result.incompatibleToolCount;
        summary.publishedRevisionCount += result.publishedRevisionCount;
      } catch (error) {
        summary.failedConnectionCount += 1;
        const createdAt = new Date().toISOString();
        await this.dependencies.repository
          .appendAudit({
            action: 'feishu.tool_catalog_lifecycle_failed',
            actorId: context.userId,
            connectionId: target.connectionId,
            correlationId: targetContext.correlationId,
            createdAt,
            details: {
              code:
                error instanceof IntegrationError
                  ? error.code
                  : 'TOOL_CATALOG_SYNC_FAILED',
            },
            id: `${targetContext.correlationId}:failed`,
            workspaceId: target.workspaceId,
          })
          .catch(() => undefined);
      }
    }
    return summary;
  }

  private requireFeishuCatalogActor(context: IntegrationContext) {
    if (context.role !== 'admin' && context.role !== 'worker') {
      throw new IntegrationError(
        'FORBIDDEN',
        'Feishu tool catalog lifecycle requires an admin or trusted worker.',
        403
      );
    }
  }

  private async persistDiscoveredFeishuTools(
    tools: Awaited<ReturnType<FeishuMcpAdapterPort['discover']>>
  ) {
    const discovered: FeishuToolRevision[] = [];
    let incompatibleToolCount = 0;
    const discoveredAt = new Date().toISOString();
    for (const tool of tools) {
      const vendored = vendorFeishuTool(tool, discoveredAt);
      if (vendored.compatibility.status === 'incompatible') {
        incompatibleToolCount += 1;
      }
      if (vendored.compatibility.reason === 'tool_id_missing') continue;
      const schemaHash = this.hash({
        inputSchema: vendored.inputSchema,
        risk: tool.risk,
      });
      const existing = (
        await this.dependencies.repository.listToolRevisions(tool.id)
      ).find((revision) => revision.schemaHash === schemaHash);
      if (existing) {
        discovered.push(existing);
        continue;
      }
      const revision: FeishuToolRevision = {
        ...structuredClone(tool),
        compatibility: vendored.compatibility,
        inputSchema: vendored.inputSchema,
        revision: `${tool.remoteRevision}:${schemaHash.slice(0, 12)}`,
        schemaHash,
        status: 'draft',
        discoveredAt,
      };
      await this.dependencies.repository.saveToolRevision(revision);
      discovered.push(revision);
    }
    return { incompatibleToolCount, revisions: discovered };
  }

  async verifyFeishuConnection(
    context: IntegrationContext,
    connectionId: string
  ) {
    this.requireOwner(context);
    const { connection, tools } = await this.discoverAndActivateFeishu(
      context,
      connectionId
    );
    const synced = await this.persistDiscoveredFeishuTools(tools);
    for (const revision of synced.revisions) {
      if (
        revision.compatibility?.status !== 'incompatible' &&
        revision.status !== 'published'
      ) {
        await this.publishFeishuToolRevisionRecord(revision);
      }
    }
    return structuredClone(connection);
  }

  private async discoverAndActivateFeishu(
    context: IntegrationContext,
    connectionId: string
  ) {
    const connection = await this.getConnection(context, connectionId);
    const connectionWrite = this.connectionWriteExpectation(connection);
    if (connection.provider !== 'feishu' || !this.dependencies.feishu) {
      throw new IntegrationError(
        'FEISHU_UNAVAILABLE',
        'Feishu MCP is unavailable.',
        503
      );
    }
    if (!connection.requestedCapabilities.includes('mcp.tools')) {
      throw new IntegrationError(
        'CAPABILITY_NOT_REQUESTED',
        'The Feishu MCP capability was not requested.',
        409
      );
    }
    this.requireUsableCredential(connection, { allowUnverified: true });
    const uat = await this.dependencies.secrets.use(connection.secretRef, {
      workspaceId: connection.workspaceId,
      credentialId: connection.credential.id,
      version: connection.credential.version,
      provider: 'feishu',
    });
    const tools = await this.dependencies.feishu.discover({ uat });
    const verifiedAt = new Date().toISOString();
    connection.credential.status = 'active';
    connection.credential.lastUsedAt = verifiedAt;
    if (!connection.grantedCapabilities.includes('mcp.tools')) {
      connection.grantedCapabilities.push('mcp.tools');
    }
    connection.capabilityEvidence['mcp.tools'] = {
      revision: `feishu-discovery:${this.hash(
        tools.map(({ id, remoteRevision }) => ({ id, remoteRevision }))
      ).slice(0, 16)}`,
      scopes: [...connection.credential.scope],
      verifiedAt,
    };
    delete connection.degradedCapabilities['mcp.tools'];
    connection.status = Object.keys(connection.degradedCapabilities).length
      ? 'degraded'
      : 'available';
    connection.updatedAt = verifiedAt;
    await this.saveConnection(context, connection, undefined, connectionWrite);
    await this.dependencies.repository.appendAudit({
      action: 'feishu.connection_verified',
      actorId: context.userId,
      connectionId,
      correlationId: context.correlationId,
      createdAt: verifiedAt,
      details: {
        capability: 'mcp.tools',
        credentialVersion: connection.credential.version,
        toolCount: tools.length,
      },
      id: `${context.correlationId}:feishu-connection-verified:${connectionId}`,
      workspaceId: context.workspaceId,
    });
    return { connection, tools };
  }

  async publishFeishuToolRevision(
    context: IntegrationContext,
    toolId: string,
    revisionId: string
  ) {
    this.requireAdmin(context);
    const revision = await this.dependencies.repository.getToolRevision(
      toolId,
      revisionId
    );
    if (!revision)
      throw new IntegrationError(
        'TOOL_REVISION_NOT_FOUND',
        'Tool revision not found.'
      );
    return (await this.publishFeishuToolRevisionRecord(revision)).revision;
  }

  private async publishFeishuToolRevisionRecord(
    revision: FeishuToolRevision
  ): Promise<{ published: boolean; revision: FeishuToolRevision }> {
    if (revision.compatibility?.status === 'incompatible') {
      throw new IntegrationError(
        'TOOL_REVISION_INCOMPATIBLE',
        'An incompatible tool revision cannot be published.',
        409
      );
    }
    if (revision.status === 'published') {
      return { published: false, revision: structuredClone(revision) };
    }
    for (const older of await this.dependencies.repository.listToolRevisions(
      revision.id
    )) {
      if (older.status === 'published') {
        older.status = 'retired';
        await this.dependencies.repository.saveToolRevision(older);
      }
    }
    revision.status = 'published';
    revision.publishedAt = new Date().toISOString();
    await this.dependencies.repository.saveToolRevision(revision);
    return { published: true, revision: structuredClone(revision) };
  }

  async executeFeishuIntent(
    context: IntegrationContext,
    input: {
      connectionId: string;
      toolId: string;
      sideEffect: ExternalActionIntent['sideEffect'];
      source: ExternalActionIntent['source'];
      targetObjectId?: string;
      fields: string[];
      arguments: Record<string, unknown>;
      idempotencyKey: string;
    }
  ) {
    if (context.role !== 'owner' && context.role !== 'worker') {
      throw new IntegrationError(
        'FORBIDDEN',
        'Only a workspace owner or trusted worker may execute Feishu tools.',
        403
      );
    }
    const connection = await this.getConnection(context, input.connectionId);
    if (connection.provider !== 'feishu') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not Feishu.'
      );
    }
    this.requireUsableCredential(connection, { capability: 'mcp.tools' });
    const source: ExternalActionIntent['source'] =
      context.role === 'worker' ? 'autonomous' : 'explicit_user';
    const payload = this.hash({
      arguments: input.arguments,
      command: 'feishu.intent.execute',
      connectionId: input.connectionId,
      fields: input.fields,
      source,
      targetObjectId: input.targetObjectId,
      toolId: input.toolId,
    });
    const replay =
      await this.dependencies.repository.getIdempotent<StoredFeishuIntentResult>(
        context.workspaceId,
        input.idempotencyKey,
        payload
      );
    if (replay && !replay.matches) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency payload changed.',
        409
      );
    }
    if (replay) {
      const persisted = await this.dependencies.repository.getIntent(
        context.workspaceId,
        replay.value.intent.id
      );
      if (persisted && persisted.status !== replay.value.intent.status) {
        return this.recoverFeishuIntentResult(persisted);
      }
      return structuredClone(replay.value);
    }
    const revision = await this.dependencies.repository.getPublishedTool(
      input.toolId
    );
    if (!revision) {
      throw new IntegrationError(
        'TOOL_NOT_PUBLISHED',
        'Tool schema is not published.',
        403
      );
    }
    const envelope = this.validateFeishuIntentEnvelope(revision, input, source);
    const now = new Date().toISOString();
    const requiresConfirmation =
      source === 'autonomous' &&
      (revision.risk === 'destructive' ||
        revision.risk === 'open_world' ||
        envelope.sideEffect === 'send' ||
        envelope.sideEffect === 'delete' ||
        envelope.sideEffect === 'overwrite');
    const intent: ExternalActionIntent = {
      id: `${input.idempotencyKey}:intent`,
      workspaceId: context.workspaceId,
      connectionId: connection.id,
      toolId: input.toolId,
      toolRevision: revision.revision,
      schemaHash: revision.schemaHash,
      sideEffect: envelope.sideEffect,
      source,
      targetObjectId: envelope.targetObjectId,
      fields: envelope.fields,
      argumentHash: this.hash(input.arguments),
      ...(requiresConfirmation ? {} : { effectState: 'claimed' as const }),
      status: requiresConfirmation ? 'confirmation_pending' : 'authorized',
      createdBy: context.userId,
      createdAt: now,
    };
    if (requiresConfirmation) {
      if (!this.dependencies.confirmationTasks) {
        throw new IntegrationError(
          'CONFIRMATION_TASK_PORT_MISSING',
          'A durable confirmation task adapter is required for autonomous high-risk actions.',
          503
        );
      }
      const confirmation = await this.dependencies.confirmationTasks.create({
        correlationId: context.correlationId,
        dueAt: now,
        intentId: intent.id,
        title: `确认飞书操作：${intent.toolId}`,
        userId: context.userId,
        workspaceId: context.workspaceId,
      });
      intent.confirmationTaskId = confirmation.taskId;
    }
    const claim = await this.dependencies.repository.claimIntent(intent);
    if (!claim.claimed) {
      this.assertMatchingFeishuIntent(claim.intent, intent);
      return this.recoverFeishuIntentResult(claim.intent);
    }
    if (requiresConfirmation) {
      const pending = {
        status: 'confirmation_pending' as const,
        confirmationTaskId: intent.confirmationTaskId!,
        intent: structuredClone(intent),
      };
      await this.dependencies.repository.saveIdempotent(
        context.workspaceId,
        input.idempotencyKey,
        payload,
        pending
      );
      return pending;
    }
    const result = await this.callFeishu(
      context,
      connection,
      revision,
      input.arguments,
      intent
    );
    const returned = {
      status:
        result.status === 'ok'
          ? ('completed' as const)
          : result.status === 'unknown'
            ? ('unknown' as const)
            : ('failed' as const),
      content: result.status === 'ok' ? result.content : undefined,
      output: result.status === 'ok' ? result.output : undefined,
      intent: (await this.dependencies.repository.getIntent(
        context.workspaceId,
        intent.id
      ))!,
    };
    const stored: StoredFeishuIntentResult = {
      intent: structuredClone(returned.intent),
      status: returned.status,
    };
    await this.dependencies.repository.saveIdempotent(
      context.workspaceId,
      input.idempotencyKey,
      payload,
      stored
    );
    return returned;
  }

  private validateFeishuIntentEnvelope(
    revision: FeishuToolRevision,
    input: {
      arguments: Record<string, unknown>;
      fields: string[];
      targetObjectId?: string;
    },
    source: ExternalActionIntent['source']
  ) {
    const schema = revision.inputSchema;
    if (schema.type !== undefined && schema.type !== 'object') {
      throw new IntegrationError(
        'TOOL_SCHEMA_INVALID',
        'Published tool schema must describe an object.',
        500
      );
    }
    const properties =
      schema.properties &&
      typeof schema.properties === 'object' &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : undefined;
    const argumentKeys = Object.keys(input.arguments);
    if (properties) {
      const unknownKey = argumentKeys.find((key) => !(key in properties));
      if (unknownKey) {
        throw new IntegrationError(
          'TOOL_ARGUMENTS_INVALID',
          `Argument ${unknownKey} is not in the published tool schema.`,
          400
        );
      }
      for (const key of argumentKeys) {
        if (
          !this.matchesTopLevelJsonSchema(
            input.arguments[key],
            properties[key]
          )
        ) {
          throw new IntegrationError(
            'TOOL_ARGUMENTS_INVALID',
            `Argument ${key} does not match the published tool schema.`,
            400
          );
        }
      }
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [];
    const missing = required.find(
      (key) => !(key in input.arguments) || input.arguments[key] === undefined
    );
    if (missing) {
      throw new IntegrationError(
        'TOOL_ARGUMENTS_INVALID',
        `Required argument ${missing} is missing.`,
        400
      );
    }
    if (
      input.fields.some((field) => !field.trim()) ||
      new Set(input.fields).size !== input.fields.length
    ) {
      throw new IntegrationError(
        'INTENT_SCOPE_INVALID',
        'Intent fields must be unique non-empty names.',
        400
      );
    }
    const targetKeys = new Set([
      'record_id',
      'recordId',
      'message_id',
      'messageId',
      'event_id',
      'eventId',
      'node_token',
      'nodeToken',
      'document_id',
      'documentId',
      'doc_token',
      'docToken',
      'object_id',
      'objectId',
      'task_id',
      'taskId',
      'file_token',
      'fileToken',
      'attachment_token',
      'attachmentToken',
      'view_id',
      'viewId',
      'sheet_id',
      'sheetId',
      'spreadsheet_token',
      'spreadsheetToken',
      'table_id',
      'tableId',
      'app_token',
      'appToken',
      'base_token',
      'baseToken',
      'folder_token',
      'folderToken',
      'chat_id',
      'chatId',
      'calendar_id',
      'calendarId',
      'user_id',
      'userId',
    ]);
    const argumentTargets = argumentKeys
      .filter((key) => targetKeys.has(key))
      .map((key) => input.arguments[key])
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      );
    if (
      (input.targetObjectId &&
        argumentTargets.length > 0 &&
        !argumentTargets.includes(input.targetObjectId)) ||
      (source === 'autonomous' &&
        argumentTargets.length > 0 &&
        !input.targetObjectId)
    ) {
      throw new IntegrationError(
        'INTENT_SCOPE_VIOLATION',
        'Tool arguments cannot change the authorized target object.',
        409
      );
    }
    const authorizedFields = new Set(input.fields);
    const expandedField = argumentKeys.find(
      (key) => !targetKeys.has(key) && !authorizedFields.has(key)
    );
    if (expandedField) {
      throw new IntegrationError(
        'INTENT_SCOPE_VIOLATION',
        `Tool arguments cannot expand the authorized field ${expandedField}.`,
        409
      );
    }
    return {
      fields: [...input.fields],
      sideEffect: this.deriveFeishuSideEffect(revision),
      targetObjectId: input.targetObjectId ?? argumentTargets[0],
    };
  }

  private matchesTopLevelJsonSchema(value: unknown, schema: unknown) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return true;
    }
    const definition = schema as Record<string, unknown>;
    if (
      Array.isArray(definition.enum) &&
      !definition.enum.some(
        (candidate) => this.hash(candidate) === this.hash(value)
      )
    ) {
      return false;
    }
    const types = Array.isArray(definition.type)
      ? definition.type
      : definition.type
        ? [definition.type]
        : [];
    if (types.length === 0) return true;
    return types.some((type) => {
      switch (type) {
        case 'null':
          return value === null;
        case 'array':
          return Array.isArray(value);
        case 'object':
          return (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value)
          );
        case 'integer':
          return typeof value === 'number' && Number.isInteger(value);
        case 'number':
          return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
        case 'string':
          return typeof value === type;
        default:
          return false;
      }
    });
  }

  private deriveFeishuSideEffect(
    revision: FeishuToolRevision
  ): ExternalActionIntent['sideEffect'] {
    const operation = revision.id.toLowerCase().split(/[./:_-]/).at(-1) ?? '';
    if (revision.risk === 'read') return 'read';
    if (/^(create|add|append|insert)$/.test(operation)) return 'create';
    if (/^(update|edit|patch|modify)$/.test(operation)) return 'edit';
    if (/^(send|post|message|notify)$/.test(operation)) return 'send';
    if (/^(overwrite|replace)$/.test(operation)) return 'overwrite';
    if (/^(delete|remove|destroy)$/.test(operation)) return 'delete';
    if (revision.risk === 'destructive') return 'delete';
    if (revision.risk === 'open_world') return 'send';
    return 'edit';
  }

  private assertMatchingFeishuIntent(
    persisted: ExternalActionIntent,
    requested: ExternalActionIntent
  ) {
    if (
      persisted.connectionId !== requested.connectionId ||
      persisted.toolId !== requested.toolId ||
      persisted.toolRevision !== requested.toolRevision ||
      persisted.schemaHash !== requested.schemaHash ||
      persisted.sideEffect !== requested.sideEffect ||
      persisted.source !== requested.source ||
      persisted.targetObjectId !== requested.targetObjectId ||
      persisted.argumentHash !== requested.argumentHash ||
      this.hash(persisted.fields) !== this.hash(requested.fields)
    ) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        'Persisted Feishu intent differs from the requested envelope.',
        409
      );
    }
  }

  private async recoverFeishuIntentResult(
    intent: ExternalActionIntent
  ): Promise<StoredFeishuIntentResult> {
    if (intent.status === 'confirmation_pending') {
      return {
        confirmationTaskId: intent.confirmationTaskId,
        intent: structuredClone(intent),
        status: 'confirmation_pending',
      };
    }
    if (intent.status === 'authorized') {
      const recoveredAt = new Date().toISOString();
      const recovered: ExternalActionIntent = {
        ...intent,
        effectState: 'reconciliation_required',
        lastErrorCode: 'process_interrupted_after_effect_claim',
        nextReconcileAt: recoveredAt,
        outcomeStatus: 'unknown',
        reconciliationAttempts: intent.reconciliationAttempts ?? 0,
        status: 'unknown',
      };
      await this.dependencies.repository.saveIntent(recovered);
      return {
        intent: recovered,
        status: 'reconciliation_required',
      };
    }
    return {
      intent: structuredClone(intent),
      status:
        intent.status === 'executed'
          ? 'completed'
          : intent.status === 'unknown'
            ? 'unknown'
            : 'failed',
    };
  }

  async listFeishuActivity(context: IntegrationContext, connectionId: string) {
    const connection = await this.getConnection(context, connectionId);
    if (connection.provider !== 'feishu') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not Feishu.'
      );
    }
    return this.dependencies.repository.listActivities(
      context.workspaceId,
      connectionId
    );
  }

  async listFeishuToolCatalog(
    context: IntegrationContext,
    connectionId: string
  ) {
    this.requireOwner(context);
    const connection = await this.getConnection(context, connectionId);
    if (connection.provider !== 'feishu') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not Feishu.'
      );
    }
    return (await this.dependencies.repository.listToolRevisions())
      .map((revision) => ({
        discoveredAt: revision.discoveredAt,
        id: revision.id,
        ...(revision.publishedAt ? { publishedAt: revision.publishedAt } : {}),
        remoteRevision: revision.remoteRevision,
        revision: revision.revision,
        risk: revision.risk,
        status: revision.status,
      }))
      .sort((left, right) =>
        left.id === right.id
          ? right.discoveredAt.localeCompare(left.discoveredAt)
          : left.id.localeCompare(right.id)
      );
  }

  async listFeishuToolRevisionCatalog(context: IntegrationContext) {
    this.requireAdmin(context);
    return (await this.dependencies.repository.listToolRevisions())
      .map((revision) => ({
        compatibility: revision.compatibility
          ? {
              ...(revision.compatibility.reason
                ? { reason: revision.compatibility.reason }
                : {}),
              status: revision.compatibility.status,
            }
          : { status: 'pending' as const },
        discoveredAt: revision.discoveredAt,
        id: revision.id,
        ...(revision.publishedAt ? { publishedAt: revision.publishedAt } : {}),
        remoteRevision: revision.remoteRevision,
        revision: revision.revision,
        risk: revision.risk,
        schemaHash: revision.schemaHash,
        status: revision.status,
      }))
      .sort((left, right) =>
        left.id === right.id
          ? right.discoveredAt.localeCompare(left.discoveredAt)
          : left.id.localeCompare(right.id)
      );
  }

  async setFeishuShortcuts(
    context: IntegrationContext,
    connectionId: string,
    shortcuts: FeishuToolShortcut[]
  ) {
    this.requireOwner(context);
    const connection = await this.getConnection(context, connectionId);
    if (connection.provider !== 'feishu') {
      throw new IntegrationError(
        'PROVIDER_MISMATCH',
        'Connection is not Feishu.'
      );
    }
    const seen = new Set<string>();
    for (const shortcut of shortcuts) {
      if (
        seen.has(shortcut.toolId) ||
        !(await this.dependencies.repository.getPublishedTool(shortcut.toolId))
      ) {
        throw new IntegrationError(
          'SHORTCUT_TOOL_INVALID',
          'Shortcut tool is not published.'
        );
      }
      seen.add(shortcut.toolId);
    }
    await this.dependencies.repository.saveShortcuts(
      context.workspaceId,
      connectionId,
      shortcuts
    );
    return this.listFeishuShortcuts(context, connectionId);
  }

  async listFeishuShortcuts(context: IntegrationContext, connectionId: string) {
    await this.getConnection(context, connectionId);
    return this.dependencies.repository.listShortcuts(
      context.workspaceId,
      connectionId
    );
  }

  async listFeishuPendingIntents(
    context: IntegrationContext,
    connectionId: string
  ) {
    await this.getConnection(context, connectionId);
    return (
      await this.dependencies.repository.listIntents(
        context.workspaceId,
        connectionId
      )
    ).filter((intent) => intent.status === 'confirmation_pending');
  }

  async listFeishuIntentRecovery(
    context: IntegrationContext,
    connectionId: string
  ) {
    await this.getConnection(context, connectionId);
    return (
      await this.dependencies.repository.listIntents(
        context.workspaceId,
        connectionId
      )
    ).filter((intent) => intent.status !== 'confirmation_pending');
  }

  async reconcileFeishuIntent(
    context: IntegrationContext,
    intentId: string,
    at = new Date().toISOString()
  ) {
    if (context.role !== 'owner' && context.role !== 'worker') {
      throw new IntegrationError(
        'FORBIDDEN',
        'Only a workspace owner or trusted worker may reconcile Feishu writes.',
        403
      );
    }
    if (!Number.isFinite(Date.parse(at))) {
      throw new IntegrationError(
        'INVALID_TIMESTAMP',
        'Feishu reconciliation time is invalid.'
      );
    }
    const intent = await this.dependencies.repository.getIntent(
      context.workspaceId,
      intentId
    );
    if (!intent) {
      throw new IntegrationError('INTENT_NOT_FOUND', 'Intent was not found.', 404);
    }
    if (
      intent.sideEffect === 'read' ||
      intent.status !== 'unknown' ||
      intent.effectState !== 'reconciliation_required'
    ) {
      return this.recoverFeishuIntentResult(intent);
    }
    const localActivity = (
      await this.dependencies.repository.listActivities(
        context.workspaceId,
        intent.connectionId
      )
    ).find(
      (activity) =>
        activity.intentId === intent.id && activity.status === 'completed'
    );
    if (localActivity) {
      return this.settleFeishuReconciliation(
        context,
        intent,
        at,
        {
          status: 'completed',
          objectId: localActivity.objectId,
          externalUrl: localActivity.externalUrl,
          providerLogId: localActivity.providerLogId,
        },
        'local_activity_ledger'
      );
    }
    const connection = await this.getConnection(context, intent.connectionId);
    this.requireUsableCredential(connection, { capability: 'mcp.tools' });
    const revision = await this.dependencies.repository.getToolRevision(
      intent.toolId,
      intent.toolRevision
    );
    if (!revision || revision.schemaHash !== intent.schemaHash) {
      throw new IntegrationError(
        'INTENT_SCHEMA_UNAVAILABLE',
        'Pinned tool schema is unavailable.'
      );
    }
    const credential = await this.dependencies.secrets.use(
      connection.secretRef,
      {
        workspaceId: connection.workspaceId,
        credentialId: connection.credential.id,
        version: connection.credential.version,
        provider: 'feishu',
      }
    );
    const result = this.dependencies.feishu?.reconcile
      ? await this.dependencies.feishu.reconcile({
          argumentHash: intent.argumentHash,
          fields: [...intent.fields],
          intentId: intent.id,
          schemaHash: intent.schemaHash,
          sideEffect: intent.sideEffect,
          ...(intent.targetObjectId
            ? { targetObjectId: intent.targetObjectId }
            : {}),
          toolId: intent.toolId,
          toolRevision: intent.toolRevision,
          uat: credential,
        })
      : {
          errorCode: 'reconcile_adapter_unavailable',
          status: 'unknown' as const,
        };
    return this.settleFeishuReconciliation(
      context,
      intent,
      at,
      result,
      'external_inspection'
    );
  }

  private async settleFeishuReconciliation(
    context: Pick<
      IntegrationContext,
      'workspaceId' | 'userId' | 'correlationId'
    >,
    intent: ExternalActionIntent,
    at: string,
    result: Awaited<
      ReturnType<NonNullable<FeishuMcpAdapterPort['reconcile']>>
    >,
    source: 'local_activity_ledger' | 'external_inspection'
  ): Promise<StoredFeishuIntentResult> {
    const updated: ExternalActionIntent = {
      ...intent,
      lastReconciledAt: at,
      reconciliationAttempts: (intent.reconciliationAttempts ?? 0) + 1,
    };
    if (result.status === 'completed') {
      updated.status = 'executed';
      updated.outcomeStatus = 'completed';
      updated.effectState = 'settled';
      delete updated.lastErrorCode;
      delete updated.nextReconcileAt;
      await this.dependencies.repository.appendActivity({
        connectionId: intent.connectionId,
        executedAt: at,
        externalUrl: result.externalUrl,
        id: `${intent.id}:reconciled:completed`,
        intentId: intent.id,
        objectId: result.objectId,
        providerLogId: result.providerLogId,
        status: 'completed',
        toolId: intent.toolId,
        workspaceId: intent.workspaceId,
      });
    } else if (result.status === 'not_found') {
      updated.status = 'failed';
      updated.outcomeStatus = 'failed';
      updated.effectState = 'settled';
      updated.lastErrorCode = 'confirmed_not_executed';
      delete updated.nextReconcileAt;
      await this.dependencies.repository.appendActivity({
        connectionId: intent.connectionId,
        executedAt: at,
        id: `${intent.id}:reconciled:not-found`,
        intentId: intent.id,
        providerLogId: result.providerLogId,
        status: 'failed',
        toolId: intent.toolId,
        workspaceId: intent.workspaceId,
      });
    } else {
      updated.status = 'unknown';
      updated.outcomeStatus = 'unknown';
      updated.effectState = 'reconciliation_required';
      updated.lastErrorCode = result.errorCode ?? `reconcile_${result.status}`;
      const reconciliationAttempts = updated.reconciliationAttempts ?? 1;
      const delay = Math.min(
        FEISHU_RECONCILIATION_MAX_DELAY_MS,
        FEISHU_RECONCILIATION_BASE_MS *
          2 ** Math.min(reconciliationAttempts - 1, 6)
      );
      updated.nextReconcileAt = new Date(Date.parse(at) + delay).toISOString();
    }
    await this.dependencies.repository.saveIntent(updated);
    await this.dependencies.repository.appendAudit({
      action: 'feishu.intent_reconciled',
      actorId: context.userId,
      connectionId: intent.connectionId,
      correlationId: context.correlationId,
      createdAt: at,
      details: {
        outcome: result.status,
        source,
        toolId: intent.toolId,
      },
      id: `${context.correlationId}:${this.hash({
        at,
        intentId: intent.id,
        outcome: result.status,
        source,
      })}`,
      workspaceId: intent.workspaceId,
    });
    return {
      intent: structuredClone(updated),
      status:
        updated.status === 'executed'
          ? 'completed'
          : updated.status === 'failed'
            ? 'failed'
            : 'unknown',
    };
  }

  async confirmFeishuIntent(
    context: IntegrationContext,
    input: {
      intentId: string;
      arguments: Record<string, unknown>;
      idempotencyKey: string;
    }
  ) {
    this.requireOwner(context);
    const intent = await this.dependencies.repository.getIntent(
      context.workspaceId,
      input.intentId
    );
    if (!intent) {
      throw new IntegrationError(
        'INTENT_NOT_FOUND',
        'Intent was not found.',
        404
      );
    }
    if (this.hash(input.arguments) !== intent.argumentHash) {
      throw new IntegrationError(
        'INTENT_ARGUMENTS_CHANGED',
        'Confirmed arguments differ from the immutable intent envelope.',
        409
      );
    }
    if (intent.status !== 'confirmation_pending') {
      return this.recoverFeishuIntentResult(intent);
    }
    if (!intent.confirmationTaskId || !this.dependencies.confirmationTasks) {
      throw new IntegrationError(
        'CONFIRMATION_TASK_UNAVAILABLE',
        'The durable confirmation task is unavailable.',
        409
      );
    }
    const connection = await this.getConnection(context, intent.connectionId);
    this.requireUsableCredential(connection, { capability: 'mcp.tools' });
    const revision = await this.dependencies.repository.getToolRevision(
      intent.toolId,
      intent.toolRevision
    );
    if (!revision || revision.schemaHash !== intent.schemaHash) {
      throw new IntegrationError(
        'INTENT_SCHEMA_UNAVAILABLE',
        'Pinned tool schema is unavailable.'
      );
    }
    await this.dependencies.confirmationTasks.confirm({
      correlationId: context.correlationId,
      intentId: intent.id,
      taskId: intent.confirmationTaskId,
      userId: context.userId,
      workspaceId: context.workspaceId,
    });
    intent.effectState = 'claimed';
    intent.status = 'authorized';
    const claim = await this.dependencies.repository.claimIntentExecution(
      intent,
      'confirmation_pending'
    );
    if (!claim.claimed) {
      return this.recoverFeishuIntentResult(claim.intent);
    }
    const result = await this.callFeishu(
      context,
      connection,
      revision,
      input.arguments,
      intent
    );
    return {
      status:
        result.status === 'ok'
          ? ('completed' as const)
          : result.status === 'unknown'
            ? ('unknown' as const)
            : ('failed' as const),
      intent: (await this.dependencies.repository.getIntent(
        context.workspaceId,
        intent.id
      ))!,
    };
  }

  private async callFeishu(
    context: Pick<
      IntegrationContext,
      'workspaceId' | 'userId' | 'correlationId'
    >,
    connection: IntegrationConnection,
    revision: FeishuToolRevision,
    args: Record<string, unknown>,
    intent: ExternalActionIntent
  ) {
    if (!this.dependencies.feishu) {
      throw new IntegrationError(
        'FEISHU_UNAVAILABLE',
        'Feishu MCP is unavailable.',
        503
      );
    }
    const connectionWrite = this.connectionWriteExpectation(connection);
    const uat = await this.dependencies.secrets.use(connection.secretRef, {
      workspaceId: connection.workspaceId,
      credentialId: connection.credential.id,
      version: connection.credential.version,
      provider: 'feishu',
    });
    let result: Awaited<ReturnType<FeishuMcpAdapterPort['call']>>;
    try {
      result = await this.dependencies.feishu.call({
        uat,
        toolId: revision.id,
        allowedTools: [revision.id],
        arguments: structuredClone(args),
      });
      if (result.status === 'rate_limited' && intent.sideEffect === 'read') {
        result = await this.dependencies.feishu.call({
          uat,
          toolId: revision.id,
          allowedTools: [revision.id],
          arguments: structuredClone(args),
        });
      }
    } catch {
      result = { status: 'unknown', errorCode: 'mcp_transport_unknown' };
    }
    intent.status =
      result.status === 'ok'
        ? 'executed'
        : result.status === 'unknown'
          ? 'unknown'
          : 'failed';
    intent.outcomeStatus =
      result.status === 'ok'
        ? 'completed'
        : result.status === 'unknown'
          ? 'unknown'
          : 'failed';
    intent.effectState =
      result.status === 'unknown' ? 'reconciliation_required' : 'settled';
    if (result.status === 'unknown' && intent.sideEffect !== 'read') {
      intent.reconciliationAttempts = intent.reconciliationAttempts ?? 0;
      intent.nextReconcileAt = new Date().toISOString();
    }
    if (result.status === 'ok') delete intent.lastErrorCode;
    else {
      intent.lastErrorCode =
        'errorCode' in result && result.errorCode
          ? result.errorCode
          : result.status;
    }
    await this.dependencies.repository.saveIntent(intent);
    if (result.status === 'ok') {
      delete connection.degradedCapabilities[revision.id];
      connection.status = Object.keys(connection.degradedCapabilities).length
        ? 'degraded'
        : 'available';
      connection.credential.status = 'active';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(context, connection, undefined, connectionWrite);
    } else if (result.status === 'unauthorized') {
      connection.status = 'reauthorize_required';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(
        context,
        connection,
        'unauthorized',
        connectionWrite
      );
    } else if (result.status === 'forbidden') {
      connection.status = 'degraded';
      connection.degradedCapabilities[revision.id] = 'forbidden';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(
        context,
        connection,
        'forbidden',
        connectionWrite
      );
    } else if (result.status === 'rate_limited') {
      connection.status = 'rate_limited';
      connection.degradedCapabilities[revision.id] = 'rate_limited';
      connection.updatedAt = new Date().toISOString();
      await this.saveConnection(
        context,
        connection,
        'rate_limited',
        connectionWrite
      );
    }
    await this.dependencies.repository.appendActivity({
      id: `${intent.id}:activity`,
      workspaceId: intent.workspaceId,
      connectionId: intent.connectionId,
      toolId: intent.toolId,
      intentId: intent.id,
      objectId: result.status === 'ok' ? result.objectId : undefined,
      externalUrl: result.status === 'ok' ? result.externalUrl : undefined,
      status:
        result.status === 'ok'
          ? 'completed'
          : result.status === 'unknown'
            ? 'unknown'
            : 'failed',
      executedAt: new Date().toISOString(),
    });
    return result;
  }

  private hash(value: unknown) {
    return createHash('sha256')
      .update(JSON.stringify(this.canonicalize(value)))
      .digest('hex');
  }

  private douyinOAuthLifecycleKey(
    workspaceId: string,
    connectionId: string,
    sourceCredentialVersion: number
  ) {
    return `douyin-oauth-lifecycle:${this.hash({
      command: 'douyin.oauth_lifecycle',
      connectionId,
      sourceCredentialVersion,
      workspaceId,
    })}`;
  }

  private refreshReauthorizationReminder(
    connection: IntegrationConnection,
    at: string
  ) {
    const refreshExpiresAt = connection.credential.refreshExpiresAt;
    return refreshExpiresAt
      ? Date.parse(refreshExpiresAt) <= Date.parse(at) + 3 * 24 * 60 * 60 * 1000
      : false;
  }

  private nextConnectionUpdatedAt(current: string) {
    const currentTime = Date.parse(current);
    return new Date(
      Math.max(Date.now(), Number.isFinite(currentTime) ? currentTime + 1 : 0)
    ).toISOString();
  }

  private connectionWriteExpectation(connection: IntegrationConnection) {
    return {
      credentialVersion: connection.credential.version,
      updatedAt: connection.updatedAt,
    };
  }

  private canonicalize(value: unknown): unknown {
    if (Array.isArray(value))
      return value.map((item) => this.canonicalize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, this.canonicalize(entry)])
      );
    }
    return value;
  }
}
