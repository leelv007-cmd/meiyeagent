/**
 * Request-time secret broker (G2 / D-060).
 *
 * Assembles credentials by frozen CredentialAccount version for provider runtime.
 * Secret values only transit SecretStorePort (KMS/file/AWS) — product API
 * projections never echo them. Does not create a second vault.
 */
import type { SecretStorePort } from '../integrations/contracts.js';
import type { CredentialAccount } from './credential-account.js';
import {
  assertNoSecretEcho,
  toPublicMetadata,
} from './credential-account.js';
import {
  resolveFrozenCredentialVersion,
  type CredentialLifecycleError,
} from './credential-lifecycle.js';

export class SecretBrokerError extends Error {
  constructor(
    readonly code:
      | 'ACCOUNT_NOT_FOUND'
      | 'ACCOUNT_PENDING'
      | 'VERSION_NOT_FOUND'
      | 'VERSION_NOT_CURRENT'
      | 'ACCOUNT_RETIRED'
      | 'ACCOUNT_EXPIRED'
      | 'SECRET_UNAVAILABLE'
      | 'SCOPE_ISOLATION',
    message: string,
  ) {
    super(message);
    this.name = 'SecretBrokerError';
  }
}

/** Frozen assembly request from RouteSnapshot / attempt. */
export interface AssembleCredentialRequest {
  credentialAccountId: string;
  /** Frozen version from RouteSnapshot. Omit only at a new request boundary. */
  frozenVersion?: string;
  /**
   * Requested scope. Platform tasks must not read workspace_byok and vice versa
   * (extends FoundationStrictByokLedger isolation baseline — no rebuild).
   */
  requiredScope: 'platform' | 'workspace_byok';
}

/** Runtime-only assembly result. Must never be returned from product APIs. */
export interface AssembledCredential {
  credentialAccountId: string;
  version: string;
  secretReference: string;
  secretVersion: number;
  scope: 'platform' | 'workspace_byok';
  /** Secret material — provider runtime only. */
  secret: string;
}

/** Port consumed by provider runtime (G owns; I only consumes). */
export interface CredentialSecretBrokerPort {
  assembleForRequest(
    request: AssembleCredentialRequest,
  ): Promise<AssembledCredential>;
  projectPublic(accountId: string): Promise<ReturnType<typeof toPublicMetadata>>;
}

/** Governed probe-only extension. Normal provider execution never consumes it. */
export interface CredentialConnectivityTestBrokerPort
  extends CredentialSecretBrokerPort {
  assembleForConnectivityTest(request: {
    credentialAccountId: string;
    version: string;
    requiredScope: 'platform' | 'workspace_byok';
  }): Promise<AssembledCredential>;
}

export interface CredentialAccountDirectory {
  get(id: string): Promise<CredentialAccount | null> | CredentialAccount | null;
}

/**
 * Request-time broker backed by existing SecretStorePort + CredentialAccount
 * directory. In-flight tasks keep their frozen version via versionHistory.
 */
