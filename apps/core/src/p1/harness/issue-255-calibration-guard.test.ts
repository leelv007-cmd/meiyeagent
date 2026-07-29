import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { BoundedExecutionCalibrationSample } from './bounded-execution-calibration.js';
import {
  FileIssue255LiveCalibrationStore,
  Issue255LiveCalibrationGuard,
  assertIssue255RecordedMatrix,
  type Issue255GenerationPostPort,
  type Issue255LiveGenerationEffect,
  type Issue255LiveGenerationRequest,
  type Issue255TerminalProviderCostLineage,
  type Issue255TrustedQuoteSource,
} from './issue-255-calibration-guard.js';

const modalities = ['copy', 'image_text', 'video'] as const;
const bands = ['low', 'typical', 'boundary'] as const;
const seeds = [1, 2, 3] as const;
const approvedMicros = {
  copy: 100_000,
  image_text: 500_000,
  video: 3_000_000,
} as const;

function recordedMatrix(): BoundedExecutionCalibrationSample[] {
  return modalities.flatMap((modality) =>
    bands.flatMap((scenarioBand) =>
      seeds.map((seed) => ({
        axes: {
          skillRevision: `${modality}@recorded-v1`,
          promptVersion: `${scenarioBand}@v1`,
          catalogRevision: 'catalog-recorded-v1',
          scene: `${modality}.generate`,
        },
        artifactRef: `recorded://issue-255/${modality}-${scenarioBand}-${seed}`,
        evidenceKind: 'recorded' as const,
        loopEvidence:
          modality === 'copy'
            ? scenarioBand === 'low'
              ? ('bounded_single_pass' as const)
              : ('full_limit_loop' as const)
            : ('non_limit_loop' as const),
        modality,
        sampleId: `${modality}-${scenarioBand}-${seed}`,
        scenarioBand,
        scenarioId: `${modality}-${scenarioBand}`,
        seed,
        observed: {
          delegations: 0,
          iterations: modality === 'copy' ? seed : 1,
          costCents: seed,
          wallClockMs: 10 + seed,
          suspendedMs: 0,
        },
      })),
    ),
  );
}

function request(
  modality: (typeof modalities)[number],
): Issue255LiveGenerationRequest {
  switch (modality) {
    case 'copy':
      return {
        modality,
        adapter: 'direct-copy',
        catalogModelId: 'deepseek-v4-pro',
        deploymentId: 'deepseek-v4-pro-direct',
        operation: 'copy.generate',
        prompt: 'Grounded issue 255 copy calibration.',
        candidateCount: 3,
        maxInputTokens: 1_000,
        maxOutputTokens: 128,
      };
    case 'image_text':
      return {
        modality,
        adapter: 'tuzi-image',
        catalogModelId: 'gpt-image-2',
        deploymentId: 'gpt-image-2-tuzi-relay',
        operation: 'image.generate',
        prompt: 'Grounded issue 255 image calibration.',
        outputCount: 1,
        width: 2048,
        height: 2048,
      };
    case 'video':
      return {
        modality,
        adapter: 'tuzi-video',
        catalogModelId: 'seedance-1-5-pro',
        deploymentId: 'seedance-1-5-pro-tuzi-relay',
        operation: 'video.generate',
        prompt: 'Grounded issue 255 video calibration.',
        outputCount: 1,
        durationSeconds: 5,
      };
  }
}

