/**
 * Cloudflare read-only presentation model for product admin (J6 / D-052 / D-053).
 *
 * Translates inventory + probes + config risks into business impact language.
 * Never copies raw Dashboard metrics. Never invents Cloudflare Queue cards.
 * Failures / sampling / retention / rate-limit surface as unknown / stale.
 */

import {
  adminCfDeepLinkLabel,
  type AdminCfDeepLinkResourceKind,
} from './admin-cloudflare-deep-link';
import {
  type AdminCfProbeView,
  summarizeProbeSuite,
} from './admin-cloudflare-probe';
import {
  admin_capability_not_verified_0800371a,
  admin_cloudflare_allowed_refresh_read_only_snapshot_first_00164271,
  admin_cloudflare_app_shell_path_to_postgres_via_hyperdriv_966cae72,
  admin_cloudflare_cloudflare_api_rate_limited_status_unava_070352b0,
  admin_cloudflare_cloudflare_read_only_inventory_failed_do_9defdbf5,
  admin_cloudflare_deploy_versions_only_reflect_app_shell_r_6fde9a61,
  admin_cloudflare_external_otel_destination_not_configured_b61123a9,
  admin_cloudflare_fresh_467bc8d4,
  admin_cloudflare_full_traces_amplify_event_volume_cost_an_ceb657f2,
  admin_cloudflare_hyperdrive_binding_is_still_a_placeholde_d2834f2f,
  admin_cloudflare_native_deep_diagnosis_logs_traces_deploy_004e2b12,
  admin_cloudflare_no_deploy_records_cannot_infer_productio_b303b73e,
  admin_cloudflare_no_usable_cached_snapshot_9b4f1543,
  admin_cloudflare_no_version_records_long_term_release_aud_b7d21eb4,
  admin_cloudflare_outbound_logs_traces_deep_diagnosis_unav_03995d9e,
  admin_cloudflare_past_retention_window_historical_details_2750a11e,
  admin_cloudflare_product_admin_only_projects_read_only_de_db73d1d6,
  admin_cloudflare_production_account_zone_script_mapping_u_d276f681,
  admin_cloudflare_related_cloudflare_resources_not_configu_25852a43,
  admin_cloudflare_sampled_data_is_incomplete_not_full_evid_b81c1665,
  admin_cloudflare_scope_app_shell_cloudflare_workers_only_c268f876,
  admin_cloudflare_server_read_only_token_not_configured_br_769c07ef,
  admin_cloudflare_shell_deploys_inventoriable,
  admin_cloudflare_stale_not_real_time_c477cd56,
  admin_cloudflare_status_unknown_reason,
  admin_cloudflare_unavailable_rate_limit_retention_f91da348,
  admin_cloudflare_worker_version_history_inventoriable_lim_5b46e0f8,
  admin_cloudflare_workers_trace_sampling_is_100_5b9b1ad6,
  admin_supply_unknown_d9c32a4c,
} from '@/locale/paraglide/messages';

export type AdminCfFreshness =
  | 'fresh'
  | 'stale'
  | 'unknown'
  | 'not_verified'
  | 'unavailable';

export type AdminCfFieldStatus = 'known' | 'unknown';

export interface AdminCfFieldView<T> {
  status: AdminCfFieldStatus;
  value?: T;
  reason?: string;
  freshness: AdminCfFreshness;
  businessImpact: string;
}

export interface AdminCfDeploymentView {
  deploymentId: string;
  versionId?: string;
  createdOn?: string;
  source?: string;
  trafficPercent?: number;
  note: string;
}

export interface AdminCfResourceView {
  kind: string;
  name: string;
  readiness: string;
  businessImpact: string;
  detail?: string;
}

export interface AdminCfConfigRiskView {
  id: string;
  severity: 'config_risk' | 'not_ready';
  title: string;
  businessImpact: string;
  evidence: string;
}

export interface AdminCfInventoryInput {
  mappingRef: string;
  capturedAt: string;
  freshness: AdminCfFreshness;
  deployments:
    | {
        status: 'known';
        value: AdminCfDeploymentView[];
        freshness?: AdminCfFreshness;
      }
    | {
        status: 'unknown';
        reason: string;
        freshness?: AdminCfFreshness;
        detail?: string;
      };
  versions:
    | {
        status: 'known';
        value: Array<{ versionId: string; createdOn?: string }>;
        freshness?: AdminCfFreshness;
      }
    | {
        status: 'unknown';
        reason: string;
        freshness?: AdminCfFreshness;
        detail?: string;
      };
  resources: AdminCfResourceView[];
  cloudflareQueuesEnabled: false;
  graphqlAnalyticsDeferred: true;
  cache?: { hit: boolean; ttlMs: number; ageMs: number | null };
}

