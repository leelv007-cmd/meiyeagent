import type { Pool } from 'pg';

import type { ProductNotifier } from '../../product/notifier.js';
import {
  DailyRecommendationDeliveryPort,
  type DailyRecommendationCandidateReader,
} from './delivery-port.js';
import {
  PostgresWorkspaceOwnerMembershipReader,
  ProductionDueDeliveryEligibility,
} from './eligibility.js';
import { DueDeliveryScannerRunner } from './scanner-job.js';
import {
  DueDeliveryWorker,
  type DueDeliveryRepository,
} from './worker.js';

export interface DueDeliveryPollerDecision {
  pollMs: number;
  reason: string;
  start: boolean;
}

export interface DueDeliveryPurgeStore {
  purgeExpired(
    now: Date,
    limit: number,
  ): Promise<{ deletedItems: number; deletedRuns: number }>;
}

/**
 * In-process ticker for the same DueDeliveryWorker the pg-boss cron invokes.
 * Worker always runs it so dashboard dues are not gated on the next minute.
 * e2e API also runs it: Playwright Core is the consumer-reachable process, and
 * APP_ENV=e2e otherwise skips durable pollers (ARCH-05).
 */
export function shouldStartDueDeliveryPoller(input: {
  env?: NodeJS.ProcessEnv;
  processRole: 'api' | 'worker';
}): DueDeliveryPollerDecision {
  const env = input.env ?? {};
  const configured = Number(env.DUE_DELIVERY_POLL_MS ?? 1_000);
  const pollMs = Number.isFinite(configured) && configured >= 1 ? configured : 1_000;
  if (input.processRole === 'worker') {
    return {
      pollMs,
      reason: 'worker-owns-due-delivery-poller',
      start: true,
    };
  }
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase();
  if (appEnv === 'e2e') {
    return {
      pollMs,
      reason: 'e2e-api-runs-worker-due-delivery-poller',
      start: true,
    };
  }
  if (appEnv === 'production' || appEnv === 'staging') {
    return {
      pollMs,
      reason: 'api-must-not-run-due-delivery-poller',
      start: false,
    };
  }
  if (env.CORE_DURABLE_POLLER_FALLBACK === '1') {
    return {
      pollMs: pollMs * 10,
      reason: 'preview-dev-throttled-fallback',
      start: true,
    };
  }
  return {
    pollMs,
    reason: 'api-boot-role-skips-due-delivery-poller',
    start: false,
  };
}

export function createProductionDueDeliveryScanner(input: {
  candidates: DailyRecommendationCandidateReader;
  notifier?: Pick<ProductNotifier, 'notify'>;
  pool: Pick<Pool, 'query'>;
  repository: DueDeliveryRepository & DueDeliveryPurgeStore;
}): DueDeliveryScannerRunner {
  return new DueDeliveryScannerRunner(
    new DueDeliveryWorker(
      input.repository,
      new ProductionDueDeliveryEligibility(
        new PostgresWorkspaceOwnerMembershipReader(input.pool),
      ),
      new DailyRecommendationDeliveryPort(
        input.candidates,
        undefined,
        input.notifier,
      ),
    ),
    input.repository,
  );
}

export function startDueDeliveryPoller(input: {
  clock?: () => Date;
  env?: NodeJS.ProcessEnv;
  processRole: 'api' | 'worker';
  scanner: Pick<DueDeliveryScannerRunner, 'run'>;
  workerId: string;
}): { start: boolean; stop(): void } {
  const decision = shouldStartDueDeliveryPoller({
    env: input.env,
    processRole: input.processRole,
  });
  if (!decision.start) {
    return {
      start: false,
      stop() {},
    };
  }
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await input.scanner.run(
        input.workerId,
        (input.clock?.() ?? new Date()).toISOString(),
      );
    } catch (error) {
      console.error('Due delivery scanner iteration failed.', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), decision.pollMs);
  timer.unref?.();
  void tick();
  return {
    start: true,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
