import type { P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { IntegrationApplicationService } from './application-service.js';
import {
  IntegrationError,
  type CreateConnectionInput,
  type DouyinCapability,
  type DouyinPublishAnchor,
  type FeishuToolShortcut,
  type IntegrationContext,
  type SubmitStrictByokInput,
} from './contracts.js';
import type {
  ProviderCredentialOperatorPort,
  ProviderCredentialRuntimeSources,
} from './provider-credential-runtime.js';
import { toPublicMetadata } from '../supply-registry/credential-account.js';

type ProviderCredentialEffectiveSource = 'vault' | 'env_fallback' | 'env';

const PROVIDER_CREDENTIAL_SLOTS = [
  'model.direct',
  'ark.media',
  'douyin.platform',
] as const;

interface IntegrationsFoundationModuleOptions {
  adminActorIds?: readonly string[];
  providerCredentialOperator?: ProviderCredentialOperatorPort;
  providerCredentialSources?: ProviderCredentialRuntimeSources;
}

function invalidInput(message: string): never {
  throw new IntegrationError('INVALID_INPUT', message, 400);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidInput('Integration input must be an object.');
  }
  return value as Record<string, unknown>;
}

function objectField(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidInput(`${key} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidInput(`${key} is required.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) return undefined;
  return string(input, key);
}

function timestamp(input: Record<string, unknown>, key: string) {
  const value = string(input, key);
  if (!Number.isFinite(Date.parse(value))) {
    invalidInput(`${key} must be a timestamp.`);
  }
  return value;
}

function optionalTimestamp(input: Record<string, unknown>, key: string) {
  if (input[key] === undefined) return undefined;
  return timestamp(input, key);
}

function stringList(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    invalidInput(`${key} must be a string array.`);
  }
  return [...value] as string[];
}

function optionalStringList(input: Record<string, unknown>, key: string) {
  return input[key] === undefined ? [] : stringList(input, key);
}

function boolean(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'boolean') {
    invalidInput(`${key} must be a boolean.`);
  }
  return value;
}

function nonNegativeInteger(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    invalidInput(`${key} must be a non-negative integer.`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  input: Record<string, unknown>,
  key: string,
  values: T
): T[number] {
  const value = string(input, key);
  if (!values.includes(value)) {
    invalidInput(`${key} is invalid.`);
  }
  return value as T[number];
}

function credentialInput(
  value: unknown
): CreateConnectionInput['credential'] {
  const input = objectField({ credential: value }, 'credential');
  const expiresAt = optionalTimestamp(input, 'expiresAt');
  const refreshExpiresAt = optionalTimestamp(input, 'refreshExpiresAt');
  const status =
    input.status === undefined
      ? undefined
      : oneOf(input, 'status', [
          'active',
          'revoked',
          'expired',
          'unverified',
        ] as const);
  return {
    value: string(input, 'value'),
    scope: stringList(input, 'scope'),
    ...(expiresAt ? { expiresAt } : {}),
    ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
    ...(status ? { status } : {}),
  };
}

function createConnectionInput(
  payload: Record<string, unknown>
): CreateConnectionInput {
  const subject = optionalString(payload, 'subject');
  const identityMode = oneOf(payload, 'identityMode', [
    'oauth_user',
    'service',
    'byok',
  ] as const);
  const input: CreateConnectionInput = {
    id: string(payload, 'id'),
    provider: oneOf(payload, 'provider', [
      'douyin',
      'feishu',
      'model',
    ] as const),
    identityMode,
    requestedCapabilities: stringList(payload, 'requestedCapabilities'),
    grantedCapabilities: optionalStringList(payload, 'grantedCapabilities'),
    ...(subject ? { subject } : {}),
    credential: credentialInput(payload.credential),
  };
  if (identityMode === 'oauth_user') {
    input.grantedCapabilities = [];
    input.credential.status = 'unverified';
  }
  return input;
}

function strictByokInput(
  payload: Record<string, unknown>,
  idempotencyKey: string
): SubmitStrictByokInput {
  return {
    connectionId: string(payload, 'connectionId'),
    endpointProfileId: string(payload, 'endpointProfileId'),
    catalogModelId: string(payload, 'catalogModelId'),
    prompt: string(payload, 'prompt'),
    idempotencyKey,
  };
}

function douyinCapabilityInput(payload: Record<string, unknown>) {
  return {
    connectionId: string(payload, 'connectionId'),
    capability: oneOf(payload, 'capability', [
      'publish',
      'observe',
      'publish.poi',
      'publish.mini_program',
    ] as const) satisfies DouyinCapability,
  };
}

function douyinPublishAnchor(value: unknown): DouyinPublishAnchor | undefined {
  if (value === undefined) return undefined;
  const input = objectField({ anchor: value }, 'anchor');
  return {
    id: string(input, 'id'),
    kind: oneOf(input, 'kind', ['poi', 'mini_program'] as const),
  };
}

function feishuShortcuts(
  payload: Record<string, unknown>
): FeishuToolShortcut[] {
  if (!Array.isArray(payload.shortcuts)) {
    invalidInput('shortcuts must be an array.');
  }
  return payload.shortcuts.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidInput(`shortcuts[${index}] must be an object.`);
    }
    const shortcut = value as Record<string, unknown>;
    return {
      toolId: string(shortcut, 'toolId'),
      order: nonNegativeInteger(shortcut, 'order'),
      hidden: boolean(shortcut, 'hidden'),
    };
  });
}

