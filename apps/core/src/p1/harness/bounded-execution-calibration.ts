import { observabilityAxesSchema } from '@meiye/contracts';
import { z } from 'zod';

const calibrationModalitySchema = z.enum(['copy', 'image_text', 'video']);
const calibrationEvidenceKindSchema = z.enum([
  'fixture',
  'recorded',
  'live',
]);
const calibrationScenarioBandSchema = z.enum([
  'low',
  'typical',
  'boundary',
]);

export const boundedExecutionCalibrationSampleSchema = z
  .object({
    axes: observabilityAxesSchema,
    artifactRef: z.string().trim().min(1),
    evidenceKind: calibrationEvidenceKindSchema,
    modality: calibrationModalitySchema,
    sampleId: z.string().trim().min(1),
    scenarioBand: calibrationScenarioBandSchema,
    scenarioId: z.string().trim().min(1),
    seed: z.number().int().nonnegative(),
    observed: z
      .object({
        delegations: z.number().int().nonnegative(),
        iterations: z.number().int().nonnegative(),
        costCents: z.number().int().nonnegative(),
        wallClockMs: z.number().int().positive(),
        suspendedMs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((sample, context) => {
    if (!sample.artifactRef.startsWith(`${sample.evidenceKind}://`)) {
      context.addIssue({
        code: 'custom',
        message: 'artifactRef must use the declared evidenceKind scheme.',
        path: ['artifactRef'],
      });
    }
    if (sample.observed.suspendedMs > sample.observed.wallClockMs) {
      context.addIssue({
        code: 'custom',
        message: 'suspendedMs cannot exceed wallClockMs.',
        path: ['observed', 'suspendedMs'],
      });
    }
  });

export type BoundedExecutionCalibrationSample = z.infer<
  typeof boundedExecutionCalibrationSampleSchema
>;

interface Distribution {
  count: number;
  min: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
}

interface LimitDistributions {
  maxIterations: Distribution;
  maxCostCents: Distribution;
  maxWallClockMs: Distribution;
  activeWallClockMs: Distribution;
  suspendedWallClockMs: Distribution;
  maxDelegations: Distribution;
}

const MODALITIES = calibrationModalitySchema.options;
const EVIDENCE_KINDS = calibrationEvidenceKindSchema.options;

function nearestRank(sorted: readonly number[], quantile: number) {
  return sorted[Math.ceil(sorted.length * quantile) - 1]!;
}

function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0]!,
    p50: nearestRank(sorted, 0.5),
    p90: nearestRank(sorted, 0.9),
    p95: nearestRank(sorted, 0.95),
    max: sorted.at(-1)!,
  };
}

function limitDistributions(
  samples: readonly BoundedExecutionCalibrationSample[],
): LimitDistributions {
  return {
    maxIterations: distribution(
      samples.map(({ observed }) => observed.iterations),
    ),
    maxCostCents: distribution(
      samples.map(({ observed }) => observed.costCents),
    ),
    maxWallClockMs: distribution(
      samples.map(({ observed }) => observed.wallClockMs),
    ),
    activeWallClockMs: distribution(
      samples.map(
        ({ observed }) => observed.wallClockMs - observed.suspendedMs,
      ),
    ),
    suspendedWallClockMs: distribution(
      samples.map(({ observed }) => observed.suspendedMs),
    ),
    maxDelegations: distribution(
      samples.map(({ observed }) => observed.delegations),
    ),
  };
}

export function summarizeBoundedExecutionCalibration(input: unknown) {
  const samples = z
    .array(boundedExecutionCalibrationSampleSchema)
    .min(1)
    .parse(input);
  if (new Set(samples.map(({ sampleId }) => sampleId)).size !== samples.length) {
    throw new Error('Calibration sampleId must be unique.');
  }
  const byModality = Object.fromEntries(
    MODALITIES.map((modality) => {
      const modalitySamples = samples.filter(
        (sample) => sample.modality === modality,
      );
      if (modalitySamples.length === 0) {
        throw new Error(`Calibration samples are missing modality ${modality}.`);
      }
      return [modality, limitDistributions(modalitySamples)];
    }),
  ) as Record<(typeof MODALITIES)[number], LimitDistributions>;
  const byEvidence = Object.fromEntries(
    EVIDENCE_KINDS.map((evidenceKind) => {
      const evidenceSamples = samples.filter(
        (sample) => sample.evidenceKind === evidenceKind,
      );
      return [
        evidenceKind,
        evidenceSamples.length === 0
          ? null
          : limitDistributions(evidenceSamples),
      ];
    }),
  ) as Record<
    (typeof EVIDENCE_KINDS)[number],
    LimitDistributions | null
  >;

  return {
    schemaVersion: 1 as const,
    quantileMethod: 'nearest_rank' as const,
    sampleCount: samples.length,
    evidenceCounts: {
      fixture: samples.filter(({ evidenceKind }) => evidenceKind === 'fixture')
        .length,
      recorded: samples.filter(
        ({ evidenceKind }) => evidenceKind === 'recorded',
      ).length,
      live: samples.filter(({ evidenceKind }) => evidenceKind === 'live')
        .length,
    },
    scenarioBandCounts: {
      low: samples.filter(({ scenarioBand }) => scenarioBand === 'low').length,
      typical: samples.filter(({ scenarioBand }) => scenarioBand === 'typical')
        .length,
      boundary: samples.filter(
        ({ scenarioBand }) => scenarioBand === 'boundary',
      ).length,
    },
    overall: limitDistributions(samples),
    byEvidence,
    byModality,
  };
}
