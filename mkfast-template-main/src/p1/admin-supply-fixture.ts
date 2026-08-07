/**
 * Presentation fixture for J4 control center.
 * Mirrors D-069 dual-channel matrix shape without importing apps/core.
 */
import type {
  CredentialAccountMetadata,
  RoutePolicyRevision,
  SupplyCatalogModel,
  SupplyContract,
  SupplyDeployment,
  SupplyExecutionChannel,
  SupplyPool,
  SupplyProviderProfile,
  SupplierPriceRevision,
} from '@meiye/contracts';

import type {
  SupplyControlSnapshot,
  SupplyRunRecord,
} from './admin-supply-types';
import {
  admin_supply_ark_credential_rotated_to_v3_metadata_on_49239cb0,
  admin_supply_ark_platform_primary_account_e08488b8,
  admin_supply_default_shared_pool_62852833,
  admin_supply_publish_video_dual_channel_routepolicy_r_5fbddb38,
  admin_supply_tu_zi_new_api_console_technical_evidence_c07f2d4d,
  admin_supply_tu_zi_relay_4cc3f0f3,
  admin_supply_tu_zi_relay_primary_account_82b15abf,
  admin_supply_volcengine_ark_8d0a89d2,
} from '@/locale/paraglide/messages';

const CAPTURED_AT = '2026-07-20T12:00:00.000Z';

const models: SupplyCatalogModel[] = [
  {
    id: 'model-text-seed',
    modality: 'llm',
    operations: ['copy.generate', 'copy.adapt', 'text.respond'],
    displayName: 'Seed Text Mini',
    manufacturer: 'ByteDance',
    stableModelName: 'doubao-seed-2-0-mini',
    qualityRank: 90,
  },
  {
    id: 'model-image-seedream',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    displayName: 'Seedream 5.0',
    manufacturer: 'ByteDance',
    stableModelName: 'doubao-seedream-5-0',
    qualityRank: 92,
  },
  {
    id: 'model-video-seedance',
    modality: 'video',
    operations: ['video.generate'],
    displayName: 'Seedance 1.5 Pro',
    manufacturer: 'ByteDance',
    stableModelName: 'doubao-seedance-1-5-pro',
    qualityRank: 88,
  },
  {
    id: 'model-image-single',
    modality: 'image',
    operations: ['image.generate'],
    displayName: 'Single-channel Image',
    manufacturer: 'OpenAI',
    stableModelName: 'gpt-image-2',
    qualityRank: 85,
  },
];

const providerProfiles: SupplyProviderProfile[] = [
  {
    id: 'provider-ark',
    displayName: admin_supply_volcengine_ark_8d0a89d2(),
    counterparty: 'Volcengine Ark',
    gatewayFingerprint: 'none',
    revisionId: 'provider-ark:r1',
  },
  {
    id: 'provider-tuzi',
    displayName: admin_supply_tu_zi_relay_4cc3f0f3(),
    counterparty: 'tu-zi',
    gatewayFingerprint: 'new_api',
    revisionId: 'provider-tuzi:r1',
  },
  {
    id: 'provider-openai',
    displayName: 'OpenAI',
    counterparty: 'OpenAI',
    gatewayFingerprint: 'none',
    revisionId: 'provider-openai:r1',
  },
];

const executionChannels: SupplyExecutionChannel[] = [
  {
    id: 'channel-ark-direct',
    providerProfileId: 'provider-ark',
    kind: 'official_direct',
    region: 'domestic',
    protocolFamily: 'ark',
    accountOwnership: 'platform',
    lifecycleRevision: 'channel-ark-direct:lifecycle:r0',
    revisionId: 'channel-ark-direct:r1',
  },
  {
    id: 'channel-tuzi-reseller',
    providerProfileId: 'provider-tuzi',
    kind: 'upstream_reseller',
    region: 'overseas',
    protocolFamily: 'openai-compat',
    accountOwnership: 'platform',
    lifecycleRevision: 'channel-tuzi-reseller:lifecycle:r0',
    revisionId: 'channel-tuzi-reseller:r1',
  },
  {
    id: 'channel-openai-direct',
    providerProfileId: 'provider-openai',
    kind: 'official_direct',
    region: 'overseas',
    protocolFamily: 'openai',
    accountOwnership: 'platform',
    lifecycleRevision: 'channel-openai-direct:lifecycle:r0',
    revisionId: 'channel-openai-direct:r1',
  },
];