export interface AdminCfPresentationView {
  /** Three truth layers reminder for the panel. */
  truthLayers: {
    nativeDiagnostics: string;
    productProjection: string;
    productSideActions: string;
  };
  freshness: AdminCfFreshness;
  freshnessLabel: string;
  coverageNote: string;
  deployments: AdminCfFieldView<AdminCfDeploymentView[]>;
  versions: AdminCfFieldView<Array<{ versionId: string; createdOn?: string }>>;
  resources: AdminCfResourceView[];
  configRisks: AdminCfConfigRiskView[];
  probes: AdminCfProbeView[];
  probeSummary: ReturnType<typeof summarizeProbeSuite>;
  /**
   * Official Dashboard deep-links resolved server-side.
   * Empty when mapping is unverified — never render dead CTAs.
   */
  deepLinks: Array<{
    kind: AdminCfDeepLinkResourceKind;
    label: string;
    dashboardUrl: string;
  }>;
  /** Always false — do not render a CF Queue card. */
  showCloudflareQueueCard: false;
  /** Always true — GraphQL analytics broker deferred. */
  graphqlAnalyticsDeferred: true;
  /** Write ops are never offered. */
  writeActionsAllowed: false;
  deniedWriteActions: readonly string[];
  capturedAt: string;
  cacheHit: boolean;
}

export const ADMIN_CF_DENIED_WRITE_ACTIONS = [
  'cloudflare_deploy',
  'cloudflare_rollback',
  'cloudflare_dns_write',
  'cloudflare_waf_write',
  'cloudflare_secret_put',
  'cloudflare_r2_write',
  'cloudflare_billing_write',
  'cloudflare_publish',
] as const;

export const DEFAULT_REPO_CONFIG_RISKS: AdminCfConfigRiskView[] = [
  {
    id: 'trace_sampling_100pct',
    severity: 'config_risk',
    title: admin_cloudflare_workers_trace_sampling_is_100_5b9b1ad6(),
    businessImpact:
      admin_cloudflare_full_traces_amplify_event_volume_cost_an_ceb657f2(),
    evidence: 'observability.traces.head_sampling_rate=1',
  },
  {
    id: 'hyperdrive_placeholder',
    severity: 'not_ready',
    title: admin_cloudflare_hyperdrive_binding_is_still_a_placeholde_d2834f2f(),
    businessImpact:
      admin_cloudflare_app_shell_path_to_postgres_via_hyperdriv_966cae72(),
    evidence: 'hyperdrive.id=00000000-0000-0000-0000-000000000000',
  },
  {
    id: 'otel_destination_absent',
    severity: 'not_ready',
    title: admin_cloudflare_external_otel_destination_not_configured_b61123a9(),
    businessImpact:
      admin_cloudflare_outbound_logs_traces_deep_diagnosis_unav_03995d9e(),
    evidence: 'otel_destination=absent',
  },
];

export function freshnessLabel(freshness: AdminCfFreshness): string {
  switch (freshness) {
    case 'fresh':
      return admin_cloudflare_fresh_467bc8d4();
    case 'stale':
      return admin_cloudflare_stale_not_real_time_c477cd56();
    case 'unknown':
      return admin_supply_unknown_d9c32a4c();
    case 'not_verified':
      return admin_capability_not_verified_0800371a();
    case 'unavailable':
      return admin_cloudflare_unavailable_rate_limit_retention_f91da348();
    default:
      return freshness;
  }
}

function unknownReasonImpact(reason: string): string {
  switch (reason) {
    case 'read_failed':
      return admin_cloudflare_cloudflare_read_only_inventory_failed_do_9defdbf5();
    case 'rate_limited':
      return admin_cloudflare_cloudflare_api_rate_limited_status_unava_070352b0();
    case 'retention_window_exceeded':
      return admin_cloudflare_past_retention_window_historical_details_2750a11e();
    case 'sampled_incomplete':
      return admin_cloudflare_sampled_data_is_incomplete_not_full_evid_b81c1665();
    case 'mapping_not_verified':
      return admin_cloudflare_production_account_zone_script_mapping_u_d276f681();
    case 'token_missing':
      return admin_cloudflare_server_read_only_token_not_configured_br_769c07ef();
    case 'not_configured':
      return admin_cloudflare_related_cloudflare_resources_not_configu_25852a43();
    case 'cache_miss':
      return admin_cloudflare_no_usable_cached_snapshot_9b4f1543();
    default:
      return admin_cloudflare_status_unknown_reason({ reason });
  }
}

function projectDeployments(
  input: AdminCfInventoryInput['deployments'],
  freshness: AdminCfFreshness
): AdminCfFieldView<AdminCfDeploymentView[]> {
  if (input.status === 'known') {
    const value = input.value.map((d) => ({
      ...d,
      note:
        d.note ||
        admin_cloudflare_deploy_versions_only_reflect_app_shell_r_6fde9a61(),
    }));
    return {
      status: 'known',
      value,
      freshness: input.freshness ?? freshness,
      businessImpact:
        value.length > 0
          ? admin_cloudflare_shell_deploys_inventoriable({
              count: value.length,
            })
          : admin_cloudflare_no_deploy_records_cannot_infer_productio_b303b73e(),
    };
  }
  return {
    status: 'unknown',
    reason: input.reason,
    freshness: input.freshness ?? freshness,
    businessImpact: unknownReasonImpact(input.reason),
  };
}

