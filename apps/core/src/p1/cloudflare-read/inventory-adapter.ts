/**
 * Cloudflare read-only REST inventory adapter (D-053).
 *
 * Workers deployments/versions + enabled resource inventory with
 * query / normalize / cache / freshness / unknown contracts.
 *
 * GraphQL analytics is intentionally absent (D-080 C3 deferred).
 * Token stays server-side — this module never returns credentials.
 */

import type {
  CloudflareDeploymentSnapshot,
  CloudflareFieldEnvelope,
  CloudflareFreshness,
  CloudflareInventorySnapshot,
  CloudflareResourceInventoryItem,
  CloudflareResourceMapping,
  CloudflareUnknownReason,
  CloudflareVersionSnapshot,
} from './types.js';
import { isHyperdrivePlaceholder } from './config-risk.js';

export const CLOUDFLARE_INVENTORY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

export type CloudflareHttpFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface CloudflareInventoryAdapterOptions {
  /** Server-held read token — never logged or returned. */
  apiToken?: string;
  mapping: CloudflareResourceMapping;
  fetchImpl?: CloudflareHttpFetch;
  cacheTtlMs?: number;
  now?: () => Date;
  apiBase?: string;
}

interface CacheEntry {
  snapshot: CloudflareInventorySnapshot;
  storedAtMs: number;
}

interface CfApiListResponse<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

/** Raw CF deployment list item (subset we normalize). */
interface RawDeployment {
  id?: string;
  version_id?: string;
  created_on?: string;
  source?: string;
  author_email?: string;
  versions?: Array<{ version_id?: string; percentage?: number }>;
}

interface RawVersion {
  id?: string;
  version_id?: string;
  created_on?: string;
  source?: string;
  annotations?: { 'workers/message'?: string; [key: string]: string | undefined };
  metadata?: { created_on?: string; source?: string };
}

interface RawScript {
  id?: string;
  created_on?: string;
  modified_on?: string;
}

interface RawR2Bucket {
  name?: string;
  creation_date?: string;
  location?: string;
  storage_class?: string;
  jurisdiction?: string;
}

interface RawHyperdrive {
  id?: string;
  name?: string;
  origin?: unknown;
}

interface RawSecretMeta {
  name?: string;
  type?: string;
}

interface RawOtelDestination {
  id?: string;
  name?: string;
  type?: string;
  enabled?: boolean;
}

/**
 * Allowlisted read methods on the inventory adapter.
 * Any other method name is treated as a write-op denial target.
 */
export const CLOUDFLARE_INVENTORY_READ_METHODS = [
  'getInventory',
  'refreshInventory',
  'getCachedInventory',
  'clearCache',
  'listAllowedMethods',
] as const;

export type CloudflareInventoryReadMethod =
  (typeof CLOUDFLARE_INVENTORY_READ_METHODS)[number];

/** Explicit write / mutation method names that must never exist. */
export const CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS = [
  'deploy',
  'publish',
  'rollback',
  'createDeployment',
  'uploadVersion',
  'putSecret',
  'deleteSecret',
  'writeDns',
  'writeWaf',
  'writeR2',
  'writeHyperdrive',
  'writeBilling',
  'mutateOtelDestination',
  'executeGraphql',
  'queryObservability',
] as const;

export class CloudflareInventoryAdapter {
  private readonly apiToken: string | undefined;
  private readonly mapping: CloudflareResourceMapping;
  private readonly fetchImpl: CloudflareHttpFetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => Date;
  private readonly apiBase: string;
  private cache: CacheEntry | null = null;

  constructor(options: CloudflareInventoryAdapterOptions) {
    this.apiToken = options.apiToken?.trim() || undefined;
    this.mapping = options.mapping;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? CLOUDFLARE_INVENTORY_CACHE_TTL_MS;
    this.now = options.now ?? (() => new Date());
    this.apiBase = (options.apiBase ?? CLOUDFLARE_API_BASE).replace(/\/+$/, '');
  }

  listAllowedMethods(): readonly CloudflareInventoryReadMethod[] {
    return CLOUDFLARE_INVENTORY_READ_METHODS;
  }

  getCachedInventory(): CloudflareInventorySnapshot | null {
    if (!this.cache) return null;
    const ageMs = this.now().getTime() - this.cache.storedAtMs;
    if (ageMs < 0) return null;
    // Return snapshot with recomputed freshness from age.
    return withFreshness(this.cache.snapshot, ageMs, this.cacheTtlMs, true);
  }

