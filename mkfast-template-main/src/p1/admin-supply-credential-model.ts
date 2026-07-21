/**
 * CredentialAccount UI projection (J5 / D-060 / D-070).
 *
 * Pure presentation: metadata / binding / version / 3-state trunk + tested
 * activation gate + draining sub-state / probe results / rotate-drain flow.
 * Secret material is never accepted or projected. env_fallback risk + migration
 * entry stay visible whenever source is env_fallback.
 */
import type {
  CredentialAccountLifecycle,
  CredentialAccountMetadata,
  CredentialDrainSubstate,
} from '@meiye/contracts';

import type { SupplyControlSnapshot } from './admin-supply-types';

export type CredentialTestStatusUi =
  | 'passed'
  | 'unauthorized'
  | 'network_failed'
  | 'unknown'
  | 'not_wired'
  | 'pending';

export type CredentialVersionHistoryRow = {
  version: string;
  /** Public mask only — never a secret value. */
  mask: string;
  createdAt: string;
  source: CredentialAccountMetadata['source'];
};

export type CredentialProbeResultView = {
  status: CredentialTestStatusUi;
  testedAt?: string;
  evidenceRef?: string;
  errorCode?: string;
  label: string;
};

export type CredentialRotateDrainFlowView = {
  canRotate: boolean;
  canActivate: boolean;
  canStartDrain: boolean;
  canCompleteDrain: boolean;
  canRevoke: boolean;
  notes: string[];
};

/** Admin-facing CredentialAccount row (metadata only). */
export interface CredentialAccountUiView {
  id: string;
  label: string;
  providerProfileId: string;
  providerDisplayName: string | null;
  projectRegion?: string;
  type: string;
  scope: CredentialAccountMetadata['scope'];
  /** Opaque secret reference — never a raw key. */
  secretReference: string;
  version: string;
  /** Three-state trunk: pending → active → retired. */
  status: CredentialAccountLifecycle;
  statusLabel: string;
  /** Async media sub-state only. */
  drainSubstate: CredentialDrainSubstate;
  drainLabel: string;
  source: CredentialAccountMetadata['source'];
  sourceLabel: string;
  verifiedAt?: string;
  expiresAt?: string;
  publicQuotaHint?: string;
  /** tested = activation gate, not a lifecycle state. */
  activationGate: {
    satisfied: boolean;
    probe: CredentialProbeResultView;
  };
  binding: {
    deploymentIds: string[];
    poolIds: string[];
    executionChannelIds: string[];
  };
  versionHistory: CredentialVersionHistoryRow[];
  /** Always true when source is env_fallback. */
  envFallbackRisk: boolean;
  /** Migration entry always visible for env_fallback. */
  migrationEntryVisible: boolean;
  migrationEntryLabel: string | null;
  rotateDrainFlow: CredentialRotateDrainFlowView;
}

export interface CredentialUiPanelView {
  accounts: CredentialAccountUiView[];
  envFallbackCount: number;
  /** Always true — panel must keep env_fallback risk visible. */
  envFallbackRiskAlwaysVisible: true;
  secretNeverEchoed: true;
}

/** Optional probe/history enrichment beyond public metadata (fixture / Core). */
export interface CredentialAccountUiEnrichment {
  testStatus?: CredentialTestStatusUi;
  testedAt?: string;
  evidenceRef?: string;
  errorCode?: string;
  versionHistory?: CredentialVersionHistoryRow[];
  mask?: string;
}

const STATUS_LABEL: Record<CredentialAccountLifecycle, string> = {
  pending: '待激活',
  active: '已激活',
  retired: '已退役',
};

const SOURCE_LABEL: Record<CredentialAccountMetadata['source'], string> = {
  registry: '注册表',
  env_fallback: '环境变量回退（保险箱未接管）',
  migration: '迁移来源',
};

const PROBE_LABEL: Record<CredentialTestStatusUi, string> = {
  passed: '探针通过',
  unauthorized: '鉴权失败',
  network_failed: '网络失败',
  unknown: '结果未知',
  not_wired: '未接线（仅记录）',
  pending: '尚未测试',
};

const FORBIDDEN_SECRET_KEY =
  /"(apiKey|api_key|secret|password|authorization|token|credentialValue|privateKey)"\s*:/i;
const FORBIDDEN_SECRET_VALUE =
  /\bsk-[A-Za-z0-9]{8,}\b|\bBearer\s+[A-Za-z0-9._\-+/=]{8,}\b/i;

/**
 * Assert a public projection never carries secret material.
 * Used by contract tests (J5 secret no-echo).
 */
export function assertNoSecretEcho(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (json === undefined) return;
  if (FORBIDDEN_SECRET_KEY.test(json) || FORBIDDEN_SECRET_VALUE.test(json)) {
    throw new Error('CredentialAccount UI projection must not echo secrets.');
  }
}

export function isActivationGateSatisfied(
  probe: CredentialProbeResultView,
  options: { now?: string; maxAgeMs?: number } = {}
): boolean {
  if (probe.status !== 'passed' || !probe.testedAt) return false;
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const testedMs = Date.parse(probe.testedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(testedMs)) return false;
  const maxAge = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
  return nowMs - testedMs <= maxAge;
}

