/**
 * ARCH-05 / R-P1-18: durable background ownership.
 *
 * Pollers, outbox drains, expiry, and reconcile loops belong on the worker
 * process (or a Web scheduled trigger). Ordinary API/Web request drain is not
 * an owner. Inventory is the catalog below; gaps are explicit.
 */

export type BackgroundProcessRole = 'api' | 'worker' | 'web';

export type DurableBackgroundKind =
  | 'outbox'
  | 'recovery'
  | 'expiry'
  | 'reconcile'
  | 'sweep'
  | 'job-consumer';

export type DurableBackgroundTransport =
  | 'worker-poller'
  | 'pg-boss-recurring'
  | 'pg-boss-handler'
  | 'web-scheduled'
  | 'api-poller-gap';

export interface DurableBackgroundOwner {
  currentOwner: BackgroundProcessRole;
  gap?: string;
  id: string;
  kind: DurableBackgroundKind;
  lease: 'claim-token' | 'pg-boss' | 'in-process' | 'none';
  requiredOwner: BackgroundProcessRole;
  sources: readonly string[];
  transport: DurableBackgroundTransport;
}

/** Single inventory of outbox / recovery / expiry / reconcile owners. */
export const DURABLE_BACKGROUND_CATALOG: readonly DurableBackgroundOwner[] = [
  {
    id: 'langfuse-outbox',
    kind: 'outbox',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'worker-poller',
    lease: 'claim-token',
    sources: [
      'apps/core/src/p1/harness/outbox-worker.ts',
      'apps/core/src/assembly/durable-background.ts',
      'apps/core/src/assembly/worker-runtime.ts',
    ],
  },
  {
    id: 'observability-reconcile',
    kind: 'reconcile',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'worker-poller',
    lease: 'in-process',
    sources: [
      'apps/core/src/p1/harness/observability-reconciliation.ts',
      'apps/core/src/assembly/durable-background.ts',
      'apps/core/src/assembly/worker-runtime.ts',
    ],
  },
  {
    id: 'plan-event-outbox',
    kind: 'outbox',
    requiredOwner: 'worker',
    currentOwner: 'api',
    transport: 'api-poller-gap',
    lease: 'claim-token',
    gap: 'api-live-semantic-hub',
    sources: [
      'apps/core/src/p1/agent-session/plan-event-outbox-dispatcher.ts',
      'apps/core/src/assembly/api-runtime.ts',
    ],
  },
  {
    id: 'fact-expiration-invalidation',
    kind: 'expiry',
    requiredOwner: 'worker',
    currentOwner: 'api',
    transport: 'api-poller-gap',
    lease: 'claim-token',
    gap: 'worker-missing-invalidation-graph',
    sources: [
      'apps/core/src/p1/operations/expired-fact-invalidation-outbox.ts',
      'apps/core/src/assembly/api-runtime.ts',
    ],
  },
  {
    id: 'campaign-paid-work-recovery',
    kind: 'recovery',
    requiredOwner: 'worker',
    currentOwner: 'api',
    transport: 'api-poller-gap',
    lease: 'in-process',
    gap: 'worker-missing-composer-graph',
    sources: ['apps/core/src/assembly/api-runtime.ts'],
  },
  {
    id: 'pending-start-recovery',
    kind: 'recovery',
    requiredOwner: 'worker',
    currentOwner: 'api',
    transport: 'api-poller-gap',
    lease: 'in-process',
    gap: 'worker-missing-composer-graph',
    sources: ['apps/core/src/assembly/api-runtime.ts'],
  },
  {
    id: 'harness-compensation',
    kind: 'sweep',
    requiredOwner: 'worker',
    currentOwner: 'api',
    transport: 'api-poller-gap',
    lease: 'in-process',
    gap: 'worker-missing-harness-recovery-graph',
    sources: ['apps/core/src/assembly/api-runtime.ts'],
  },
  {
    id: 'confirmation-expiry',
    kind: 'expiry',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-recurring',
    lease: 'pg-boss',
    sources: [
      'apps/core/src/p1/agent-session/execution-confirmation-expiry-job.ts',
      'apps/core/src/assembly/worker-runtime.ts',
    ],
  },
  {
    id: 'credit-subscription-cycle',
    kind: 'expiry',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-recurring',
    lease: 'pg-boss',
    sources: [
      'apps/core/src/p1/credit-billing/credit-subscription-scheduler.ts',
      'apps/core/src/assembly/worker-runtime.ts',
    ],
  },
  {
    id: 'credit-subscription-reconciliation',
    kind: 'reconcile',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-recurring',
    lease: 'pg-boss',
    sources: [
      'apps/core/src/p1/credit-billing/credit-subscription-scheduler.ts',
      'apps/core/src/assembly/worker-runtime.ts',
    ],
  },
  {
    id: 'redemption-expiry',
    kind: 'expiry',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-recurring',
    lease: 'pg-boss',
    sources: [
      'apps/core/src/p1/foundation/redemption-expiry-scheduler.ts',
      'apps/core/src/assembly/worker-runtime.ts',
    ],
  },
  {
    id: 'due-delivery-scanner',
    kind: 'sweep',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-recurring',
    lease: 'pg-boss',
    sources: [
      'apps/core/src/p1/due-delivery/scanner-job.ts',
      'apps/core/src/p1/due-delivery/poller.ts',
      'apps/core/src/assembly/worker-runtime.ts',
      'apps/core/src/assembly/api-runtime.ts',
    ],
  },
  {
    id: 's3-asset-registration-cleanup',
    kind: 'sweep',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-recurring',
    lease: 'pg-boss',
    sources: [
      'apps/core/src/p1/model-supply/owned-asset-registration-cleanup.ts',
      'apps/core/src/assembly/worker-runtime.ts',
    ],
  },
  {
    id: 'parse-batch-jobs',
    kind: 'job-consumer',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-handler',
    lease: 'pg-boss',
    sources: ['apps/core/src/assembly/worker-runtime.ts'],
  },
  {
    id: 'media-generation-jobs',
    kind: 'job-consumer',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-handler',
    lease: 'pg-boss',
    sources: ['apps/core/src/assembly/worker-runtime.ts'],
  },
  {
    id: 'operations-trigger-jobs',
    kind: 'job-consumer',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-handler',
    lease: 'pg-boss',
    sources: ['apps/core/src/assembly/worker-runtime.ts'],
  },
  {
    id: 'feishu-lifecycle-jobs',
    kind: 'job-consumer',
    requiredOwner: 'worker',
    currentOwner: 'worker',
    transport: 'pg-boss-handler',
    lease: 'pg-boss',
    sources: ['apps/core/src/assembly/worker-runtime.ts'],
  },
  {
    id: 'payment-webhook-settlement-outbox',
    kind: 'outbox',
    requiredOwner: 'web',
    currentOwner: 'web',
    transport: 'web-scheduled',
    lease: 'claim-token',
    sources: [
      'mkfast-template-main/src/payment/postgres-webhook-settlement.ts',
      'mkfast-template-main/src/payment/webhook-settlement.ts',
      'mkfast-template-main/src/server.ts',
    ],
  },
  {
    id: 'payment-refund-review-alert-outbox',
    kind: 'outbox',
    requiredOwner: 'web',
    currentOwner: 'web',
    transport: 'web-scheduled',
    lease: 'claim-token',
    sources: [
      'mkfast-template-main/src/payment/payment-refund-alerts.ts',
      'mkfast-template-main/src/server.ts',
    ],
  },
  {
    id: 'storage-object-outbox',
    kind: 'outbox',
    requiredOwner: 'web',
    currentOwner: 'web',
    transport: 'web-scheduled',
    lease: 'claim-token',
    sources: [
      'mkfast-template-main/src/storage/object-outbox.ts',
      'mkfast-template-main/src/server.ts',
    ],
  },
];

