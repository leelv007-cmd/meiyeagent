import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/**
 * Owns provider reference dispatch policy and safe retrieval for model execution.
 */

export class ProviderSafeFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SafeFetchTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  cancel(): void | Promise<void>;
}

export interface SafeFetchTransportPort {
  request(input: {
    url: URL;
    allowedAddresses: string[];
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<SafeFetchTransportResponse>;
}

export interface SafeFetchResult {
  bytes: Uint8Array;
  mimeType: string;
  finalUrl: string;
}

export interface SafeFetchConstraints {
  allowedMimeTypes: string[];
  authorization?: {
    host: string;
    value: string;
  };
  maxBytes: number;
}

export interface ReferenceAssetDeliveryPort {
  get(
    target: string,
    constraints: SafeFetchConstraints,
  ): Promise<SafeFetchResult>;
}

export class NodePinnedHttpTransport implements SafeFetchTransportPort {
  async request(input: {
    url: URL;
    allowedAddresses: string[];
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<SafeFetchTransportResponse> {
    const address = input.allowedAddresses[0];
    if (!address) {
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_DNS_EMPTY',
        'Provider host did not resolve to an address.',
      );
    }
    const request = input.url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          protocol: input.url.protocol,
          hostname: address,
          port:
            input.url.port || (input.url.protocol === 'https:' ? 443 : 80),
          path: `${input.url.pathname}${input.url.search}`,
          method: 'GET',
          headers: {
            ...input.headers,
            host: input.url.host,
          },
          ...(input.url.protocol === 'https:'
            ? { servername: input.url.hostname }
            : {}),
        },
        (response) => {
          const headers = Object.fromEntries(
            Object.entries(response.headers).flatMap(([key, value]) => {
              if (value === undefined) return [];
              return [[key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]];
            }),
          );
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: response,
            cancel: () => {
              response.destroy();
            },
          });
        },
      );
      outgoing.setTimeout(input.timeoutMs, () => {
        outgoing.destroy(
          new ProviderSafeFetchError(
            'SAFE_FETCH_TIMEOUT',
            'Provider fetch exceeded its timeout.',
          ),
        );
      });
      outgoing.once('error', reject);
      outgoing.end();
    });
  }
}

