import type { DurationEstimate } from '@meiye/contracts';
import {
  duration_evidence_description,
  duration_insufficient_description,
  duration_insufficient_title,
  duration_minutes,
  duration_minutes_seconds,
  duration_range,
  duration_seconds,
} from '@/locale/paraglide/messages';

function durationLabel(seconds: number) {
  if (seconds < 60) return duration_seconds({ count: seconds });
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? duration_minutes({ count: minutes })
    : duration_minutes_seconds({ minutes, seconds: remainingSeconds });
}

export function durationEstimateView(estimate: DurationEstimate | undefined) {
  if (!estimate || estimate.status === 'insufficient_data') {
    const sampleSize = estimate?.sampleSize ?? 0;
    return {
      label: duration_insufficient_title(),
      description: duration_insufficient_description({ sampleSize }),
    };
  }
  return {
    label: duration_range({
      lower: durationLabel(estimate.p50Seconds),
      upper: durationLabel(estimate.p90Seconds),
    }),
    description: duration_evidence_description({
      sampleSize: estimate.sampleSize,
    }),
  };
}
