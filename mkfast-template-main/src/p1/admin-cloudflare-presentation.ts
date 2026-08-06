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
    title: 'Workers trace 采样为 100%',
    businessImpact:
      '全量 trace 放大事件量、费用与敏感字段暴露面；不能当作已优化的生产配置',
    evidence: 'observability.traces.head_sampling_rate=1',
  },
  {
    id: 'hyperdrive_placeholder',
    severity: 'not_ready',
    title: 'Hyperdrive 绑定仍为占位 ID',
    businessImpact:
      'App Shell 经 Hyperdrive 访问 Postgres 的路径未就绪；不得宣称生产数据库加速可用',
    evidence: 'hyperdrive.id=00000000-0000-0000-0000-000000000000',
  },
  {
    id: 'otel_destination_absent',
    severity: 'not_ready',
    title: '外部 OTel destination 未配置',
    businessImpact:
      'logs/traces 外发深诊断不可用；明细通过 Cloudflare 原生控制台 handoff 下钻',
    evidence: 'otel_destination=absent',
  },
];

export function freshnessLabel(freshness: AdminCfFreshness): string {
  switch (freshness) {
    case 'fresh':
      return '新鲜';
    case 'stale':
      return '过期（非实时）';
    case 'unknown':
      return '未知';
    case 'not_verified':
      return '未核验';
    case 'unavailable':
      return '不可用（限流/保留期）';
    default:
      return freshness;
  }
}

function unknownReasonImpact(reason: string): string {
  switch (reason) {
    case 'read_failed':
      return 'Cloudflare 只读盘点读取失败，不能用空列表伪装健康';
    case 'rate_limited':
      return 'Cloudflare API 限流，当前状态不可用，勿刷新刷爆配额';
    case 'retention_window_exceeded':
      return '已超出保留窗口，历史明细不可从 CF 恢复为产品真相';
    case 'sampled_incomplete':
      return '数据经采样不完整，不能当作全量证据';
    case 'mapping_not_verified':
      return '生产 account/zone/script 映射未核验，盘点不能宣称生产可用';
    case 'token_missing':
      return '服务端只读 Token 未配置，浏览器不得持有账户凭据';
    case 'not_configured':
      return '相关 Cloudflare 资源未配置';
    case 'cache_miss':
      return '无可用缓存快照';
    default:
      return `状态未知（${reason}），不得伪装为实时健康`;
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
        '部署版本仅反映 App Shell 发布事实，不是业务数据回滚；不覆盖 Core/Canvas',
    }));
    return {
      status: 'known',
      value,
      freshness: input.freshness ?? freshness,
      businessImpact:
        value.length > 0
          ? `最近 ${value.length} 条 Shell 部署可盘点；用户入口版本与灰度比例据此判断`
          : '暂无部署记录；不能推断生产未发布或已健康',
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
          ? 'Worker 版本历史可盘点（有限窗口，非无限审计）'
          : '无版本记录；长期发布审计应落我方事件库',
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
        '原生深诊断（logs/traces/部署操作）留在 Cloudflare Dashboard / Wrangler',
      productProjection:
        '产品后台只投影只读部署/版本/资源盘点与业务影响，不复制 Dashboard 指标',
      productSideActions:
        '可触发：刷新只读快照、自有健康探针、脱敏 deep-link；零 CF 写权限',
    },
    freshness,
    freshnessLabel: freshnessLabel(freshness),
    coverageNote:
      '覆盖范围：仅 App Shell（Cloudflare Workers）。不含 Node Core / Canvas 运行指标。',
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
