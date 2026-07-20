/**
 * Supply registry expand/migrate + CredentialAccount secret broker
 * + capability hot assembly (G1 / G2 / G3 / G4 / D-058 / D-060 / D-044 / D-080).
 *
 * Expands CatalogRevision payload thin records into four-layer entities +
 * SupplyContract, migrates fixed credential slots to CredentialAccount
 * metadata (assembly asserted separately), dual-reads with switch/rollback,
 * and projects five association views.
 *
 * G2: CredentialAccount specialization, three-state lifecycle (pending →
 * active → retired; tested activation gate; draining sub-state), request-time
 * secret broker by frozen version, env_fallback monitoring, high-sensitivity
 * audit projections. Secret material stays in SecretStorePort only.
 *
 * G3: versioned credential/adapter capability hot assembly — effective
 * runtime capability revision (not process-start freeze), request-time
 * assembly by frozen version, cache invalidation, rolling compat, channel
 * isolate/drain without restart. Catalog-head hot-read remains orthogonal.
 *
 * Does not wire main/job-worker/runtime-assembly (Z2-WIRING).
 * Does not rewrite RouteSnapshot types (consumes S2b adapters only).
 */

export {
  expandCatalogModel,
  expandProviderProfile,
  expandExecutionChannel,
  expandDeployment,
  expandSupplyContracts,
  expandCatalogRevisionPayload,
  expandDefaultCatalog,
  type ExpandedSupplyRegistrySnapshot,
} from './expand.js';

export {
  validateDualRead,
  SupplyRegistryDualReadController,
  type SupplyRegistryReadSource,
  type DualReadMismatch,
  type DualReadValidationResult,
  type SupplyRegistryMigrationState,
} from './dual-read.js';

export {
  FIXED_CREDENTIAL_SLOTS,
  migrateFixedCredentialSlots,
  projectCredentialAccountMetadata,
  assertFixedSlotMigrationBaseline,
  type FixedCredentialSlot,
  type CredentialSlotRuntimeAssembly,
  type CredentialSlotMigrationRecord,
  type CredentialSlotMigrationView,
  type FixedSlotRuntimeSources,
} from './credential-slots.js';

export {
  buildSupplyRegistryIndexes,
  projectModelViewForward,
  projectModelViewReverse,
  projectCounterpartyChannelForward,
  projectCounterpartyChannelReverse,
  projectDeploymentViewForward,
  projectDeploymentViewReverse,
  projectCredentialViewForward,
  projectCredentialViewReverse,
  projectRouteViewForward,
  projectRouteViewReverse,
  createFiveAssociationViews,
  type SupplyRegistryIndexes,
  type ModelAssociationForward,
  type ModelAssociationReverse,
  type CounterpartyChannelForward,
  type CounterpartyChannelReverse,
  type DeploymentAssociationForward,
  type DeploymentAssociationReverse,
  type CredentialAssociationForward,
  type CredentialAssociationReverse,
  type RouteAssociationForward,
  type RouteAssociationReverse,
  type FiveAssociationViews,
} from './association-views.js';

export {
  resolvePlatformDefaultBindings,
  createRegistryPlatformDefaultModelPort,
  applyStrictByokOverride,
  resolvePlatformTaskCredentialScope,
  type PlatformDefaultBinding,
  type ByokOverride,
  type CredentialScope,
} from './platform-defaults.js';

// --- G2 CredentialAccount + secret broker ---------------------------------

export {
  specializeCredentialAccount,
  createCredentialAccount,
  toPublicMetadata,
  assertNoSecretEcho,
  type CredentialAccount,
  type CredentialVersionSnapshot,
  type CredentialTestEvidence,
  type CredentialTestStatus,
  type CredentialSensitiveAction,
  type SpecializeCredentialAccountInput,
} from './credential-account.js';

export {
  transitionCredentialLifecycle,
  isActivationGateSatisfied,
  resolveFrozenCredentialVersion,
  credentialLifecycleLabel,
  CredentialLifecycleError,
  DEFAULT_TEST_EVIDENCE_MAX_AGE_MS,
  type CredentialLifecycleCommand,
} from './credential-lifecycle.js';

export {
  RequestTimeSecretBroker,
  putCredentialSecret,
  redactCredentialLogDetails,
  normalizeConnectivityTestResult,
  SecretBrokerError,
  type AssembleCredentialRequest,
  type AssembledCredential,
  type CredentialSecretBrokerPort,
  type CredentialAccountDirectory,
  type NormalizedConnectivityTestResult,
} from './secret-broker.js';

export {
  projectEnvFallbackRisk,
  buildEnvFallbackMonitorView,
  classifyBootCredentialSource,
  type EnvFallbackRiskLevel,
  type EnvFallbackMigrationEntry,
  type EnvFallbackRiskProjection,
  type EnvFallbackMonitorView,
} from './env-fallback-monitor.js';

export {
  projectCredentialSensitiveAudit,
  assertCredentialSensitiveActionsAudited,
  CREDENTIAL_GOVERN_PERMISSION,
  CREDENTIAL_SENSITIVE_ACTIONS,
  type ProjectCredentialSensitiveAuditInput,
} from './credential-sensitive-audit.js';

// --- G4 RoutePolicy + health overlay -------------------------------------

export {
  LITELLM_COOLDOWN_TIME_SECONDS,
  LITELLM_ALLOWED_FAILS,
  ENVOY_CONSECUTIVE_5XX,
  ENVOY_BASE_EJECTION_TIME_SECONDS,
  ENVOY_MAX_EJECTION_PERCENT,
  ENVOY_INTERVAL_SECONDS,
  HEALTH_OVERLAY_CONSTANT_PROVENANCE,
} from './health-overlay-constants.js';

