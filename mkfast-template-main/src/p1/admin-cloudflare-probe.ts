import {
  admin_capability_degraded_d8518883,
  admin_cloudflare_app_shell_entry_6c445d25,
  admin_cloudflare_app_shell_http_probe_not_wired_entry_ava_a9611145,
  admin_cloudflare_business_db_connectivity_dbc79722,
  admin_cloudflare_business_db_probe_not_wired_task_and_led_d5e4ce99,
  admin_cloudflare_cloudflare_production_mapping_4f15cd8f,
  admin_cloudflare_failed_3e3c8068,
  admin_cloudflare_healthy_f78d037a,
  admin_cloudflare_not_ready_6789578c,
  admin_cloudflare_object_storage_binding_3b01912b,
  admin_cloudflare_object_storage_probe_not_wired_material_df4a68fc,
  admin_cloudflare_production_cloudflare_mapping_unverified_98ef1ba5,
  admin_supply_unknown_d9c32a4c,
} from '@/locale/paraglide/messages';
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
  shell_http: admin_cloudflare_app_shell_entry_6c445d25(),
  database_connectivity: admin_cloudflare_business_db_connectivity_dbc79722(),
  object_storage_binding: admin_cloudflare_object_storage_binding_3b01912b(),
  mapping_readiness: admin_cloudflare_cloudflare_production_mapping_4f15cd8f(),
};

const STATUS_LABELS: Record<AdminCfProbeStatus, string> = {
  ok: admin_cloudflare_healthy_f78d037a(),
  degraded: admin_capability_degraded_d8518883(),
  failed: admin_cloudflare_failed_3e3c8068(),
  unknown: admin_supply_unknown_d9c32a4c(),
  not_ready: admin_cloudflare_not_ready_6789578c(),
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
export function defaultAdminCfProbes(
  now: Date = new Date()
): AdminCfProbeView[] {
  const observedAt = now.toISOString();
  return [
    projectAdminCfProbe({
      kind: 'shell_http',
      status: 'not_ready',
      businessImpact:
        admin_cloudflare_app_shell_http_probe_not_wired_entry_ava_a9611145(),
      observedAt,
      detail: 'probe_not_wired',
    }),
    projectAdminCfProbe({
      kind: 'database_connectivity',
      status: 'not_ready',
      businessImpact:
        admin_cloudflare_business_db_probe_not_wired_task_and_led_d5e4ce99(),
      observedAt,
      detail: 'probe_not_wired',
    }),
    projectAdminCfProbe({
      kind: 'object_storage_binding',
      status: 'not_ready',
      businessImpact:
        admin_cloudflare_object_storage_probe_not_wired_material_df4a68fc(),
      observedAt,
      detail: 'probe_not_wired',
    }),
    projectAdminCfProbe({
      kind: 'mapping_readiness',
      status: 'not_ready',
      businessImpact:
        admin_cloudflare_production_cloudflare_mapping_unverified_98ef1ba5(),
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
