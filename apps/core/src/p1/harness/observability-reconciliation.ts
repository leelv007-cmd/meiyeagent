import type { ObservabilityDropEvent } from '@meiye/contracts';

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
  code:
    | 'missing_trace'
    | 'orphan_trace'
    | 'undelivered_event'
    | 'delivery_drop';
  count: number;
}

export interface HarnessObservabilityReconciliationStore {
  completeObservabilityReconciliationWindow(input: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<void>;
  readObservabilityReconciliationBoundary(input: {
    intervalMs: number;
  }): Promise<Date>;
  readObservabilityReconciliationCursor(): Promise<Date | null>;
  readObservabilityDeliveryHealth(input: { now: Date }): Promise<{
    lastSuccessAt: Date | null;
    oldestQueuedAt: Date | null;
    queueAgeMs: number | null;
  }>;
  readObservabilityDropSummary(input: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<readonly ObservabilityDropEvent[]>;
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
      onDeliverySnapshot?: (snapshot: {
        deliveryHealth: {
          lastSuccessAt: Date | null;
          oldestQueuedAt: Date | null;
          queueAgeMs: number | null;
        };
        dropSummary: readonly ObservabilityDropEvent[];
      }) => void;
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
    const [windowEnd, cursor] = await Promise.all([
      this.store.readObservabilityReconciliationBoundary({ intervalMs }),
      this.store.readObservabilityReconciliationCursor(),
    ]);
    if (cursor && cursor.getTime() >= windowEnd.getTime()) {
      return null;
    }
    const windowStart = cursor ?? new Date(windowEnd.getTime() - windowMs);
    const [deliveryHealth, dropSummary] = await Promise.all([
      this.store.readObservabilityDeliveryHealth({ now: windowEnd }),
      this.store.readObservabilityDropSummary({ windowStart, windowEnd }),
    ]);
    const result = await this.store.reconcileBusinessEventsToTraces({
      windowStart,
      windowEnd,
    });
    const deliveryDropCount = dropSummary.reduce(
      (count, drop) => count + drop.count,
      0,
    );
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
        ...(deliveryDropCount > 0
          ? [{ code: 'delivery_drop' as const, count: deliveryDropCount }]
          : []),
      ],
      onViolation: (violation) => this.options.onViolation?.(violation),
    });
    this.options.onDeliverySnapshot?.({ deliveryHealth, dropSummary });
    await this.store.completeObservabilityReconciliationWindow({
      windowStart,
      windowEnd,
    });
    return { ...result, deliveryHealth, dropSummary, detection };
  }
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}
