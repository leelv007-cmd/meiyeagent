/**
 * Env-gated live dual-channel text conformance (MP-04T).
 *
 * Channel matrix:
 * - official_direct: Volcengine Ark text (ARK_TEXT_* / ARK_*)
 * - upstream_reseller: OpenAI-compatible reseller (MODEL_DIRECT_*)
 *
 * Open gate: RUN_LIVE_TEXT_CONFORMANCE=1
 * Does not spend quota unless explicitly enabled.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAiCompatibleLlmExecutionPort } from '../adapters.js';
import type { CatalogModel, ModelDeployment } from '../index.js';
import { dualChannelActivationGateReady } from './activation-evidence-input.js';
import {
  TEXT_ROUTE_ATTEMPT_LIMIT,
  type TextDualChannelConformanceResult,
} from './types.js';
import { runTextDualChannelConformance } from './text/dual-channel.js';
import type { TextChannelFixture } from './text/fixtures.js';
import { runTextChannelConformance } from './text/runner.js';

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

interface LiveTextChannelEnv {
  label: 'official_direct' | 'upstream_reseller';
  catalogModelId: string;
  providerModel: string;
  baseUrl: string;
  apiKey: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  endpointRevision: string;
  configurationRevision: string;
  credentialVersion: string;
  currency: 'CNY' | 'USD';
  gatewayProduct: 'official_native' | 'new_api';
  region: 'domestic' | 'overseas';
}

function parseCost(name: string, fallback: string): number {
  const raw = env(name) ?? fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Prefer explicit ARK_TEXT_* for official; fall back to skip when absent.
 * Reseller uses MODEL_DIRECT_* (existing live-llm path).
 */
function resolveOfficialDirect(): LiveTextChannelEnv | null {
  const apiKey = env('ARK_TEXT_API_KEY') ?? env('ARK_API_KEY');
  const baseUrl =
    env('ARK_TEXT_BASE_URL') ??
    env('ARK_BASE_URL') ??
    'https://ark.cn-beijing.volces.com/api/v3';
  const providerModel =
    env('ARK_TEXT_MODEL') ?? env('ARK_LLM_MODEL') ?? env('ARK_MODEL');
  const catalogModelId =
    env('ARK_TEXT_CATALOG_MODEL_ID') ?? 'llm-doubao-seed-mini';
  if (!apiKey || !providerModel) return null;
  return {
    label: 'official_direct',
    catalogModelId,
    providerModel,
    baseUrl,
    apiKey,
    inputCostPerMillion: parseCost('ARK_TEXT_INPUT_COST_PER_MILLION', '1'),
    outputCostPerMillion: parseCost('ARK_TEXT_OUTPUT_COST_PER_MILLION', '2'),
    endpointRevision:
      env('ARK_TEXT_ENDPOINT_REVISION') ?? 'ark-text-live',
    configurationRevision:
      env('ARK_TEXT_CONFIGURATION_REVISION') ??
      `ark-text:${providerModel}:${baseUrl}`,
    credentialVersion: env('ARK_TEXT_CREDENTIAL_VERSION') ?? 'ark-live-v1',
    currency: 'CNY',
    gatewayProduct: 'official_native',
    region: 'domestic',
  };
}

function resolveUpstreamReseller(): LiveTextChannelEnv | null {
  const apiKey = env('MODEL_DIRECT_API_KEY');
  const baseUrl = env('MODEL_DIRECT_BASE_URL');
  const providerModel = env('MODEL_DIRECT_MODEL');
  const catalogModelId = env('MODEL_DIRECT_CATALOG_MODEL_ID');
  if (!apiKey || !baseUrl || !providerModel || !catalogModelId) return null;
  return {
    label: 'upstream_reseller',
    catalogModelId,
    providerModel,
    baseUrl,
    apiKey,
    inputCostPerMillion: parseCost('MODEL_DIRECT_INPUT_COST_PER_MILLION', '1'),
    outputCostPerMillion: parseCost(
      'MODEL_DIRECT_OUTPUT_COST_PER_MILLION',
      '2'
    ),
    endpointRevision:
      env('MODEL_DIRECT_ENDPOINT_REVISION') ?? 'direct-live',
    configurationRevision:
      env('MODEL_DIRECT_CONFIGURATION_REVISION') ??
      `direct:${catalogModelId}:${providerModel}:${baseUrl}`,
    credentialVersion:
      env('MODEL_DIRECT_CREDENTIAL_VERSION') ?? 'direct-live-v1',
    currency: 'USD',
    gatewayProduct: 'new_api',
    region: 'overseas',
  };
}