export class ProviderSafeFetch implements ReferenceAssetDeliveryPort {
  private active = 0;
  private readonly allowedHosts: Set<string>;
  private readonly maxConcurrency: number;
  private readonly maxRedirects: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      allowedHosts: string[];
      resolver?: { resolve(hostname: string): Promise<string[]> };
      transport?: SafeFetchTransportPort;
      maxConcurrency?: number;
      maxRedirects?: number;
      timeoutMs?: number;
    },
  ) {
    this.allowedHosts = new Set(
      options.allowedHosts.map((host) => host.trim().toLowerCase()),
    );
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async get(
    target: string,
    constraints: SafeFetchConstraints,
  ): Promise<SafeFetchResult> {
    if (this.active >= this.maxConcurrency) {
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_CONCURRENCY_LIMIT',
        'Provider fetch concurrency limit is exhausted.',
      );
    }
    if (!Number.isSafeInteger(constraints.maxBytes) || constraints.maxBytes <= 0) {
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_LIMIT_INVALID',
        'Provider fetch byte limit is invalid.',
      );
    }
    if (constraints.allowedMimeTypes.length === 0) {
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_MIME_REQUIRED',
        'Provider fetch MIME allowlist is empty.',
      );
    }
    if (constraints.authorization) {
      const authorizationHost = constraints.authorization.host.trim().toLowerCase();
      if (!this.allowedHosts.has(authorizationHost)) {
        throw new ProviderSafeFetchError(
          'SAFE_FETCH_AUTH_HOST_FORBIDDEN',
          'Provider authorization host is not configured.',
        );
      }
      if (
        !constraints.authorization.value.trim() ||
        /[\r\n]/u.test(constraints.authorization.value)
      ) {
        throw new ProviderSafeFetchError(
          'SAFE_FETCH_AUTH_INVALID',
          'Provider authorization value is invalid.',
        );
      }
    }
    this.active += 1;
    try {
      return await this.follow(target, constraints, 0);
    } finally {
      this.active -= 1;
    }
  }

  private async follow(
    target: string,
    constraints: SafeFetchConstraints,
    redirectCount: number,
  ): Promise<SafeFetchResult> {
    const url = validateUrl(target, this.allowedHosts);
    if (constraints.authorization && url.protocol !== 'https:') {
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_AUTH_PROTOCOL_FORBIDDEN',
        'Provider authorization requires HTTPS for every request hop.',
      );
    }
    const addresses = await this.resolve(url.hostname);
    const transport = this.options.transport ?? new NodePinnedHttpTransport();
    const response = await transport.request({
      url,
      allowedAddresses: addresses,
      headers: {
        accept: constraints.allowedMimeTypes.join(', '),
        ...(constraints.authorization?.host.trim().toLowerCase() ===
        url.hostname.toLowerCase()
          ? { authorization: constraints.authorization.value }
          : {}),
      },
      timeoutMs: this.timeoutMs,
    });
    let bodyClosed = false;
    const cancelBody = async () => {
      if (bodyClosed) return;
      bodyClosed = true;
      await response.cancel();
    };
    if (response.status >= 300 && response.status < 400) {
      await cancelBody();
      if (redirectCount >= this.maxRedirects) {
        throw new ProviderSafeFetchError(
          'SAFE_FETCH_REDIRECT_LIMIT',
          'Provider fetch exceeded its redirect limit.',
        );
      }
      const location = response.headers.location;
      if (!location) {
        throw new ProviderSafeFetchError(
          'SAFE_FETCH_REDIRECT_INVALID',
          'Provider redirect omitted its location.',
        );
      }
      return this.follow(
        new URL(location, url).toString(),
        constraints,
        redirectCount + 1,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      await cancelBody();
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_UPSTREAM_STATUS',
        `Provider fetch returned status ${response.status}.`,
      );
    }
    const declaredSize = response.headers['content-length'];
    if (
      declaredSize !== undefined &&
      (!/^\d+$/.test(declaredSize) || Number(declaredSize) > constraints.maxBytes)
    ) {
      await cancelBody();
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_TOO_LARGE',
        'Provider response exceeds the declared byte limit.',
      );
    }
    const mimeType = (response.headers['content-type'] ?? '')
      .split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (!mimeType || !constraints.allowedMimeTypes.includes(mimeType)) {
      await cancelBody();
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_MIME_FORBIDDEN',
        'Provider response MIME type is not allowed.',
      );
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > constraints.maxBytes) {
          throw new ProviderSafeFetchError(
            'SAFE_FETCH_TOO_LARGE',
            'Provider response exceeded the streamed byte limit.',
          );
        }
        chunks.push(new Uint8Array(chunk));
      }
      bodyClosed = true;
    } catch (error) {
      await cancelBody();
      throw error;
    }
    const bytes = concat(chunks, size);
    if (!matchesMagic(bytes, mimeType)) {
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_MAGIC_MISMATCH',
        'Provider response bytes do not match the declared MIME type.',
      );
    }
    return { bytes, mimeType, finalUrl: url.toString() };
  }

  private async resolve(hostname: string) {
    const addresses = (
      this.options.resolver
        ? await this.options.resolver.resolve(hostname)
        : (
            await lookup(hostname, {
              all: true,
              verbatim: true,
            })
          ).map((entry) => entry.address)
    ).map(normalizeAddress);
    if (addresses.length === 0) {
      throw new ProviderSafeFetchError(
        'SAFE_FETCH_DNS_EMPTY',
        'Provider host did not resolve to an address.',
      );
    }
    for (const address of addresses) {
      if (!isPublicAddress(address)) {
        throw new ProviderSafeFetchError(
          'SAFE_FETCH_PRIVATE_ADDRESS',
          'Provider host resolved to a private or reserved address.',
        );
      }
    }
    return [...new Set(addresses)];
  }
}

function validateUrl(target: string, allowedHosts: Set<string>) {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new ProviderSafeFetchError(
      'SAFE_FETCH_URL_INVALID',
      'Provider fetch URL is invalid.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderSafeFetchError(
      'SAFE_FETCH_PROTOCOL_FORBIDDEN',
      'Provider fetch protocol is not allowed.',
    );
  }
  if (url.username || url.password) {
    throw new ProviderSafeFetchError(
      'SAFE_FETCH_CREDENTIALS_FORBIDDEN',
      'Provider fetch URL credentials are forbidden.',
    );
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new ProviderSafeFetchError(
      'SAFE_FETCH_PORT_FORBIDDEN',
      'Provider fetch port is not allowed.',
    );
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new ProviderSafeFetchError(
      'SAFE_FETCH_HOST_FORBIDDEN',
      'Provider fetch host is not configured.',
    );
  }
  return url;
}

function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function normalizeAddress(address: string) {
  if (isIP(address) !== 6) return address;
  return mappedIpv4FromIpv6(address) ?? address;
}

function isPublicIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255)) {
    return false;
  }
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0 && d !== 9 && d !== 10) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string) {
  const mappedIpv4 = mappedIpv4FromIpv6(address);
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);
  const normalized = address.toLowerCase();
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  ) {
    return false;
  }
  return true;
}