class TrustedBoundary
  implements Issue255TrustedQuoteSource, Issue255GenerationPostPort
{
  readonly quoted: Issue255LiveGenerationEffect[] = [];
  readonly submitted: Issue255LiveGenerationEffect[] = [];

  async quote(
    effect: Issue255LiveGenerationEffect,
  ): ReturnType<Issue255TrustedQuoteSource['quote']> {
    this.quoted.push(structuredClone(effect));
    return {
      source: 'frozen_provider_price' as const,
      effectId: effect.effectId,
      requestFingerprint: effect.requestFingerprint,
      worstCaseAmountMicros: approvedMicros[effect.modality],
      currency: 'CNY' as const,
      priceRevision: `${effect.adapter}-price-v1`,
      exchangeRevision: 'native-cny-v1',
      basis:
        effect.modality === 'copy'
          ? {
              inputCostPerMillionMicros: 1_000_000,
              outputCostPerMillionMicros: 2_000_000,
              maxInputTokens: effect.maxInputTokens,
              maxOutputTokens: effect.maxOutputTokens,
            }
          : effect.modality === 'image_text'
            ? {
                outputCount: effect.outputCount,
                width: effect.width,
                height: effect.height,
                unitPriceMicros: approvedMicros.image_text,
              }
            : {
                durationSeconds: effect.durationSeconds,
                outputCount: effect.outputCount,
                unitPriceMicros: approvedMicros.video,
              },
    };
  }

  async postGeneration(
    effect: Issue255LiveGenerationEffect,
  ): ReturnType<Issue255GenerationPostPort['postGeneration']> {
    this.submitted.push(structuredClone(effect));
    const amountMicros =
      effect.modality === 'copy'
        ? 80_000
        : effect.modality === 'image_text'
          ? 400_000
          : 2_500_000;
    const attemptId = `attempt-${effect.modality}-1`;
    return {
      effectId: effect.effectId,
      requestFingerprint: effect.requestFingerprint,
      generationPostCount: 1 as const,
      providerHttpRequestCount:
        effect.modality === 'copy' ? 1 : effect.modality === 'image_text' ? 2 : 4,
      attempt: {
        id: attemptId,
        deploymentId: effect.deploymentId,
        providerIdempotencyKey: effect.effectId,
        providerTaskRef: `provider-${effect.modality}-1`,
        requestFingerprint: effect.requestFingerprint,
        acceptance: 'accepted' as const,
        status: 'completed' as const,
      },
      providerCost: {
        id: `provider-cost-${effect.modality}-1`,
        attemptId,
        amountMicros,
        currency: 'CNY' as const,
        priceRevision: `${effect.adapter}-price-v1`,
        exchangeRevision: 'native-cny-v1',
        evidenceKind: 'provider_cost' as const,
        usage:
          effect.modality === 'copy'
            ? { inputTokens: 64, outputTokens: 32 }
            : { mediaUnits: 1 },
      },
    };
  }
}

function guard(
  repositoryRoot: string,
  boundary: Issue255TrustedQuoteSource & Issue255GenerationPostPort,
  samples: unknown = recordedMatrix(),
) {
  return new Issue255LiveCalibrationGuard(
    new FileIssue255LiveCalibrationStore(repositoryRoot),
    {
      runNonce: 'issue-255-stable-run',
      probeCapMicros: 3_600_000,
      globalCapMicros: 5_000_000,
      recordedSamples: samples,
      trustedQuoteSource: boundary,
      generationPostPort: boundary,
    },
  );
}

function ledgerPath(repositoryRoot: string) {
  return join(
    repositoryRoot,
    'references/evidence/issue-255/live-ledger.json',
  );
}

test('issue 255 recorded acceptance requires exactly the 3 modalities x 3 bands x 3 seeds matrix and fixture zero', () => {
  assert.equal(assertIssue255RecordedMatrix(recordedMatrix()).length, 27);
  assert.throws(
    () => assertIssue255RecordedMatrix(recordedMatrix().slice(1)),
    /exactly 27/u,
  );
  assert.throws(
    () =>
      assertIssue255RecordedMatrix([
        ...recordedMatrix().slice(0, -1),
        {
          ...recordedMatrix().at(-1)!,
          artifactRef: 'fixture://issue-255/video-boundary-3',
          evidenceKind: 'fixture',
        },
      ]),
    /recorded evidence/u,
  );
  assert.throws(
    () =>
      assertIssue255RecordedMatrix([
        ...recordedMatrix().slice(0, -1),
        {
          ...recordedMatrix().at(-1)!,
          sampleId: 'duplicate-coordinate',
          seed: 2,
        },
      ]),
    /matrix coordinate/u,
  );
});

