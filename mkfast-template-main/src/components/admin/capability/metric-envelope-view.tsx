import type { OperationalMetricEnvelope } from '@meiye/contracts';

import { formatMetricEnvelope } from '@/p1/admin-capability-registry-model';

/**
 * Honest known|unknown metric cell — never paints green/zero for unknown.
 */
export function MetricEnvelopeView<T>({
  label,
  metric,
  format,
}: {
  label: string;
  metric: OperationalMetricEnvelope<T> | undefined;
  format?: (value: T) => string;
}) {
  const text = formatMetricEnvelope(metric, format);
  const isUnknown = !metric || metric.status === 'unknown';

  return (
    <div
      className="rounded-lg border p-3"
      data-metric-status={metric?.status ?? 'absent'}
      data-testid="metric-envelope"
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          isUnknown
            ? 'mt-1 break-words font-mono text-sm text-muted-foreground'
            : 'mt-1 break-words text-lg font-semibold'
        }
      >
        {text}
      </dd>
      {metric?.scope ? (
        <p className="mt-1 break-words text-xs text-muted-foreground">
          scope: {metric.scope}
        </p>
      ) : null}
    </div>
  );
}
