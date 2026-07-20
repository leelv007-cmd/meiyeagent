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
  type LiveProviderLifecycleEvidence,
  type LiveTransportFaultEvidence,
} from './live-provider-gate.js';

interface ExternalEvidenceBundle {
  lifecycleEvidence?: LiveProviderLifecycleEvidence[];
  transportFaultEvidence?: LiveTransportFaultEvidence[];
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

const liveEnabled = env('RUN_PROVIDER_LIVE_FAULT_INJECTION') === '1';
const requireAll = env('PROVIDER_LIVE_REQUIRE_ALL') === '1';
const costCap = Number(env('PROVIDER_LIVE_COST_CAP_USD') ?? '1');
const resolution = resolveLiveProviderChannels();
const missingSummary = resolution.missingByChannel
  .map(
    (entry) =>
      `${entry.operation}/${entry.channelKind}: ${entry.missing.join(', ')}`,
  )
  .join('; ');
const liveSkip = !liveEnabled
  ? 'RUN_PROVIDER_LIVE_FAULT_INJECTION=1 is required (spends provider quota)'
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
    assert.ok(Number.isFinite(costCap) && costCap > 0 && costCap <= 5);
    assert.deepEqual(
      resolution.missingByChannel,
      [],
      `protected provider-live workflow requires all six channels: ${missingSummary}`,
    );
    assert.equal(resolution.channels.length, 6);

    const evidenceDirectory = env('PROVIDER_LIVE_EVIDENCE_DIR');
    const evidencePath = evidenceDirectory
      ? join(evidenceDirectory, 'provider-live-gate.json')
      : undefined;
    if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });
    const externalEvidencePath = env(
      'PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH',
    );
    const externalEvidence = externalEvidencePath
      ? await loadExternalEvidence(externalEvidencePath)
      : {};
    const externalEvidenceCostReservationUsd = Number(
      env('PROVIDER_LIVE_FAULT_INJECTOR_MAX_COST_USD') ?? '0',
    );

    const report = await runLiveProviderGate({
      channels: resolution.channels,
      costCapUsd: costCap,
      externalEvidenceCostReservationUsd,
      lifecycleEvidence: externalEvidence.lifecycleEvidence,
      transportFaultEvidence: externalEvidence.transportFaultEvidence,
      probe: async (channel) =>
        probeLiveProviderChannel(channel as ResolvedLiveProviderChannel),
      ...(evidencePath
        ? {
            onProbe: async (probes) =>
              writeEvidence(evidencePath, {
                complete: false,
                probes,
              }),
          }
        : {}),
    });

    // Persist failures too: the protected workflow uploads this artifact with
    // `if: always()`, so a red gate still leaves truthful, redacted evidence.
    if (evidencePath) await writeEvidence(evidencePath, report);

    assert.equal(report.probes.length, 6);
    for (const probe of report.probes) {
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

    assert.equal(report.activationEvidence.length, 6);
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
    assert.equal(report.publishGates.length, 3);
    assert.ok(report.publishGates.every((gate) => gate.multiChannelReady));
    assert.deepEqual(report.skippedOperations, []);
    assert.equal(report.liveMatrixReports.length, 3);
    assert.ok(
      report.liveMatrixReports.every(
        (matrix) =>
          matrix.evidenceKind === 'live_provider' &&
          matrix.allPassed &&
          matrix.dualChannelReady &&
          matrix.scenarios.length === 5,
      ),
    );
    assert.ok(report.externalEvidenceRefs.length > 0);
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Provider live external evidence must be a JSON object.');
  }
  return parsed as ExternalEvidenceBundle;
}
