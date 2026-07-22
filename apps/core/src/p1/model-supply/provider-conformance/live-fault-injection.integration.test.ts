/**
 * Env-gated MP-04T/I/V + MP-08 live provider gate.
 *
 * Unlike the recorded unit matrix, this file first executes the production
 * OpenAI-compatible, Ark and Tuzi adapters. Only successful provider receipts
 * may become live_verified evidence. A paid success receipt is not reused as
 * fake fault evidence: the release gate remains blocked until a real transport
 * injector executes switch/no-resubmit/drain/replay scenarios.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  probeLiveProviderChannel,
  resolveLiveProviderChannels,
  type ResolvedLiveProviderChannel,
} from './live-provider-adapters.js';
import {
  runLiveProviderGate,
  type LiveExternalCostEvidence,
  type LiveProviderLifecycleEvidence,
  type LiveProviderProbeEvidence,
  type LiveTransportFaultEvidence,
} from './live-provider-gate.js';
import {
  CORE_FAULT_INJECTION_OPERATIONS,
  SECONDARY_FAULT_INJECTION_OPERATIONS,
} from './fault-injection/types.js';

interface ExternalEvidenceBundle {
  costEvidence?: LiveExternalCostEvidence;
  lifecycleEvidence?: LiveProviderLifecycleEvidence[];
  secondaryProbes?: LiveProviderProbeEvidence[];
  transportFaultEvidence?: LiveTransportFaultEvidence[];
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

const liveEnabled =
  env('RUN_PROVIDER_LIVE_CONNECTIVITY') === '1' ||
  env('RUN_PROVIDER_LIVE_FAULT_INJECTION') === '1';
const requireAll = env('PROVIDER_LIVE_REQUIRE_ALL') === '1';
const acceptanceMode =
  env('PROVIDER_LIVE_ACCEPTANCE_MODE') === 'primary_connectivity'
    ? 'primary_connectivity'
    : 'dual_channel_conformance';
const primaryConnectivity = acceptanceMode === 'primary_connectivity';
const costCap = Number(env('PROVIDER_LIVE_COST_CAP_CNY') ?? '5');
const runNonce = env('PROVIDER_LIVE_RUN_NONCE');
const releaseRef = env('PROVIDER_LIVE_RELEASE_REF');
const environment = env('PROVIDER_LIVE_ENVIRONMENT');
const configurationRevision = env('PROVIDER_LIVE_CONFIG_REVISION');
const evidenceTtlSeconds = Number(
  env('PROVIDER_LIVE_EVIDENCE_TTL_SECONDS') ?? '86400',
);
const resolution = resolveLiveProviderChannels(
  process.env,
  primaryConnectivity ? { channelKinds: ['official_direct'] } : {},
);
const missingSummary = resolution.missingByChannel
  .map(
    (entry) =>
      `${entry.operation}/${entry.channelKind}: ${entry.missing.join(', ')}`,
  )
  .join('; ');
const liveSkip = !liveEnabled
  ? 'RUN_PROVIDER_LIVE_CONNECTIVITY=1 is required (spends provider quota)'
  : resolution.missingByChannel.length > 0 && !requireAll
    ? `missing live provider configuration: ${missingSummary}`
    : false;

test(
  'live MP-04T/I/V + MP-08: real adapters must not publish while conformance checks are blocked',
  {
    skip: liveSkip,
    timeout: 45 * 60_000,
  },
  async () => {
    assert.ok(Number.isFinite(costCap) && costCap > 0 && costCap <= 50);
    assert.ok(runNonce, 'PROVIDER_LIVE_RUN_NONCE is required');
    assert.ok(releaseRef, 'PROVIDER_LIVE_RELEASE_REF is required');
    assert.ok(environment, 'PROVIDER_LIVE_ENVIRONMENT is required');
    assert.ok(
      configurationRevision,
      'PROVIDER_LIVE_CONFIG_REVISION is required',
    );
    assert.ok(Number.isSafeInteger(evidenceTtlSeconds));
    assert.ok(evidenceTtlSeconds > 0);
    assert.deepEqual(
      resolution.missingByChannel,
      [],
      `protected provider-live workflow requires every configured release channel: ${missingSummary}`,
    );
    assert.equal(resolution.channels.length, primaryConnectivity ? 3 : 6);

    const evidenceDirectory = env('PROVIDER_LIVE_EVIDENCE_DIR');
    const evidencePath = evidenceDirectory
      ? join(evidenceDirectory, 'provider-live-gate.json')
      : undefined;
    if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });
    const externalEvidencePath = env(
      'PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH',
    );
    const externalEvidence =
      externalEvidencePath && !primaryConnectivity
        ? await loadExternalEvidence(externalEvidencePath)
        : {};
    const externalEvidenceCostReservationCny = primaryConnectivity
      ? 0
      : Number(env('PROVIDER_LIVE_FAULT_INJECTOR_MAX_COST_CNY') ?? '0');
    const partialEvidenceContext = {
      complete: false,
      status: 'probes_running',
      acceptanceMode,
      runNonce,
      releaseRef,
      environment,
      configurationRevision,
      startedAt: new Date().toISOString(),
      completedAt: null,
      expiresAt: null,
    } as const;

    const report = await runLiveProviderGate({
      acceptanceMode,
      channels: resolution.channels,
      costCapCny: costCap,
      externalEvidenceCostReservationCny,
      externalCostEvidence: externalEvidence.costEvidence,
      runNonce,
      releaseRef,
      environment,
      configurationRevision,
      evidenceTtlSeconds,
      secondaryProbes: externalEvidence.secondaryProbes,
      lifecycleEvidence: externalEvidence.lifecycleEvidence,
      transportFaultEvidence: externalEvidence.transportFaultEvidence,
      probe: async (channel) =>
        probeLiveProviderChannel(channel as ResolvedLiveProviderChannel),
      ...(evidencePath
        ? {
            onProbe: async (probes) =>
              writeEvidence(evidencePath, {
                ...partialEvidenceContext,
                probes,
              }),
          }
        : {}),
    });

    // Persist failures too: the protected workflow uploads this artifact with
    // `if: always()`, so a red gate still leaves truthful, redacted evidence.
    if (evidencePath) await writeEvidence(evidencePath, report);

    assert.equal(report.acceptanceMode, acceptanceMode);
    assert.equal(report.runNonce, runNonce);
    assert.equal(report.releaseRef, releaseRef);
    assert.equal(report.environment, environment);
    assert.equal(report.configurationRevision, configurationRevision);
    assert.match(report.effectiveConfigurationSha256, /^[a-f0-9]{64}$/u);
    assert.ok(Date.parse(report.expiresAt) > Date.parse(report.completedAt));

    assert.equal(
      report.probes.filter((probe) =>
        CORE_FAULT_INJECTION_OPERATIONS.includes(
          probe.operation as (typeof CORE_FAULT_INJECTION_OPERATIONS)[number],
        ),
      ).length,
      primaryConnectivity ? 3 : 6,
    );
    if (!primaryConnectivity) {
      for (const operation of SECONDARY_FAULT_INJECTION_OPERATIONS) {
        assert.ok(
          report.probes.filter((probe) => probe.operation === operation)
            .length >= 1,
          operation,
        );
      }
    }
    for (const probe of report.probes) {
      assert.match(probe.providerModelSha256, /^[a-f0-9]{64}$/u);
      assert.equal(probe.adapterExecuted, true, probe.evidenceRef);
      assert.equal(
        probe.providerCallSucceeded,
        true,
        `${probe.evidenceRef}: ${probe.failureCode ?? 'unknown'} ${probe.failureMessage ?? ''}`,
      );
      assert.equal(probe.acceptance, 'accepted', probe.evidenceRef);
      assert.ok(probe.providerTaskRef, probe.evidenceRef);
      assert.equal(probe.lifecycle.submitted, true, probe.evidenceRef);
      if (probe.modality === 'llm') {
        assert.ok((probe.providerCost.usage?.inputTokens ?? 0) > 0);
        assert.ok((probe.providerCost.usage?.outputTokens ?? 0) > 0);
        assert.ok((probe.lifecycle.resultBytes ?? 0) > 0);
        assert.match(probe.lifecycle.resultSha256 ?? '', /^[a-f0-9]{64}$/u);
      }
      if (probe.modality === 'image' || probe.modality === 'video') {
        assert.equal(probe.lifecycle.recovered, true, probe.evidenceRef);
        assert.equal(probe.lifecycle.pollStatus, 'completed', probe.evidenceRef);
        assert.equal(probe.lifecycle.downloaded, true, probe.evidenceRef);
        assert.ok((probe.lifecycle.downloadedBytes ?? 0) > 0);
        assert.match(probe.lifecycle.assetSha256 ?? '', /^[a-f0-9]{64}$/u);
        assert.ok((probe.providerCost.usage?.mediaUnits ?? 0) > 0);
        if (probe.modality === 'video') {
          assert.ok((probe.providerCost.usage?.outputTokens ?? 0) > 0);
        }
      }
    }

    assert.equal(report.activationEvidence.length, report.probes.length);
    assert.ok(
      report.activationEvidence.every(
        (evidence) => evidence.activationStatus === 'live_verified',
      ),
    );
    assert.deepEqual(
      report.blockedChecks,
      [],
      `provider-live gate remains blocked: ${JSON.stringify(report.blockedChecks)}`,
    );
    assert.equal(report.publishGates.length, primaryConnectivity ? 3 : 6);
    if (primaryConnectivity) {
      assert.ok(
        report.publishGates.every(
          (gate) =>
            gate.status === 'single_channel' &&
            gate.publishAllowed &&
            !gate.multiChannelReady &&
            gate.channelLabel === 'single-channel/no-fallback',
        ),
      );
    } else {
      assert.ok(
        report.publishGates
          .filter((gate) =>
            CORE_FAULT_INJECTION_OPERATIONS.includes(
              gate.operation as (typeof CORE_FAULT_INJECTION_OPERATIONS)[number],
            ),
          )
          .every((gate) => gate.multiChannelReady),
      );
      assert.ok(
        report.publishGates
          .filter((gate) =>
            SECONDARY_FAULT_INJECTION_OPERATIONS.includes(
              gate.operation as (typeof SECONDARY_FAULT_INJECTION_OPERATIONS)[number],
            ),
          )
          .every(
            (gate) =>
              gate.status === 'single_channel' &&
              gate.publishAllowed &&
              !gate.multiChannelReady &&
              gate.channelLabel === 'single-channel/no-fallback',
          ),
      );
    }
    assert.deepEqual(report.skippedOperations, []);
    assert.equal(report.liveMatrixReports.length, primaryConnectivity ? 0 : 3);
    if (!primaryConnectivity) {
      assert.ok(
        report.liveMatrixReports.every(
          (matrix) =>
            matrix.evidenceKind === 'live_provider' &&
            matrix.allPassed &&
            matrix.dualChannelReady &&
            matrix.scenarios.length === 5,
        ),
      );
    }
    assert.ok(report.externalEvidenceRefs.length > 0);
    assert.ok(report.actualCost.totalCny <= report.actualCost.capCny);
  },
);

async function writeEvidence(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

async function loadExternalEvidence(
  path: string,
): Promise<ExternalEvidenceBundle> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(source);
  return parseExternalEvidence(parsed);
}

function parseExternalEvidence(parsed: unknown): ExternalEvidenceBundle {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Provider live external evidence must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const allowed = new Set([
    'costEvidence',
    'lifecycleEvidence',
    'secondaryProbes',
    'transportFaultEvidence',
  ]);
  const unknownKeys = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Provider live external evidence has unknown top-level fields: ${unknownKeys.join(', ')}`,
    );
  }
  return {
    ...(record.costEvidence
      ? { costEvidence: stripCostEvidence(record.costEvidence) }
      : {}),
    ...(record.lifecycleEvidence
      ? {
          lifecycleEvidence: requireArray(record.lifecycleEvidence).map(
            (value) => stripLifecycleEvidence(value),
          ),
        }
      : {}),
    ...(record.secondaryProbes
      ? {
          secondaryProbes: requireArray(record.secondaryProbes).map((value) =>
            stripSecondaryProbe(value),
          ),
        }
      : {}),
    ...(record.transportFaultEvidence
      ? {
          transportFaultEvidence: requireArray(
            record.transportFaultEvidence,
          ).map((value) => stripTransportEvidence(value)),
        }
      : {}),
  };
}

function stripCostEvidence(value: unknown): LiveExternalCostEvidence {
  const record = requireRecord(value);
  return {
    ...pick(record, [
      'source',
      'runNonce',
      'evidenceRef',
      'observedAt',
      'amountCny',
      'currency',
    ]),
    components: requireArray(record.components).map((component) => {
      return pick(requireRecord(component), [
        'kind',
        'amountCny',
        'evidenceRef',
      ]);
    }),
  } as LiveExternalCostEvidence;
}

function stripSecondaryProbe(value: unknown): LiveProviderProbeEvidence {
  const record = requireRecord(value);
  const providerCost = requireRecord(record.providerCost);
  const usage = recordOrEmpty(providerCost.usage);
  const fx = recordOrEmpty(providerCost.fx);
  const lifecycle = requireRecord(record.lifecycle);
  const operationEvidence = requireRecord(record.operationEvidence);
  return {
    ...pick(record, [
      'operation',
      'modality',
      'channelKind',
      'catalogModelId',
      'providerProfileId',
      'deploymentId',
      'adapterKind',
      'accountIdentityFingerprint',
      'endpointFingerprint',
      'providerModelSha256',
      'adapterExecuted',
      'providerCallSucceeded',
      'acceptance',
      'providerTaskRef',
      'evidenceRef',
      'observedAt',
    ]),
    providerCost: {
      ...pick(providerCost, ['amount', 'currency', 'amountCny']),
      usage: pick(usage, ['inputTokens', 'outputTokens', 'mediaUnits']),
      ...(Object.keys(fx).length > 0
        ? {
            fx: pick(fx, ['cnyPerUsd', 'evidenceRef', 'observedAt']),
          }
        : {}),
    },
    lifecycle: pick(lifecycle, [
      'submitted',
      'recovered',
      'pollStatus',
      'downloaded',
      'resultBytes',
      'resultSha256',
      'downloadedBytes',
      'contentType',
      'assetSha256',
    ]),
    operationEvidence: pick(operationEvidence, [
      'operation',
      'runNonce',
      'requestIdempotencyKeySha256',
      'requestPayloadSha256',
      'resultPayloadSha256',
    ]),
  } as LiveProviderProbeEvidence;
}

function stripLifecycleEvidence(value: unknown): LiveProviderLifecycleEvidence {
  const record = requireRecord(value);
  return {
    ...pick(record, [
      'source',
      'runNonce',
      'evidenceRef',
      'observedAt',
      'operation',
      'modality',
      'channelKind',
      'catalogModelId',
      'providerProfileId',
      'deploymentId',
      'adapterKind',
      'accountIdentityFingerprint',
      'endpointFingerprint',
    ]),
    checks: requireArray(record.checks).map((check) => {
      return pick(requireRecord(check), [
        'checkId',
        'passed',
        'evidenceRef',
      ]);
    }),
  } as LiveProviderLifecycleEvidence;
}

function stripTransportEvidence(value: unknown): LiveTransportFaultEvidence {
  const record = requireRecord(value);
  return {
    ...pick(record, [
      'source',
      'runNonce',
      'evidenceRef',
      'observedAt',
      'operation',
      'catalogModelId',
      'officialDeploymentId',
      'resellerDeploymentId',
      'officialAccountIdentityFingerprint',
      'officialEndpointFingerprint',
      'resellerAccountIdentityFingerprint',
      'resellerEndpointFingerprint',
    ]),
    scenarios: requireArray(record.scenarios).map((scenario) => {
      const item = requireRecord(scenario);
      return {
        ...pick(item, ['scenarioId', 'transportInjectorExecuted']),
        evidenceRefs: requireArray(item.evidenceRefs),
      };
    }),
    matrixReport: record.matrixReport,
  } as LiveTransportFaultEvidence;
}

function requireArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected provider evidence array.');
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected provider evidence object.');
  }
  return value as Record<string, unknown>;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pick(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => key in record).map((key) => [key, record[key]]),
  );
}

test('external evidence parser rejects unknown top-level fields and strips nested extras', () => {
  assert.throws(
    () => parseExternalEvidence({ unexpected: 'never-serialize-me' }),
    /unknown top-level fields/,
  );
  const parsed = parseExternalEvidence({
    secondaryProbes: [
      {
        operation: 'copy.adapt',
        modality: 'llm',
        channelKind: 'upstream_reseller',
        catalogModelId: 'model',
        providerProfileId: 'profile',
        deploymentId: 'deployment',
        adapterKind: 'openai_compatible_llm',
        accountIdentityFingerprint: fingerprintForParser,
        endpointFingerprint: fingerprintForParser,
        providerModelSha256: fingerprintForParser,
        adapterExecuted: true,
        providerCallSucceeded: true,
        acceptance: 'accepted',
        providerTaskRef: 'provider-task-ref',
        providerCost: { amount: 0, currency: 'USD', usage: {} },
        lifecycle: {
          submitted: true,
          recovered: true,
          pollStatus: 'completed',
          downloaded: false,
          resultBytes: 1,
          resultSha256: fingerprintForParser,
        },
        evidenceRef: 'provider-live:secondary:test',
        observedAt: new Date().toISOString(),
        operationEvidence: {
          operation: 'copy.adapt',
          runNonce: 'provider-live-parser-run',
          requestIdempotencyKeySha256: fingerprintForParser,
          requestPayloadSha256: fingerprintForParser,
          resultPayloadSha256: fingerprintForParser,
          rawSecret: 'never-serialize-me',
        },
        rawSecret: 'never-serialize-me',
      },
    ],
  });
  assert.equal(JSON.stringify(parsed).includes('never-serialize-me'), false);
});

const fingerprintForParser = 'a'.repeat(64);
