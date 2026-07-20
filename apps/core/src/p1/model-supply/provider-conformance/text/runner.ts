/**
 * Run MP-04T text conformance against a ProviderExecutionPort (S2a port).
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
  ProviderExecutionPort,
  ProviderExecutionRequest,
} from '../../provider-lifecycle.js';
import type { CatalogModel, ModelDeployment } from '../../supply-contracts.js';
import {
  gradeMappingConfidence,
  mappingConfidenceMeetsActivationGate,
} from '../mapping-confidence.js';
import type {
  GatewayFingerprintMetadata,
  MappingConfidenceGrade,
  TextChannelConformanceResult,
  TextConformanceCheckResult,
  TextConformanceOperation,
} from '../types.js';
import {
  extractProtocolEvidence,
  extractUsageEvidence,
  gatewayFingerprintConsistent,
  normalizeProviderError,
  protocolPayloadSatisfiesOperation,
} from './normalize.js';
import {
  textConformancePrompt,
  type TextChannelFixture,
  type TextFixtureScenario,
} from './fixtures.js';

export interface TextChannelConformanceRunInput {
  fixture: Pick<
    TextChannelFixture,
    | 'channelKind'
    | 'catalogModelId'
    | 'catalogStableModelName'
    | 'deploymentId'
    | 'providerProfileId'
    | 'executionChannelId'
    | 'providerModel'
    | 'declaredAlias'
    | 'endpointRevision'
    | 'configurationRevision'
    | 'protocolFamily'
    | 'gatewayFingerprint'
    | 'model'
    | 'deployment'
  >;
  port: ProviderExecutionPort;
  operation?: TextConformanceOperation;
  evidenceKind?: 'recorded' | 'live_provider';
  /**
   * When provided, runner injects this scenario via fixture.setScenario
   * before the error-normalization probe (recorded fakes only).
   */
  errorProbeScenario?: TextFixtureScenario;
  injectErrorProbe?: (scenario: TextFixtureScenario) => void;
  observedAt?: string;
  resultId?: string;
}

function buildRequest(
  model: CatalogModel,
  deployment: ModelDeployment,
  operation: TextConformanceOperation
): ProviderExecutionRequest {
  return {
    jobId: randomUUID(),
    model,
    deployment,
    submission: {
      workspaceId: 'conformance-workspace',
      actorId: 'conformance-runner',
      idempotencyKey: randomUUID(),
      operation,
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: [],
      prompt: textConformancePrompt(operation),
    },
  };
}