function dep(
  id: string,
  catalogModelId: string,
  providerProfileId: string,
  executionChannelId: string,
  status: SupplyDeployment['lifecycleStatus'] = 'active',
  evidence: SupplyDeployment['activationEvidence'] = {
    status: 'live_verified',
    verifiedAt: '2026-07-19T00:00:00.000Z',
    evidenceRef: `evidence://${id}`,
  }
): SupplyDeployment {
  return {
    id,
    catalogModelId,
    providerProfileId,
    executionChannelId,
    lifecycleStatus: status,
    activationEvidence: evidence,
    dataPolicyRevisionId: 'data-policy-r1',
    priceRevisionId: `price-${id}`,
    credentialAccountId: `cred-${providerProfileId}`,
    accountIdentity: `account:${providerProfileId}`,
    endpointFingerprint: `endpoint:${executionChannelId}`,
    revisionId: `${id}:r1`,
  };
}

const deployments: SupplyDeployment[] = [
  // Text dual-channel
  dep('dep-text-ark', 'model-text-seed', 'provider-ark', 'channel-ark-direct'),
  dep(
    'dep-text-tuzi',
    'model-text-seed',
    'provider-tuzi',
    'channel-tuzi-reseller'
  ),
  // Image dual-channel
  dep(
    'dep-image-ark',
    'model-image-seedream',
    'provider-ark',
    'channel-ark-direct'
  ),
  dep(
    'dep-image-tuzi',
    'model-image-seedream',
    'provider-tuzi',
    'channel-tuzi-reseller'
  ),
  // Video dual-channel (shared manufacturer → channel-level only)
  dep(
    'dep-video-ark',
    'model-video-seedance',
    'provider-ark',
    'channel-ark-direct'
  ),
  dep(
    'dep-video-tuzi',
    'model-video-seedance',
    'provider-tuzi',
    'channel-tuzi-reseller'
  ),
  // Single-channel image (no fallback)
  dep(
    'dep-image-openai',
    'model-image-single',
    'provider-openai',
    'channel-openai-direct'
  ),
];

