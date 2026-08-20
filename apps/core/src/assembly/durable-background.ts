import type { AdminConfigRepository } from '../p1/admin-config/foundation-module.js';
import { langfuseSenderFromEnv } from '../p1/harness/langfuse-sender.js';
import {
  HarnessObservabilityReconciler,
  shouldPublishObservabilityDeliverySnapshot,
  type HarnessObservabilityReconciliationStore,
} from '../p1/harness/observability-reconciliation.js';
import {
  HarnessLangfuseOutboxWorker,
  type HarnessLangfuseOutboxStore,
} from '../p1/harness/outbox-worker.js';
import {
  DurableBackgroundSupervisor,
  MemoryExclusiveLease,
} from '../runtime-truth/background-ownership.js';

export function startWorkerDurableBackground(input: {
  adminConfig?: Pick<AdminConfigRepository, 'get'>;
  env: NodeJS.ProcessEnv;
  harnessObservabilityStore: HarnessLangfuseOutboxStore &
    HarnessObservabilityReconciliationStore;
  ownerId: string;
}): { stop(): void } {
  const promptOutboxWorker = new HarnessLangfuseOutboxWorker(
    input.harnessObservabilityStore,
    langfuseSenderFromEnv(input.env),
    { config: input.adminConfig },
  );
  const observabilityReconciler = new HarnessObservabilityReconciler(
    input.harnessObservabilityStore,
    {
      onDeliverySnapshot(snapshot) {
        if (!shouldPublishObservabilityDeliverySnapshot(snapshot)) return;
        console.log('Harness observability delivery snapshot.', snapshot);
      },
      onViolation(violation) {
        console.warn('Harness observability drift detected.', violation);
      },
    },
  );
  const supervisor = new DurableBackgroundSupervisor({
    env: input.env,
    lease: new MemoryExclusiveLease(),
    loops: [
      {
        id: 'langfuse-outbox',
        pollMs: Number(input.env.HARNESS_COMPENSATION_POLL_MS ?? 1_000),
        async runOnce() {
          try {
            await promptOutboxWorker.runOnce();
          } catch (error) {
            console.error('Langfuse prompt outbox iteration failed.', error);
          }
        },
      },
      {
        id: 'observability-reconcile',
        pollMs: 5 * 60_000,
        async runOnce() {
          try {
            await observabilityReconciler.runOnce();
          } catch (error) {
            console.error('Harness observability reconciliation failed.', error);
          }
        },
      },
    ],
    ownerId: input.ownerId,
    processRole: 'worker',
  });
  supervisor.start();
  return {
    stop() {
      supervisor.stop();
    },
  };
}