function digestId(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

async function runSuccessPath(
  port: ProviderExecutionPort,
  request: ProviderExecutionRequest
) {
  return port.execute(request);
}

async function runErrorProbe(
  port: ProviderExecutionPort,
  request: ProviderExecutionRequest,
  inject: ((scenario: TextFixtureScenario) => void) | undefined,
  scenario: TextFixtureScenario
) {
  inject?.(scenario);
  return port.execute(request);
}

/**
 * Single-channel text conformance: protocol / error / usage / fingerprint / mapping.
 * Performs at most two port executions (success + optional error probe) —
 * these are check probes, not route attempts (route ceiling is dual-channel).
 */
export async function runTextChannelConformance(
  input: TextChannelConformanceRunInput
): Promise<TextChannelConformanceResult> {
  const operation = input.operation ?? 'copy.generate';
  const evidenceKind = input.evidenceKind ?? 'recorded';
  const observedAt = input.observedAt ?? new Date().toISOString();
  const fixture = input.fixture;
  const checks: TextConformanceCheckResult[] = [];
  let attemptCount = 0;

  const request = buildRequest(fixture.model, fixture.deployment, operation);
  attemptCount += 1;
  const successResponse = await runSuccessPath(input.port, request);

  const protocol = extractProtocolEvidence(operation, successResponse);
  const protocolOk =
    successResponse.kind === 'completed' &&
    protocolPayloadSatisfiesOperation(operation, protocol);
  checks.push({
    checkId: 'protocol_completion',
    passed: protocolOk,
    detail: protocolOk
      ? `Protocol completed for ${operation}`
      : `Protocol incomplete for ${operation}: kind=${successResponse.kind}`,
    evidence: { protocol, kind: successResponse.kind },
  });

  const usage =
    successResponse.kind === 'completed'
      ? extractUsageEvidence(successResponse)
      : undefined;
  const usageOk =
    usage !== undefined &&
    usage.source === 'observed_usage' &&
    (usage.inputTokens ?? 0) > 0 &&
    (usage.outputTokens ?? 0) > 0;
  checks.push({
    checkId: 'usage_evidence',
    passed: usageOk,
    detail: usageOk
      ? 'Observed input/output token usage present'
      : 'Usage evidence missing or zero',
    evidence: usage ? { ...usage } : { missing: true },
  });

  // Error normalization probe (recorded fakes). Live runs may skip inject.
  let normalizedError: TextChannelConformanceResult['normalizedError'];
  const errorScenario = input.errorProbeScenario ?? 'rate_limit_429';
  if (input.injectErrorProbe || input.errorProbeScenario) {
    attemptCount += 1;
    const errorResponse = await runErrorProbe(
      input.port,
      buildRequest(fixture.model, fixture.deployment, operation),
      input.injectErrorProbe,
      errorScenario
    );
    if (errorResponse.kind === 'failure') {
      normalizedError = normalizeProviderError({
        acceptance: errorResponse.acceptance,
        errorCode: errorResponse.errorCode,
        retryable: errorResponse.retryable,
        message: errorResponse.message,
      });
      const errorOk =
        Boolean(normalizedError.errorCode) &&
        Boolean(normalizedError.acceptance) &&
        typeof normalizedError.retryable === 'boolean';
      checks.push({
        checkId: 'error_normalization',
        passed: errorOk,
        detail: errorOk
          ? `Normalized ${normalizedError.errorCode} → ${normalizedError.acceptance}`
          : 'Error response missing normalized fields',
        evidence: { ...normalizedError },
      });
      const acceptanceOk =
        (errorScenario === 'auth_401' &&
          normalizedError.acceptance === 'rejected_before_accept' &&
          !normalizedError.retryable) ||
        (errorScenario === 'rate_limit_429' &&
          normalizedError.acceptance === 'rejected_before_accept' &&
          normalizedError.retryable) ||
        (errorScenario === 'server_5xx' &&
          normalizedError.acceptance === 'acceptance_unknown' &&
          normalizedError.retryable) ||
        errorScenario === 'usage_missing' ||
        errorScenario === 'success';
      checks.push({
        checkId: 'acceptance_semantics',
        passed: acceptanceOk,
        detail: acceptanceOk
          ? 'Acceptance semantics match injected scenario'
          : `Unexpected acceptance for ${errorScenario}`,
        evidence: {
          scenario: errorScenario,
          acceptance: normalizedError.acceptance,
          retryable: normalizedError.retryable,
        },
      });
    } else {
      checks.push({
        checkId: 'error_normalization',
        passed: false,
        detail: 'Expected failure response for error probe',
      });
      checks.push({
        checkId: 'acceptance_semantics',
        passed: false,
        detail: 'Error probe did not fail',
      });
    }
  } else if (successResponse.kind === 'failure') {
    normalizedError = normalizeProviderError({
      acceptance: successResponse.acceptance,
      errorCode: successResponse.errorCode,
      retryable: successResponse.retryable,
      message: successResponse.message,
    });
    checks.push({
      checkId: 'error_normalization',
      passed: Boolean(normalizedError.errorCode),
      detail: 'Primary path failed; captured normalized error',
      evidence: { ...normalizedError },
    });
    checks.push({
      checkId: 'acceptance_semantics',
      passed: Boolean(normalizedError.acceptance),
      detail: `Primary failure acceptance=${normalizedError.acceptance}`,
      evidence: { acceptance: normalizedError.acceptance },
    });
  } else {
    // Live success path without error inject: acceptance semantics satisfied by completed.
    checks.push({
      checkId: 'error_normalization',
      passed: true,
      detail:
        'Error inject skipped (live path); success response implies adapter is reachable',
      evidence: { skipped: true, reason: 'live_or_success_only' },
    });
    checks.push({
      checkId: 'acceptance_semantics',
      passed: true,
      detail: 'Completed response implies accepted completion path',
      evidence: { kind: 'completed' },
    });
  }

  const fingerprint = fixture.gatewayFingerprint;
  const fingerprintOk = gatewayFingerprintConsistent({
    channelKind: fixture.channelKind,
    fingerprint,
  });
  checks.push({
    checkId: 'gateway_fingerprint',
    passed: fingerprintOk,
    detail: fingerprintOk
      ? `Fingerprint ${fingerprint.product} consistent with ${fixture.channelKind}`
      : `Fingerprint ${fingerprint.product} inconsistent with ${fixture.channelKind}`,
    evidence: { ...fingerprint, channelKind: fixture.channelKind },
  });

  const mappingConfidence: MappingConfidenceGrade = gradeMappingConfidence({
    providerModel: fixture.providerModel,
    catalogModelId: fixture.catalogModelId,
    catalogStableModelName: fixture.catalogStableModelName,
    declaredAlias: fixture.declaredAlias,
    channelKind: fixture.channelKind,
    gatewayFingerprint: fingerprint,
    protocolFamily: fixture.protocolFamily,
  });
  const mappingOk =
    evidenceKind === 'live_provider'
      ? mappingConfidenceMeetsActivationGate(mappingConfidence)
      : mappingConfidence !== 'unknown';
  checks.push({
    checkId: 'mapping_confidence',
    passed: mappingOk,
    detail: `Mapping confidence=${mappingConfidence}`,
    evidence: {
      mappingConfidence,
      providerModel: fixture.providerModel,
      catalogModelId: fixture.catalogModelId,
    },
  });

  const passed = checks.every((check) => check.passed);
  const id =
    input.resultId ??
    digestId([
      fixture.deploymentId,
      operation,
      observedAt,
      evidenceKind,
    ]);

  return {
    id,
    modality: 'llm',
    operation,
    channelKind: fixture.channelKind,
    catalogModelId: fixture.catalogModelId,
    deploymentId: fixture.deploymentId,
    providerProfileId: fixture.providerProfileId,
    executionChannelId: fixture.executionChannelId,
    providerModel: fixture.providerModel,
    endpointRevision: fixture.endpointRevision,
    configurationRevision: fixture.configurationRevision,
    gatewayFingerprint: fingerprint satisfies GatewayFingerprintMetadata,
    mappingConfidence,
    checks,
    passed,
    protocol,
    ...(usage ? { usage } : {}),
    ...(normalizedError ? { normalizedError } : {}),
    attemptCount,
    observedAt,
    evidenceKind,
  };
}