  clearCache(): void {
    this.cache = null;
  }

  /**
   * Return inventory: prefer fresh cache, else query+normalize.
   * Never returns raw API token or origin credentials.
   */
  async getInventory(): Promise<CloudflareInventorySnapshot> {
    const cached = this.getCachedInventory();
    if (cached && cached.freshness === 'fresh') {
      return cached;
    }
    // Stale cache is still returned if refresh fails (honest stale).
    try {
      return await this.refreshInventory();
    } catch {
      if (cached) {
        return {
          ...cached,
          freshness: 'stale',
          cache: { ...cached.cache, hit: true },
        };
      }
      return this.unknownSnapshot('read_failed');
    }
  }

  /** Force query + normalize + cache store. */
  async refreshInventory(): Promise<CloudflareInventorySnapshot> {
    if (!this.mapping.verified) {
      const snapshot = this.unknownSnapshot('mapping_not_verified');
      this.cache = { snapshot, storedAtMs: this.now().getTime() };
      return snapshot;
    }
    if (!this.apiToken) {
      const snapshot = this.unknownSnapshot('token_missing');
      this.cache = { snapshot, storedAtMs: this.now().getTime() };
      return snapshot;
    }
    if (!this.mapping.accountId || !this.mapping.scriptName) {
      const snapshot = this.unknownSnapshot('mapping_not_verified', {
        detail: 'accountId or scriptName missing',
      });
      this.cache = { snapshot, storedAtMs: this.now().getTime() };
      return snapshot;
    }

    const capturedAt = this.now().toISOString();
    const accountId = this.mapping.accountId;
    const scriptName = this.mapping.scriptName;

    const [deploymentsResult, versionsResult, resources] = await Promise.all([
      this.queryDeployments(accountId, scriptName, capturedAt),
      this.queryVersions(accountId, scriptName, capturedAt),
      this.queryEnabledResources(accountId, scriptName, capturedAt),
    ]);

    const snapshot: CloudflareInventorySnapshot = {
      mappingRef: this.mapping.internalRef,
      capturedAt,
      freshness: 'fresh',
      deployments: deploymentsResult,
      versions: versionsResult,
      resources,
      cloudflareQueuesEnabled: false,
      graphqlAnalyticsDeferred: true,
      cache: {
        hit: false,
        ttlMs: this.cacheTtlMs,
        ageMs: 0,
      },
    };

    this.cache = {
      snapshot,
      storedAtMs: this.now().getTime(),
    };
    return snapshot;
  }

  // ── private query helpers ──────────────────────────────────────────

  private async queryDeployments(
    accountId: string,
    scriptName: string,
    observedAt: string,
  ): Promise<CloudflareFieldEnvelope<CloudflareDeploymentSnapshot[]>> {
    const path = `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`;
    const raw = await this.cfGet<RawDeployment[] | { items?: RawDeployment[] }>(
      path,
    );
    if (raw.kind === 'error') {
      return unknownField(raw.reason, observedAt, raw.detail);
    }
    const list = Array.isArray(raw.data)
      ? raw.data
      : (raw.data.items ?? []);
    return {
      status: 'known',
      value: list.map(normalizeDeployment),
      freshness: 'fresh',
      observedAt,
      source: 'cloudflare_rest',
    };
  }

  private async queryVersions(
    accountId: string,
    scriptName: string,
    observedAt: string,
  ): Promise<CloudflareFieldEnvelope<CloudflareVersionSnapshot[]>> {
    const path = `/accounts/${accountId}/workers/scripts/${scriptName}/versions`;
    const raw = await this.cfGet<RawVersion[] | { items?: RawVersion[] }>(path);
    if (raw.kind === 'error') {
      return unknownField(raw.reason, observedAt, raw.detail);
    }
    const list = Array.isArray(raw.data)
      ? raw.data
      : (raw.data.items ?? []);
    return {
      status: 'known',
      value: list.map(normalizeVersion),
      freshness: 'fresh',
      observedAt,
      source: 'cloudflare_rest',
    };
  }

