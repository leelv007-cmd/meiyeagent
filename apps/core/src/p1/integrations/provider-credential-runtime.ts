/**
 * Provider credential runtime + G2 migration adapter.
 *
 * Boot path still binds vault → env for process assembly (existing behavior).
 * Request-time path exposes CredentialSecretBrokerPort so provider runtime
 * assembles by frozen CredentialAccount version. I-lane only consumes the port.
 *
 * Does not create a second secret vault — reuses SecretStorePort backends.
 */
import {
  IntegrationError,
  type IntegrationConnection,
  type SecretStorePort,
} from './contracts.js';
import type { IntegrationRepository } from './repository.js';
import {
  PLATFORM_CREDENTIAL_WORKSPACE_ID,
  specializeCredentialAccount,
  toPublicMetadata,
  type CredentialAccount,
} from '../supply-registry/credential-account.js';
import {
  RequestTimeSecretBroker,
  type AssembleCredentialRequest,
  type AssembledCredential,
  type CredentialAccountDirectory,
  type CredentialConnectivityTestBrokerPort,
  type CredentialSecretBrokerPort,
} from '../supply-registry/secret-broker.js';
import { transitionCredentialLifecycle } from '../supply-registry/credential-lifecycle.js';
import type { ProviderConnectivityStatus } from './provider-connectivity.js';
import {
  buildEnvFallbackMonitorView,
  classifyBootCredentialSource,
  type EnvFallbackMonitorView,
} from '../supply-registry/env-fallback-monitor.js';
import type { FixedCredentialSlot } from '../supply-registry/credential-slots.js';

const GLOBAL_WORKSPACE_ID = PLATFORM_CREDENTIAL_WORKSPACE_ID;

export type ProviderCredentialRuntimeSource =
  | { source: 'vault'; credentialVersion: number }
  | { source: 'env_fallback' };

export interface ProviderCredentialRuntimeSources {
  modelDirect: ProviderCredentialRuntimeSource;
  arkMedia: ProviderCredentialRuntimeSource;
}

export interface ProviderCredentialAccountRepository {
  getCredentialAccount(
    workspaceId: string,
    accountId: string
  ): Promise<{ account: CredentialAccount; recordRevision: number } | null>;
  saveCredentialAccount(
    workspaceId: string,
    account: CredentialAccount,
    expectedRecordRevision: number | null
  ): Promise<number>;
  listCredentialAccounts(
    workspaceId: string
  ): Promise<Array<{ account: CredentialAccount; recordRevision: number }>>;
}

export interface ProviderCredentialSecureWriteReceipt {
  id: string;
  workspaceId: string;
  accountId: string;
  nextSecretVersion: number;
  expiresAt: string;
}

export interface ProviderCredentialSecureWriteReceiptIssuer {
  issue(input: {
    workspaceId: string;
    accountId: string;
    secretReference: string;
    expiresAt: string;
    now?: string;
  }): Promise<ProviderCredentialSecureWriteReceipt>;
}

export interface ProviderCredentialOperatorPort {
  listAccounts(workspaceId: string): Promise<CredentialAccount[]>;
  provisionConnection(
    connection: IntegrationConnection
  ): Promise<CredentialAccount>;
  stageRotation(input: {
    workspaceId: string;
    accountId: string;
    secret: string;
  }): Promise<{
    account: ReturnType<typeof toPublicMetadata>;
    secureWriteReceipt: ProviderCredentialSecureWriteReceipt;
  }>;
  recordConnectivityResult(
    input: ProviderCredentialConnectivityVerificationInput
  ): Promise<ProviderCredentialConnectivityVerificationResult>;
}

export interface ProviderCredentialConnectivityVerificationInput {
  workspaceId: string;
  accountId: string;
  expectedVersion: string;
  status: ProviderConnectivityStatus;
  testedAt: string;
  evidenceRef: string;
  errorCode?: string;
}

export interface ProviderCredentialConnectivityVerificationResult {
  account: ReturnType<typeof toPublicMetadata>;
  activated: boolean;
}

export interface ProviderCredentialConnectivityVerificationPort {
  recordConnectivityResult(
    input: ProviderCredentialConnectivityVerificationInput
  ): Promise<ProviderCredentialConnectivityVerificationResult>;
}

