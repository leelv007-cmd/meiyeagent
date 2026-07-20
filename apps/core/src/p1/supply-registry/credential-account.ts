/**
 * CredentialAccount specialization (G2 / D-060).
 *
 * Migrates IntegrationConnection + CredentialMetadata onto provider-account
 * metadata. Secret material stays exclusively in SecretStorePort (fake/file/AWS)
 * — this module never creates a second vault/repository.
 */
import type {
  CredentialAccountLifecycle,
  CredentialAccountMetadata,
  CredentialDrainSubstate,
} from '@meiye/contracts';
import type {
  CredentialMetadata,
  IntegrationConnection,
  IntegrationProvider,
} from '../integrations/contracts.js';

/** High-sensitivity credential governance actions (D-057 / D-060). */
export type CredentialSensitiveAction =
  | 'view_meta'
  | 'write_rotate'
  | 'test'
  | 'activate'
  | 'drain'
  | 'revoke';

/** Frozen version row retained for in-flight tasks (rotation never rewrites). */
export interface CredentialVersionSnapshot {
  version: string;
  secretReference: string;
  /** Numeric version for SecretStorePort AAD. */
  secretVersion: number;
  createdAt: string;
  source: CredentialAccountMetadata['source'];
  /** Never secret material — public mask only. */
  mask: CredentialMetadata['mask'];
}

/** Connectivity probe evidence used as the activation gate (not a lifecycle state). */
export type CredentialTestStatus =
  | 'passed'
  | 'unauthorized'
  | 'network_failed'
  | 'unknown'
  | 'not_wired';

export interface CredentialTestEvidence {
  status: CredentialTestStatus;
  testedAt: string;
  evidenceRef: string;
  errorCode?: string;
}

/**
 * Domain CredentialAccount — specializes IntegrationConnection for provider
 * accounts. Product API surfaces only `toPublicMetadata()`.
 */