  private async queryEnabledResources(
    accountId: string,
    scriptName: string,
    observedAt: string,
  ): Promise<CloudflareResourceInventoryItem[]> {
    const items: CloudflareResourceInventoryItem[] = [];

    // Worker script itself
    const scripts = await this.cfGet<RawScript[] | { items?: RawScript[] }>(
      `/accounts/${accountId}/workers/scripts`,
    );
    if (scripts.kind === 'ok') {
      const list = Array.isArray(scripts.data)
        ? scripts.data
        : (scripts.data.items ?? []);
      const found = list.some((s) => s.id === scriptName);
      items.push({
        kind: 'worker_script',
        name: scriptName,
        readiness: found ? 'verified' : 'unknown',
        businessImpact: found
          ? 'App Shell Worker 脚本已在账号中注册，可作为部署盘点锚点'
          : '配置的 script 名未出现在账号脚本列表，映射可能错误',
        observedAt,
      });
    } else {
      items.push({
        kind: 'worker_script',
        name: scriptName,
        readiness: 'unknown',
        businessImpact: '无法核验 Worker 脚本是否存在，勿宣称生产部署健康',
        detail: scripts.detail ?? scripts.reason,
        observedAt,
      });
    }

    // R2 buckets
    const r2 = await this.cfGet<RawR2Bucket[] | { buckets?: RawR2Bucket[] }>(
      `/accounts/${accountId}/r2/buckets`,
    );
    if (r2.kind === 'ok') {
      const buckets = Array.isArray(r2.data)
        ? r2.data
        : (r2.data.buckets ?? []);
      if (buckets.length === 0) {
        items.push({
          kind: 'r2_bucket',
          name: this.mapping.r2BucketName ?? '(none)',
          readiness: 'not_enabled',
          businessImpact: '账号下无 R2 桶；素材对象存储路径未就绪',
          observedAt,
        });
      } else {
        for (const bucket of buckets) {
          if (!bucket.name) continue;
          // Filter to mapped bucket when known.
          if (
            this.mapping.r2BucketName &&
            bucket.name !== this.mapping.r2BucketName
          ) {
            continue;
          }
          items.push({
            kind: 'r2_bucket',
            name: bucket.name,
            readiness: 'verified',
            businessImpact:
              '对象资产桶可盘点（仅名称/区域/存储类；不含对象内容）',
            detail: [
              bucket.location ? `location=${bucket.location}` : null,
              bucket.storage_class ? `class=${bucket.storage_class}` : null,
              bucket.jurisdiction
                ? `jurisdiction=${bucket.jurisdiction}`
                : null,
            ]
              .filter(Boolean)
              .join(' '),
            observedAt,
          });
        }
      }
    } else {
      items.push({
        kind: 'r2_bucket',
        name: this.mapping.r2BucketName ?? '(unknown)',
        readiness: 'unknown',
        businessImpact: 'R2 桶列表读取失败，素材存储就绪状态未知',
        detail: r2.detail ?? r2.reason,
        observedAt,
      });
    }

    // Hyperdrive — never return origin details
    const hd = await this.cfGet<
      RawHyperdrive[] | { result?: RawHyperdrive[] }
    >(`/accounts/${accountId}/hyperdrive/configs`);
    if (hd.kind === 'ok') {
      const configs = Array.isArray(hd.data) ? hd.data : [];
      const mappedId = this.mapping.hyperdriveConfigId;
      if (isHyperdrivePlaceholder(mappedId)) {
        items.push({
          kind: 'hyperdrive',
          name: mappedId ?? HYPERDRIVE_PLACEHOLDER_LABEL,
          readiness: 'not_ready',
          businessImpact:
            'Hyperdrive 仍为占位 ID，App Shell 数据库加速路径未就绪',
          detail: 'placeholder_id',
          observedAt,
        });
      } else if (configs.length === 0) {
        items.push({
          kind: 'hyperdrive',
          name: mappedId ?? '(none)',
          readiness: 'not_enabled',
          businessImpact: '账号无 Hyperdrive 配置',
          observedAt,
        });
      } else {
        for (const cfg of configs) {
          if (!cfg.id) continue;
          if (mappedId && cfg.id !== mappedId) continue;
          items.push({
            kind: 'hyperdrive',
            name: cfg.name ?? cfg.id,
            readiness: 'verified',
            businessImpact:
              'Hyperdrive 配置存在（不暴露 origin host/凭据）',
            // Deliberately omit origin
            observedAt,
          });
        }
      }
    } else {
      items.push({
        kind: 'hyperdrive',
        name: this.mapping.hyperdriveConfigId ?? '(unknown)',
        readiness: isHyperdrivePlaceholder(this.mapping.hyperdriveConfigId)
          ? 'not_ready'
          : 'unknown',
        businessImpact: 'Hyperdrive 配置读取失败或未就绪',
        detail: hd.detail ?? hd.reason,
        observedAt,
      });
    }

    // Secret metadata only (names/types — never values)
    const secrets = await this.cfGet<RawSecretMeta[]>(
      `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
    );
    if (secrets.kind === 'ok') {
      const names = (Array.isArray(secrets.data) ? secrets.data : [])
        .map((s) => s.name)
        .filter((n): n is string => Boolean(n));
      items.push({
        kind: 'worker_secret_meta',
        name: `${names.length} secrets`,
        readiness: names.length > 0 ? 'configured' : 'not_enabled',
        businessImpact:
          names.length > 0
            ? 'Worker 运行密钥元数据可读（值永不回显）'
            : '未发现 Worker secret 元数据；运行密钥就绪未验证',
        // Do not list full secret names by default (reduce surface).
        detail: `count=${names.length}`,
        observedAt,
      });
    } else {
      items.push({
        kind: 'worker_secret_meta',
        name: 'secrets',
        readiness: 'unknown',
        businessImpact: 'Worker secret 元数据不可读',
        detail: secrets.detail ?? secrets.reason,
        observedAt,
      });
    }

    // OTel destinations (read health only)
    const otel = await this.cfGet<
      RawOtelDestination[] | { destinations?: RawOtelDestination[] }
    >(`/accounts/${accountId}/workers/observability/destinations`);
    if (otel.kind === 'ok') {
      const list = Array.isArray(otel.data)
        ? otel.data
        : (otel.data.destinations ?? []);
      if (list.length === 0) {
        items.push({
          kind: 'otel_destination',
          name: '(none)',
          readiness: 'not_enabled',
          businessImpact:
            '无 OTel destination；logs/traces 外发深诊断不可用，明细走原生 handoff',
          observedAt,
        });
      } else {
        for (const dest of list) {
          items.push({
            kind: 'otel_destination',
            name: dest.name ?? dest.id ?? 'destination',
            readiness: dest.enabled === false ? 'not_enabled' : 'configured',
            businessImpact: 'OTel destination 元数据可读（不修改 destination）',
            observedAt,
          });
        }
      }
    } else {
      items.push({
        kind: 'otel_destination',
        name: 'otel',
        readiness: 'unknown',
        businessImpact: 'OTel destination 列表读取失败',
        detail: otel.detail ?? otel.reason,
        observedAt,
      });
    }

    // Explicit non-resource: Cloudflare Queues are not used.
    // Do not push a queue inventory row that looks like a live Queue.

    return items;
  }

  private async cfGet<T>(
    path: string,
  ): Promise<
    | { kind: 'ok'; data: T }
    | { kind: 'error'; reason: CloudflareUnknownReason; detail?: string }
  > {
    try {
      const response = await this.fetchImpl(`${this.apiBase}${path}`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.apiToken}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 429) {
        return { kind: 'error', reason: 'rate_limited', detail: 'http_429' };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          kind: 'error',
          reason: 'token_missing',
          detail: `http_${response.status}`,
        };
      }
      if (!response.ok) {
        return {
          kind: 'error',
          reason: 'read_failed',
          detail: `http_${response.status}`,
        };
      }
      const body = (await response.json()) as CfApiListResponse<T>;
      if (body.success === false) {
        return {
          kind: 'error',
          reason: 'read_failed',
          detail: body.errors?.[0]?.message ?? 'api_success_false',
        };
      }
      // CF wraps in { result }; some endpoints return result directly as array.
      const data = (body.result ?? body) as T;
      return { kind: 'ok', data };
    } catch (error) {
      return {
        kind: 'error',
        reason: 'read_failed',
        detail: error instanceof Error ? error.message : 'network_error',
      };
    }
  }

  private unknownSnapshot(
    reason: CloudflareUnknownReason,
    options: { detail?: string } = {},
  ): CloudflareInventorySnapshot {
    const observedAt = this.now().toISOString();
    const freshness: CloudflareFreshness =
      reason === 'mapping_not_verified' ? 'not_verified' : 'unknown';
    return {
      mappingRef: this.mapping.internalRef,
      capturedAt: observedAt,
      freshness,
      deployments: unknownField(reason, observedAt, options.detail),
      versions: unknownField(reason, observedAt, options.detail),
      resources: [
        {
          kind: 'worker_script',
          name: this.mapping.scriptName ?? this.mapping.internalRef,
          readiness:
            reason === 'mapping_not_verified' ? 'not_ready' : 'unknown',
          businessImpact:
            reason === 'mapping_not_verified'
              ? '生产映射未核验，只读盘点不能宣称生产可用'
              : 'Cloudflare 只读盘点不可用，勿以空列表伪装健康',
          detail: options.detail ?? reason,
          observedAt,
        },
      ],
      cloudflareQueuesEnabled: false,
      graphqlAnalyticsDeferred: true,
      cache: {
        hit: false,
        ttlMs: this.cacheTtlMs,
        ageMs: null,
      },
    };
  }
}

const HYPERDRIVE_PLACEHOLDER_LABEL = '00000000-0000-0000-0000-000000000000';

function normalizeDeployment(raw: RawDeployment): CloudflareDeploymentSnapshot {
  const traffic =
    raw.versions?.find((v) => v.percentage != null)?.percentage ?? undefined;
  return {
    deploymentId: raw.id ?? 'unknown',
    ...(raw.version_id || raw.versions?.[0]?.version_id
      ? { versionId: raw.version_id ?? raw.versions?.[0]?.version_id }
      : {}),
    ...(raw.created_on ? { createdOn: raw.created_on } : {}),
    ...(raw.source ? { source: raw.source } : {}),
    ...(raw.author_email ? { authorEmail: raw.author_email } : {}),
    ...(traffic != null ? { trafficPercent: traffic } : {}),
    notDataRollback: true,
  };
}

function normalizeVersion(raw: RawVersion): CloudflareVersionSnapshot {
  const versionId = raw.id ?? raw.version_id ?? 'unknown';
  const createdOn = raw.created_on ?? raw.metadata?.created_on;
  const source = raw.source ?? raw.metadata?.source;
  const annotations: Record<string, string> = {};
  if (raw.annotations) {
    for (const [k, v] of Object.entries(raw.annotations)) {
      if (typeof v === 'string' && v.length > 0) {
        // Skip potentially sensitive annotation bodies beyond short messages.
        if (k === 'workers/message' || k.startsWith('workers/')) {
          annotations[k] = v.slice(0, 200);
        }
      }
    }
  }
  return {
    versionId,
    ...(createdOn ? { createdOn } : {}),
    ...(source ? { source } : {}),
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
}

function unknownField<T>(
  reason: CloudflareUnknownReason,
  observedAt: string,
  detail?: string,
): CloudflareFieldEnvelope<T> {
  const freshness: CloudflareFreshness =
    reason === 'mapping_not_verified'
      ? 'not_verified'
      : reason === 'rate_limited'
        ? 'unavailable'
        : 'unknown';
  return {
    status: 'unknown',
    reason,
    freshness,
    observedAt,
    ...(detail ? { detail } : {}),
  };
}

function withFreshness(
  snapshot: CloudflareInventorySnapshot,
  ageMs: number,
  ttlMs: number,
  cacheHit: boolean,
): CloudflareInventorySnapshot {
  const freshness: CloudflareFreshness =
    ageMs <= ttlMs ? 'fresh' : 'stale';
  return {
    ...snapshot,
    freshness,
    cache: {
      hit: cacheHit,
      ttlMs,
      ageMs,
    },
  };
}

/**
 * Pure normalize helpers exported for unit tests without network.
 */
export function normalizeDeploymentsFromApi(
  raw: unknown,
): CloudflareDeploymentSnapshot[] {
  const list = extractList<RawDeployment>(raw);
  return list.map(normalizeDeployment);
}

export function normalizeVersionsFromApi(
  raw: unknown,
): CloudflareVersionSnapshot[] {
  const list = extractList<RawVersion>(raw);
  return list.map(normalizeVersion);
}

function extractList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.result)) return obj.result as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.buckets)) return obj.buckets as T[];
  }
  return [];
}
