import { createHash } from 'node:crypto';
import type {
  ConnectionCreateOperation,
  CreateConnectionInput,
  ConfirmationTaskPort,
  ControlledEndpointProfile,
  ExternalActionIntent,
  FeishuMcpAdapterPort,
  FeishuToolRevision,
  FeishuToolShortcut,
  IntegrationConnection,
  IntegrationContext,
  IntegrationAnomalyTaskPort,
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

const FEISHU_RECONCILIATION_BASE_MS = 5 * 60 * 1000;
const FEISHU_RECONCILIATION_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

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

  private requireAdmin(context: IntegrationContext) {
    if (context.role !== 'admin') {
      throw new IntegrationError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
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
    return this.dependencies.repository.listConnections(context.workspaceId);
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
    if (slot !== 'model.direct' && slot !== 'ark.media') {
      throw new IntegrationError(
        'INVALID_PROVIDER_CREDENTIAL_SLOT',
        'The connection is not a platform provider credential.',
        400,
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