export interface DurablePollerStartDecision {
  pollMsMultiplier: number;
  reason: string;
  start: boolean;
}

export function shouldStartDurablePollers(input: {
  env?: NodeJS.ProcessEnv;
  processRole: 'api' | 'worker';
}): DurablePollerStartDecision {
  if (input.processRole === 'worker') {
    return {
      pollMsMultiplier: 1,
      reason: 'worker-owns-durable-pollers',
      start: true,
    };
  }
  const env = input.env ?? {};
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase();
  if (appEnv === 'production' || appEnv === 'staging') {
    return {
      pollMsMultiplier: 1,
      reason: 'api-must-not-run-durable-pollers',
      start: false,
    };
  }
  if (env.CORE_DURABLE_POLLER_FALLBACK === '1') {
    return {
      pollMsMultiplier: 10,
      reason: 'preview-dev-throttled-fallback',
      start: true,
    };
  }
  return {
    pollMsMultiplier: 1,
    reason: 'api-boot-role-skips-durable-pollers',
    start: false,
  };
}

export interface ExclusiveLease {
  release(loopId: string, ownerId: string): Promise<void>;
  tryAcquire(loopId: string, ownerId: string): Promise<boolean>;
}

export class MemoryExclusiveLease implements ExclusiveLease {
  private readonly holds = new Map<
    string,
    { expiresAtMs: number; ownerId: string }
  >();

  constructor(
    private readonly options: {
      clock?: () => Date;
      ttlMs?: number;
    } = {},
  ) {}

  async tryAcquire(loopId: string, ownerId: string) {
    const now = (this.options.clock?.() ?? new Date()).getTime();
    const ttlMs = this.options.ttlMs ?? 15_000;
    const current = this.holds.get(loopId);
    if (
      current &&
      current.ownerId !== ownerId &&
      current.expiresAtMs > now
    ) {
      return false;
    }
    this.holds.set(loopId, { expiresAtMs: now + ttlMs, ownerId });
    return true;
  }

