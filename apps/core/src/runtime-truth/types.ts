/**
 * Runtime truth surfaces for #143 / P0-D2:
 * - live: process lifecycle only
 * - ready: environment can deliver traffic
 * - capabilities: merchant three-state only
 * - release identity/manifest: commit + digest + config revision
 */

/** Merchant-facing capability states only. Never expose internal evidence layers. */
export type MerchantCapabilityState =
  | 'verified'
  | 'assisted'
  | 'unavailable';

/**
 * Internal evidence layers kept separate from merchant projection.
 * These must never appear on `/capabilities`.
 */
export type InternalCapabilityEvidence =
  | 'implemented'
  | 'recorded_verified'
  | 'live_verified'
  | 'merchant_validated';

export type ReadinessCheckStatus = 'pass' | 'fail' | 'skip';

export type ReadinessCheckName =
  | 'postgresql'
  | 'dbos'
  | 'schema'
  | 'objectStorage'
  | 'workerFreshness'
  | 'providerMode'
  | 'outbox'
  | 'canvas';

export interface ReadinessCheckResult {
  detail?: string;
  name: ReadinessCheckName;
  status: ReadinessCheckStatus;
}

export interface ReleaseIdentity {
  artifactDigest?: string;
  commitSha: string;
  configRevision?: string;
}

export interface ReleaseUnitIdentity extends ReleaseIdentity {
  unit: 'web' | 'core' | 'worker' | 'canvas';
}

export interface ReleaseManifest {
  capturedAt: string;
  units: ReleaseUnitIdentity[];
}

export interface LiveStatus {
  role?: 'api' | 'worker';
  service: 'meiye-core';
  status: 'live';
}

export interface ReadyStatus {
  checks: ReadinessCheckResult[];
  ready: boolean;
  release?: ReleaseIdentity;
  service: 'meiye-core';
  status: 'ready' | 'not_ready';
}

export interface MerchantCapability {
  id: string;
  safeExplanation: string;
  state: MerchantCapabilityState;
}

export interface MerchantCapabilitiesSnapshot {
  capabilities: MerchantCapability[];
  /** Explicit policy marker so clients never confuse internal evidence. */
  evidencePolicy: 'merchant_three_state_only';
  release?: ReleaseIdentity;
}

export interface InternalCapabilityRecord {
  id: string;
  /** Optional assisted path that remains usable without live verification. */
  assistedPathAvailable?: boolean;
  evidence: InternalCapabilityEvidence[];
  /** Optional human-readable purpose used only to craft safe explanations. */
  purpose?: string;
}

export interface RuntimeTruthPort {
  evaluateReadiness(): Promise<ReadyStatus>;
  listMerchantCapabilities(): Promise<MerchantCapabilitiesSnapshot>;
  releaseIdentity(): ReleaseIdentity | undefined;
}