export interface CredentialAccount {
  id: string;
  label: string;
  providerProfileId: string;
  projectRegion?: string;
  type: string;
  scope: CredentialAccountMetadata['scope'];
  secretReference: string;
  version: string;
  status: CredentialAccountLifecycle;
  drainSubstate: CredentialDrainSubstate;
  source: CredentialAccountMetadata['source'];
  verifiedAt?: string;
  expiresAt?: string;
  publicQuotaHint?: string;
  lastTestEvidenceRef?: string;
  /** Latest probe result; required for activate (activation gate). */
  lastTest?: CredentialTestEvidence;
  /** Migration source binding — not a second secret store. */
  connectionId: string;
  workspaceId: string;
  provider: IntegrationProvider;
  credentialId: string;
  secretVersion: number;
  /** Append-only; historical snapshots are never rewritten on rotate. */
  versionHistory: CredentialVersionSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface SpecializeCredentialAccountInput {
  connection: IntegrationConnection;
  label: string;
  providerProfileId: string;
  type: string;
  scope?: CredentialAccountMetadata['scope'];
  projectRegion?: string;
  publicQuotaHint?: string;
  source?: CredentialAccountMetadata['source'];
  status?: CredentialAccountLifecycle;
  drainSubstate?: CredentialDrainSubstate;
  now?: string;
}

function mapConnectionStatus(
  connection: IntegrationConnection,
): CredentialAccountLifecycle {
  if (
    connection.status === 'revoked' ||
    connection.status === 'disabled' ||
    connection.credential.status === 'revoked' ||
    connection.credential.status === 'expired'
  ) {
    return 'retired';
  }
  if (
    connection.status === 'available' &&
    connection.credential.status === 'active'
  ) {
    return 'active';
  }
  return 'pending';
}

function mapSource(
  connection: IntegrationConnection,
  explicit?: CredentialAccountMetadata['source'],
): CredentialAccountMetadata['source'] {
  if (explicit) return explicit;
  if (connection.secretRef.startsWith('env://')) return 'env_fallback';
  if (connection.id.startsWith('platform:')) return 'migration';
  return 'registry';
}

/**
 * Specialize an IntegrationConnection into a CredentialAccount without reading
 * or copying secret values.
 */
export function specializeCredentialAccount(
  input: SpecializeCredentialAccountInput,
): CredentialAccount {
  const { connection } = input;
  const now = input.now ?? new Date().toISOString();
  const version = String(connection.credential.version);
  const lastTest =
    connection.credential.testedAt && connection.credential.testStatus
      ? {
          status: connection.credential.testStatus as CredentialTestStatus,
          testedAt: connection.credential.testedAt,
          evidenceRef: `test://${connection.id}/v${version}/${connection.credential.testedAt}`,
          ...(connection.credential.testErrorCode
            ? { errorCode: connection.credential.testErrorCode }
            : {}),
        }
      : undefined;

  const snapshot: CredentialVersionSnapshot = {
    version,
    secretReference: connection.secretRef,
    secretVersion: connection.credential.version,
    createdAt: connection.createdAt,
    source: mapSource(connection, input.source),
    mask: connection.credential.mask,
  };

  return {
    id: `credential-account:${connection.id}`,
    label: input.label,
    providerProfileId: input.providerProfileId,
    ...(input.projectRegion ? { projectRegion: input.projectRegion } : {}),
    type: input.type,
    scope: input.scope ?? 'platform',
    secretReference: connection.secretRef,
    version,
    status: input.status ?? mapConnectionStatus(connection),
    drainSubstate: input.drainSubstate ?? 'none',
    source: mapSource(connection, input.source),
    ...(connection.credential.testedAt
      ? { verifiedAt: connection.credential.testedAt }
      : {}),
    ...(connection.credential.expiresAt
      ? { expiresAt: connection.credential.expiresAt }
      : {}),
    ...(input.publicQuotaHint
      ? { publicQuotaHint: input.publicQuotaHint }
      : {}),
    ...(lastTest ? { lastTestEvidenceRef: lastTest.evidenceRef, lastTest } : {}),
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    provider: connection.provider,
    credentialId: connection.credential.id,
    secretVersion: connection.credential.version,
    versionHistory: [snapshot],
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt || now,
  };
}

/**
 * Build a new CredentialAccount from registry metadata + secret reference only
 * (no IntegrationConnection required for pure registry paths).
 */
export function createCredentialAccount(input: {
  id: string;
  label: string;
  providerProfileId: string;
  type: string;
  scope: CredentialAccountMetadata['scope'];
  secretReference: string;
  version: string;
  secretVersion: number;
  credentialId: string;
  connectionId: string;
  workspaceId: string;
  provider: IntegrationProvider;
  source?: CredentialAccountMetadata['source'];
  status?: CredentialAccountLifecycle;
  drainSubstate?: CredentialDrainSubstate;
  projectRegion?: string;
  publicQuotaHint?: string;
  expiresAt?: string;
  now?: string;
}): CredentialAccount {
  const now = input.now ?? new Date().toISOString();
  const source = input.source ?? 'registry';
  return {
    id: input.id,
    label: input.label,
    providerProfileId: input.providerProfileId,
    ...(input.projectRegion ? { projectRegion: input.projectRegion } : {}),
    type: input.type,
    scope: input.scope,
    secretReference: input.secretReference,
    version: input.version,
    status: input.status ?? 'pending',
    drainSubstate: input.drainSubstate ?? 'none',
    source,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.publicQuotaHint
      ? { publicQuotaHint: input.publicQuotaHint }
      : {}),
    connectionId: input.connectionId,
    workspaceId: input.workspaceId,
    provider: input.provider,
    credentialId: input.credentialId,
    secretVersion: input.secretVersion,
    versionHistory: [
      {
        version: input.version,
        secretReference: input.secretReference,
        secretVersion: input.secretVersion,
        createdAt: now,
        source,
        mask: '••••••••',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Product API / admin projection — secret values never appear.
 */
export function toPublicMetadata(
  account: CredentialAccount,
): CredentialAccountMetadata {
  return {
    id: account.id,
    label: account.label,
    providerProfileId: account.providerProfileId,
    ...(account.projectRegion
      ? { projectRegion: account.projectRegion }
      : {}),
    type: account.type,
    scope: account.scope,
    secretReference: account.secretReference,
    version: account.version,
    status: account.status,
    drainSubstate: account.drainSubstate,
    source: account.source,
    ...(account.verifiedAt ? { verifiedAt: account.verifiedAt } : {}),
    ...(account.expiresAt ? { expiresAt: account.expiresAt } : {}),
    ...(account.publicQuotaHint
      ? { publicQuotaHint: account.publicQuotaHint }
      : {}),
    ...(account.lastTestEvidenceRef
      ? { lastTestEvidenceRef: account.lastTestEvidenceRef }
      : {}),
  };
}

/**
 * Assert a public payload never carries secret material (negative check).
 * Throws when forbidden keys/values are present.
 */
export function assertNoSecretEcho(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (json === undefined) return;
  const forbiddenKeys =
    /"(apiKey|api_key|secret|password|authorization|token|credentialValue|privateKey)"\s*:/i;
  if (forbiddenKeys.test(json)) {
    throw new Error('CredentialAccount public payload must not echo secrets.');
  }
  // Common secret prefixes / bearer patterns.
  if (
    /\bsk-[A-Za-z0-9]{8,}\b/.test(json) ||
    /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}\b/i.test(json)
  ) {
    throw new Error('CredentialAccount public payload must not echo secrets.');
  }
}