function projectVersions(
  input: AdminCfInventoryInput['versions'],
  freshness: AdminCfFreshness
): AdminCfFieldView<Array<{ versionId: string; createdOn?: string }>> {
  if (input.status === 'known') {
    return {
      status: 'known',
      value: input.value,
      freshness: input.freshness ?? freshness,
      businessImpact:
        input.value.length > 0
          ? admin_cloudflare_worker_version_history_inventoriable_lim_5b46e0f8()
          : admin_cloudflare_no_version_records_long_term_release_aud_b7d21eb4(),
    };
  }
  return {
    status: 'unknown',
    reason: input.reason,
    freshness: input.freshness ?? freshness,
    businessImpact: unknownReasonImpact(input.reason),
  };
}

export interface AdminCfResolvedDeepLinkInput {
  kind: AdminCfDeepLinkResourceKind;
  dashboardUrl: string;
}

/**
 * Project Core-resolved deep-links into operator-facing CTAs.
 * Drops entries without a usable https Dashboard URL (no dead spans).
 */
export function projectAdminCloudflareDeepLinks(
  resolved: readonly AdminCfResolvedDeepLinkInput[] | undefined | null
): AdminCfPresentationView['deepLinks'] {
  if (!resolved?.length) return [];
  const links: AdminCfPresentationView['deepLinks'] = [];
  for (const item of resolved) {
    const url = item.dashboardUrl?.trim();
    if (!url || !/^https:\/\//i.test(url)) continue;
    links.push({
      kind: item.kind,
      label: adminCfDeepLinkLabel(item.kind),
      dashboardUrl: url,
    });
  }
  return links;
}

export function buildAdminCloudflarePresentation(input: {
  inventory?: AdminCfInventoryInput | null;
  probes?: AdminCfProbeView[];
  configRisks?: AdminCfConfigRiskView[];
  now?: Date;
  /**
   * Server-resolved Dashboard URLs. When omitted or empty, the panel hides
   * the deep-link block entirely (ticket #392: no dead CTAs).
   */
  deepLinks?: readonly AdminCfResolvedDeepLinkInput[] | null;
}): AdminCfPresentationView {
  const inventory = input.inventory;
  const freshness: AdminCfFreshness = inventory?.freshness ?? 'not_verified';
  const probes = input.probes ?? [];
  const configRisks = input.configRisks ?? DEFAULT_REPO_CONFIG_RISKS;
  const deepLinks = projectAdminCloudflareDeepLinks(input.deepLinks);

  return {
    truthLayers: {
      nativeDiagnostics:
        admin_cloudflare_native_deep_diagnosis_logs_traces_deploy_004e2b12(),
      productProjection:
        admin_cloudflare_product_admin_only_projects_read_only_de_db73d1d6(),
      productSideActions:
        admin_cloudflare_allowed_refresh_read_only_snapshot_first_00164271(),
    },
    freshness,
    freshnessLabel: freshnessLabel(freshness),
    coverageNote:
      admin_cloudflare_scope_app_shell_cloudflare_workers_only_c268f876(),
    deployments: inventory
      ? projectDeployments(inventory.deployments, freshness)
      : {
          status: 'unknown',
          reason: 'mapping_not_verified',
          freshness: 'not_verified',
          businessImpact: unknownReasonImpact('mapping_not_verified'),
        },
    versions: inventory
      ? projectVersions(inventory.versions, freshness)
      : {
          status: 'unknown',
          reason: 'mapping_not_verified',
          freshness: 'not_verified',
          businessImpact: unknownReasonImpact('mapping_not_verified'),
        },
    resources: inventory?.resources ?? [],
    configRisks,
    probes,
    probeSummary: summarizeProbeSuite(probes),
    deepLinks,
    showCloudflareQueueCard: false,
    graphqlAnalyticsDeferred: true,
    writeActionsAllowed: false,
    deniedWriteActions: ADMIN_CF_DENIED_WRITE_ACTIONS,
    capturedAt:
      inventory?.capturedAt ?? (input.now ?? new Date()).toISOString(),
    cacheHit: inventory?.cache?.hit ?? false,
  };
}

/** Honest metric text for SSR / unit tests — never invents zero health. */
export function formatAdminCfField<T>(
  field: AdminCfFieldView<T>,
  format: (value: T) => string = String
): string {
  if (field.status === 'known' && field.value !== undefined) {
    return format(field.value);
  }
  return `unknown (${field.reason ?? field.freshness})`;
}