const contracts: SupplyContract[] = [
  {
    id: 'contract-ark',
    providerProfileId: 'provider-ark',
    termsRevisionId: 'terms-ark-r1',
    dataProcessingSummary: 'domestic processing; no training on customer data',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'contract-tuzi',
    providerProfileId: 'provider-tuzi',
    termsRevisionId: 'terms-tuzi-r1',
    dataProcessingSummary:
      'overseas relay; retention per subprocessor schedule',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'contract-openai',
    providerProfileId: 'provider-openai',
    termsRevisionId: 'terms-openai-r1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  },
];

const credentials: CredentialAccountMetadata[] = [
  {
    id: 'cred-provider-ark',
    label: admin_supply_ark_platform_primary_account_e08488b8(),
    providerProfileId: 'provider-ark',
    type: 'api_key',
    scope: 'platform',
    secretReference: 'secret://ark/platform/v3',
    version: 'v3',
    status: 'active',
    drainSubstate: 'none',
    source: 'registry',
    verifiedAt: '2026-07-18T00:00:00.000Z',
    publicQuotaHint: 'balance headroom ok',
    lastTestEvidenceRef: 'test://ark/v3/2026-07-18',
  },
  {
    id: 'cred-provider-tuzi',
    label: admin_supply_tu_zi_relay_primary_account_82b15abf(),
    providerProfileId: 'provider-tuzi',
    type: 'api_key',
    scope: 'platform',
    secretReference: 'secret://tuzi/platform/v2',
    version: 'v2',
    status: 'active',
    drainSubstate: 'draining',
    source: 'registry',
    verifiedAt: '2026-07-18T00:00:00.000Z',
    lastTestEvidenceRef: 'test://tuzi/v2/2026-07-18',
  },
  {
    id: 'cred-provider-openai',
    label: 'OpenAI platform',
    providerProfileId: 'provider-openai',
    type: 'api_key',
    scope: 'platform',
    secretReference: 'secret://openai/platform/v1',
    version: 'v1',
    status: 'pending',
    drainSubstate: 'none',
    source: 'env_fallback',
  },
];

const pools: SupplyPool[] = [
  {
    id: 'pool-shared-default',
    kind: 'shared',
    displayName: admin_supply_default_shared_pool_62852833(),
    credentialAccountIds: [
      'cred-provider-ark',
      'cred-provider-tuzi',
      'cred-provider-openai',
    ],
    deploymentIds: deployments.map((d) => d.id),
    capacity: {
      supplyAccount: { rpm: 600, tpm: 1_000_000, concurrency: 40 },
      productAccount: { concurrency: 8, queuePriority: 50 },
      systemTotal: { concurrency: 120 },
    },
    revisionId: 'pool-shared-default:r2',
  },
];

const routePolicies: RoutePolicyRevision[] = [
  {
    id: 'route-copy-generate',
    operation: 'copy.generate',
    qualityTier: 'balanced',
    hardConstraints: ['data_class_allowed', 'health_not_blocking'],
    candidateDeploymentIds: ['dep-text-ark', 'dep-text-tuzi'],
    maxAttempts: 2,
    fallbackAuthorized: true,
    publishedAt: '2026-07-15T00:00:00.000Z',
    revisionId: 'route-copy-generate:r3',
  },
  {
    id: 'route-image-generate',
    operation: 'image.generate',
    qualityTier: 'quality',
    hardConstraints: ['data_class_allowed', 'health_not_blocking'],
    candidateDeploymentIds: [
      'dep-image-ark',
      'dep-image-tuzi',
      'dep-image-openai',
    ],
    maxAttempts: 2,
    fallbackAuthorized: true,
    publishedAt: '2026-07-15T00:00:00.000Z',
    revisionId: 'route-image-generate:r2',
  },
  {
    id: 'route-video-generate',
    operation: 'video.generate',
    qualityTier: 'quality',
    hardConstraints: ['data_class_allowed', 'health_not_blocking'],
    candidateDeploymentIds: ['dep-video-ark', 'dep-video-tuzi'],
    maxAttempts: 1,
    fallbackAuthorized: true,
    publishedAt: '2026-07-16T00:00:00.000Z',
    revisionId: 'route-video-generate:r1',
  },
];

const priceRevisions: SupplierPriceRevision[] = deployments.map((d, i) => ({
  id: `price-${d.id}`,
  deploymentId: d.id,
  executionChannelId: d.executionChannelId,
  pricingTier: 'standard',
  amountMicros: 1_000 + i * 250,
  currency: 'CNY' as const,
  unit: d.catalogModelId.includes('video') ? 'second' : 'request',
  evidence: {
    source: i % 2 === 0 ? 'invoice' : 'observed_usage',
    observedAt: CAPTURED_AT,
  },
  revisionId: `price-${d.id}:r1`,
}));

const runs: SupplyRunRecord[] = [
  {
    id: 'run-1',
    taskId: 'task-text-001',
    operation: 'copy.generate',
    modality: 'llm',
    status: 'succeeded',
    catalogModelId: 'model-text-seed',
    deploymentId: 'dep-text-ark',
    providerProfileId: 'provider-ark',
    executionChannelId: 'channel-ark-direct',
    channelKind: 'official_direct',
    workspaceId: 'ws-demo',
    accountId: 'acct-demo',
    dataClass: 'public',
    startedAt: '2026-07-20T11:50:00.000Z',
    endedAt: '2026-07-20T11:50:02.400Z',
    latencyMs: 2400,
    queueMs: 120,
    providerMs: 2100,
    postprocessMs: 180,
    costMicros: 1200,
    currency: 'CNY',
    attemptCount: 1,
    lifecycle: 'sync_attempt',
    routePolicyRevisionId: 'route-copy-generate:r3',
    poolId: 'pool-shared-default',
  },
  {
    id: 'run-2',
    taskId: 'task-image-002',
    operation: 'image.generate',
    modality: 'image',
    status: 'failed',
    catalogModelId: 'model-image-seedream',
    deploymentId: 'dep-image-tuzi',
    providerProfileId: 'provider-tuzi',
    executionChannelId: 'channel-tuzi-reseller',
    channelKind: 'upstream_reseller',
    workspaceId: 'ws-demo',
    accountId: 'acct-demo',
    dataClass: 'contains_face',
    startedAt: '2026-07-20T11:40:00.000Z',
    endedAt: '2026-07-20T11:40:08.000Z',
    latencyMs: 8000,
    queueMs: 400,
    providerMs: 7200,
    postprocessMs: 400,
    errorCode: 'UPSTREAM_5XX',
    errorMessage: 'upstream returned 503 after accept window',
    attemptCount: 2,
    lifecycle: 'async_poll',
    routePolicyRevisionId: 'route-image-generate:r2',
    poolId: 'pool-shared-default',
  },
  {
    id: 'run-3',
    taskId: 'task-video-003',
    operation: 'video.generate',
    modality: 'video',
    status: 'acceptance_unknown',
    catalogModelId: 'model-video-seedance',
    deploymentId: 'dep-video-ark',
    providerProfileId: 'provider-ark',
    executionChannelId: 'channel-ark-direct',
    channelKind: 'official_direct',
    workspaceId: 'ws-pro',
    accountId: 'acct-pro',
    dataClass: 'public',
    startedAt: '2026-07-20T10:00:00.000Z',
    latencyMs: 45_000,
    queueMs: 2_000,
    providerMs: 40_000,
    postprocessMs: 3_000,
    attemptCount: 1,
    lifecycle: 'async_recover',
    artifactPreviewUrl: '/seed/video-preview.webp',
    routePolicyRevisionId: 'route-video-generate:r1',
    poolId: 'pool-shared-default',
  },
  {
    id: 'run-4',
    taskId: 'task-text-004',
    operation: 'copy.generate',
    modality: 'llm',
    status: 'running',
    catalogModelId: 'model-text-seed',
    deploymentId: 'dep-text-tuzi',
    providerProfileId: 'provider-tuzi',
    executionChannelId: 'channel-tuzi-reseller',
    channelKind: 'upstream_reseller',
    workspaceId: 'ws-demo',
    accountId: 'acct-demo',
    dataClass: 'public',
    startedAt: '2026-07-20T11:58:00.000Z',
    attemptCount: 1,
    lifecycle: 'sync_attempt',
    routePolicyRevisionId: 'route-copy-generate:r3',
    poolId: 'pool-shared-default',
  },
  {
    id: 'run-5',
    taskId: 'task-image-005',
    operation: 'image.generate',
    modality: 'image',
    status: 'succeeded',
    catalogModelId: 'model-image-single',
    deploymentId: 'dep-image-openai',
    providerProfileId: 'provider-openai',
    executionChannelId: 'channel-openai-direct',
    channelKind: 'official_direct',
    workspaceId: 'ws-byok',
    accountId: 'acct-byok',
    dataClass: 'public',
    startedAt: '2026-07-20T09:00:00.000Z',
    endedAt: '2026-07-20T09:00:05.000Z',
    latencyMs: 5000,
    queueMs: 200,
    providerMs: 4500,
    postprocessMs: 300,
    costMicros: 3000,
    currency: 'USD',
    attemptCount: 1,
    lifecycle: 'async_poll',
    artifactPreviewUrl: '/model-previews/gpt-image-2.png',
    poolId: 'pool-shared-default',
  },
];

/** Default snapshot used by admin supply control until live Core wiring. */
export function buildDefaultSupplyControlSnapshot(): SupplyControlSnapshot {
  return {
    catalogRevisionId: 'catalog-default-expand',
    catalogRevisionNumber: 1,
    capturedAt: CAPTURED_AT,
    models,
    providerProfiles,
    executionChannels,
    deployments,
    contracts,
    credentials,
    pools,
    entitlementPolicies: [
      {
        id: 'entitlement-policy:growth:r1',
        tier: 'growth',
        revision: 1,
        stage: 'published',
        revisionId: 'entitlement-policy:growth:r1',
        concurrencyLimit: 4,
        queuePriority: 5,
        supportLabel: 'priority',
        allowanceSummary: 'audio=10, copy=100, image=20, video=5',
        publishedAt: CAPTURED_AT,
        actorId: 'admin-1',
        reason: 'Default fixture policy',
      },
    ],
    accountAllocations: [
      {
        id: 'allocation-fixture-a',
        accountId: 'acct-pro',
        workspaceId: 'ws-pro',
        kind: 'grant',
        targetLabel: 'supply_pool:pool-shared-default',
        source: 'enterprise_contract',
        status: 'active',
        reason: 'Default fixture allocation',
        startsAt: CAPTURED_AT,
        endsAt: null,
      },
    ],
    routePolicies,
    priceRevisions,
    healthOverlays: [
      // Non-blocking degraded signal for overview surface (not in BLOCKING set).
      {
        targetId: 'dep-image-openai',
        state: 'degraded',
        reason: 'elevated_latency',
        source: 'health_overlay',
        startedAt: '2026-07-20T11:40:10.000Z',
      },
    ],
    runPage: {
      query: {
        page: 1,
        pageSize: 20,
        sort: 'startedAt',
        dir: 'desc',
      },
      total: runs.length,
      totalPages: Math.max(1, Math.ceil(runs.length / 20)),
      rows: runs,
      facets: {
        operations: [...new Set(runs.map((run) => run.operation))],
        statuses: [...new Set(runs.map((run) => run.status))],
        modalities: [...new Set(runs.map((run) => run.modality))],
        channelKinds: [...new Set(runs.map((run) => run.channelKind))],
        dataClasses: [...new Set(runs.map((run) => run.dataClass))],
      },
    },
    runs,
    recentChanges: [
      {
        id: 'audit-1',
        at: '2026-07-20T08:00:00.000Z',
        actorId: 'admin-1',
        action: 'route_policy.publish',
        targetType: 'RoutePolicyRevision',
        targetId: 'route-video-generate',
        summary:
          admin_supply_publish_video_dual_channel_routepolicy_r_5fbddb38(),
        correlationId: 'corr-route-video-1',
      },
      {
        id: 'audit-2',
        at: '2026-07-19T16:00:00.000Z',
        actorId: 'admin-1',
        action: 'credential.rotate',
        targetType: 'CredentialAccount',
        targetId: 'cred-provider-ark',
        summary:
          admin_supply_ark_credential_rotated_to_v3_metadata_on_49239cb0(),
        correlationId: 'corr-cred-ark-3',
      },
    ],
    gatewayDeepLinks: [
      {
        id: 'gw-tuzi-console',
        label: admin_supply_tu_zi_new_api_console_technical_evidence_c07f2d4d(),
        href: 'https://example.invalid/tuzi/console',
        gatewayFingerprint: 'new_api',
        evidenceOnly: true,
      },
    ],
    featuredCoreModelIds: {
      'copy.generate': 'model-text-seed',
      'image.generate': 'model-image-seedream',
      'video.generate': 'model-video-seedance',
    },
  };
}