function publicHttpsUrl(value?: string) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function integrationContext(context: P1Context): IntegrationContext {
  return {
    ...context,
    role: context.actor === 'worker' ? 'worker' : 'owner',
  };
}

function publicConnection<
  T extends { secretRef: string; credentialTransition?: unknown },
>(connection: T) {
  const {
    secretRef: _secretRef,
    credentialTransition: _credentialTransition,
    ...view
  } = connection;
  return view;
}

function publicDouyinPublishJob(
  job: Awaited<
    ReturnType<IntegrationApplicationService['getDouyinOperationsSnapshot']>
  >['publishJobs'][number]
) {
  return {
    acceptance: job.acceptance,
    confirmationId: job.confirmationId,
    createdAt: job.createdAt,
    effectState: job.effectState,
    anchor: job.anchor,
    id: job.id,
    itemId: job.itemId,
    lastErrorCode: job.lastErrorCode,
    nextPollAt: job.nextPollAt,
    pollAttempts: job.pollAttempts,
    pollDeadlineAt: job.pollDeadlineAt,
    pollingState: job.pollingState,
    pollLimit: job.pollLimit,
    status: job.status,
    updatedAt: job.updatedAt,
    videoId: job.videoId,
  };
}

export class IntegrationsFoundationModule implements P1OperationModule {
  readonly name = 'integrations';
  private readonly adminActorIds: Set<string>;
  private readonly providerCredentialOperator?: ProviderCredentialOperatorPort;
  private readonly providerCredentialSources?: ProviderCredentialRuntimeSources;

  constructor(
    private readonly integrations: IntegrationApplicationService,
    options: IntegrationsFoundationModuleOptions = {}
  ) {
    this.adminActorIds = new Set(options.adminActorIds ?? []);
    this.providerCredentialOperator = options.providerCredentialOperator;
    this.providerCredentialSources = options.providerCredentialSources;
  }

