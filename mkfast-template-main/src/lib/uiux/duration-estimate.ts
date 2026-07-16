import type { DurationEstimate } from '@meiye/contracts';
import { m } from '@/locale/paraglide/messages';

function durationLabel(seconds: number) {
  if (seconds < 60) return m.duration_seconds({ count: seconds });
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? m.duration_minutes({ count: minutes })
    : m.duration_minutes_seconds({ minutes, seconds: remainingSeconds });
}

export function durationEstimateView(estimate: DurationEstimate | undefined) {
  if (!estimate || estimate.status === 'insufficient_data') {
    const sampleSize = estimate?.sampleSize ?? 0;
    return {
      label: m.duration_insufficient_title(),
      description: m.duration_insufficient_description({ sampleSize }),
    };
  }
  return {
    label: m.duration_range({
      lower: durationLabel(estimate.p50Seconds),
      upper: durationLabel(estimate.p90Seconds),
    }),
    description: m.duration_evidence_description({
      sampleSize: estimate.sampleSize,
    }),
  };
}