function mappedIpv4FromIpv6(address: string) {
  // URL canonicalization collapses valid compressed, expanded, dotted, and
  // hexadecimal IPv6 spellings before the mapped prefix is inspected.
  const canonical = new URL(`http://[${address}]/`).hostname;
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/u.exec(
    canonical,
  );
  if (!mapped) return null;
  const high = Number.parseInt(mapped[1] ?? '', 16);
  const low = Number.parseInt(mapped[2] ?? '', 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

function matchesMagic(bytes: Uint8Array, mimeType: string) {
  switch (mimeType) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case 'audio/mpeg':
      return (
        startsWith(bytes, [0x49, 0x44, 0x33]) ||
        (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
      );
    case 'audio/wav':
    case 'audio/x-wav':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]);
    case 'audio/mp4':
    case 'video/mp4':
      return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    default:
      return false;
  }
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return (
    bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function concat(chunks: Uint8Array[], size: number) {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// Local API docs: docs/_private/tuzi-api/images-edits.openapi.yaml
// (+ images-generations.openapi.yaml; edits doc suggests generations preferred).
// Live evidence: docs/evidence/pro-studio/ticket-09/2026-07-16-tuzi-production-multipart-probe.md
// image.generate with owned refs rewrites to the same /images/edits multipart
// transport as image.edit (tuzi-media-adapter rewriteTuziRequest).
const VERIFIED_PROVIDER_REFERENCE_TRANSPORTS = [
  {
    deploymentId: 'seedream-4-5-tuzi-relay',
    executionChannelId: 'channel-tuzi-seedream-4-5-relay',
    operation: 'image.edit',
    providerModel: 'doubao-seedream-4-5-251128',
    providerProfileId: 'provider-tu-zi-openai',
    transport: 'multipart_upload_from_owned_data_url',
  },
  {
    deploymentId: 'seedream-4-5-tuzi-relay',
    executionChannelId: 'channel-tuzi-seedream-4-5-relay',
    operation: 'image.generate',
    providerModel: 'doubao-seedream-4-5-251128',
    providerProfileId: 'provider-tu-zi-openai',
    transport: 'multipart_upload_from_owned_data_url',
  },
] as const;

export const CURRENT_PROVIDER_REFERENCE_DECISION = {
  evidenceRef:
    'docs/evidence/pro-studio/ticket-09/2026-07-16-tuzi-production-multipart-probe.md',
  grantEndpoint: null,
  status: 'accepted_owned_reference_upload',
  verifiedTransports: VERIFIED_PROVIDER_REFERENCE_TRANSPORTS,
} as const;

export class ProviderReferencePolicyError extends Error {
  constructor(
    readonly code: 'PROVIDER_REFERENCE_PROBE_REQUIRED',
    message: string,
  ) {
    super(message);
  }
}

export interface ProviderReferencePolicyPort {
  assertCanDispatch(input: {
    deploymentId: string;
    executionChannelId?: string;
    operation: string;
    providerModel?: string;
    providerProfileId?: string;
    referenceAssetCount: number;
  }): void;
}

export const CURRENT_PROVIDER_REFERENCE_POLICY: ProviderReferencePolicyPort = {
  assertCanDispatch(input) {
    if (input.referenceAssetCount === 0) return;
    const verified = VERIFIED_PROVIDER_REFERENCE_TRANSPORTS.some(
      (transport) =>
        transport.deploymentId === input.deploymentId &&
        transport.executionChannelId === input.executionChannelId &&
        transport.operation === input.operation &&
        transport.providerModel === input.providerModel &&
        transport.providerProfileId === input.providerProfileId,
    );
    if (verified) return;
    throw new ProviderReferencePolicyError(
      'PROVIDER_REFERENCE_PROBE_REQUIRED',
      'Provider reference transport has no matching live capability evidence.',
    );
  },
};

/** Used only by the APP_ENV=e2e-only fixture runtime. */
export const LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY: ProviderReferencePolicyPort =
  {
    assertCanDispatch() {},
  };

export function providerReferenceReleaseConformance() {
  return {
    failures: [] as const,
    grantEndpoint: CURRENT_PROVIDER_REFERENCE_DECISION.grantEndpoint,
    grantUrlsProduced: false,
    ready: true,
    verifiedTransports: CURRENT_PROVIDER_REFERENCE_DECISION.verifiedTransports,
  } as const;
}

/** Grants are disabled. Any mint attempt is rejected and audited. */
export async function rejectProviderReferenceGrantAccess(input: {
  accessAudit?: {
    recordAccessDenied(event: {
      actorId: string;
      createdAt?: string;
      objectId: string;
      objectKind: 'grant';
      projectId?: string;
      workspaceId: string;
    }): Promise<void>;
  };
  actorId: string;
  grantId: string;
  projectId?: string;
  workspaceId: string;
}): Promise<never> {
  await input.accessAudit?.recordAccessDenied({
    actorId: input.actorId,
    objectId: input.grantId,
    objectKind: 'grant',
    ...(input.projectId ? { projectId: input.projectId } : {}),
    workspaceId: input.workspaceId,
  });
  throw new ProviderReferencePolicyError(
    'PROVIDER_REFERENCE_PROBE_REQUIRED',
    'ProviderReferenceGrant is disabled; no grant object exists to read.',
  );
}
