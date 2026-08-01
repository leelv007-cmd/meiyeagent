import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import { P1DomainError } from '../foundation/domain.js';
import type { JobRuntimeHandler, RecurringJobInput } from '../job-runtime/index.js';
import type { CreditPlanId, CreditPlanOffer } from './credit-plan-catalog.js';
import type { CreditGrantLot, GrantCreditsInput } from './credit-ledger.js';

export const CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND =
  'credit-subscription.grant-cycles';
export const CREDIT_SUBSCRIPTION_CYCLE_SCHEDULE_ID =
  'credit-subscription.grant-cycles.v1';
export const CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND =
  'credit-subscription.reconcile-grants';
export const CREDIT_SUBSCRIPTION_RECONCILIATION_SCHEDULE_ID =
  'credit-subscription.reconcile-grants.v1';
export const CREDIT_SUBSCRIPTION_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000;

export type CreditSubscriptionInterval = 'single_month' | 'monthly' | 'yearly';
export type CreditSubscriptionStatus = 'active' | 'past_due' | 'cancelled';

export interface CreditSubscription {
  id: string;
  workspaceId: string;
  tier: Exclude<CreditPlanId, 'trial'>;
  interval: CreditSubscriptionInterval;
  /** A downgrade or interval change that starts with the next paid cycle. */
  pendingTier: Exclude<CreditPlanId, 'trial'> | null;
  pendingInterval: CreditSubscriptionInterval | null;
  pendingEffectiveCycle: number | null;
  /** Keeps grant keys unique when a provider retains its id across an upgrade. */
  grantCycleOffset: number;
  /** Retains paid-cycle grant identity when a provider replaces its subscription id. */
  grantLineageId: string;
  anchorAt: string;
  /** Number of monthly cycles with a successful payment coverage. */
  paidThroughCycle: number;
  status: CreditSubscriptionStatus;
  pastDueAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditSubscriptionInput {
  id: string;
  workspaceId: string;
  tier: Exclude<CreditPlanId, 'trial'>;
  interval: CreditSubscriptionInterval;
  pendingTier?: Exclude<CreditPlanId, 'trial'> | null;
  pendingInterval?: CreditSubscriptionInterval | null;
  pendingEffectiveCycle?: number | null;
  grantCycleOffset?: number;
  grantLineageId?: string;
  anchorAt: string;
  paidThroughCycle: number;
  status?: CreditSubscriptionStatus;
  pastDueAt?: string | null;
  cancelledAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreditSubscriptionStore {
  get(subscriptionId: string): Promise<CreditSubscription | null>;
  listForWorkspace(workspaceId: string): Promise<CreditSubscription[]>;
  listGrantCandidates(): Promise<CreditSubscription[]>;
  upsert(input: CreditSubscriptionInput): Promise<CreditSubscription>;
  recordPaidCoverage(
    subscriptionId: string,
    paidThroughCycle: number,
    at: string,
  ): Promise<CreditSubscription>;
  recordPaidPeriod(input: {
    subscriptionId: string;
    periodStartsAt: string;
    coverageCycles: number;
    at: string;
  }): Promise<CreditSubscription>;
  recordInitialPaidPeriod(input: {
    subscriptionId: string;
    periodStartsAt: string;
    coverageCycles: number;
    at: string;
  }): Promise<CreditSubscription>;
  latestPaidPeriodStartsAt(subscriptionId: string): Promise<string | null>;
  replaceSubscription(input: {
    sourceSubscriptionId: string;
    targetSubscriptionId: string;
    at: string;
  }): Promise<CreditSubscription>;
  resume(subscriptionId: string, at: string): Promise<CreditSubscription>;
  markPastDue(subscriptionId: string, at: string): Promise<CreditSubscription>;
  cancelPastDue(subscriptionId: string, at: string): Promise<CreditSubscription>;
  cancel(subscriptionId: string, at: string): Promise<CreditSubscription>;
  scheduleChange(input: {
    subscriptionId: string;
    tier: Exclude<CreditPlanId, 'trial'>;
    interval: CreditSubscriptionInterval;
    effectiveCycle: number;
    at: string;
  }): Promise<CreditSubscription>;
  withPaymentEvent(
    input: {
      workspaceId: string;
      paymentEventId: string;
      payloadHash: string;
      createdAt: string;
    },
    operation: (
      subscriptions: CreditSubscriptionStore,
    ) => Promise<CreditSubscription | null>,
  ): Promise<CreditSubscription | null>;
}

export interface CreditSubscriptionAlert {
  code: 'CREDIT_SUBSCRIPTION_GRANT_MISSING';
  workspaceId: string;
  subscriptionId: string;
  cycleIndex: number;
}

export interface CreditSubscriptionAlertPort {
  notify(alert: CreditSubscriptionAlert): Promise<void>;
}

export interface CreditGrantPort {
  grant(input: GrantCreditsInput): CreditGrantLot | Promise<CreditGrantLot>;
  listLots(workspaceId: string): readonly CreditGrantLot[] | Promise<readonly CreditGrantLot[]>;
}

export interface CreditSubscriptionCycle {
  cycleIndex: number;
  startsAt: string;
  endsAt: string;
}

/** Calendar month arithmetic anchored to the original UTC timestamp. */
export function creditSubscriptionCycle(
  anchorAt: string,
  cycleIndex: number,
): CreditSubscriptionCycle {
  if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
    throw new Error('cycleIndex must be a non-negative integer.');
  }
  const anchor = date(anchorAt, 'anchorAt');
  const startsAt = addUtcMonths(anchor, cycleIndex);
  const endsAt = addUtcMonths(anchor, cycleIndex + 1);
  return {
    cycleIndex,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

export function dueCreditSubscriptionCycles(
  subscription: CreditSubscription,
  asOf: string,
) {
  const now = date(asOf, 'asOf').getTime();
  const cycles: CreditSubscriptionCycle[] = [];
  for (let cycleIndex = 0; cycleIndex < subscription.paidThroughCycle; cycleIndex += 1) {
    const cycle = creditSubscriptionCycle(subscription.anchorAt, cycleIndex);
    if (Date.parse(cycle.startsAt) > now) break;
    cycles.push(cycle);
  }
  return cycles;
}

export function currentCreditSubscriptionCycle(
  subscription: CreditSubscription,
  asOf: string,
): CreditSubscriptionCycle | null {
  const now = date(asOf, 'asOf').getTime();
  const current = dueCreditSubscriptionCycles(subscription, asOf).at(-1);
  return current && now < Date.parse(current.endsAt) ? current : null;
}

export function creditSubscriptionTierForCycle(
  subscription: CreditSubscription,
  cycleIndex: number,
) {
  if (
    subscription.pendingTier &&
    subscription.pendingEffectiveCycle !== null &&
    cycleIndex >= subscription.pendingEffectiveCycle
  ) {
    return subscription.pendingTier;
  }
  return subscription.tier;
}

export function creditSubscriptionIntervalForCycle(
  subscription: CreditSubscription,
  cycleIndex: number,
) {
  if (
    subscription.pendingInterval &&
    subscription.pendingEffectiveCycle !== null &&
    cycleIndex >= subscription.pendingEffectiveCycle
  ) {
    return subscription.pendingInterval;
  }
  return subscription.interval;
}

export class CreditSubscriptionCycleScheduler {
  constructor(
    private readonly subscriptions: CreditSubscriptionStore,
    private readonly ledger: CreditGrantPort,
    private readonly options: {
      alerts?: CreditSubscriptionAlertPort;
      planFor(tier: CreditSubscription['tier']):
        | Pick<CreditPlanOffer, 'credits'>
        | Promise<Pick<CreditPlanOffer, 'credits'>>;
    },
  ) {}

  async run(asOf = new Date().toISOString()) {
    const now = date(asOf, 'asOf');
    let cancelledSubscriptions = 0;
    let grantedCycles = 0;
    for (const subscription of await this.subscriptions.listGrantCandidates()) {
      if (subscription.status === 'past_due') {
        if (
          subscription.pastDueAt &&
          now.getTime() >=
            date(subscription.pastDueAt, 'pastDueAt').getTime() +
              CREDIT_SUBSCRIPTION_GRACE_PERIOD_MS
        ) {
          await this.subscriptions.cancelPastDue(subscription.id, asOf);
          cancelledSubscriptions += 1;
        }
        continue;
      }
      if (subscription.status !== 'active') continue;
      const existingGrants = new Set(
        (await this.ledger.listLots(subscription.workspaceId)).map(
          (lot) => lot.grantIdempotencyKey,
        ),
      );
      for (const cycle of dueCreditSubscriptionCycles(subscription, asOf)) {
        const tier = creditSubscriptionTierForCycle(subscription, cycle.cycleIndex);
        const plan = await this.options.planFor(tier);
        if (!Number.isSafeInteger(plan.credits) || plan.credits <= 0) {
          throw new Error(
            `Credit plan ${tier} must provide a positive integer credit amount.`,
          );
        }
        const grantIdempotencyKey = creditSubscriptionGrantKey(
          subscription.grantLineageId,
          subscription.grantCycleOffset + cycle.cycleIndex,
        );
        if (existingGrants.has(grantIdempotencyKey)) continue;
        await this.ledger.grant({
          actorId: 'system-credit-subscription-scheduler',
          correlationId: `credit-subscription-cycle:${subscription.id}:${cycle.cycleIndex}`,
          createdAt: cycle.startsAt,
          credits: plan.credits,
          expirationDate: cycle.endsAt,
          grantIdempotencyKey,
          id: `subscription:${subscription.grantLineageId}:${subscription.grantCycleOffset + cycle.cycleIndex}`,
          sourceRef: subscription.grantLineageId,
          transactionType: 'SUBSCRIPTION_RENEWAL',
          workspaceId: subscription.workspaceId,
        });
        existingGrants.add(grantIdempotencyKey);
        grantedCycles += 1;
      }
    }
    return { cancelledSubscriptions, grantedCycles };
  }

  async reconcile(asOf = new Date().toISOString()) {
    let alertedCycles = 0;
    let checkedCycles = 0;
    for (const subscription of await this.subscriptions.listGrantCandidates()) {
      const keys = new Set(
        (await this.ledger.listLots(subscription.workspaceId)).map(
          (lot) => lot.grantIdempotencyKey,
        ),
      );
      for (const cycle of dueCreditSubscriptionCycles(subscription, asOf)) {
        checkedCycles += 1;
        if (
          keys.has(
            creditSubscriptionGrantKey(
              subscription.grantLineageId,
              subscription.grantCycleOffset + cycle.cycleIndex,
            ),
          )
        ) {
          continue;
        }
        alertedCycles += 1;
        await this.options.alerts?.notify({
          code: 'CREDIT_SUBSCRIPTION_GRANT_MISSING',
          cycleIndex: cycle.cycleIndex,
          subscriptionId: subscription.id,
          workspaceId: subscription.workspaceId,
        });
      }
    }
    return { alertedCycles, checkedCycles };
  }
}

export function creditSubscriptionGrantKey(
  subscriptionId: string,
  cycleIndex: number,
) {
  return `grant:sub:${subscriptionId}:${cycleIndex}`;
}

export function createCreditSubscriptionCycleJobHandler(
  scheduler: Pick<CreditSubscriptionCycleScheduler, 'run'>,
): JobRuntimeHandler {
  return async (envelope, context) => {
    if (
      envelope.kind !== CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND ||
      envelope.workspaceId !== '__system__'
    ) {
      return { output: { code: 'UNSUPPORTED_JOB_KIND' }, status: 'dead_letter' };
    }
    try {
      return {
        output: await scheduler.run(context.claimedAt),
        status: 'completed',
      };
    } catch (error) {
      return {
        output: {
          code: 'CREDIT_SUBSCRIPTION_CYCLE_GRANT_FAILED',
          message: error instanceof Error ? error.message : 'Unknown cycle grant failure.',
        },
        status: 'retry',
      };
    }
  };
}

export function createCreditSubscriptionReconciliationJobHandler(
  scheduler: Pick<CreditSubscriptionCycleScheduler, 'reconcile'>,
): JobRuntimeHandler {
  return async (envelope, context) => {
    if (
      envelope.kind !== CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND ||
      envelope.workspaceId !== '__system__'
    ) {
      return { output: { code: 'UNSUPPORTED_JOB_KIND' }, status: 'dead_letter' };
    }
    try {
      return {
        output: await scheduler.reconcile(context.claimedAt),
        status: 'completed',
      };
    } catch (error) {
      return {
        output: {
          code: 'CREDIT_SUBSCRIPTION_GRANT_RECONCILIATION_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown grant reconciliation failure.',
        },
        status: 'retry',
      };
    }
  };
}

export async function registerCreditSubscriptionSchedules(
  runtime: { scheduleRecurring(input: RecurringJobInput): Promise<void> },
  options: { cycleCron?: string; reconciliationCron?: string; timezone?: string } = {},
) {
  const timezone = options.timezone ?? 'UTC';
  await runtime.scheduleRecurring({
    cron: options.cycleCron ?? '*/5 * * * *',
    kind: CREDIT_SUBSCRIPTION_CYCLE_JOB_KIND,
    payload: {},
    scheduleId: CREDIT_SUBSCRIPTION_CYCLE_SCHEDULE_ID,
    timezone,
    workspaceId: '__system__',
  });
  await runtime.scheduleRecurring({
    cron: options.reconciliationCron ?? '17 0 * * *',
    kind: CREDIT_SUBSCRIPTION_RECONCILIATION_JOB_KIND,
    payload: {},
    scheduleId: CREDIT_SUBSCRIPTION_RECONCILIATION_SCHEDULE_ID,
    timezone,
    workspaceId: '__system__',
  });
}

export class MemoryCreditSubscriptionStore implements CreditSubscriptionStore {
  private readonly subscriptions = new Map<string, CreditSubscription>();
  private readonly paymentEvents = new Map<
    string,
    { payloadHash: string; result: CreditSubscription | null }
  >();
  private paymentEventTail: Promise<void> = Promise.resolve();
  private readonly paidPeriods = new Map<string, number>();

  async get(subscriptionId: string) {
    const subscription = this.subscriptions.get(subscriptionId);
    return subscription ? structuredClone(subscription) : null;
  }

  async listForWorkspace(workspaceId: string) {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((subscription) => structuredClone(subscription));
  }

  async listGrantCandidates() {
    return [...this.subscriptions.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((subscription) => structuredClone(subscription));
  }

  async upsert(input: CreditSubscriptionInput) {
    assertSubscriptionInput(input);
    const existing = this.subscriptions.get(input.id);
    const now = input.updatedAt ?? input.anchorAt;
    const subscription: CreditSubscription = {
      id: input.id,
      workspaceId: input.workspaceId,
      tier: input.tier,
      interval: input.interval,
      pendingTier: input.pendingTier ?? null,
      pendingInterval: input.pendingInterval ?? null,
      pendingEffectiveCycle: input.pendingEffectiveCycle ?? null,
      grantCycleOffset: input.grantCycleOffset ?? 0,
      grantLineageId:
        input.grantLineageId ?? existing?.grantLineageId ?? input.id,
      anchorAt: iso(input.anchorAt),
      paidThroughCycle: input.paidThroughCycle,
      status: input.status ?? 'active',
      pastDueAt: input.pastDueAt ? iso(input.pastDueAt) : null,
      cancelledAt: input.cancelledAt ? iso(input.cancelledAt) : null,
      createdAt: existing?.createdAt ?? iso(input.createdAt ?? input.anchorAt),
      updatedAt: iso(now),
    };
    this.subscriptions.set(subscription.id, subscription);
    return structuredClone(subscription);
  }

  async recordPaidCoverage(subscriptionId: string, paidThroughCycle: number, at: string) {
    const subscription = this.require(subscriptionId);
    assertPaidThroughCycle(paidThroughCycle);
    if (subscription.status === 'cancelled') {
      throw new Error('Cancelled credit subscriptions cannot receive renewal coverage.');
    }
    subscription.paidThroughCycle = Math.max(
      subscription.paidThroughCycle,
      paidThroughCycle,
    );
    subscription.status = 'active';
    subscription.pastDueAt = null;
    subscription.updatedAt = iso(at);
    return structuredClone(subscription);
  }

  async recordPaidPeriod(input: {
    subscriptionId: string;
    periodStartsAt: string;
    coverageCycles: number;
    at: string;
  }) {
    const subscription = this.require(input.subscriptionId);
    const periodStartsAt = iso(input.periodStartsAt);
    const at = iso(input.at);
    assertCoverageCycles(input.coverageCycles);
    if (subscription.status === 'cancelled') {
      throw new Error('Cancelled credit subscriptions cannot receive renewal coverage.');
    }
    const key = `${input.subscriptionId}\u0000${periodStartsAt}`;
    const existingCoverage = this.paidPeriods.get(key);
    if (existingCoverage !== undefined) {
      if (existingCoverage !== input.coverageCycles) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Credit subscription billing period has different coverage facts.',
        );
      }
      return this.recordPaidCoverage(
        input.subscriptionId,
        subscription.paidThroughCycle,
        at,
      );
    }
    const latest = await this.latestPaidPeriodStartsAt(input.subscriptionId);
    if (
      periodStartsAt > at ||
      (latest !== null && periodStartsAt < latest)
    ) {
      return structuredClone(subscription);
    }
    this.paidPeriods.set(key, input.coverageCycles);
    return this.recordPaidCoverage(
      input.subscriptionId,
      subscription.paidThroughCycle + input.coverageCycles,
      at,
    );
  }

  async recordInitialPaidPeriod(input: {
    subscriptionId: string;
    periodStartsAt: string;
    coverageCycles: number;
    at: string;
  }) {
    const subscription = this.require(input.subscriptionId);
    const periodStartsAt = iso(input.periodStartsAt);
    assertCoverageCycles(input.coverageCycles);
    const key = `${input.subscriptionId}\u0000${periodStartsAt}`;
    const existingCoverage = this.paidPeriods.get(key);
    if (
      existingCoverage !== undefined &&
      existingCoverage !== input.coverageCycles
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Credit subscription billing period has different coverage facts.',
      );
    }
    this.paidPeriods.set(key, input.coverageCycles);
    return structuredClone(subscription);
  }

  async latestPaidPeriodStartsAt(subscriptionId: string) {
    const prefix = `${subscriptionId}\u0000`;
    return [...this.paidPeriods.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort()
      .at(-1) ?? null;
  }

  async replaceSubscription(input: {
    sourceSubscriptionId: string;
    targetSubscriptionId: string;
    at: string;
  }) {
    const source = this.require(input.sourceSubscriptionId);
    if (this.subscriptions.has(input.targetSubscriptionId)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Credit subscription ${input.targetSubscriptionId} already exists.`,
      );
    }
    const at = iso(input.at);
    source.status = 'cancelled';
    source.pastDueAt = null;
    source.cancelledAt = at;
    source.updatedAt = at;
    const replacement: CreditSubscription = {
      ...structuredClone(source),
      id: input.targetSubscriptionId,
      status: 'active',
      cancelledAt: null,
      updatedAt: at,
    };
    this.subscriptions.set(replacement.id, replacement);
    const sourcePrefix = `${input.sourceSubscriptionId}\u0000`;
    for (const [key, coverage] of this.paidPeriods) {
      if (!key.startsWith(sourcePrefix)) continue;
      this.paidPeriods.set(
        `${input.targetSubscriptionId}\u0000${key.slice(sourcePrefix.length)}`,
        coverage,
      );
    }
    return structuredClone(replacement);
  }

  async resume(subscriptionId: string, at: string) {
    const subscription = this.require(subscriptionId);
    if (subscription.status === 'cancelled') {
      throw new Error('Cancelled credit subscriptions cannot resume.');
    }
    subscription.status = 'active';
    subscription.pastDueAt = null;
    subscription.updatedAt = iso(at);
    return structuredClone(subscription);
  }

  async markPastDue(subscriptionId: string, at: string) {
    const subscription = this.require(subscriptionId);
    if (subscription.status === 'active') {
      subscription.status = 'past_due';
      subscription.pastDueAt = iso(at);
      subscription.updatedAt = iso(at);
    }
    return structuredClone(subscription);
  }

  async cancelPastDue(subscriptionId: string, at: string) {
    const subscription = this.require(subscriptionId);
    if (subscription.status === 'past_due') {
      subscription.status = 'cancelled';
      subscription.pastDueAt = null;
      subscription.cancelledAt = iso(at);
      subscription.updatedAt = iso(at);
    }
    return structuredClone(subscription);
  }

  async cancel(subscriptionId: string, at: string) {
    const subscription = this.require(subscriptionId);
    if (subscription.status !== 'cancelled') {
      subscription.status = 'cancelled';
      subscription.pastDueAt = null;
      subscription.cancelledAt = iso(at);
      subscription.updatedAt = iso(at);
    }
    return structuredClone(subscription);
  }

  async scheduleChange(input: {
    subscriptionId: string;
    tier: Exclude<CreditPlanId, 'trial'>;
    interval: CreditSubscriptionInterval;
    effectiveCycle: number;
    at: string;
  }) {
    assertPaidThroughCycle(input.effectiveCycle);
    const subscription = this.require(input.subscriptionId);
    if (subscription.status === 'cancelled') {
      throw new Error('Cancelled credit subscriptions cannot be changed.');
    }
    subscription.pendingTier = input.tier;
    subscription.pendingInterval = input.interval;
    subscription.pendingEffectiveCycle = input.effectiveCycle;
    subscription.updatedAt = iso(input.at);
    return structuredClone(subscription);
  }

  async withPaymentEvent(
    input: {
      workspaceId: string;
      paymentEventId: string;
      payloadHash: string;
      createdAt: string;
    },
    operation: (
      subscriptions: CreditSubscriptionStore,
    ) => Promise<CreditSubscription | null>,
  ) {
    let release!: () => void;
    const previous = this.paymentEventTail;
    this.paymentEventTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      assertPaymentEventInput(input);
      const key = `${input.workspaceId}\u0000${input.paymentEventId}`;
      const existing = this.paymentEvents.get(key);
      if (existing) {
        assertPaymentEventFacts(existing.payloadHash, input.payloadHash);
        return existing.result ? structuredClone(existing.result) : null;
      }
      const result = await operation(this);
      this.paymentEvents.set(key, {
        payloadHash: input.payloadHash,
        result: result ? structuredClone(result) : null,
      });
      return result ? structuredClone(result) : null;
    } finally {
      release();
    }
  }

  private require(subscriptionId: string) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new Error(`Credit subscription ${subscriptionId} was not found.`);
    return subscription;
  }
}

interface CreditSubscriptionRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  tier: CreditSubscription['tier'];
  interval: CreditSubscriptionInterval;
  pending_tier: CreditSubscription['tier'] | null;
  pending_interval: CreditSubscriptionInterval | null;
  pending_effective_cycle: number | string | null;
  grant_cycle_offset: number | string;
  grant_lineage_id: string;
  anchor_at: Date | string;
  paid_through_cycle: number | string;
  status: CreditSubscriptionStatus;
  past_due_at: Date | string | null;
  cancelled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CreditPaymentEventRow extends QueryResultRow {
  payload_hash: string;
  result_json: unknown;
  completed: boolean;
}

interface CreditSubscriptionDatabase {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

/** Durable payment-status truth consumed by the worker scheduler. */
export class PostgresCreditSubscriptionStore
  implements CreditSubscriptionStore, PostgresSchemaMigrator
{
  constructor(
    private readonly pool: Pool,
    private readonly database: CreditSubscriptionDatabase = pool,
  ) {}

  async migrate(client: PoolClient) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_credit_subscriptions (
        id text PRIMARY KEY,
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        tier text NOT NULL CHECK (tier IN ('starter', 'growth', 'pro')),
        interval text NOT NULL CHECK (interval IN ('single_month', 'monthly', 'yearly')),
        pending_tier text CHECK (pending_tier IN ('starter', 'growth', 'pro')),
        pending_interval text CHECK (pending_interval IN ('single_month', 'monthly', 'yearly')),
        pending_effective_cycle integer CHECK (pending_effective_cycle >= 0),
        grant_cycle_offset integer NOT NULL DEFAULT 0 CHECK (grant_cycle_offset >= 0),
        grant_lineage_id text NOT NULL,
        anchor_at timestamptz NOT NULL,
        paid_through_cycle integer NOT NULL CHECK (paid_through_cycle >= 0),
        status text NOT NULL CHECK (status IN ('active', 'past_due', 'cancelled')),
        past_due_at timestamptz,
        cancelled_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        CHECK ((status = 'past_due') = (past_due_at IS NOT NULL)),
        CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
        CHECK (
          (pending_tier IS NULL AND pending_interval IS NULL AND pending_effective_cycle IS NULL)
          OR
          (pending_tier IS NOT NULL AND pending_interval IS NOT NULL AND pending_effective_cycle IS NOT NULL)
        )
      );
      ALTER TABLE p1_credit_subscriptions
        ADD COLUMN IF NOT EXISTS pending_tier text;
      ALTER TABLE p1_credit_subscriptions
        ADD COLUMN IF NOT EXISTS pending_interval text;
      ALTER TABLE p1_credit_subscriptions
        ADD COLUMN IF NOT EXISTS pending_effective_cycle integer;
      ALTER TABLE p1_credit_subscriptions
        ADD COLUMN IF NOT EXISTS grant_cycle_offset integer NOT NULL DEFAULT 0;
      ALTER TABLE p1_credit_subscriptions
        ADD COLUMN IF NOT EXISTS grant_lineage_id text;
      UPDATE p1_credit_subscriptions
         SET grant_lineage_id = id
       WHERE grant_lineage_id IS NULL;
      ALTER TABLE p1_credit_subscriptions
        ALTER COLUMN grant_lineage_id SET NOT NULL;
      CREATE INDEX IF NOT EXISTS p1_credit_subscriptions_scheduler_idx
        ON p1_credit_subscriptions (status, anchor_at, id)
        WHERE status IN ('active', 'past_due');
      CREATE UNIQUE INDEX IF NOT EXISTS p1_credit_subscriptions_one_active_workspace_idx
        ON p1_credit_subscriptions (workspace_id)
        WHERE status IN ('active', 'past_due');
      CREATE TABLE IF NOT EXISTS p1_credit_subscription_paid_periods (
        subscription_id text NOT NULL REFERENCES p1_credit_subscriptions(id) ON DELETE CASCADE,
        period_starts_at timestamptz NOT NULL,
        coverage_cycles integer NOT NULL CHECK (coverage_cycles > 0),
        created_at timestamptz NOT NULL,
        PRIMARY KEY (subscription_id, period_starts_at)
      );
      CREATE TABLE IF NOT EXISTS p1_credit_payment_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        payment_event_id text NOT NULL,
        payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
        result_json jsonb,
        completed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, payment_event_id)
      );
    `);
  }

  async get(subscriptionId: string) {
    const result = await this.database.query<CreditSubscriptionRow>(
      'SELECT * FROM p1_credit_subscriptions WHERE id = $1',
      [subscriptionId],
    );
    return result.rows[0] ? subscriptionFromRow(result.rows[0]) : null;
  }

  async listForWorkspace(workspaceId: string) {
    const result = await this.database.query<CreditSubscriptionRow>(
      `SELECT * FROM p1_credit_subscriptions
        WHERE workspace_id = $1
        ORDER BY updated_at DESC, id`,
      [workspaceId],
    );
    return result.rows.map(subscriptionFromRow);
  }

  async listGrantCandidates() {
    const result = await this.database.query<CreditSubscriptionRow>(
      `SELECT * FROM p1_credit_subscriptions
        ORDER BY anchor_at, id`,
    );
    return result.rows.map(subscriptionFromRow);
  }

  async upsert(input: CreditSubscriptionInput) {
    assertSubscriptionInput(input);
    const now = iso(input.updatedAt ?? input.anchorAt);
    const result = await this.database.query<CreditSubscriptionRow>(
      `INSERT INTO p1_credit_subscriptions
        (id, workspace_id, tier, interval, pending_tier, pending_interval,
         pending_effective_cycle, grant_cycle_offset, grant_lineage_id, anchor_at, paid_through_cycle,
         status, past_due_at, cancelled_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         tier = EXCLUDED.tier,
         interval = EXCLUDED.interval,
         pending_tier = EXCLUDED.pending_tier,
         pending_interval = EXCLUDED.pending_interval,
         pending_effective_cycle = EXCLUDED.pending_effective_cycle,
         grant_cycle_offset = EXCLUDED.grant_cycle_offset,
         grant_lineage_id = EXCLUDED.grant_lineage_id,
         anchor_at = EXCLUDED.anchor_at,
         paid_through_cycle = EXCLUDED.paid_through_cycle,
         status = EXCLUDED.status,
         past_due_at = EXCLUDED.past_due_at,
         cancelled_at = EXCLUDED.cancelled_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        input.id,
        input.workspaceId,
        input.tier,
        input.interval,
        input.pendingTier ?? null,
        input.pendingInterval ?? null,
        input.pendingEffectiveCycle ?? null,
        input.grantCycleOffset ?? 0,
        input.grantLineageId ?? input.id,
        iso(input.anchorAt),
        input.paidThroughCycle,
        input.status ?? 'active',
        input.pastDueAt ? iso(input.pastDueAt) : null,
        input.cancelledAt ? iso(input.cancelledAt) : null,
        iso(input.createdAt ?? input.anchorAt),
        now,
      ],
    );
    return subscriptionFromRow(result.rows[0]!);
  }

  async recordPaidCoverage(subscriptionId: string, paidThroughCycle: number, at: string) {
    assertPaidThroughCycle(paidThroughCycle);
    const existing = await this.require(subscriptionId);
    if (existing.status === 'cancelled') {
      throw new Error('Cancelled credit subscriptions cannot receive renewal coverage.');
    }
    const result = await this.database.query<CreditSubscriptionRow>(
      `UPDATE p1_credit_subscriptions
          SET paid_through_cycle = GREATEST(paid_through_cycle, $2),
              status = 'active', past_due_at = NULL, updated_at = $3
        WHERE id = $1 AND status <> 'cancelled'
        RETURNING *`,
      [subscriptionId, paidThroughCycle, iso(at)],
    );
    if (!result.rows[0]) throw new Error(`Credit subscription ${subscriptionId} was not found.`);
    return subscriptionFromRow(result.rows[0]);
  }

  async recordPaidPeriod(input: {
    subscriptionId: string;
    periodStartsAt: string;
    coverageCycles: number;
    at: string;
  }) {
    assertCoverageCycles(input.coverageCycles);
    const existing = await this.require(input.subscriptionId);
    if (existing.status === 'cancelled') {
      throw new Error('Cancelled credit subscriptions cannot receive renewal coverage.');
    }
    const periodStartsAt = iso(input.periodStartsAt);
    const at = iso(input.at);
    const latest = await this.latestPaidPeriodStartsAt(input.subscriptionId);
    if (
      periodStartsAt > at ||
      (latest !== null && periodStartsAt < latest)
    ) {
      return existing;
    }
    const inserted = await this.database.query<{ coverage_cycles: number | string }>(
      `INSERT INTO p1_credit_subscription_paid_periods
        (subscription_id, period_starts_at, coverage_cycles, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subscription_id, period_starts_at) DO NOTHING
       RETURNING coverage_cycles`,
      [input.subscriptionId, periodStartsAt, input.coverageCycles, iso(input.at)],
    );
    if (!inserted.rows[0]) {
      const replay = await this.database.query<{ coverage_cycles: number | string }>(
        `SELECT coverage_cycles
           FROM p1_credit_subscription_paid_periods
          WHERE subscription_id = $1 AND period_starts_at = $2`,
        [input.subscriptionId, periodStartsAt],
      );
      if (Number(replay.rows[0]?.coverage_cycles) !== input.coverageCycles) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Credit subscription billing period has different coverage facts.',
        );
      }
      return this.recordPaidCoverage(
        input.subscriptionId,
        existing.paidThroughCycle,
        at,
      );
    }
    const updated = await this.database.query<CreditSubscriptionRow>(
      `UPDATE p1_credit_subscriptions
          SET paid_through_cycle = paid_through_cycle + $2,
              status = 'active', past_due_at = NULL, updated_at = $3
        WHERE id = $1 AND status <> 'cancelled'
        RETURNING *`,
      [input.subscriptionId, input.coverageCycles, at],
    );
    if (!updated.rows[0]) {
      throw new Error(`Credit subscription ${input.subscriptionId} was not found.`);
    }
    return subscriptionFromRow(updated.rows[0]);
  }

  async recordInitialPaidPeriod(input: {
    subscriptionId: string;
    periodStartsAt: string;
    coverageCycles: number;
    at: string;
  }) {
    assertCoverageCycles(input.coverageCycles);
    const subscription = await this.require(input.subscriptionId);
    const periodStartsAt = iso(input.periodStartsAt);
    const inserted = await this.database.query<{ coverage_cycles: number | string }>(
      `INSERT INTO p1_credit_subscription_paid_periods
        (subscription_id, period_starts_at, coverage_cycles, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (subscription_id, period_starts_at) DO NOTHING
       RETURNING coverage_cycles`,
      [input.subscriptionId, periodStartsAt, input.coverageCycles, iso(input.at)],
    );
    if (!inserted.rows[0]) {
      const existing = await this.database.query<{ coverage_cycles: number | string }>(
        `SELECT coverage_cycles
           FROM p1_credit_subscription_paid_periods
          WHERE subscription_id = $1 AND period_starts_at = $2`,
        [input.subscriptionId, periodStartsAt],
      );
      if (Number(existing.rows[0]?.coverage_cycles) !== input.coverageCycles) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Credit subscription billing period has different coverage facts.',
        );
      }
    }
    return subscription;
  }

  async latestPaidPeriodStartsAt(subscriptionId: string) {
    const result = await this.database.query<{ period_starts_at: Date | string | null }>(
      `SELECT max(period_starts_at) AS period_starts_at
         FROM p1_credit_subscription_paid_periods
        WHERE subscription_id = $1`,
      [subscriptionId],
    );
    const value = result.rows[0]?.period_starts_at;
    return value ? iso(value) : null;
  }

  async replaceSubscription(input: {
    sourceSubscriptionId: string;
    targetSubscriptionId: string;
    at: string;
  }) {
    const source = await this.require(input.sourceSubscriptionId);
    if (await this.get(input.targetSubscriptionId)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Credit subscription ${input.targetSubscriptionId} already exists.`,
      );
    }
    const at = iso(input.at);
    await this.cancel(input.sourceSubscriptionId, at);
    const replacement = await this.upsert({
      ...source,
      id: input.targetSubscriptionId,
      pendingTier: source.pendingTier ?? undefined,
      pendingInterval: source.pendingInterval ?? undefined,
      pendingEffectiveCycle: source.pendingEffectiveCycle ?? undefined,
      status: 'active',
      pastDueAt: null,
      cancelledAt: null,
      updatedAt: at,
    });
    await this.database.query(
      `INSERT INTO p1_credit_subscription_paid_periods
        (subscription_id, period_starts_at, coverage_cycles, created_at)
       SELECT $2, period_starts_at, coverage_cycles, created_at
         FROM p1_credit_subscription_paid_periods
        WHERE subscription_id = $1
       ON CONFLICT (subscription_id, period_starts_at) DO NOTHING`,
      [input.sourceSubscriptionId, input.targetSubscriptionId],
    );
    return replacement;
  }

  async resume(subscriptionId: string, at: string) {
    const result = await this.database.query<CreditSubscriptionRow>(
      `UPDATE p1_credit_subscriptions
          SET status = 'active', past_due_at = NULL, updated_at = $2
        WHERE id = $1 AND status <> 'cancelled'
        RETURNING *`,
      [subscriptionId, iso(at)],
    );
    if (!result.rows[0]) {
      throw new Error(`Credit subscription ${subscriptionId} was not found.`);
    }
    return subscriptionFromRow(result.rows[0]);
  }

  async markPastDue(subscriptionId: string, at: string) {
    const result = await this.database.query<CreditSubscriptionRow>(
      `UPDATE p1_credit_subscriptions
          SET status = 'past_due', past_due_at = COALESCE(past_due_at, $2), updated_at = $2
        WHERE id = $1 AND status = 'active'
        RETURNING *`,
      [subscriptionId, iso(at)],
    );
    return result.rows[0] ? subscriptionFromRow(result.rows[0]) : this.require(subscriptionId);
  }

  async cancelPastDue(subscriptionId: string, at: string) {
    const result = await this.database.query<CreditSubscriptionRow>(
      `UPDATE p1_credit_subscriptions
          SET status = 'cancelled', past_due_at = NULL, cancelled_at = $2, updated_at = $2
        WHERE id = $1 AND status = 'past_due'
        RETURNING *`,
      [subscriptionId, iso(at)],
    );
    return result.rows[0] ? subscriptionFromRow(result.rows[0]) : this.require(subscriptionId);
  }

  async cancel(subscriptionId: string, at: string) {
    const result = await this.database.query<CreditSubscriptionRow>(
      `UPDATE p1_credit_subscriptions
          SET status = 'cancelled', past_due_at = NULL, cancelled_at = $2, updated_at = $2
        WHERE id = $1 AND status <> 'cancelled'
        RETURNING *`,
      [subscriptionId, iso(at)],
    );
    return result.rows[0] ? subscriptionFromRow(result.rows[0]) : this.require(subscriptionId);
  }

  async scheduleChange(input: {
    subscriptionId: string;
    tier: Exclude<CreditPlanId, 'trial'>;
    interval: CreditSubscriptionInterval;
    effectiveCycle: number;
    at: string;
  }) {
    assertPaidThroughCycle(input.effectiveCycle);
    const result = await this.database.query<CreditSubscriptionRow>(
      `UPDATE p1_credit_subscriptions
          SET pending_tier = $2, pending_interval = $3,
              pending_effective_cycle = $4, updated_at = $5
        WHERE id = $1 AND status <> 'cancelled'
        RETURNING *`,
      [
        input.subscriptionId,
        input.tier,
        input.interval,
        input.effectiveCycle,
        iso(input.at),
      ],
    );
    if (!result.rows[0]) throw new Error(`Credit subscription ${input.subscriptionId} was not found.`);
    return subscriptionFromRow(result.rows[0]);
  }

  async withPaymentEvent(
    input: {
      workspaceId: string;
      paymentEventId: string;
      payloadHash: string;
      createdAt: string;
    },
    operation: (
      subscriptions: CreditSubscriptionStore,
    ) => Promise<CreditSubscription | null>,
  ) {
    assertPaymentEventInput(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO p1_credit_payment_events
          (workspace_id, payment_event_id, payload_hash, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, payment_event_id) DO NOTHING
         RETURNING payment_event_id`,
        [
          input.workspaceId,
          input.paymentEventId,
          input.payloadHash,
          iso(input.createdAt),
        ],
      );
      if (inserted.rowCount === 0) {
        const replay = await client.query<CreditPaymentEventRow>(
          `SELECT payload_hash, result_json, completed
             FROM p1_credit_payment_events
            WHERE workspace_id = $1 AND payment_event_id = $2`,
          [input.workspaceId, input.paymentEventId],
        );
        const receipt = replay.rows[0];
        if (!receipt || !receipt.completed) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Credit payment event receipt is incomplete.',
          );
        }
        assertPaymentEventFacts(receipt.payload_hash, input.payloadHash);
        await client.query('COMMIT');
        return creditPaymentEventResult(receipt.result_json);
      }

      const result = await operation(
        new PostgresCreditSubscriptionStore(this.pool, client),
      );
      await client.query(
        `UPDATE p1_credit_payment_events
            SET result_json = $3::jsonb, completed = true
          WHERE workspace_id = $1 AND payment_event_id = $2`,
        [input.workspaceId, input.paymentEventId, JSON.stringify(result)],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async require(subscriptionId: string) {
    const subscription = await this.get(subscriptionId);
    if (!subscription) throw new Error(`Credit subscription ${subscriptionId} was not found.`);
    return subscription;
  }
}

function assertPaymentEventInput(input: {
  workspaceId: string;
  paymentEventId: string;
  payloadHash: string;
  createdAt: string;
}) {
  if (!input.workspaceId.trim() || !input.paymentEventId.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Credit payment workspace and event id are required.',
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(input.payloadHash)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Credit payment payload hash is invalid.',
    );
  }
  date(input.createdAt, 'createdAt');
}

function assertPaymentEventFacts(existing: string, replayed: string) {
  if (existing !== replayed) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Credit payment event was replayed with different facts.',
    );
  }
}

function creditPaymentEventResult(value: unknown) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Credit payment event result is invalid.',
    );
  }
  return structuredClone(value) as CreditSubscription;
}

function addUtcMonths(anchor: Date, offset: number) {
  const targetMonth = anchor.getUTCMonth() + offset;
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

function assertSubscriptionInput(input: CreditSubscriptionInput) {
  if (!input.id.trim() || !input.workspaceId.trim()) {
    throw new Error('Credit subscription id and workspaceId are required.');
  }
  if (!['starter', 'growth', 'pro'].includes(input.tier)) {
    throw new Error('Credit subscription tier must be a paid plan.');
  }
  if (!['single_month', 'monthly', 'yearly'].includes(input.interval)) {
    throw new Error('Credit subscription interval is invalid.');
  }
  date(input.anchorAt, 'anchorAt');
  assertPaidThroughCycle(input.paidThroughCycle);
  const hasPending =
    input.pendingTier !== undefined ||
    input.pendingInterval !== undefined ||
    input.pendingEffectiveCycle !== undefined;
  if (hasPending) {
    if (
      !input.pendingTier ||
      !input.pendingInterval ||
      input.pendingEffectiveCycle === undefined ||
      input.pendingEffectiveCycle === null
    ) {
      throw new Error('Pending subscription changes require tier, interval and effective cycle.');
    }
    if (!['starter', 'growth', 'pro'].includes(input.pendingTier)) {
      throw new Error('Pending subscription tier must be a paid plan.');
    }
    if (!['single_month', 'monthly', 'yearly'].includes(input.pendingInterval)) {
      throw new Error('Pending subscription interval is invalid.');
    }
    assertPaidThroughCycle(input.pendingEffectiveCycle);
  }
  if (input.status === 'past_due' && !input.pastDueAt) {
    throw new Error('past_due subscriptions require pastDueAt.');
  }
  if (input.status !== 'past_due' && input.pastDueAt) {
    throw new Error('Only past_due subscriptions may have pastDueAt.');
  }
  if (input.status === 'cancelled' && !input.cancelledAt) {
    throw new Error('cancelled subscriptions require cancelledAt.');
  }
  if (input.status !== 'cancelled' && input.cancelledAt) {
    throw new Error('Only cancelled subscriptions may have cancelledAt.');
  }
}

function assertPaidThroughCycle(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('paidThroughCycle must be a non-negative integer.');
  }
}

function assertCoverageCycles(value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('coverageCycles must be a positive integer.');
  }
}

function date(value: string, field: string) {
  const parsed = new Date(value);
  if (!value.trim() || Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
  return parsed;
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : date(value, 'timestamp').toISOString();
}

function subscriptionFromRow(row: CreditSubscriptionRow): CreditSubscription {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    tier: row.tier,
    interval: row.interval,
    pendingTier: row.pending_tier,
    pendingInterval: row.pending_interval,
    pendingEffectiveCycle:
      row.pending_effective_cycle === null
        ? null
        : Number(row.pending_effective_cycle),
    grantCycleOffset: Number(row.grant_cycle_offset),
    grantLineageId: row.grant_lineage_id,
    anchorAt: iso(row.anchor_at),
    paidThroughCycle: Number(row.paid_through_cycle),
    status: row.status,
    pastDueAt: row.past_due_at ? iso(row.past_due_at) : null,
    cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