function toFixture(channel: LiveTextChannelEnv): TextChannelFixture {
  const channelKind = channel.label;
  const model: CatalogModel = {
    id: channel.catalogModelId,
    displayName: channel.catalogModelId,
    modality: 'llm',
    operations: ['copy.generate', 'copy.adapt', 'text.respond'],
    qualityRank: 80,
    stableModelName: channel.providerModel,
    version: channel.endpointRevision,
  };
  const deployment: ModelDeployment = {
    id: `live-${channelKind}-${channel.catalogModelId}`,
    catalogModelId: channel.catalogModelId,
    providerProfileId:
      channelKind === 'official_direct' ? 'pp-ark-live' : 'pp-reseller-live',
    executionChannelId:
      channelKind === 'official_direct' ? 'ec-ark-live' : 'ec-reseller-live',
    providerModel: channel.providerModel,
    endpointRevision: channel.endpointRevision,
    apiFamily: 'openai',
    channel: channelKind === 'official_direct' ? 'direct' : 'managed',
    region: channel.region,
    status: 'active',
    credentialMode: 'platform',
    credentialVersion: channel.credentialVersion,
  };

  const port = new OpenAiCompatibleLlmExecutionPort({
    catalogModelId: channel.catalogModelId,
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    model: channel.providerModel,
    inputCostPerMillion: channel.inputCostPerMillion,
    outputCostPerMillion: channel.outputCostPerMillion,
    currency: channel.currency,
  });

  const fixture: TextChannelFixture = {
    channelKind,
    catalogModelId: channel.catalogModelId,
    catalogStableModelName: channel.providerModel,
    deploymentId: deployment.id,
    providerProfileId: deployment.providerProfileId!,
    executionChannelId: deployment.executionChannelId!,
    providerModel: channel.providerModel,
    declaredAlias: {
      providerModel: channel.providerModel,
      catalogModelId: channel.catalogModelId,
      mappingRevision: `live-map:${channel.catalogModelId}`,
    },
    endpointRevision: channel.endpointRevision,
    configurationRevision: channel.configurationRevision,
    protocolFamily: 'openai_compatible',
    gatewayFingerprint: {
      product: channel.gatewayProduct,
      version: channel.endpointRevision,
      evidence: `live:${channelKind}`,
      observedAt: new Date().toISOString(),
    },
    region: channel.region,
    apiFamily: 'openai',
    model,
    deployment,
    port,
    setScenario: () => {
      // Live ports do not support recorded scenario inject.
    },
  };
  return fixture;
}

const official = resolveOfficialDirect();
const reseller = resolveUpstreamReseller();
const liveGateOff = process.env.RUN_LIVE_TEXT_CONFORMANCE !== '1';
const dualSkip =
  liveGateOff
    ? 'RUN_LIVE_TEXT_CONFORMANCE=1 is required (spends provider quota)'
    : !official && !reseller
      ? 'missing live text channel env (ARK_TEXT_* and/or MODEL_DIRECT_*)'
      : false;

test(
  'live text channel conformance — each configured channel independently',
  {
    skip: dualSkip,
    timeout: 3 * 60 * 1_000,
  },
  async () => {
    const channels = [official, reseller].filter(
      (value): value is LiveTextChannelEnv => Boolean(value)
    );
    assert.ok(channels.length >= 1);

    for (const channel of channels) {
      const fixture = toFixture(channel);
      const result = await runTextChannelConformance({
        fixture,
        port: fixture.port,
        operation: 'copy.generate',
        evidenceKind: 'live_provider',
        // No error inject on live — avoid deliberate 401/429 against real keys.
      });
      assert.equal(result.channelKind, channel.label);
      assert.equal(result.passed, true, JSON.stringify(result.checks, null, 2));
      assert.ok((result.usage?.inputTokens ?? 0) > 0);
      assert.ok((result.usage?.outputTokens ?? 0) > 0);
      process.stdout.write(
        `${JSON.stringify({
          channel: channel.label,
          catalogModelId: result.catalogModelId,
          mappingConfidence: result.mappingConfidence,
          usage: result.usage,
          evidenceRef: `provider-conformance:live:${result.id}`,
        })}\n`
      );
    }
  }
);

const dualChannelSkip =
  liveGateOff
    ? 'RUN_LIVE_TEXT_CONFORMANCE=1 is required (spends provider quota)'
    : !official || !reseller
      ? 'dual-channel live requires both ARK_TEXT_* (official_direct) and MODEL_DIRECT_* (upstream_reseller)'
      : false;

test(
  'live dual-channel text conformance — official_direct + upstream_reseller',
  {
    skip: dualChannelSkip,
    timeout: 5 * 60 * 1_000,
  },
  async () => {
    assert.ok(official && reseller);
    const officialFixture = toFixture(official);
    const resellerFixture = toFixture(reseller);

    const dual: TextDualChannelConformanceResult =
      await runTextDualChannelConformance({
        officialDirect: {
          fixture: officialFixture,
          port: officialFixture.port,
        },
        upstreamReseller: {
          fixture: resellerFixture,
          port: resellerFixture.port,
        },
        operation: 'copy.generate',
        evidenceKind: 'live_provider',
        runErrorProbes: false,
      });

    assert.equal(dual.attemptLimit, TEXT_ROUTE_ATTEMPT_LIMIT);
    assert.equal(dual.attemptLimit, 2);
    assert.equal(dual.channels.length, 2);
    assert.equal(dual.dualChannelReady, true);
    assert.equal(
      dualChannelActivationGateReady(dual.activationEvidenceInputs, {
        requireLiveVerified: true,
      }),
      true
    );

    for (const input of dual.activationEvidenceInputs) {
      assert.equal(input.status, 'live_verified');
      assert.ok(input.evidenceRef.startsWith('provider-conformance:'));
      assert.equal(input.conformance.evidenceKind, 'live_provider');
    }

    process.stdout.write(
      `${JSON.stringify({
        dualChannelReady: dual.dualChannelReady,
        attemptLimit: dual.attemptLimit,
        activationEvidenceInputs: dual.activationEvidenceInputs.map(
          (input) => ({
            deploymentId: input.deploymentId,
            channelKind: input.channelKind,
            status: input.status,
            mappingConfidence: input.mappingConfidence,
            gatewayFingerprint: input.gatewayFingerprint.product,
            evidenceRef: input.evidenceRef,
          })
        ),
      })}\n`
    );
  }
);
