/**
 * Local config risk projection for Cloudflare wiring (D-053).
 *
 * - 100% head sampling → config_risk (cost / PII volume)
 * - Hyperdrive all-zero placeholder ID → not_ready
 * - No Cloudflare Queue binding → not_enabled (do not invent Queue cards)
 */

import type { CloudflareConfigRisk } from './types.js';

export const HYPERDRIVE_PLACEHOLDER_ID =
  '00000000-0000-0000-0000-000000000000';

export interface CloudflareLocalConfigSnapshot {
  /** Trace head_sampling_rate from wrangler observability.traces (0..1). */
  traceHeadSamplingRate?: number;
  /** Hyperdrive binding id from wrangler (may be placeholder). */
  hyperdriveId?: string;
  /** Whether a Cloudflare Queue binding exists (repo currently: false). */
  cloudflareQueueBindingPresent?: boolean;
  /** R2 bucket binding declared (config only — not production proof). */
  r2BucketBindingDeclared?: boolean;
  /** Logpush flag in wrangler (capability, not job proof). */
  logpushEnabled?: boolean;
  /** OTel destination configured (external). */
  otelDestinationConfigured?: boolean;
}

export function isHyperdrivePlaceholder(id: string | undefined): boolean {
  if (!id) return true;
  return id.trim() === HYPERDRIVE_PLACEHOLDER_ID || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id.trim());
}

/**
 * Project local wrangler/config facts into operator-facing config risks.
 * Never claims production health from undeployed config.
 */
export function projectCloudflareConfigRisks(
  config: CloudflareLocalConfigSnapshot,
): CloudflareConfigRisk[] {
  const risks: CloudflareConfigRisk[] = [];

  if (
    config.traceHeadSamplingRate != null &&
    config.traceHeadSamplingRate >= 1
  ) {
    risks.push({
      id: 'trace_sampling_100pct',
      severity: 'config_risk',
      title: 'Workers trace 采样为 100%',
      businessImpact:
        '全量 trace 会放大事件量、费用与敏感字段暴露面；运营侧不得把采样率当成已优化的生产配置',
      evidence: `observability.traces.head_sampling_rate=${config.traceHeadSamplingRate}`,
    });
  }

  if (isHyperdrivePlaceholder(config.hyperdriveId)) {
    risks.push({
      id: 'hyperdrive_placeholder',
      severity: 'not_ready',
      title: 'Hyperdrive 绑定仍为占位 ID',
      businessImpact:
        'App Shell 经 Hyperdrive 访问 Postgres 的路径未就绪；不得宣称生产数据库加速可用',
      evidence: `hyperdrive.id=${config.hyperdriveId ?? '(missing)'}`,
    });
  }

  if (config.cloudflareQueueBindingPresent === true) {
    // Present is unexpected for current topology — surface as attention, still no invent.
    risks.push({
      id: 'cloudflare_queue_unexpected',
      severity: 'config_risk',
      title: '检测到 Cloudflare Queue 绑定',
      businessImpact:
        '当前异步真相源为 Core DBOS/pg-boss/Postgres；Queue 绑定需单独验收，不得与 Core 队列混算',
      evidence: 'cloudflare_queue_binding=present',
    });
  }

  if (config.r2BucketBindingDeclared === false) {
    risks.push({
      id: 'r2_binding_missing',
      severity: 'not_ready',
      title: 'R2 bucket 绑定未声明',
      businessImpact: '对象资产存储路径未在 Worker 配置中声明',
      evidence: 'r2_buckets=absent',
    });
  }

  if (config.otelDestinationConfigured === false) {
    // Informational readiness — not a hard failure.
    risks.push({
      id: 'otel_destination_absent',
      severity: 'not_ready',
      title: '外部 OTel destination 未配置',
      businessImpact:
        'logs/traces 外发深诊断不可用；明细仍应通过 Cloudflare 原生控制台 handoff 下钻',
      evidence: 'otel_destination=absent',
    });
  }

  return risks;
}

/**
 * Default risks derived from the current repository wrangler.jsonc facts.
 * Used when no live production mapping is available.
 */
export function defaultRepoConfigRisks(): CloudflareConfigRisk[] {
  return projectCloudflareConfigRisks({
    traceHeadSamplingRate: 1,
    hyperdriveId: HYPERDRIVE_PLACEHOLDER_ID,
    cloudflareQueueBindingPresent: false,
    r2BucketBindingDeclared: true,
    logpushEnabled: true,
    otelDestinationConfigured: false,
  });
}

/** Explicit: product admin must not show a fictional Cloudflare Queue card. */
export function shouldShowCloudflareQueueCard(
  config: CloudflareLocalConfigSnapshot,
): false {
  void config;
  return false;
}
