import { IntegrationError, type SecretStorePort } from './contracts.js';
import type { IntegrationRepository } from './repository.js';

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