  async release(loopId: string, ownerId: string) {
    const current = this.holds.get(loopId);
    if (current?.ownerId === ownerId) this.holds.delete(loopId);
  }
}

export interface DurableLoop {
  id: string;
  pollMs?: number;
  runOnce: () => Promise<void>;
}

export interface DurableBackgroundTickResult {
  ran: string[];
  skipped: string[];
}

export class DurableBackgroundSupervisor {
  private readonly lease: ExclusiveLease;
  private readonly loops: readonly DurableLoop[];
  private readonly ownerId: string;
  private readonly policy: DurablePollerStartDecision;
  private readonly running = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private allowed = false;

  constructor(options: {
    env?: NodeJS.ProcessEnv;
    lease?: ExclusiveLease;
    loops: readonly DurableLoop[];
    ownerId: string;
    processRole: 'api' | 'worker';
  }) {
    this.lease = options.lease ?? new MemoryExclusiveLease();
    this.loops = options.loops;
    this.ownerId = options.ownerId;
    this.policy = shouldStartDurablePollers({
      env: options.env,
      processRole: options.processRole,
    });
  }

  get startDecision() {
    return this.policy;
  }

  start() {
    if (!this.policy.start) return false;
    this.allowed = true;
    for (const loop of this.loops) {
      if (this.timers.has(loop.id)) continue;
      const timer = setInterval(
        () => void this.tickLoop(loop),
        loop.pollMs ?? 1_000,
      );
      timer.unref?.();
      this.timers.set(loop.id, timer);
      void this.tickLoop(loop);
    }
    return true;
  }

  stop() {
    this.allowed = false;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    for (const loop of this.loops) {
      void this.lease.release(loop.id, this.ownerId);
    }
  }

  async tickAll(): Promise<DurableBackgroundTickResult> {
    const ran: string[] = [];
    const skipped: string[] = [];
    if (!this.policy.start) {
      return { ran, skipped: this.loops.map((loop) => loop.id) };
    }
    this.allowed = true;
    for (const loop of this.loops) {
      const ranLoop = await this.tickLoop(loop);
      if (ranLoop) ran.push(loop.id);
      else skipped.push(loop.id);
    }
    return { ran, skipped };
  }

  private async tickLoop(loop: DurableLoop) {
    if (!this.allowed && !this.policy.start) return false;
    if (!this.policy.start) return false;
    if (this.running.has(loop.id)) return false;
    if (!(await this.lease.tryAcquire(loop.id, this.ownerId))) return false;
    this.running.add(loop.id);
    try {
      await loop.runOnce();
      return true;
    } finally {
      this.running.delete(loop.id);
      await this.lease.release(loop.id, this.ownerId);
    }
  }
}

export interface ExclusiveOutboxClaim<T> {
  claimToken: string;
  item: T;
}

export interface ExclusiveOutboxInbox<T> {
  claimNext(ownerId: string): Promise<ExclusiveOutboxClaim<T> | null>;
  complete(claim: ExclusiveOutboxClaim<T>): Promise<void>;
}

/** Fake SKIP LOCKED outbox: one claim owner at a time per item. */
export class MemoryExclusiveOutboxInbox<T> implements ExclusiveOutboxInbox<T> {
  private chain = Promise.resolve();
  private readonly items: Array<{
    claimToken: string | null;
    item: T;
    status: 'pending' | 'processing' | 'completed';
  }>;

  constructor(items: readonly T[]) {
    this.items = items.map((item) => ({
      claimToken: null,
      item,
      status: 'pending' as const,
    }));
  }

  claimNext(ownerId: string) {
    const run = this.chain.then(() => this.claimLocked(ownerId));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async complete(claim: ExclusiveOutboxClaim<T>) {
    const row = this.items.find(
      (entry) =>
        entry.status === 'processing' && entry.claimToken === claim.claimToken,
    );
    if (!row) throw new Error('Payment outbox claim was lost.');
    row.status = 'completed';
    row.claimToken = null;
  }

  private claimLocked(ownerId: string): ExclusiveOutboxClaim<T> | null {
    const row = this.items.find((entry) => entry.status === 'pending');
    if (!row) return null;
    row.status = 'processing';
    row.claimToken = `lease:${ownerId}:${String(this.items.indexOf(row))}`;
    return { claimToken: row.claimToken, item: row.item };
  }
}

export async function drainExclusiveOutbox<T>(
  ownerId: string,
  inbox: ExclusiveOutboxInbox<T>,
  processItem: (item: T, ownerId: string) => Promise<void>,
  limit = 25,
) {
  let completed = 0;
  for (let index = 0; index < limit; index += 1) {
    const claim = await inbox.claimNext(ownerId);
    if (!claim) break;
    await processItem(claim.item, ownerId);
    await inbox.complete(claim);
    completed += 1;
  }
  return { completed };
}