const DIRECT_ACTIVATION_KEYS = [
  'MODEL_DIRECT_ACTIVATION_CONFIGURATION_REVISION',
  'MODEL_DIRECT_ACTIVATION_EVIDENCE_REF',
  'MODEL_DIRECT_ACTIVATION_VERIFIED_AT',
] as const;

const ARK_ACTIVATION_KEYS = [
  'ARK_SEEDANCE_ACTIVATION_CONFIGURATION_REVISION',
  'ARK_SEEDANCE_ACTIVATION_EVIDENCE_REF',
  'ARK_SEEDANCE_ACTIVATION_VERIFIED_AT',
  'ARK_SEEDREAM_ACTIVATION_CONFIGURATION_REVISION',
  'ARK_SEEDREAM_ACTIVATION_EVIDENCE_REF',
  'ARK_SEEDREAM_ACTIVATION_VERIFIED_AT',
] as const;

const SLOT_PROVIDER_PROFILE: Record<'model.direct' | 'ark.media', string> = {
  'model.direct': 'provider-tu-zi',
  'ark.media': 'provider-bytedance-volcengine',
};

const SLOT_LABEL: Record<'model.direct' | 'ark.media', string> = {
  'model.direct': 'Platform model.direct',
  'ark.media': 'Platform ark.media',
};

export async function providerCredentialEnvFromVault(
  repository: ProviderCredentialAccountRepository,
  secrets: SecretStorePort,
  env: NodeJS.ProcessEnv,
  workspaceId: string = GLOBAL_WORKSPACE_ID
): Promise<{
  env: NodeJS.ProcessEnv;
  sources: ProviderCredentialRuntimeSources;
}> {
  const sourcedEnv = { ...env };
  const directory = new PostgresCredentialAccountDirectory(
    repository,
    workspaceId
  );
  const modelDirect = await bindCredential({
    directory,
    secrets,
    slot: 'model.direct',
    apiKeyName: 'MODEL_DIRECT_API_KEY',
    credentialVersionName: 'MODEL_DIRECT_CREDENTIAL_VERSION',
    activationKeys: DIRECT_ACTIVATION_KEYS,
    env: sourcedEnv,
  });
  const arkMedia = await bindCredential({
    directory,
    secrets,
    slot: 'ark.media',
    apiKeyName: 'ARK_MEDIA_API_KEY',
    credentialVersionName: 'ARK_MEDIA_CREDENTIAL_VERSION',
    activationKeys: ARK_ACTIVATION_KEYS,
    env: sourcedEnv,
  });
  return { env: sourcedEnv, sources: { arkMedia, modelDirect } };
}

async function bindCredential(input: {
  directory: CredentialAccountDirectory;
  secrets: SecretStorePort;
  slot: 'model.direct' | 'ark.media';
  apiKeyName: 'MODEL_DIRECT_API_KEY' | 'ARK_MEDIA_API_KEY';
  credentialVersionName:
    | 'MODEL_DIRECT_CREDENTIAL_VERSION'
    | 'ARK_MEDIA_CREDENTIAL_VERSION';
  activationKeys: readonly string[];
  env: NodeJS.ProcessEnv;
}): Promise<ProviderCredentialRuntimeSource> {
  const account = await input.directory.get(
    `credential-account:platform:${input.slot}`
  );
  if (!account || account.type !== input.slot || account.status !== 'active') {
    return { source: 'env_fallback' };
  }
  let credential: string;
  try {
    credential = await input.secrets.use(account.secretReference, {
      workspaceId: account.workspaceId,
      credentialId: account.credentialId,
      version: account.secretVersion,
      provider: account.provider,
    });
  } catch (error) {
    if (
      error instanceof IntegrationError &&
      error.code === 'SECRET_NOT_FOUND'
    ) {
      return { source: 'env_fallback' };
    }
    throw error;
  }
  input.env[input.apiKeyName] = credential;
  input.env[input.credentialVersionName] = String(account.secretVersion);
  for (const key of input.activationKeys) delete input.env[key];
  return {
    source: 'vault',
    credentialVersion: account.secretVersion,
  };
}

