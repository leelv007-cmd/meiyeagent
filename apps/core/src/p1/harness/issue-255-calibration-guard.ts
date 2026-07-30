import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import {
  boundedExecutionCalibrationSampleSchema,
  type BoundedExecutionCalibrationSample,
} from './bounded-execution-calibration.js';

const modalities = ['copy', 'image_text', 'video'] as const;
const scenarioBands = ['low', 'typical', 'boundary'] as const;
const seeds = [1, 2, 3] as const;
const modalityCapMicros = {
  copy: 100_000,
  image_text: 50_000,
  video: 1_620_000,
} as const;

const liveGenerationRequestSchema = z.discriminatedUnion('modality', [
  z
    .object({
      modality: z.literal('copy'),
      adapter: z.literal('direct-copy'),
      catalogModelId: z.string().trim().min(1),
      deploymentId: z.string().trim().min(1),
      operation: z.literal('copy.generate'),
      prompt: z.string().trim().min(1),
      candidateCount: z.literal(3),
      maxInputTokens: z.number().int().positive(),
      maxOutputTokens: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      modality: z.literal('image_text'),
      adapter: z.literal('tuzi-image'),
      catalogModelId: z.literal('gpt-image-2'),
      deploymentId: z.string().trim().min(1),
      operation: z.literal('image.generate'),
      prompt: z.string().trim().min(1),
      outputCount: z.literal(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      modality: z.literal('video'),
      adapter: z.literal('tuzi-video'),
      catalogModelId: z.literal('seedance-1-5-pro'),
      deploymentId: z.string().trim().min(1),
      operation: z.literal('video.generate'),
      prompt: z.string().trim().min(1),
      outputCount: z.literal(1),
      durationSeconds: z.number().int().positive(),
    })
    .strict(),
]);

export type Issue255LiveGenerationRequest = z.infer<
  typeof liveGenerationRequestSchema
>;

const liveGenerationEffectSchema = z.intersection(
  liveGenerationRequestSchema,
  z
    .object({
      effectId: z.string().trim().min(1),
      requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      allowAutoRoute: z.literal(false),
      allowStructuredRepair: z.literal(false),
      allowCancellation: z.literal(false),
    })
    .strict(),
);

export type Issue255LiveGenerationEffect = z.infer<
  typeof liveGenerationEffectSchema
>;

const trustedQuoteSchema = z
  .object({
    source: z.literal('frozen_provider_price'),
    effectId: z.string().trim().min(1),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    worstCaseAmountMicros: z.number().int().positive(),
    currency: z.literal('CNY'),
    priceRevision: z.string().trim().min(1),
    exchangeRevision: z.string().trim().min(1),
    basis: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

const terminalProviderCostLineageSchema = z
  .object({
    effectId: z.string().trim().min(1),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    generationPostCount: z.literal(1),
    providerHttpRequestCount: z.number().int().positive(),
    attempt: z
      .object({
        id: z.string().trim().min(1),
        deploymentId: z.string().trim().min(1),
        providerIdempotencyKey: z.string().trim().min(1),
        providerTaskRef: z.string().trim().min(1),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        acceptance: z.literal('accepted'),
        status: z.literal('completed'),
      })
      .strict(),
    providerCost: z
      .object({
        id: z.string().trim().min(1),
        attemptId: z.string().trim().min(1),
        amountMicros: z.number().int().positive(),
        currency: z.literal('CNY'),
        priceRevision: z.string().trim().min(1),
        exchangeRevision: z.string().trim().min(1),
        evidenceKind: z.literal('provider_cost'),
        usage: z
          .object({
            inputTokens: z.number().int().positive().optional(),
            outputTokens: z.number().int().positive().optional(),
            mediaUnits: z.number().int().positive().optional(),
          })
          .strict()
          .refine((usage) => Object.keys(usage).length > 0, {
            message: 'Terminal ProviderCost lineage requires provider usage.',
          }),
      })
      .strict(),
  })
  .strict();

export type Issue255TerminalProviderCostLineage = z.infer<
  typeof terminalProviderCostLineageSchema
>;

export interface Issue255TrustedQuoteSource {
  quote(
    effect: Issue255LiveGenerationEffect,
  ): Promise<z.infer<typeof trustedQuoteSchema>>;
}

export interface Issue255GenerationPostPort {
  postGeneration(
    effect: Issue255LiveGenerationEffect,
  ): Promise<Issue255TerminalProviderCostLineage>;
}

const liveGenerationProbeSchema = z
  .object({
    modality: z.enum(modalities),
    reservedAmountMicros: z.number().int().positive(),
    status: z.enum(['started', 'completed', 'unknown']),
    startedAt: z.string().datetime(),
    terminalAt: z.string().datetime().optional(),
    effect: liveGenerationEffectSchema,
    quote: trustedQuoteSchema,
    terminal: terminalProviderCostLineageSchema.optional(),
  })
  .strict();

const liveStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    version: z.number().int().nonnegative(),
    runNonce: z.string().trim().min(1),
    probeCapMicros: z.literal(3_600_000),
    globalCapMicros: z.literal(5_000_000),
    recordedMatrixDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    probes: z.array(liveGenerationProbeSchema).max(3),
  })
  .strict();

type Issue255LiveCalibrationState = z.infer<typeof liveStateSchema>;

export function assertIssue255RecordedMatrix(input: unknown) {
  const samples = z
    .array(boundedExecutionCalibrationSampleSchema)
    .length(27, 'Issue 255 requires exactly 27 recorded samples.')
    .parse(input);
  if (samples.some((sample) => sample.evidenceKind !== 'recorded')) {
    throw new Error('Issue 255 recorded matrix accepts recorded evidence only.');
  }
  if (
    samples.some((sample) =>
      sample.modality === 'copy'
        ? sample.loopEvidence !==
            (sample.scenarioBand === 'low'
              ? 'bounded_single_pass'
              : 'full_limit_loop')
        : sample.loopEvidence !== 'non_limit_loop',
    )
  ) {
    throw new Error(
      'Issue 255 recorded matrix must mark low copy as bounded_single_pass, other copy as full_limit_loop, and media as non_limit_loop.',
    );
  }
  const coordinates = new Set(
    samples.map(
      (sample) =>
        `${sample.modality}\0${sample.scenarioBand}\0${sample.seed}`,
    ),
  );
  for (const modality of modalities) {
    for (const scenarioBand of scenarioBands) {
      for (const seed of seeds) {
        if (!coordinates.has(`${modality}\0${scenarioBand}\0${seed}`)) {
          throw new Error(
            `Issue 255 recorded matrix coordinate is missing: ${modality}/${scenarioBand}/${seed}.`,
          );
        }
      }
    }
  }
  if (coordinates.size !== 27) {
    throw new Error('Issue 255 recorded matrix coordinate must be unique.');
  }
  if (
    samples.some(
      (sample) =>
        sample.observed.iterations === 0 ||
        (sample.modality === 'copy' && sample.observed.costCents === 0),
    )
  ) {
    throw new Error(
      'Issue 255 recorded matrix requires useful observed execution and copy cost evidence.',
    );
  }
  return samples satisfies BoundedExecutionCalibrationSample[];
}

export interface Issue255LiveCalibrationStore {
  read(): Promise<unknown | undefined>;
  write(state: unknown, expectedVersion: number | null): Promise<void>;
  withExclusiveLock<Result>(operation: () => Promise<Result>): Promise<Result>;
}

export class FileIssue255LiveCalibrationStore
  implements Issue255LiveCalibrationStore
{
  private readonly path: string;
  private readonly lockPath: string;

  constructor(repositoryRoot: string) {
    if (!repositoryRoot.trim()) {
      throw new Error('Issue 255 repository root is required.');
    }
    this.path = resolve(
      repositoryRoot,
      'references/evidence/issue-255/live-ledger.json',
    );
    this.lockPath = `${this.path}.lock`;
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as unknown;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async write(state: unknown, expectedVersion: number | null) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const current = await this.read();
    const currentVersion =
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      'version' in current &&
      typeof current.version === 'number'
        ? current.version
        : null;
    if (currentVersion !== expectedVersion) {
      throw new Error(
        `Issue 255 live ledger CAS failed: expected version ${String(expectedVersion)}, found ${String(currentVersion)}.`,
      );
    }
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(state, null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async withExclusiveLock<Result>(operation: () => Promise<Result>) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      await mkdir(this.lockPath, { mode: 0o700 });
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        throw new Error(
          'Issue 255 live ledger is locked by another process; fail closed.',
        );
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await rm(this.lockPath, { recursive: true });
    }
  }
}

export class Issue255LiveCalibrationGuard {
  private readonly options: {
    runNonce: string;
    probeCapMicros: 3_600_000;
    globalCapMicros: 5_000_000;
    recordedSamples: unknown;
    trustedQuoteSource?: Issue255TrustedQuoteSource;
    generationPostPort?: Issue255GenerationPostPort;
  };

  constructor(
    private readonly store: Issue255LiveCalibrationStore,
    options: {
      runNonce: string;
      probeCapMicros: 3_600_000;
      globalCapMicros: 5_000_000;
      recordedSamples: unknown;
      trustedQuoteSource?: Issue255TrustedQuoteSource;
      generationPostPort?: Issue255GenerationPostPort;
    },
  ) {
    this.options = {
      runNonce: z.string().trim().min(1).parse(options.runNonce),
      probeCapMicros: z.literal(3_600_000).parse(options.probeCapMicros),
      globalCapMicros: z.literal(5_000_000).parse(options.globalCapMicros),
      recordedSamples: options.recordedSamples,
      trustedQuoteSource: options.trustedQuoteSource,
      generationPostPort: options.generationPostPort,
    };
  }

  async runGeneration(input: Issue255LiveGenerationRequest) {
    return this.store.withExclusiveLock(() =>
      this.runGenerationWithLock(input),
    );
  }

  private async runGenerationWithLock(input: Issue255LiveGenerationRequest) {
    const quoteSource = this.options.trustedQuoteSource;
    const generationPostPort = this.options.generationPostPort;
    if (!quoteSource || !generationPostPort) {
      throw new Error(
        'Issue 255 live generation requires typed quote and generation POST ports.',
      );
    }
    const request = liveGenerationRequestSchema.parse(input);
    const recordedMatrix = assertIssue255RecordedMatrix(
      this.options.recordedSamples,
    );
    const recordedMatrixDigest = canonicalRecordedMatrixDigest(recordedMatrix);
    const state = await this.load();
    if (state.recordedMatrixDigest !== recordedMatrixDigest) {
      throw new Error('Issue 255 recorded matrix changed during the live run.');
    }
    if (
      state.probes.some(
        (probe) => probe.status === 'started' || probe.status === 'unknown',
      )
    ) {
      throw new Error(
        'Issue 255 live run is frozen by started or unknown work; only reconciliation is permitted.',
      );
    }
    if (state.probes.some((probe) => probe.modality === request.modality)) {
      throw new Error(
        `Issue 255 live modality ${request.modality} already started; unknown work is never resubmitted.`,
      );
    }
    if (state.probes.length >= 3) {
      throw new Error(
        'Issue 255 live calibration permits exactly three generation submissions.',
      );
    }
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex');
    const effect = liveGenerationEffectSchema.parse({
      ...request,
      effectId:
        `issue-255-live:${this.options.runNonce}:${request.modality}:` +
        requestFingerprint.slice(0, 24),
      requestFingerprint,
      allowAutoRoute: false,
      allowStructuredRepair: false,
      allowCancellation: false,
    });
    const quote = trustedQuoteSchema.parse(await quoteSource.quote(effect));
    if (
      quote.effectId !== effect.effectId ||
      quote.requestFingerprint !== effect.requestFingerprint
    ) {
      throw new Error('Issue 255 trusted quote does not bind the generation effect.');
    }
    if (quote.worstCaseAmountMicros > modalityCapMicros[request.modality]) {
      throw new Error(
        `Issue 255 ${request.modality} trusted quote exceeds its approved cap.`,
      );
    }
    const reserved =
      state.probes.reduce(
        (sum, probe) => sum + probe.reservedAmountMicros,
        0,
      ) + quote.worstCaseAmountMicros;
    if (
      reserved > this.options.probeCapMicros ||
      reserved > this.options.globalCapMicros
    ) {
      throw new Error('Issue 255 live cost cap would be exceeded before submit.');
    }
    const startedAt = new Date().toISOString();
    const started = liveStateSchema.parse({
      ...state,
      version: state.version + 1,
      probes: [
        ...state.probes,
        {
          modality: request.modality,
          reservedAmountMicros: quote.worstCaseAmountMicros,
          status: 'started',
          startedAt,
          effect,
          quote,
        },
      ],
    });
    await this.store.write(
      started,
      state.version === 0 ? null : state.version,
    );

    try {
      const terminal = terminalProviderCostLineageSchema.parse(
        await generationPostPort.postGeneration(effect),
      );
      assertTerminalLineage(effect, quote, terminal);
      if (
        terminal.providerCost.amountMicros > quote.worstCaseAmountMicros ||
        terminal.providerCost.amountMicros >
          modalityCapMicros[request.modality]
      ) {
        throw new Error(
          `Issue 255 terminal ProviderCost exceeded the ${request.modality} quote or cap.`,
        );
      }
      const completed = {
        ...started,
        version: started.version + 1,
        probes: started.probes.map((probe, index) =>
          index === started.probes.length - 1
            ? {
                ...probe,
                status: 'completed' as const,
                terminalAt: new Date().toISOString(),
                terminal,
              }
            : probe,
        ),
      };
      await this.store.write(
        liveStateSchema.parse(completed),
        started.version,
      );
      return terminal;
    } catch (error) {
      const unknown = {
        ...started,
        version: started.version + 1,
        probes: started.probes.map((probe, index) =>
          index === started.probes.length - 1
            ? {
                ...probe,
                status: 'unknown' as const,
                terminalAt: new Date().toISOString(),
              }
            : probe,
        ),
      };
      await this.store.write(
        liveStateSchema.parse(unknown),
        started.version,
      );
      throw error;
    }
  }

  private async load(): Promise<Issue255LiveCalibrationState> {
    const existing = await this.store.read();
    if (existing === undefined) {
      return liveStateSchema.parse({
        schemaVersion: 2,
        version: 0,
        runNonce: this.options.runNonce,
        probeCapMicros: this.options.probeCapMicros,
        globalCapMicros: this.options.globalCapMicros,
        recordedMatrixDigest: canonicalRecordedMatrixDigest(
          assertIssue255RecordedMatrix(this.options.recordedSamples),
        ),
        probes: [],
      });
    }
    const state = liveStateSchema.parse(existing);
    if (
      state.runNonce !== this.options.runNonce ||
      state.probeCapMicros !== this.options.probeCapMicros ||
      state.globalCapMicros !== this.options.globalCapMicros
    ) {
      throw new Error('Issue 255 live run identity or caps changed.');
    }
    return state;
  }
}

export function canonicalRecordedMatrixDigest(
  samples: readonly BoundedExecutionCalibrationSample[],
) {
  return createHash('sha256')
    .update(JSON.stringify(samples))
    .digest('hex');
}

function assertTerminalLineage(
  effect: Issue255LiveGenerationEffect,
  quote: z.infer<typeof trustedQuoteSchema>,
  terminal: Issue255TerminalProviderCostLineage,
) {
  if (
    terminal.effectId !== effect.effectId ||
    terminal.requestFingerprint !== effect.requestFingerprint ||
    terminal.attempt.deploymentId !== effect.deploymentId ||
    terminal.attempt.providerIdempotencyKey !== effect.effectId ||
    terminal.attempt.requestFingerprint !== effect.requestFingerprint ||
    terminal.providerCost.attemptId !== terminal.attempt.id
  ) {
    throw new Error(
      'Issue 255 terminal ProviderCost lineage does not bind the generation effect.',
    );
  }
  if (
    terminal.providerCost.priceRevision !== quote.priceRevision ||
    terminal.providerCost.exchangeRevision !== quote.exchangeRevision
  ) {
    throw new Error(
      'Issue 255 terminal ProviderCost revisions do not match the trusted quote.',
    );
  }
}