export class RequestTimeSecretBroker
  implements CredentialConnectivityTestBrokerPort
{
  constructor(
    private readonly directory: CredentialAccountDirectory,
    private readonly secrets: SecretStorePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async assembleForRequest(
    request: AssembleCredentialRequest,
  ): Promise<AssembledCredential> {
    const account = await this.directory.get(request.credentialAccountId);
    if (!account) {
      throw new SecretBrokerError(
        'ACCOUNT_NOT_FOUND',
        `CredentialAccount ${request.credentialAccountId} not found.`,
      );
    }
    if (account.scope !== request.requiredScope) {
      throw new SecretBrokerError(
        'SCOPE_ISOLATION',
        `CredentialAccount scope=${account.scope} cannot serve requiredScope=${request.requiredScope}.`,
      );
    }
    if (account.status === 'pending') {
      throw new SecretBrokerError(
        'ACCOUNT_PENDING',
        `CredentialAccount ${account.id} is pending verification.`,
      );
    }
    if (account.status === 'retired') {
      throw new SecretBrokerError(
        'ACCOUNT_RETIRED',
        `CredentialAccount ${account.id} is retired.`,
      );
    }
    if (
      account.expiresAt &&
      Date.parse(account.expiresAt) <= this.clock().getTime()
    ) {
      throw new SecretBrokerError(
        'ACCOUNT_EXPIRED',
        `CredentialAccount ${account.id} expired at ${account.expiresAt}.`,
      );
    }

    const requestedVersion = request.frozenVersion ?? account.version;
    return this.assembleVersion(account, requestedVersion);
  }

  async assembleForConnectivityTest(request: {
    credentialAccountId: string;
    version: string;
    requiredScope: 'platform' | 'workspace_byok';
  }): Promise<AssembledCredential> {
    const account = await this.directory.get(request.credentialAccountId);
    if (!account) {
      throw new SecretBrokerError(
        'ACCOUNT_NOT_FOUND',
        `CredentialAccount ${request.credentialAccountId} not found.`,
      );
    }
    if (account.scope !== request.requiredScope) {
      throw new SecretBrokerError(
        'SCOPE_ISOLATION',
        `CredentialAccount scope=${account.scope} cannot serve requiredScope=${request.requiredScope}.`,
      );
    }
    if (account.status === 'retired') {
      throw new SecretBrokerError(
        'ACCOUNT_RETIRED',
        `CredentialAccount ${account.id} is retired.`,
      );
    }
    if (
      account.expiresAt &&
      Date.parse(account.expiresAt) <= this.clock().getTime()
    ) {
      throw new SecretBrokerError(
        'ACCOUNT_EXPIRED',
        `CredentialAccount ${account.id} expired at ${account.expiresAt}.`,
      );
    }
    if (request.version !== account.version) {
      throw new SecretBrokerError(
        'VERSION_NOT_CURRENT',
        `Credential version ${request.version} is no longer the current head for ${account.id}.`,
      );
    }
    return this.assembleVersion(account, request.version);
  }

  private async assembleVersion(
    account: CredentialAccount,
    requestedVersion: string,
  ): Promise<AssembledCredential> {
    const frozen = resolveFrozenCredentialVersion(account, requestedVersion);
    if (!frozen) {
      throw new SecretBrokerError(
        'VERSION_NOT_FOUND',
        `Frozen credential version ${requestedVersion} is not recorded on ${account.id}; refusing silent upgrade.`,
      );
    }

    let secret: string;
    try {
      secret = await this.secrets.use(frozen.secretReference, {
        workspaceId: account.workspaceId,
        credentialId: account.credentialId,
        version: frozen.secretVersion,
        provider: account.provider,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Secret unavailable.';
      throw new SecretBrokerError('SECRET_UNAVAILABLE', message);
    }

    return {
      credentialAccountId: account.id,
      version: frozen.version,
      secretReference: frozen.secretReference,
      secretVersion: frozen.secretVersion,
      scope: account.scope,
      secret,
    };
  }

  async projectPublic(accountId: string) {
    const account = await this.directory.get(accountId);
    if (!account) {
      throw new SecretBrokerError(
        'ACCOUNT_NOT_FOUND',
        `CredentialAccount ${accountId} not found.`,
      );
    }
    const meta = toPublicMetadata(account);
    assertNoSecretEcho(meta);
    return meta;
  }
}

/**
 * Write a secret through SecretStorePort and return only the reference + version.
 * Callers attach the reference to CredentialAccount metadata — never the value.
 */
export async function putCredentialSecret(input: {
  secrets: SecretStorePort;
  workspaceId: string;
  credentialId: string;
  secretVersion: number;
  provider: CredentialAccount['provider'];
  value: string;
}): Promise<{ secretReference: string; secretVersion: number }> {
  const context = {
    workspaceId: input.workspaceId,
    credentialId: input.credentialId,
    version: input.secretVersion,
    provider: input.provider,
  };
  const secretReference = await input.secrets.put(context, input.value);
  return { secretReference, secretVersion: input.secretVersion };
}

/**
 * Redact sensitive fields from connectivity/test log payloads.
 * Strips Authorization, upstream response bodies, full endpoint query strings,
 * and raw credential values.
 */
export function redactCredentialLogDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const blocked = new Set([
    'authorization',
    'Authorization',
    'apiKey',
    'api_key',
    'secret',
    'credential',
    'password',
    'token',
    'upstreamResponse',
    'upstream_response',
    'responseBody',
    'response_body',
    'body',
    'raw',
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (blocked.has(key)) continue;
    if (key === 'endpoint' || key === 'url' || key === 'endpointQuery') {
      out[key] = redactEndpoint(String(value));
      continue;
    }
    if (typeof value === 'string') {
      out[key] = redactSecretSubstrings(value);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactCredentialLogDetails(
        value as Record<string, unknown>,
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

function redactEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    // Drop query entirely — may contain tokens.
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint.split('?')[0] ?? endpoint;
  }
}

function redactSecretSubstrings(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9]+/g, 'sk-[REDACTED]');
}

/** Normalized connectivity test result returned to product API (no secrets). */
export interface NormalizedConnectivityTestResult {
  credentialAccountId: string;
  credentialVersion: string;
  status:
    | 'passed'
    | 'unauthorized'
    | 'network_failed'
    | 'unknown'
    | 'not_wired';
  testedAt: string;
  evidenceRef: string;
  errorCode?: string;
}

export function normalizeConnectivityTestResult(input: {
  credentialAccountId: string;
  credentialVersion: string;
  status: NormalizedConnectivityTestResult['status'];
  testedAt: string;
  errorCode?: string;
  /** Intentionally ignored — must never leak into the result. */
  upstreamResponse?: unknown;
  authorizationHeader?: string;
  endpointWithQuery?: string;
}): NormalizedConnectivityTestResult {
  // Explicitly drop upstreamResponse / Authorization / full endpoint query.
  void input.upstreamResponse;
  void input.authorizationHeader;
  void input.endpointWithQuery;
  const result: NormalizedConnectivityTestResult = {
    credentialAccountId: input.credentialAccountId,
    credentialVersion: input.credentialVersion,
    status: input.status,
    testedAt: input.testedAt,
    evidenceRef: `test://${input.credentialAccountId}/v${input.credentialVersion}/${input.testedAt}`,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
  assertNoSecretEcho(result);
  return result;
}

// Re-export error type name for consumers that pattern-match on lifecycle errors.
export type { CredentialLifecycleError };
