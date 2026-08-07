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
import {
  admin_provider_credential_active_b1eea7b8,
  admin_provider_credential_draining_88a9ae17,
  admin_provider_credential_not_draining_cabe3fcf,
  admin_provider_credential_pending_activation_b5464790,
  admin_provider_credential_retired_0c9e069e,
  admin_supply_activation_gate_requires_a_recent_passed_e27d13d3,
  admin_supply_auth_failed_e44243f9,
  admin_supply_draining_stop_new_tasks_wait_for_async_m_ff40eca7,
  admin_supply_env_var_fallback_vault_not_owning_b8dfe62b,
  admin_supply_migrate_to_vault_write_credentialaccount_e1b1da15,
  admin_supply_migration_source_ad49b2a1,
  admin_supply_network_failed_928299bf,
  admin_supply_not_tested_yet_6cfddf70,
  admin_supply_not_wired_record_only_036ae463,
  admin_supply_probe_passed_3e55277c,
  admin_supply_registry_c7bf611e,
  admin_supply_result_unknown_53d4855a,
  admin_supply_retired_metadata_view_only_no_rotate_dra_abfd474e,
  admin_supply_rotate_appends_a_version_snapshot_withou_934f0e83,
} from '@/locale/paraglide/messages';

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
  pending: admin_provider_credential_pending_activation_b5464790(),
  active: admin_provider_credential_active_b1eea7b8(),
  retired: admin_provider_credential_retired_0c9e069e(),
};

const SOURCE_LABEL: Record<CredentialAccountMetadata['source'], string> = {
  registry: admin_supply_registry_c7bf611e(),
  env_fallback: admin_supply_env_var_fallback_vault_not_owning_b8dfe62b(),
  migration: admin_supply_migration_source_ad49b2a1(),
};

const PROBE_LABEL: Record<CredentialTestStatusUi, string> = {
  passed: admin_supply_probe_passed_3e55277c(),
  unauthorized: admin_supply_auth_failed_e44243f9(),
  network_failed: admin_supply_network_failed_928299bf(),
  unknown: admin_supply_result_unknown_53d4855a(),
  not_wired: admin_supply_not_wired_record_only_036ae463(),
  pending: admin_supply_not_tested_yet_6cfddf70(),
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
    notes.push(
      admin_supply_retired_metadata_view_only_no_rotate_dra_abfd474e()
    );
  } else {
    notes.push(
      admin_supply_rotate_appends_a_version_snapshot_withou_934f0e83()
    );
  }
  if (status === 'pending' && !gateSatisfied) {
    notes.push(
      admin_supply_activation_gate_requires_a_recent_passed_e27d13d3()
    );
  }
  if (drain === 'draining') {
    notes.push(
      admin_supply_draining_stop_new_tasks_wait_for_async_m_ff40eca7()
    );
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
    drainLabel:
      drain === 'draining'
        ? admin_provider_credential_draining_88a9ae17()
        : admin_provider_credential_not_draining_cabe3fcf(),
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
      ? admin_supply_migrate_to_vault_write_credentialaccount_e1b1da15()
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
