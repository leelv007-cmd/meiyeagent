import { randomUUID } from 'node:crypto';
import type {
  ProductContext,
  ProductState,
  UsageEvent,
} from '@meiye/contracts';
import { DomainError } from './domain-error.js';

type ReservableResource = 'content' | 'image' | 'video' | 'package';

function now() {
  return new Date().toISOString();
}

/**
 * The only thing in the repository that may move the legacy billing ledger.
 *
 * Before this module the question "may this write happen?" was answered at each
 * call site by remembering `if (!options.legacyBillingReadOnly)`. An interface
 * made of remembering cannot say whether its own enumeration is complete, and
 * twice it was not: `cancel_video`'s refund (product-service.ts:3206) had no
 * gate at all, and `executeGenerateCopy`'s reserve was gated on
 * `copyUsageAuthority`, an unrelated flag that the legacy assembly does not set
 * — so both reached a ledger that core-assembly.ts had declared read-only.
 *
 * The authority now lives inside the verbs. Callers cannot ask for it and
 * cannot route around it: `state.usageEvents` is appended in exactly one place
 * and `state.entitlement[...].remaining` moves in exactly three, all of them in
 * this file. `legacy-billing-ledger-chokepoint.static.test.ts` holds that line
 * repo-wide, so a write path added later fails the build instead of quietly
 * becoming a thirteenth thing to remember.
 *
 * When the ledger is not writable every verb is a no-op returning the value
 * that means "nothing happened" — `undefined` for a reservation, `false` for a
 * settlement. That is the same semantics the twelve already-guarded call sites
 * had, including their side effect of not enforcing legacy quota: a frozen
 * ledger's entitlement numbers are stale, and enforcement moved to the
 * foundation ledger.
 */
export class LegacyBillingLedger {
  constructor(private readonly writable: boolean) {}

  /** Append a ledger row. The single `state.usageEvents` mutation. */
  record(
    state: ProductState,
    context: ProductContext,
    resource: UsageEvent['resource'],
    amount: number,
    status: UsageEvent['status'],
    reason: string,
    reservationId?: string
  ) {
    if (!this.writable) return;
    state.usageEvents.push({
      id: randomUUID(),
      correlationId: context.correlationId,
      resource,
      amount,
      status,
      reservationId,
      reason,
      createdAt: now()
    });
  }

  /** Hold allowance. Returns undefined when the ledger is frozen. */
  reserve(
    state: ProductState,
    context: ProductContext,
    resource: ReservableResource,
    amount: number,
    reason = `${resource} generation reserved`
  ): string | undefined {
    if (!this.writable) return undefined;
    const bucket = state.entitlement[resource];
    if (bucket.remaining < amount) {
      throw new DomainError(
        'QUOTA_EXHAUSTED',
        `${resource} allowance is exhausted. Choose a plan or add-on before continuing.`,
        402,
        { plan: state.entitlement.plan, resource }
      );
    }
    const reservationId = randomUUID();
    bucket.remaining -= amount;
    this.record(
      state,
      context,
      resource,
      amount,
      'reserved',
      reason,
      reservationId
    );
    return reservationId;
  }

  commit(
    state: ProductState,
    context: ProductContext,
    resource: ReservableResource,
    reservationId: string | undefined
  ) {
    if (!this.writable || !reservationId) return false;
    const reservation = state.usageEvents.find(
      (event) =>
        event.resource === resource &&
        event.reservationId === reservationId &&
        event.status === 'reserved'
    );
    if (!reservation) {
      throw new DomainError(
        'RESERVATION_NOT_FOUND',
        'A committed task requires an existing usage reservation.',
        409
      );
    }
    const terminal = state.usageEvents.some(
      (event) =>
        event.reservationId === reservationId &&
        event.resource === resource &&
        (event.status === 'committed' ||
          event.status === 'refunded' ||
          event.status === 'expired')
    );
    if (terminal) return false;
    this.record(
      state,
      context,
      resource,
      reservation.amount,
      'committed',
      `${resource} generation committed`,
      reservationId
    );
    return true;
  }

  release(
    state: ProductState,
    context: ProductContext,
    resource: ReservableResource,
    reservationId: string | undefined,
    status: 'refunded' | 'expired' = 'refunded'
  ) {
    if (!this.writable || !reservationId) return false;
    const reservation = state.usageEvents.find(
      (event) =>
        event.resource === resource &&
        event.reservationId === reservationId &&
        event.status === 'reserved'
    );
    const terminal = state.usageEvents.some(
      (event) =>
        event.reservationId === reservationId &&
        event.resource === resource &&
        (event.status === 'committed' ||
          event.status === 'refunded' ||
          event.status === 'expired')
    );
    if (!reservation || terminal) return false;
    state.entitlement[resource].remaining += reservation.amount;
    this.record(
      state,
      context,
      resource,
      reservation.amount,
      status,
      status === 'expired'
        ? `${resource} reservation expired`
        : `${resource} reservation refunded`,
      reservationId
    );
    return true;
  }

  refund(
    state: ProductState,
    context: ProductContext,
    resource: ReservableResource,
    reservationId: string | undefined
  ) {
    return this.release(state, context, resource, reservationId);
  }

  chargeImmediate(
    state: ProductState,
    context: ProductContext,
    resource: 'content' | 'package',
    amount: number
  ) {
    const reservationId = this.reserve(state, context, resource, amount);
    this.commit(state, context, resource, reservationId);
    return reservationId;
  }

  /**
   * Storage is spent without a reservation, so it used to be a hand-rolled
   * decrement next to a `record` call at the one site that needed it
   * (product-service.ts:3151). It is the same spend as the others and belongs
   * behind the same authority.
   */
  consumeStorage(
    state: ProductState,
    context: ProductContext,
    megabytes: number,
    reason: string
  ) {
    if (!this.writable) return false;
    state.entitlement.storageMb.remaining -= megabytes;
    this.record(state, context, 'storage', megabytes, 'committed', reason);
    return true;
  }
}