function probeFromMetadata(
  meta: CredentialAccountMetadata,
  enrichment?: CredentialAccountUiEnrichment
): CredentialProbeResultView {
  const status: CredentialTestStatusUi =
    enrichment?.testStatus ??
    (meta.verifiedAt || meta.lastTestEvidenceRef ? 'passed' : 'pending');
  return {
    status,
    ...(enrichment?.testedAt
      ? { testedAt: enrichment.testedAt }
      : meta.verifiedAt
        ? { testedAt: meta.verifiedAt }
        : {}),
    ...(enrichment?.evidenceRef
      ? { evidenceRef: enrichment.evidenceRef }
      : meta.lastTestEvidenceRef
        ? { evidenceRef: meta.lastTestEvidenceRef }
        : {}),
    ...(enrichment?.errorCode ? { errorCode: enrichment.errorCode } : {}),
    label: PROBE_LABEL[status],
  };
}

function buildRotateDrainFlow(
  status: CredentialAccountLifecycle,
  drain: CredentialDrainSubstate,
  gateSatisfied: boolean
): CredentialRotateDrainFlowView {
  const notes: string[] = [];
  if (status === 'retired') {
    notes.push('已退役：仅可查看元数据，不可轮换/排空/激活');
  } else {
    notes.push('轮换追加版本快照，不追改历史；运行中任务冻结旧版本');
  }
  if (status === 'pending' && !gateSatisfied) {
    notes.push('激活前置门：需最近通过的连通/能力探针');
  }
  if (drain === 'draining') {
    notes.push('排空中：停止新任务，等待异步媒体完成（可逆）');
  }
  return {
    canRotate: status !== 'retired',
    canActivate: status === 'pending' && gateSatisfied,
    canStartDrain: status === 'active' && drain !== 'draining',
    canCompleteDrain: status === 'active' && drain === 'draining',
    canRevoke: status !== 'retired',
    notes,
  };
}

export function projectCredentialAccountUi(
  meta: CredentialAccountMetadata,
  options: {
    snapshot?: SupplyControlSnapshot;
    enrichment?: CredentialAccountUiEnrichment;
    now?: string;
  } = {}
): CredentialAccountUiView {
  const snapshot = options.snapshot;
  const provider =
    snapshot?.providerProfiles.find((p) => p.id === meta.providerProfileId) ??
    null;
  const deployments =
    snapshot?.deployments.filter(
      (d) =>
        d.credentialAccountId === meta.id ||
        d.providerProfileId === meta.providerProfileId
    ) ?? [];
  const pools =
    snapshot?.pools.filter((p) => p.credentialAccountIds.includes(meta.id)) ??
    [];
  const probe = probeFromMetadata(meta, options.enrichment);
  const gateSatisfied = isActivationGateSatisfied(probe, { now: options.now });
  const drain: CredentialDrainSubstate = meta.drainSubstate ?? 'none';
  const envFallbackRisk = meta.source === 'env_fallback';
  const mask = options.enrichment?.mask ?? '••••••••';
  const versionHistory: CredentialVersionHistoryRow[] = options.enrichment
    ?.versionHistory ?? [
    {
      version: meta.version,
      mask,
      createdAt: meta.verifiedAt ?? 'unknown',
      source: meta.source,
    },
  ];

  const view: CredentialAccountUiView = {
    id: meta.id,
    label: meta.label,
    providerProfileId: meta.providerProfileId,
    providerDisplayName: provider?.displayName ?? null,
    ...(meta.projectRegion ? { projectRegion: meta.projectRegion } : {}),
    type: meta.type,
    scope: meta.scope,
    secretReference: meta.secretReference,
    version: meta.version,
    status: meta.status,
    statusLabel: STATUS_LABEL[meta.status],
    drainSubstate: drain,
    drainLabel: drain === 'draining' ? '排空中' : '未排空',
    source: meta.source,
    sourceLabel: SOURCE_LABEL[meta.source],
    ...(meta.verifiedAt ? { verifiedAt: meta.verifiedAt } : {}),
    ...(meta.expiresAt ? { expiresAt: meta.expiresAt } : {}),
    ...(meta.publicQuotaHint ? { publicQuotaHint: meta.publicQuotaHint } : {}),
    activationGate: { satisfied: gateSatisfied, probe },
    binding: {
      deploymentIds: deployments.map((d) => d.id),
      poolIds: pools.map((p) => p.id),
      executionChannelIds: [
        ...new Set(deployments.map((d) => d.executionChannelId)),
      ],
    },
    versionHistory,
    envFallbackRisk,
    migrationEntryVisible: envFallbackRisk,
    migrationEntryLabel: envFallbackRisk
      ? '迁移到保险箱：写入 CredentialAccount 后重启生效'
      : null,
    rotateDrainFlow: buildRotateDrainFlow(meta.status, drain, gateSatisfied),
  };

  assertNoSecretEcho(view);
  return view;
}

export function buildCredentialUiPanel(
  snapshot: SupplyControlSnapshot,
  options: {
    enrichments?: ReadonlyMap<string, CredentialAccountUiEnrichment>;
    now?: string;
  } = {}
): CredentialUiPanelView {
  const accounts = snapshot.credentials.map((meta) =>
    projectCredentialAccountUi(meta, {
      snapshot,
      enrichment: options.enrichments?.get(meta.id),
      now: options.now,
    })
  );
  const panel: CredentialUiPanelView = {
    accounts,
    envFallbackCount: accounts.filter((a) => a.envFallbackRisk).length,
    envFallbackRiskAlwaysVisible: true,
    secretNeverEchoed: true,
  };
  assertNoSecretEcho(panel);
  return panel;
}
