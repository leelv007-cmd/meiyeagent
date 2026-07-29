import { check } from './check.js';

export interface HarnessObservabilityReconciliationResult {
  actionUsageEventCount: number;
  businessEventCount: number;
  traceCount: number;
  matchedCount: number;
  missingTraceCount: number;
  orphanTraceCount: number;
  ratingEventCount: number;
  undeliveredEventCount: number;
  cutoverAt: Date;
}

export interface HarnessObservabilityDetection {
  code: 'missing_trace' | 'orphan_trace' | 'undelivered_event';
  count: number;
}

export interface HarnessObservabilityReconciliationStore {
  reconcileBusinessEventsToTraces(input: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<HarnessObservabilityReconciliationResult>;
}

export class HarnessObservabilityReconciler {
  constructor(
    private readonly store: HarnessObservabilityReconciliationStore,
    private readonly options: {
      intervalMs?: number;
      windowMs?: number;
      now?: () => Date;
      onViolation?: (violation: HarnessObservabilityDetection) => void;
    } = {},
  ) {}

  async runOnce() {
    const intervalMs = positiveInteger(
      this.options.intervalMs ?? 5 * 60_000,
      'intervalMs',
    );
    const windowMs = positiveInteger(
      this.options.windowMs ?? 60 * 60_000,
      'windowMs',
    );
    const now = this.options.now?.() ?? new Date();
    const windowEnd = new Date(
      Math.floor(now.getTime() / intervalMs) * intervalMs,
    );
    const windowStart = new Date(windowEnd.getTime() - windowMs);
    const result = await this.store.reconcileBusinessEventsToTraces({
      windowStart,
      windowEnd,
    });
    const detection = await check({
      target: result,
      strategy: 'detect',
      evaluate: (target) => [
        ...(target.missingTraceCount > 0
          ? [{ code: 'missing_trace' as const, count: target.missingTraceCount }]
          : []),
        ...(target.orphanTraceCount > 0
          ? [{ code: 'orphan_trace' as const, count: target.orphanTraceCount }]
          : []),
        ...(target.undeliveredEventCount > 0
          ? [
              {
                code: 'undelivered_event' as const,
                count: target.undeliveredEventCount,
              },
            ]
          : []),
      ],
      onViolation: (violation) => this.options.onViolation?.(violation),
    });
    return { ...result, detection };
  }
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}
