/**
 * MP-08 fault-injection matrix contracts (I4 / D-069 / D-080 C5).
 *
 * Four scenarios per core operation:
 *  1. primary reject_before_accept → auto switch
 *  2. accepted / acceptance_unknown → no resubmit, enter reconcile
 *  3. isolate/drain → new tasks (no restart) take other channel
 *  4. RouteSnapshot + bilateral ledger replayable
 */
import type {
  ActivationEvidenceStatus,
  CanonicalRouteSnapshot,
  SupplyChannelKind,
  SupplyOperation,
} from '@meiye/contracts';
import type { Acceptance } from '../../supply-contracts.js';

/** Three core operations that require dual-channel live_verified (D-069). */
export const CORE_FAULT_INJECTION_OPERATIONS = [
  'copy.generate',
  'image.generate',
  'video.generate',
] as const;

export type CoreFaultInjectionOperation =
  (typeof CORE_FAULT_INJECTION_OPERATIONS)[number];

/** Secondary operations: ≥1 live_verified; single-channel labeled no-fallback. */
export const SECONDARY_FAULT_INJECTION_OPERATIONS = [
  'copy.adapt',
  'text.respond',
  'image.edit',
] as const;

export type SecondaryFaultInjectionOperation =
  (typeof SECONDARY_FAULT_INJECTION_OPERATIONS)[number];

export type FaultInjectionOperation =
  | CoreFaultInjectionOperation
  | SecondaryFaultInjectionOperation;

export const FAULT_INJECTION_SCENARIOS = [
  'reject_before_accept_switch',
  'accepted_no_resubmit',
  'acceptance_unknown_reconcile',
  'isolate_drain_new_task',
  'route_snapshot_ledger_replay',
] as const;

export type FaultInjectionScenarioId =
  (typeof FAULT_INJECTION_SCENARIOS)[number];

export type FaultInjectionModality = 'llm' | 'image' | 'video';

export type FaultDomainKind =
  | 'independent_counterparty'
  | 'independent_channel'
  | 'shared_manufacturer_only'
  | 'none';

/**
 * Independent fault domain key.
 * Same account dual-token / same-endpoint dual-alias MUST collapse to one key
 * (they do not count as independent domains).
 */
export function faultDomainKey(input: {
  /** Optional endpoint fingerprint — same endpoint aliases collapse. */
  endpointFingerprint?: string;
  /** Optional account identity — dual tokens on same account collapse. */
  accountIdentity?: string;
}): string {
  const endpoint = input.endpointFingerprint?.trim() || 'endpoint:default';
  const account = input.accountIdentity?.trim() || 'account:default';
  return `${account}::${endpoint}`;
}

export interface QualifiedDeploymentEvidence {
  deploymentId: string;
  catalogModelId: string;
  providerProfileId: string;
  executionChannelId: string;
  channelKind: SupplyChannelKind;
  activationStatus: ActivationEvidenceStatus;
  manufacturer?: string;
  /** Collapsed domain key — dual-token / dual-alias must share this. */
  faultDomainKey: string;
  endpointFingerprint?: string;
  accountIdentity?: string;
  lifecycleStatus?: 'active' | 'inactive' | 'retired' | 'draining';
  healthBlocking?: boolean;
}

export type MultiChannelReadinessStatus =
  | 'multi_channel_ready'
  | 'single_channel'
  | 'not_verified'
  | 'blocked';

export interface MultiChannelPublishGateResult {
  operation: SupplyOperation;
  catalogModelId: string | null;
  status: MultiChannelReadinessStatus;
  multiChannelReady: boolean;
  independentFaultDomainCount: number;
  faultDomainKind: FaultDomainKind;
  manufacturerIndependent: boolean;
  hasOfficialDirect: boolean;
  hasUpstreamReseller: boolean;
  qualifiedDeployments: QualifiedDeploymentEvidence[];
  /** Human label for admin + user select pages. */
  channelLabel: string;
  /** Why multi-channel ready was granted or denied. */
  reason: string;
  /**
   * True only when a claim of multi_channel_ready is legal.
   * Core ops require ≥2 independent fault domains + both channel kinds preferred.
   */
  publishAllowed: boolean;
}

export type DualChannelDisposition =
  | 'switched_to_fallback'
  | 'primary_succeeded'
  | 'reconcile_no_resubmit'
  | 'fallback_only'
  | 'failed_no_fallback';

export interface DualChannelAttemptRecord {
  rank: number;
  deploymentId: string;
  channelKind: SupplyChannelKind;
  acceptance: Acceptance;
  providerTaskRef?: string;
  errorCode?: string;
  switched: boolean;
}

export interface BilateralLedgerFreeze {
  productUsage: {
    id: string;
    status: 'reserved' | 'settled' | 'refunded' | 'held_for_reconcile';
    quantity: number;
    resource: 'copy' | 'image' | 'video';
  };
  providerCost: {
    id: string;
    amount: number;
    currency: 'CNY' | 'USD';
    status: 'estimated' | 'observed' | 'unknown';
    attemptId: string;
  };
  supplyFreeze: {
    id: string;
    routeSnapshotRef: string;
    credentialAccountVersion: string;
    supplierRequestTaskId: string;
    supplyPoolId: string;
    frozenAt: string;
  };
}

export interface FaultInjectionScenarioResult {
  scenarioId: FaultInjectionScenarioId;
  operation: FaultInjectionOperation;
  modality: FaultInjectionModality;
  passed: boolean;
  disposition: DualChannelDisposition;
  attempts: DualChannelAttemptRecord[];
  /** Frozen RouteSnapshot for replay scenario / evidence. */
  routeSnapshot?: CanonicalRouteSnapshot;
  bilateralLedger?: BilateralLedgerFreeze;
  detail: string;
  evidenceKind: 'recorded' | 'live_provider';
  observedAt: string;
}

export interface FaultInjectionMatrixReport {
  id: string;
  operation: FaultInjectionOperation;
  modality: FaultInjectionModality;
  scenarios: FaultInjectionScenarioResult[];
  allPassed: boolean;
  /**
   * True only when primary/fallback share the same CatalogModel AND use
   * distinct channel kinds. Misaligned dual-channel matrices (text/image
   * official vs reseller using different catalog models) report false even
   * when every scenario passes.
   */
  dualChannelReady: boolean;
  /**
   * primary.catalogModelId === fallback.catalogModelId with distinct channel
   * kinds. Independent of scenario pass/fail — surfaces channel_matrix_misaligned.
   */
  channelMatrixAligned: boolean;
  observedAt: string;
  evidenceKind: 'recorded' | 'live_provider';
}

export interface DualChannelRouteCandidate {
  deploymentId: string;
  catalogModelId: string;
  providerProfileId: string;
  executionChannelId: string;
  channelKind: SupplyChannelKind;
  manufacturer?: string;
  credentialVersion?: string;
  endpointRevision?: string;
  priceRevision?: string;
  region?: string;
  isolated?: boolean;
  draining?: boolean;
}