  private adminContext(context: P1Context): IntegrationContext {
    if (
      context.actor !== 'admin' &&
      !this.adminActorIds.has(context.userId)
    ) {
      throw new IntegrationError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    return { ...context, role: 'admin' };
  }

  private platformCredentialContext(context: P1Context): IntegrationContext {
    return { ...this.adminContext(context), workspaceId: '__global__' };
  }

  private platformCredentialId(payload: Record<string, unknown>) {
    const slot = oneOf(payload, 'slot', [
      'model.direct',
      'ark.media',
      'douyin.platform',
    ] as const);
    return { id: `platform:${slot}`, slot };
  }

  private providerCredentialEffectiveSource(
    id: string,
  ): ProviderCredentialEffectiveSource {
    switch (id) {
      case 'platform:model.direct':
        return this.providerCredentialSources?.modelDirect.source ?? 'env';
      case 'platform:ark.media':
        return this.providerCredentialSources?.arkMedia.source ?? 'env';
      default:
        return 'env';
    }
  }

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const context = integrationContext(args.context);
    const action = string(args.input, 'action');
    const payload = object(args.input.payload ?? {});

    switch (action) {
      case 'admin_store_provider_credential': {
        const { id, slot } = this.platformCredentialId(payload);
        const connection = await this.integrations.createConnection(
          this.platformCredentialContext(args.context),
          {
            id,
            provider: slot === 'douyin.platform' ? 'douyin' : 'model',
            identityMode: 'service',
            requestedCapabilities: [slot],
            grantedCapabilities: [slot],
            subject: slot,
            credential: credentialInput(payload.credential),
          },
          args.idempotencyKey,
        );
        await this.providerCredentialOperator?.provisionConnection(connection);
        return publicConnection(connection);
      }
      case 'admin_rotate_provider_credential': {
        const { id } = this.platformCredentialId(payload);
        const credential = credentialInput(payload.credential);
        if (this.providerCredentialOperator) {
          return this.providerCredentialOperator.stageRotation({
            workspaceId: '__global__',
            accountId: `credential-account:${id}`,
            secret: credential.value,
          });
        }
        const connection = await this.integrations.rotateConnectionCredential(
          this.platformCredentialContext(args.context),
          id,
          credential,
          args.idempotencyKey,
        );
        return publicConnection(connection);
      }
      case 'admin_revoke_provider_credential': {
        const { id } = this.platformCredentialId(payload);
        return publicConnection(
          await this.integrations.disconnectConnection(
            this.platformCredentialContext(args.context),
            id,
            args.idempotencyKey,
          ),
        );
      }
      case 'admin_test_provider_connection': {
        const { id } = this.platformCredentialId(payload);
        return publicConnection(
          await this.integrations.testProviderConnection(
            this.platformCredentialContext(args.context),
            id,
          ),
        );
      }
      case 'create_connection':
        return publicConnection(
          await this.integrations.createConnection(
            context,
            createConnectionInput(payload),
            args.idempotencyKey
          )
        );
      case 'rotate_credential':
        return publicConnection(
          await this.integrations.rotateConnectionCredential(
            context,
            string(payload, 'connectionId'),
            credentialInput(payload.credential),
            args.idempotencyKey
          )
        );
      case 'disconnect':
        return publicConnection(
          await this.integrations.disconnectConnection(
            context,
            string(payload, 'connectionId'),
            args.idempotencyKey
          )
        );
      case 'submit_strict_byok':
        return this.integrations.submitStrictByok(
          context,
          strictByokInput(payload, args.idempotencyKey)
        );
      case 'activate_douyin_capability':
        return publicConnection(
          await this.integrations.activateDouyinCapability(
            context,
            douyinCapabilityInput(payload)
          )
        );
      case 'deactivate_douyin_capability':
        return publicConnection(
          await this.integrations.deactivateDouyinCapability(
            context,
            douyinCapabilityInput(payload)
          )
        );
      case 'refresh_douyin_oauth':
        return publicConnection(
          await this.integrations.refreshDouyinOAuth(
            context,
            string(payload, 'connectionId'),
            args.idempotencyKey
          )
        );
      case 'confirm_douyin_publish':
        return this.integrations.confirmDouyinPublish(context, {
          accountSubject: string(payload, 'accountSubject'),
          anchor: douyinPublishAnchor(payload.anchor),
          connectionId: string(payload, 'connectionId'),
          contentSnapshotId: string(payload, 'contentSnapshotId'),
          scheduledAt: timestamp(payload, 'scheduledAt'),
        });
      case 'submit_douyin_publish':
        return this.integrations.submitDouyinPublish(context, {
          confirmationId: string(payload, 'confirmationId'),
          contentSnapshotId: string(payload, 'contentSnapshotId'),
          idempotencyKey: args.idempotencyKey,
          scheduledAt: timestamp(payload, 'scheduledAt'),
        });
      case 'refresh_douyin_publish':
        return this.integrations.refreshDouyinPublishStatus(
          context,
          string(payload, 'jobId')
        );
      case 'sync_douyin_observe':
        return this.integrations.syncDouyinObserve(
          context,
          string(payload, 'connectionId')
        );
      case 'sync_feishu_tools':
        return this.integrations.syncFeishuToolCatalog(
          this.adminContext(args.context),
          string(payload, 'connectionId')
        );
      case 'sync_publish_feishu_tools':
        return this.integrations.syncAndPublishFeishuToolCatalog(
          this.adminContext(args.context),
          string(payload, 'connectionId')
        );
      case 'publish_feishu_tool':
        return this.integrations.publishFeishuToolRevision(
          this.adminContext(args.context),
          string(payload, 'toolId'),
          string(payload, 'revisionId')
        );
      case 'verify_feishu_connection':
        return publicConnection(
          await this.integrations.verifyFeishuConnection(
            context,
            string(payload, 'connectionId')
          )
        );
      case 'execute_feishu_intent':
        return this.integrations.executeFeishuIntent(context, {
          arguments: object(payload.arguments),
          connectionId: string(payload, 'connectionId'),
          fields: stringList(payload, 'fields'),
          idempotencyKey: args.idempotencyKey,
          sideEffect: oneOf(payload, 'sideEffect', [
            'read',
            'create',
            'edit',
            'send',
            'delete',
            'overwrite',
          ] as const),
          source: oneOf(payload, 'source', [
            'explicit_user',
            'autonomous',
          ] as const),
          targetObjectId: optionalString(payload, 'targetObjectId'),
          toolId: string(payload, 'toolId'),
        });
      case 'set_feishu_shortcuts':
        return this.integrations.setFeishuShortcuts(
          context,
          string(payload, 'connectionId'),
          feishuShortcuts(payload)
        );
      case 'confirm_feishu_intent':
        return this.integrations.confirmFeishuIntent(context, {
          arguments: object(payload.arguments),
          idempotencyKey: args.idempotencyKey,
          intentId: string(payload, 'intentId'),
        });
      case 'reconcile_feishu_intent':
        return this.integrations.reconcileFeishuIntent(
          context,
          string(payload, 'intentId')
        );
      default:
        throw new Error(`Unknown integrations command ${action}.`);
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const context = integrationContext(args.context);
    const action = string(args.input, 'action');
    const payload = object(args.input.payload ?? {});
    switch (action) {
      case 'admin_provider_credentials':
        {
          if (this.providerCredentialOperator) {
            const platformContext = this.platformCredentialContext(
              args.context,
            );
            const accounts = new Map(
              (
                await this.providerCredentialOperator.listAccounts(
                  platformContext.workspaceId,
                )
              ).map((account) => [account.connectionId, account]),
            );
            return PROVIDER_CREDENTIAL_SLOTS.map((slot) => {
              const id = `platform:${slot}`;
              const account = accounts.get(id);
              if (!account) {
                return {
                  id,
                  effectiveSource: this.providerCredentialEffectiveSource(id),
                };
              }
              const {
                id: credentialAccountId,
                secretReference: _secretReference,
                ...metadata
              } = toPublicMetadata(account);
              return {
                ...metadata,
                id,
                credentialAccountId,
                accountStatus: account.status,
                workspaceId: account.workspaceId,
                credential: {
                  id: account.credentialId,
                  version: account.secretVersion,
                  mask: '••••••••' as const,
                  scope: [],
                  status:
                    account.status === 'active'
                      ? ('active' as const)
                      : account.status === 'retired'
                        ? ('revoked' as const)
                        : ('unverified' as const),
                  ...(account.lastTest
                    ? {
                        testedAt: account.lastTest.testedAt,
                        testStatus: account.lastTest.status,
                        ...(account.lastTest.errorCode
                          ? { testErrorCode: account.lastTest.errorCode }
                          : {}),
                      }
                    : {}),
                },
                effectiveSource: this.providerCredentialEffectiveSource(id),
              };
            });
          }
          const connections = new Map(
            (
              await this.integrations.listConnections(
                this.platformCredentialContext(args.context),
              )
            ).map((connection) => [connection.id, connection]),
          );
          return PROVIDER_CREDENTIAL_SLOTS.map((slot) => {
            const id = `platform:${slot}`;
            const connection = connections.get(id);
            return {
              ...(connection ? publicConnection(connection) : { id }),
              effectiveSource: this.providerCredentialEffectiveSource(id),
            };
          });
        }
      case 'connection':
        return publicConnection(
          await this.integrations.getConnection(
            context,
            string(payload, 'connectionId')
          )
        );
      case 'connections':
        return (await this.integrations.listConnections(context)).map(
          publicConnection
        );
      case 'douyin_integration_status':
        return this.integrations.getDouyinIntegrationStatus(context);
      case 'audit':
        return this.integrations.listIntegrationAudit(context);
      case 'douyin_projection':
        return publicConnection(
          await this.integrations.getDouyinConnectionProjection(
            context,
            string(payload, 'connectionId')
          )
        );
      case 'strict_byok_options':
        return this.integrations.getStrictByokOptions(context);
      case 'douyin_operations_snapshot': {
        const snapshot = await this.integrations.getDouyinOperationsSnapshot(
          context,
          string(payload, 'connectionId')
        );
        return {
          ...snapshot,
          publishJobs: snapshot.publishJobs.map(publicDouyinPublishJob),
        };
      }
      case 'douyin_content_snapshots':
        return this.integrations.listDouyinContentSnapshots(context);
      case 'feishu_activity':
        return (
          await this.integrations.listFeishuActivity(
            context,
            string(payload, 'connectionId')
          )
        ).map((activity) => ({
          executedAt: activity.executedAt,
          ...(publicHttpsUrl(activity.externalUrl)
            ? { externalUrl: publicHttpsUrl(activity.externalUrl) }
            : {}),
          id: activity.id,
          status: activity.status,
          toolId: activity.toolId,
        }));
      case 'feishu_tool_catalog':
        return (
          await this.integrations.listFeishuToolCatalog(
            context,
            string(payload, 'connectionId')
          )
        ).filter((revision) => revision.status === 'published');
      case 'admin_feishu_tool_catalog':
        return this.integrations.listFeishuToolRevisionCatalog(
          this.adminContext(args.context)
        );
      case 'feishu_shortcuts':
        return this.integrations.listFeishuShortcuts(
          context,
          string(payload, 'connectionId')
        );
      case 'feishu_pending_intents':
        return (
          await this.integrations.listFeishuPendingIntents(
            context,
            string(payload, 'connectionId')
          )
        ).map((intent) => ({
          confirmationTaskId: intent.confirmationTaskId,
          createdAt: intent.createdAt,
          fields: [...intent.fields],
          id: intent.id,
          sideEffect: intent.sideEffect,
          status: intent.status,
          targetObjectId: intent.targetObjectId,
          toolId: intent.toolId,
        }));
      case 'feishu_intent_recovery':
        return (
          await this.integrations.listFeishuIntentRecovery(
            context,
            string(payload, 'connectionId')
          )
        ).map((intent) => ({
          createdAt: intent.createdAt,
          effectState: intent.effectState,
          id: intent.id,
          lastErrorCode: intent.lastErrorCode,
          outcomeStatus: intent.outcomeStatus,
          status: intent.status,
          toolId: intent.toolId,
        }));
      default:
        throw new Error(`Unknown integrations query ${action}.`);
    }
  }
}