test('issue 255 typed live fence permits direct copy plus Tuzi image and video exactly once and rejects a fourth before POST', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-255-live-'));
  const path = ledgerPath(directory);
  const boundary = new TrustedBoundary();
  const live = guard(directory, boundary);

  try {
    for (const modality of modalities) {
      const terminal = await live.runGeneration(request(modality));
      assert.equal(terminal.generationPostCount, 1);
      assert.equal(terminal.providerCost.currency, 'CNY');
    }
    assert.equal(boundary.submitted.length, 3);
    assert.deepEqual(
      boundary.submitted.map((effect) => effect.adapter),
      ['direct-copy', 'tuzi-image', 'tuzi-video'],
    );
    assert.equal(
      boundary.submitted.reduce(
        (total, effect) =>
          total +
          (effect.modality === 'copy'
            ? 1
            : effect.modality === 'image_text'
              ? 2
              : 4),
        0,
      ),
      7,
      'provider HTTP requests are observed separately from three generation POSTs',
    );
    await assert.rejects(
      live.runGeneration(request('copy')),
      /exactly three|already started/u,
    );
    assert.equal(boundary.submitted.length, 3);
    const durable = JSON.parse(await readFile(path, 'utf8')) as {
      version: number;
      probeCapMicros: number;
      globalCapMicros: number;
    };
    assert.deepEqual(
      {
        version: durable.version,
        probeCapMicros: durable.probeCapMicros,
        globalCapMicros: durable.globalCapMicros,
      },
      {
        version: 6,
        probeCapMicros: 3_600_000,
        globalCapMicros: 5_000_000,
      },
    );
    assert.equal(
      'runProbe' in (live as unknown as Record<string, unknown>),
      false,
      'the opaque callback entrypoint must not remain callable',
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('issue 255 typed live fence serializes concurrent processes through one ledger without losing the started probe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-255-concurrent-'));
  const path = ledgerPath(directory);
  const boundary = new TrustedBoundary();
  const originalPost = boundary.postGeneration.bind(boundary);
  boundary.postGeneration = async (effect) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return originalPost(effect);
  };

  try {
    const results = await Promise.allSettled([
      guard(directory, boundary).runGeneration(request('copy')),
      guard(directory, boundary).runGeneration(request('image_text')),
    ]);
    assert.equal(boundary.submitted.length, 1);
    assert.deepEqual(
      results.map((result) => result.status).sort(),
      ['fulfilled', 'rejected'],
    );
    const durable = JSON.parse(await readFile(path, 'utf8')) as {
      probes: Array<{ modality: string; status: string }>;
    };
    assert.equal(durable.probes.length, 1);
    assert.equal(durable.probes[0]?.status, 'completed');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('issue 255 typed live fence freezes the entire run after unknown terminal lineage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-255-freeze-'));
  const boundary = new TrustedBoundary();
  boundary.postGeneration = async (effect) => {
    boundary.submitted.push(structuredClone(effect));
    throw new Error('provider acceptance unknown');
  };
  const live = guard(directory, boundary);

  try {
    await assert.rejects(
      live.runGeneration(request('copy')),
      /provider acceptance unknown/u,
    );
    await assert.rejects(
      live.runGeneration(request('image_text')),
      /unknown|frozen/u,
    );
    assert.equal(boundary.submitted.length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('issue 255 typed live fence rejects an untrusted or over-cap quote before generation POST', async () => {
  const cases = [
    {
      name: 'mismatched effect',
      mutate: (quote: Awaited<ReturnType<TrustedBoundary['quote']>>) => ({
        ...quote,
        effectId: 'different-effect',
      }),
      expected: /does not bind/u,
    },
    {
      name: 'over cap',
      mutate: (quote: Awaited<ReturnType<TrustedBoundary['quote']>>) => ({
        ...quote,
        worstCaseAmountMicros: 100_001,
      }),
      expected: /approved cap/u,
    },
    {
      name: 'floating amount',
      mutate: (quote: Awaited<ReturnType<TrustedBoundary['quote']>>) => ({
        ...quote,
        worstCaseAmountMicros: 99_999.5,
      }),
      expected: /int|integer/u,
    },
    {
      name: 'zero price',
      mutate: (quote: Awaited<ReturnType<TrustedBoundary['quote']>>) => ({
        ...quote,
        worstCaseAmountMicros: 0,
      }),
      expected: />0|positive/u,
    },
  ] as const;

  for (const scenario of cases) {
    const directory = await mkdtemp(join(tmpdir(), 'issue-255-quote-'));
    const boundary = new TrustedBoundary();
    const trustedQuote = boundary.quote.bind(boundary);
    boundary.quote = async (effect) =>
      scenario.mutate(await trustedQuote(effect)) as never;
    try {
      await assert.rejects(
        guard(directory, boundary).runGeneration(request('copy')),
        scenario.expected,
        scenario.name,
      );
      assert.equal(boundary.submitted.length, 0);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

test('issue 255 typed live fence rejects forged terminal lineage and freezes the run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-255-terminal-'));
  const boundary = new TrustedBoundary();
  const trustedPost = boundary.postGeneration.bind(boundary);
  boundary.postGeneration = async (effect) => {
    const terminal = await trustedPost(effect);
    return {
      ...terminal,
      providerCost: {
        ...terminal.providerCost,
        attemptId: 'caller-forged-attempt',
      },
    } as Issue255TerminalProviderCostLineage;
  };
  const live = guard(directory, boundary);

  try {
    await assert.rejects(
      live.runGeneration(request('copy')),
      /lineage does not bind/u,
    );
    await assert.rejects(
      live.runGeneration(request('image_text')),
      /unknown|frozen/u,
    );
    assert.equal(boundary.submitted.length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('issue 255 typed live fence binds the full canonical recorded matrix digest, not sample ids alone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'issue-255-digest-'));
  const boundary = new TrustedBoundary();
  const samples = recordedMatrix();

  try {
    await guard(directory, boundary, samples).runGeneration(request('copy'));
    const changed = structuredClone(samples);
    changed[0]!.observed.wallClockMs += 1;
    await assert.rejects(
      guard(directory, boundary, changed).runGeneration(request('image_text')),
      /recorded matrix changed/u,
    );
    assert.equal(boundary.submitted.length, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
