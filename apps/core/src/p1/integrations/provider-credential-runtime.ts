/**
 * Provider credential runtime + G2 migration adapter.
 *
 * Boot path still binds vault → env for process assembly (existing behavior).
 * Request-time path exposes CredentialSecretBrokerPort so provider runtime
 * assembles by frozen CredentialAccount version. I-lane only consumes the port.
 *
 * Does not create a second secret vault — reuses SecretStorePort backends.
 */
import { IntegrationError, type SecretStorePort } from './contracts.js';
import type { IntegrationRepository } from './repository.js';
import {
  specializeCredentialAccount,
  type CredentialAccount,
} from '../supply-registry/credential-account.js';
import {
  RequestTimeSecretBroker,
  type AssembleCredentialRequest,
  type AssembledCredential,
  type CredentialAccountDirectory,
  type CredentialSecretBrokerPort,
} from '../supply-registry/secret-broker.js';
import {
  buildEnvFallbackMonitorView,
  classifyBootCredentialSource,
  type EnvFallbackMonitorView,
} from '../supply-registry/env-fallback-monitor.js';
import type { FixedCredentialSlot } from '../supply-registry/credential-slots.js';

const GLOBAL_WORKSPACE_ID = '__global__';

export type ProviderCredentialRuntimeSource =
  | { source: 'vault'; credentialVersion: number }
  | { source: 'env_fallback' };

export interface ProviderCredentialRuntimeSources {
  modelDirect: ProviderCredentialRuntimeSource;
  arkMedia: ProviderCredentialRuntimeSource;
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

const SLOT_PROVIDER_PROFILE: Record<
  'model.direct' | 'ark.media' | 'douyin.platform',
  string
> = {
  'model.direct': 'provider-tu-zi',
  'ark.media': 'provider-bytedance-volcengine',
  'douyin.platform': 'provider-douyin-platform',
};

const SLOT_LABEL: Record<
  'model.direct' | 'ark.media' | 'douyin.platform',
  string
> = {
  'model.direct': 'Platform model.direct',
  'ark.media': 'Platform ark.media',
  'douyin.platform': 'Platform douyin.platform',
};

export async function providerCredentialEnvFromVault(
  repository: IntegrationRepository,
  secrets: SecretStorePort,
  env: NodeJS.ProcessEnv,
): Promise<{
  env: NodeJS.ProcessEnv;
  sources: ProviderCredentialRuntimeSources;
}> {
  const sourcedEnv = { ...env };
  const modelDirect = await bindCredential({
    repository,
    secrets,
    slot: 'model.direct',
    apiKeyName: 'MODEL_DIRECT_API_KEY',
    credentialVersionName: 'MODEL_DIRECT_CREDENTIAL_VERSION',
    activationKeys: DIRECT_ACTIVATION_KEYS,
    env: sourcedEnv,
  });
  const arkMedia = await bindCredential({
    repository,
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
  repository: IntegrationRepository;
  secrets: SecretStorePort;
  slot: 'model.direct' | 'ark.media';
  apiKeyName: 'MODEL_DIRECT_API_KEY' | 'ARK_MEDIA_API_KEY';
  credentialVersionName:
    | 'MODEL_DIRECT_CREDENTIAL_VERSION'
    | 'ARK_MEDIA_CREDENTIAL_VERSION';
  activationKeys: readonly string[];
  env: NodeJS.ProcessEnv;
}): Promise<ProviderCredentialRuntimeSource> {
  const connection = await input.repository.getConnection(
    GLOBAL_WORKSPACE_ID,
    `platform:${input.slot}`,
  );
  if (
    !connection ||
    connection.subject !== input.slot ||
    connection.status !== 'available' ||
    connection.credential.status !== 'active' ||
    connection.credentialTransition
  ) {
    return { source: 'env_fallback' };
  }
  let credential: string;
  try {
    credential = await input.secrets.use(connection.secretRef, {
      workspaceId: connection.workspaceId,
      credentialId: connection.credential.id,
      version: connection.credential.version,
      provider: connection.provider,
    });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND') {
      return { source: 'env_fallback' };
    }
    throw error;
  }
  input.env[input.apiKeyName] = credential;
  input.env[input.credentialVersionName] = String(
    connection.credential.version,
  );
  for (const key of input.activationKeys) delete input.env[key];
  return {
    source: 'vault',
    credentialVersion: connection.credential.version,
  };
}

/**
 * Directory that specializes IntegrationConnection rows into CredentialAccount
 * metadata without a second secret vault.
 */
export class IntegrationCredentialAccountDirectory
  implements CredentialAccountDirectory
{
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly workspaceId: string = GLOBAL_WORKSPACE_ID,
  ) {}

  async get(id: string): Promise<CredentialAccount | null> {
    // Accept both credential-account:platform:slot and platform:slot forms.
    const connectionId = id.startsWith('credential-account:')
      ? id.slice('credential-account:'.length)
      : id;
    const connection = await this.repository.getConnection(
      this.workspaceId,
      connectionId,
    );
    if (!connection) return null;
    const slot =
      connection.subject === 'model.direct' ||
      connection.subject === 'ark.media' ||
      connection.subject === 'douyin.platform'
        ? connection.subject
        : connection.id.replace(/^platform:/, '');
    const knownSlot =
      slot === 'model.direct' ||
      slot === 'ark.media' ||
      slot === 'douyin.platform'
        ? slot
        : null;
    return specializeCredentialAccount({
      connection,
      label: knownSlot ? SLOT_LABEL[knownSlot] : connection.id,
      providerProfileId: knownSlot
        ? SLOT_PROVIDER_PROFILE[knownSlot]
        : `provider:${connection.provider}`,
      type: knownSlot ?? connection.subject ?? connection.id,
      scope:
        connection.identityMode === 'byok' ? 'workspace_byok' : 'platform',
      source: connection.secretRef ? 'registry' : 'migration',
    });
  }
}

/**
 * G2 migration adapter: request-time secret broker over existing
 * IntegrationConnection + SecretStorePort. I-lane consumes this port only.
 */
export function createProviderCredentialSecretBroker(
  repository: IntegrationRepository,
  secrets: SecretStorePort,
  workspaceId: string = GLOBAL_WORKSPACE_ID,
): CredentialSecretBrokerPort {
  return new RequestTimeSecretBroker(
    new IntegrationCredentialAccountDirectory(repository, workspaceId),
    secrets,
  );
}

/**
 * Assemble a provider credential by frozen version (request-time path).
 * Never silently upgrades to the account head version.
 */
export async function assembleProviderCredentialByFrozenVersion(
  broker: CredentialSecretBrokerPort,
  request: AssembleCredentialRequest,
): Promise<AssembledCredential> {
  return broker.assembleForRequest(request);
}

/**
 * Project boot sources into monitored env_fallback risk rows (bare env →
 * env_fallback with migration entry). Worker Secrets are not registry truth.
 */
export function projectProviderCredentialEnvFallbackMonitor(
  sources: ProviderCredentialRuntimeSources,
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
    'douyin.platform': {
      assembly: { kind: 'not_wired', reason: 'recorded_adapter' },
      runtimeBound: false,
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