/** PostgreSQL CredentialAccount directory used by boot and request-time paths. */
export class PostgresCredentialAccountDirectory
  implements CredentialAccountDirectory
{
  constructor(
    private readonly repository: ProviderCredentialAccountRepository,
    private readonly workspaceId: string = GLOBAL_WORKSPACE_ID
  ) {}

  async get(id: string): Promise<CredentialAccount | null> {
    const accountId = id.startsWith('credential-account:')
      ? id
      : `credential-account:${id}`;
    const row = await this.repository.getCredentialAccount(
      this.workspaceId,
      accountId
    );
    return row?.account ?? null;
  }
}

/**
 * G2 migration adapter: request-time secret broker over existing
 * IntegrationConnection + SecretStorePort. I-lane consumes this port only.
 */
export function createProviderCredentialSecretBroker(
  repository: ProviderCredentialAccountRepository,
  secrets: SecretStorePort,
  workspaceId: string = GLOBAL_WORKSPACE_ID
): CredentialConnectivityTestBrokerPort {
  return new RequestTimeSecretBroker(
    new PostgresCredentialAccountDirectory(repository, workspaceId),
    secrets
  );
}

/**
 * Provisioning/secure-write bridge. IntegrationConnection is accepted only at
 * the write boundary; runtime reads never consult IntegrationRepository.
 */
export class ProviderCredentialAccountProvisioner
  implements
    ProviderCredentialOperatorPort,
    ProviderCredentialConnectivityVerificationPort
{
  constructor(
    private readonly repository: ProviderCredentialAccountRepository,
    private readonly receipts: ProviderCredentialSecureWriteReceiptIssuer,
    private readonly secrets: SecretStorePort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async listAccounts(workspaceId: string): Promise<CredentialAccount[]> {
    return (await this.repository.listCredentialAccounts(workspaceId)).map(
      (row) => row.account
    );
  }

  async recordConnectivityResult(
    input: ProviderCredentialConnectivityVerificationInput
  ): Promise<ProviderCredentialConnectivityVerificationResult> {
    const row = await this.repository.getCredentialAccount(
      input.workspaceId,
      input.accountId
    );
    if (!row) {
      throw new IntegrationError(
        'CONNECTION_NOT_FOUND',
        'CredentialAccount must exist before connectivity verification.',
        404
      );
    }
    if (row.account.version !== input.expectedVersion) {
      throw new IntegrationError(
        'IDEMPOTENCY_CONFLICT',
        `CredentialAccount ${input.accountId} changed before connectivity verification.`,
        409
      );
    }
    let next = transitionCredentialLifecycle(
      row.account,
      {
        kind: 'record_test',
        evidence: {
          status: input.status,
          testedAt: input.testedAt,
          evidenceRef: input.evidenceRef,
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        },
      },
      { now: input.testedAt }
    );
    if (input.status === 'passed') {
      next = transitionCredentialLifecycle(
        next,
        { kind: 'activate' },
        { now: input.testedAt }
      );
    }
    await this.repository.saveCredentialAccount(
      input.workspaceId,
      next,
      row.recordRevision
    );
    return {
      account: toPublicMetadata(next),
      activated: next.status === 'active',
    };
  }

  async provisionConnection(
    connection: IntegrationConnection
  ): Promise<CredentialAccount> {
    return provisionProviderCredentialConnection(this.repository, connection);
  }

  async stageRotation(input: {
    workspaceId: string;
    accountId: string;
    secret: string;
  }) {
    const row = await this.repository.getCredentialAccount(
      input.workspaceId,
      input.accountId
    );
    if (!row) {
      throw new IntegrationError(
        'CONNECTION_NOT_FOUND',
        'CredentialAccount must be provisioned before secure rotation.',
        404
      );
    }
    const nextSecretVersion = row.account.secretVersion + 1;
    const secretContext = {
      workspaceId: row.account.workspaceId,
      credentialId: row.account.credentialId,
      provider: row.account.provider,
      version: nextSecretVersion,
    };
    const secretReference = await this.secrets.put(secretContext, input.secret);
    const issuedAt = this.clock();
    try {
      const secureWriteReceipt = await this.receipts.issue({
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        secretReference,
        now: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 15 * 60 * 1_000).toISOString(),
      });
      return {
        account: toPublicMetadata(row.account),
        secureWriteReceipt,
      };
    } catch (error) {
      await this.secrets.revoke(secretReference, secretContext);
      throw error;
    }
  }
}

