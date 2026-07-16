import type { DurationEstimate } from '@meiye/contracts';

export const DURATION_ESTIMATE_WINDOW_DAYS = 30;
export const DURATION_ESTIMATE_MINIMUM_SAMPLE_SIZE = 5;

export function durationEstimateFromSamples(
  samples: number[],
  asOf = new Date().toISOString()
): DurationEstimate {
  const valid = samples
    .filter((sample) => Number.isFinite(sample) && sample > 0)
    .map((sample) => Math.max(1, Math.round(sample)))
    .sort((left, right) => left - right);
  if (valid.length < DURATION_ESTIMATE_MINIMUM_SAMPLE_SIZE) {
    return {
      status: 'insufficient_data',
      sampleSize: valid.length,
      minimumSampleSize: DURATION_ESTIMATE_MINIMUM_SAMPLE_SIZE,
      windowDays: DURATION_ESTIMATE_WINDOW_DAYS,
      asOf,
    };
  }
  return {
    status: 'observed',
    p50Seconds: nearestRank(valid, 0.5),
    p90Seconds: nearestRank(valid, 0.9),
    sampleSize: valid.length,
    windowDays: DURATION_ESTIMATE_WINDOW_DAYS,
    asOf,
  };
}

function nearestRank(sorted: number[], percentile: number) {
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1);
  return sorted[index] ?? 1;
}
