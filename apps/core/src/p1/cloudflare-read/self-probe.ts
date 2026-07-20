/**
 * Product-side self health probes (D-053 C-class).
 *
 * These never call Cloudflare control-plane write APIs. They only check our
 * functional readiness (shell HTTP, DB connectivity, binding readiness).
 */

import type {
  CloudflareSelfProbeKind,
  CloudflareSelfProbeResult,
  CloudflareResourceMapping,
} from './types.js';
import { isHyperdrivePlaceholder } from './config-risk.js';

export type ProbeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface SelfProbePorts {
  /** Optional shell base URL for HTTP readiness. */
  shellBaseUrl?: string;
  /** Optional DB ping — returns ok/fail without exposing connection strings. */
  databasePing?: () => Promise<{ ok: boolean; detail?: string }>;
  /** Optional object storage binding check. */
  objectStoragePing?: () => Promise<{ ok: boolean; detail?: string }>;
  mapping?: CloudflareResourceMapping;
  hyperdriveId?: string;
  request?: ProbeFetch;
  now?: () => Date;
}

const BUSINESS_IMPACT: Record<
  CloudflareSelfProbeKind,
  Record<CloudflareSelfProbeResult['status'], string>
> = {
  shell_http: {
    ok: 'App Shell 入口可达，用户可打开产品前台',
    degraded: 'App Shell 响应异常，部分用户可能打开失败',
    failed: 'App Shell 不可达，用户无法进入产品前台',
    unknown: 'App Shell 健康未知，勿伪装为实时可用',
    not_ready: 'App Shell 探针未配置，无法验证入口可用性',
  },
  database_connectivity: {
    ok: '业务库连通，任务与账本读写可用',
    degraded: '业务库连通变慢，任务提交/查询可能变慢',
    failed: '业务库不可达，任务与权益读写会失败',
    unknown: '业务库连通未知，勿以缓存成功伪装健康',
    not_ready: '业务库探针未接线',
  },
  object_storage_binding: {
    ok: '对象存储路径可用，素材上传/下载可继续',
    degraded: '对象存储偶发失败，素材读写可能中断',
    failed: '对象存储不可用，素材与导出交付会失败',
    unknown: '对象存储状态未知',
    not_ready: '对象存储绑定未验证',
  },
  mapping_readiness: {
    ok: '生产 Cloudflare 映射已核验，可刷新只读盘点',
    degraded: '映射部分字段缺失，盘点可能不完整',
    failed: '生产映射无效',
    unknown: '映射状态未知',
    not_ready: '生产 account/zone/script 映射未核验；只读盘点不得宣称生产可用',
  },
};

function stamp(
  kind: CloudflareSelfProbeKind,
  status: CloudflareSelfProbeResult['status'],
  observedAt: string,
  detail?: string,
): CloudflareSelfProbeResult {
  return {
    kind,
    status,
    businessImpact: BUSINESS_IMPACT[kind][status],
    observedAt,
    ...(detail ? { detail } : {}),
    mutatesCloudflare: false,
  };
}

export async function runShellHttpProbe(
  ports: SelfProbePorts,
): Promise<CloudflareSelfProbeResult> {
  const observedAt = (ports.now?.() ?? new Date()).toISOString();
  const base = ports.shellBaseUrl?.trim();
  if (!base) {
    return stamp('shell_http', 'not_ready', observedAt, 'shellBaseUrl missing');
  }
  const request = ports.request ?? fetch;
  try {
    const response = await request(base.replace(/\/+$/, ''), {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      return stamp('shell_http', 'ok', observedAt, `http_${response.status}`);
    }
    if (response.status >= 500) {
      return stamp(
        'shell_http',
        'failed',
        observedAt,
        `http_${response.status}`,
      );
    }
    return stamp(
      'shell_http',
      'degraded',
      observedAt,
      `http_${response.status}`,
    );
  } catch (error) {
    return stamp(
      'shell_http',
      'failed',
      observedAt,
      error instanceof Error ? error.message : 'network_error',
    );
  }
}

export async function runDatabaseConnectivityProbe(
  ports: SelfProbePorts,
): Promise<CloudflareSelfProbeResult> {
  const observedAt = (ports.now?.() ?? new Date()).toISOString();
  if (!ports.databasePing) {
    return stamp(
      'database_connectivity',
      'not_ready',
      observedAt,
      'databasePing not wired',
    );
  }
  try {
    const result = await ports.databasePing();
    return stamp(
      'database_connectivity',
      result.ok ? 'ok' : 'failed',
      observedAt,
      result.detail,
    );
  } catch (error) {
    return stamp(
      'database_connectivity',
      'unknown',
      observedAt,
      error instanceof Error ? error.message : 'probe_threw',
    );
  }
}

export async function runObjectStorageProbe(
  ports: SelfProbePorts,
): Promise<CloudflareSelfProbeResult> {
  const observedAt = (ports.now?.() ?? new Date()).toISOString();
  if (!ports.objectStoragePing) {
    return stamp(
      'object_storage_binding',
      'not_ready',
      observedAt,
      'objectStoragePing not wired',
    );
  }
  try {
    const result = await ports.objectStoragePing();
    return stamp(
      'object_storage_binding',
      result.ok ? 'ok' : 'failed',
      observedAt,
      result.detail,
    );
  } catch (error) {
    return stamp(
      'object_storage_binding',
      'unknown',
      observedAt,
      error instanceof Error ? error.message : 'probe_threw',
    );
  }
}

export function runMappingReadinessProbe(
  ports: SelfProbePorts,
): CloudflareSelfProbeResult {
  const observedAt = (ports.now?.() ?? new Date()).toISOString();
  const mapping = ports.mapping;
  if (!mapping) {
    return stamp(
      'mapping_readiness',
      'not_ready',
      observedAt,
      'mapping absent',
    );
  }
  if (!mapping.verified) {
    return stamp(
      'mapping_readiness',
      'not_ready',
      observedAt,
      'mapping.verified=false',
    );
  }
  if (!mapping.accountId || !mapping.scriptName) {
    return stamp(
      'mapping_readiness',
      'degraded',
      observedAt,
      'accountId or scriptName missing',
    );
  }
  if (isHyperdrivePlaceholder(ports.hyperdriveId ?? mapping.hyperdriveConfigId)) {
    return stamp(
      'mapping_readiness',
      'degraded',
      observedAt,
      'hyperdrive still placeholder',
    );
  }
  return stamp('mapping_readiness', 'ok', observedAt);
}

/** Run the full self-probe suite (product-side only). */
export async function runCloudflareSelfProbes(
  ports: SelfProbePorts,
): Promise<CloudflareSelfProbeResult[]> {
  const [shell, database, objectStorage] = await Promise.all([
    runShellHttpProbe(ports),
    runDatabaseConnectivityProbe(ports),
    runObjectStorageProbe(ports),
  ]);
  return [shell, database, objectStorage, runMappingReadinessProbe(ports)];
}