function credentialAccountFromProviderConnection(
  connection: IntegrationConnection
): CredentialAccount {
  const slot =
    connection.subject === 'model.direct' ||
    connection.subject === 'ark.media'
      ? connection.subject
      : null;
  return specializeCredentialAccount({
    connection,
    label: slot ? SLOT_LABEL[slot] : connection.id,
    providerProfileId: slot
      ? SLOT_PROVIDER_PROFILE[slot]
      : `provider:${connection.provider}`,
    type: slot ?? connection.subject ?? connection.id,
    scope: connection.identityMode === 'byok' ? 'workspace_byok' : 'platform',
    source: 'registry',
  });
}

/** One-time compatibility migration. Existing PostgreSQL heads always win. */
export async function migrateProviderCredentialAccountsFromIntegrations(
  integrations: IntegrationRepository,
  repository: ProviderCredentialAccountRepository,
  workspaceId: string = GLOBAL_WORKSPACE_ID
): Promise<void> {
  for (const slot of ['model.direct', 'ark.media'] as const) {
    const connection = await integrations.getConnection(
      workspaceId,
      `platform:${slot}`
    );
    if (connection) {
      await provisionProviderCredentialConnection(repository, connection);
    }
  }
}

async function provisionProviderCredentialConnection(
  repository: ProviderCredentialAccountRepository,
  connection: IntegrationConnection
): Promise<CredentialAccount> {
  const account = credentialAccountFromProviderConnection(connection);
  const existing = await repository.getCredentialAccount(
    connection.workspaceId,
    account.id
  );
  if (existing) {
    assertProviderCredentialIdentity(existing.account, account);
    return existing.account;
  }
  try {
    await repository.saveCredentialAccount(
      connection.workspaceId,
      account,
      null
    );
    return account;
  } catch (error) {
    const winner = await repository.getCredentialAccount(
      connection.workspaceId,
      account.id
    );
    if (!winner) throw error;
    assertProviderCredentialIdentity(winner.account, account);
    return winner.account;
  }
}

function assertProviderCredentialIdentity(
  stored: CredentialAccount,
  candidate: CredentialAccount
): void {
  if (
    stored.connectionId !== candidate.connectionId ||
    stored.credentialId !== candidate.credentialId ||
    stored.provider !== candidate.provider ||
    stored.workspaceId !== candidate.workspaceId
  ) {
    throw new IntegrationError(
      'CREDENTIAL_VERSION_CONFLICT',
      'CredentialAccount identity does not match the secure-write connection.',
      409
    );
  }
}

/**
 * Assemble a provider credential by frozen version (request-time path).
 * Never silently upgrades to the account head version.
 */
export async function assembleProviderCredentialByFrozenVersion(
  broker: CredentialSecretBrokerPort,
  request: AssembleCredentialRequest
): Promise<AssembledCredential> {
  return broker.assembleForRequest(request);
}

/**
 * Project boot sources into monitored env_fallback risk rows (bare env →
 * env_fallback with migration entry). Worker Secrets are not registry truth.
 */
export function projectProviderCredentialEnvFallbackMonitor(
  sources: ProviderCredentialRuntimeSources
): EnvFallbackMonitorView {
  const modelDirect = classifyBootCredentialSource(sources.modelDirect);
  const arkMedia = classifyBootCredentialSource(sources.arkMedia);
  const assemblies: Partial<
    Record<
      FixedCredentialSlot,
      {
        assembly: ReturnType<typeof classifyBootCredentialSource>['assembly'];
        runtimeBound?: boolean;
      }
    >
  > = {
    'model.direct': {
      assembly: modelDirect.assembly,
      runtimeBound: true,
    },
    'ark.media': {
      assembly: arkMedia.assembly,
      runtimeBound: true,
    },
  };
  return buildEnvFallbackMonitorView(assemblies);
}

export type {
  AssembleCredentialRequest,
  AssembledCredential,
  CredentialSecretBrokerPort,
  EnvFallbackMonitorView,
};
