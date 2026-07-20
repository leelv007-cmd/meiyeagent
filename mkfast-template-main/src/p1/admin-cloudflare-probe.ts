/**
 * Admin presentation of product-side Cloudflare self health probes (J6 / D-053).
 *
 * Probes are functional status only — they never mutate Cloudflare resources.
 */

export type AdminCfProbeKind =
  | 'shell_http'
  | 'database_connectivity'
  | 'object_storage_binding'
  | 'mapping_readiness';

export type AdminCfProbeStatus =
  | 'ok'
  | 'degraded'
  | 'failed'
  | 'unknown'
  | 'not_ready';

export interface AdminCfProbeView {
  kind: AdminCfProbeKind;
  status: AdminCfProbeStatus;
  title: string;
  businessImpact: string;
  observedAt: string;
  detail?: string;
  mutatesCloudflare: false;
}

const PROBE_TITLES: Record<AdminCfProbeKind, string> = {
  shell_http: 'App Shell 入口',
  database_connectivity: '业务库连通',
  object_storage_binding: '对象存储绑定',
  mapping_readiness: 'Cloudflare 生产映射',
};

const STATUS_LABELS: Record<AdminCfProbeStatus, string> = {
  ok: '正常',
  degraded: '降级',
  failed: '失败',
  unknown: '未知',
  not_ready: '未就绪',
};

export function adminCfProbeStatusLabel(status: AdminCfProbeStatus): string {
  return STATUS_LABELS[status];
}

export function adminCfProbeTitle(kind: AdminCfProbeKind): string {
  return PROBE_TITLES[kind];
}

/** Project a raw probe result into operator-facing view. */
export function projectAdminCfProbe(input: {
  kind: AdminCfProbeKind;
  status: AdminCfProbeStatus;
  businessImpact: string;
  observedAt: string;
  detail?: string;
}): AdminCfProbeView {
  return {
    kind: input.kind,
    status: input.status,
    title: PROBE_TITLES[input.kind],
    businessImpact: input.businessImpact,
    observedAt: input.observedAt,
    ...(input.detail ? { detail: input.detail } : {}),
    mutatesCloudflare: false,
  };
}

/**
 * Default probes when server has not wired live pings yet.
 * Honest not_ready / not_verified — never fake green.
 */
export function defaultAdminCfProbes(now: Date = new Date()): AdminCfProbeView[] {
  const observedAt = now.toISOString();
  return [
    projectAdminCfProbe({
      kind: 'shell_http',
      status: 'not_ready',
      businessImpact: 'App Shell HTTP 探针未接线，入口可用性未知',
      observedAt,
      detail: 'probe_not_wired',
    }),
    projectAdminCfProbe({
      kind: 'database_connectivity',
      status: 'not_ready',
      businessImpact: '业务库探针未接线，任务与账本读写可用性未知',
      observedAt,
      detail: 'probe_not_wired',
    }),
    projectAdminCfProbe({
      kind: 'object_storage_binding',
      status: 'not_ready',
      businessImpact: '对象存储探针未接线，素材读写可用性未知',
      observedAt,
      detail: 'probe_not_wired',
    }),
    projectAdminCfProbe({
      kind: 'mapping_readiness',
      status: 'not_ready',
      businessImpact:
        '生产 Cloudflare 映射未核验；只读盘点与 deep-link 不得宣称生产可用',
      observedAt,
      detail: 'mapping.verified=false',
    }),
  ];
}

export function summarizeProbeSuite(probes: AdminCfProbeView[]): {
  okCount: number;
  attentionCount: number;
  overall: AdminCfProbeStatus;
  allNonMutating: true;
} {
  let okCount = 0;
  let attentionCount = 0;
  for (const p of probes) {
    if (p.status === 'ok') okCount += 1;
    else attentionCount += 1;
  }
  let overall: AdminCfProbeStatus = 'ok';
  if (probes.some((p) => p.status === 'failed')) overall = 'failed';
  else if (probes.some((p) => p.status === 'degraded')) overall = 'degraded';
  else if (probes.some((p) => p.status === 'unknown')) overall = 'unknown';
  else if (probes.some((p) => p.status === 'not_ready')) overall = 'not_ready';

  return {
    okCount,
    attentionCount,
    overall,
    allNonMutating: true,
  };
}