export {
  HEALTH_OVERLAY_BLOCKING_STATES,
  isHealthOverlayBlocking,
  healthOverlayTargetKey,
  healthOverlayIsolationTargetId,
  resolveHealthOverlayRecord,
  applyHealthFailureFact,
  MemoryHealthOverlayPort,
  getSharedRecordedHealthOverlay,
  resetSharedRecordedHealthOverlay,
  type HealthFailureFactKind,
  type HealthFailureFact,
  type HealthOverlayCounters,
  type StoredHealthOverlay,
} from './health-overlay.js';

export {
  expandThinRouteRevision,
  toPublicRoutePolicyRevision,
  RoutePolicyRegistry,
  type RoutePolicyStage,
  type RoutePolicyQualityTier,
  type RoutePolicyPayload,
  type RoutePolicySimulationSummary,
  type RoutePolicyImpactPreview,
  type RoutePolicyRevisionRecord,
  type RoutePolicyAudit,
  type RoutePolicyRollbackAudit,
} from './route-policy.js';

export {
  decideAutoFallback,
  resolveRoutePolicyAuthority,
  collectHealthExcludedDeploymentIds,
  planModelSupplyCandidatesWithPolicy,
  buildRoutePolicySimulationSummary,
  simulateRoutePolicyCandidate,
  planModelSupplyCandidatesWithDataPolicy,
  explainPlanDecision,
  type AutoFallbackDecision,
  type DeploymentDataPolicyBinding,
  type PlanWithDataPolicyAndRankingInput,
  type PlanWithDataPolicyAndRankingResult,
} from './supply-control-plane.js';

// --- G3 credential/adapter capability hot assembly -------------------------

export {
  toRuntimeCapabilityEntry,
  defaultAdapterKey,
  projectCapabilityRevision,
  supportsRuntimeCapability,
  capabilityFingerprintsMatch,
  assertRuntimeCapabilityCompatible,
  constrainDeploymentsToCapability,
  diffCapabilityRevisions,
  shouldInvalidateAssemblyCache,
  resolveFrozenCapabilityEntry,
  initialChannelLifecycle,
  decideChannelAdmission,
  transitionChannelLifecycle,
  isCatalogOnlyHotSwitch,
  MemoryEffectiveCapabilityRevisionStore,
  CapabilityHotAssemblyRegistry,
  createSharedProcessHotAssemblyPair,
  HotAssemblyError,
  type RuntimeCapabilityEntry,
  type RuntimeCapabilityMatchInput,
  type RuntimeCapabilityRevision,
  type CapabilityRevisionDiff,
  type ChannelLifecycleMode,
  type ChannelLifecycleState,
  type ChannelAdmissionIntent,
  type ChannelAdmissionDecision,
  type AssembleCapabilityRequest,
  type AssembledCapabilityBinding,
  type EffectiveRevisionReport,
  type ApplyCapabilityResult,
  type EffectiveCapabilityRevisionStore,
  type AdapterBindingDirectory,
  type AdapterBindingRecord,
  type CapabilityHotAssemblyPort,
} from './hot-assembly.js';

// --- G5 DataPolicy + three-layer ranking -----------------------------

// --- G5 DataPolicyRevision + three-layer ranking + shared explanation -----

export {
  DUAL_APPROVAL_REQUIRED_DATA_CLASSES,
  MEDICAL_HEALTH_CONTENT_SENSITIVITY_NOTE,
  COST_EVIDENCE_PRIORITY,
  normalizeRequestedDataClasses,
  isRestrictedDataClass,
  isMedicalHealthContentSensitivity,
  projectDataProcessingLevel,
  evaluateDataPolicyHardFilter,
  failClosedWithoutCompliantCandidate,
  reclassifyDataClass,
  toPublicDataPolicyRevision,
  DataPolicyRegistry,
  compareCostEvidenceSource,
  type ContentSensitivityDataClass,
  type DataPolicySourceTrustLevel,
  type DualApprovalEvidence,
  type DataPolicyPayload,
  type DataPolicyRevisionRecord,
  type DataPolicyAudit,
  type DataClassReclassificationAudit,
  type DataPolicyHardFilterReason,
  type DataPolicyHardFilterResult,
  type DataProcessingLevelView,
} from './data-policy.js';

export {
  THREE_LAYER_ORDER,
  SORT_INPUT_PROVENANCE_MATRIX,
  evaluateQualityReliabilityGate,
  evaluateHealthCapacityGuardrail,
  evaluateCostOptimization,
  rankCandidatesThreeLayer,
  matrixInputsForLayer,
  type RankingLayerId,
  type SortInputProvenanceMatrix,
  type EvidenceFreshnessStatus,
  type CriticalEvidenceKind,
  type CriticalEvidenceFact,
  type QualityGateEvidence,
  type HealthCapacityEvidence,
  type CostEvidence,
  type RankingCandidateInput,
  type RankingBand,
  type RankingLayerOutcome,
  type RankedCandidate,
  type ThreeLayerRankingResult,
} from './three-layer-ranking.js';

export {
  buildRouteDecisionExplanation,
  assertSharedExplanationProjection,
  type ExplanationSurface,
  type ExplanationAcceptanceDecision,
  type ExplanationExclusion,
  type ExplanationRankEntry,
  type ExplanationCostEvidence,
  type ExplanationEvidenceFreshness,
  type ExplanationAcceptanceBranch,
  type RouteDecisionExplanation,
  type BuildRouteDecisionExplanationInput,
} from './route-explanation.js';
