import { P1DomainError } from '../foundation/domain.js';
import type {
  AccountAllocation,
  AccountAllocationDelta,
  AccountAllocationKind,
  AccountAllocationSource,
  AccountAllocationTarget,
} from './contracts.js';

export interface GrantAccountAllocationInput {
  accountId: string;
  /** Must be chosen inside account-allocation drilldown (D-063 multi-workspace). */
  workspaceId: string;
  kind: AccountAllocationKind;
  target: AccountAllocationTarget;
  delta: AccountAllocationDelta;
  source: AccountAllocationSource;
  reason: string;
  actorId: string;
  startsAt: string;
  endsAt: string | null;
  correlationId: string;
}

export interface RollbackAccountAllocationInput {
  allocationId: string;
  actorId: string;
  reason: string;
  correlationId: string;
}

/**
 * Append-only AccountAllocation store.
 * Admins never edit balances/history — only append grant/restrict or rollback events.
 * Expired allocations auto-fall back to plan default at read time.
 */
export class AccountAllocationStore {
  private readonly allocations: AccountAllocation[] = [];
  private seq = 0;

  append(input: GrantAccountAllocationInput): AccountAllocation {
    if (!input.accountId.trim() || !input.workspaceId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'AccountAllocation requires accountId and target workspaceId.'
      );
    }
    if (!input.reason.trim() || !input.actorId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'AccountAllocation requires actor and reason for audit.'
      );
    }
    this.assertDelta(input.kind, input.delta);
    const startsAtMs = Date.parse(input.startsAt);
    if (!Number.isFinite(startsAtMs)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'AccountAllocation startsAt must be a valid ISO timestamp.'
      );
    }
    if (input.endsAt !== null) {
      const endsAtMs = Date.parse(input.endsAt);
      if (!Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) {
        throw new P1DomainError(
          'INVALID_STATE',
          'AccountAllocation endsAt must be after startsAt.'
        );
      }
    }
    const allocation: AccountAllocation = {
      id: `allocation:${++this.seq}`,
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      target: structuredClone(input.target),
      delta: structuredClone(input.delta),
      source: input.source,
      reason: input.reason,
      actorId: input.actorId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: 'active',
      rolledBackAt: null,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    };
    this.allocations.push(allocation);
    return structuredClone(allocation);
  }

  rollback(input: RollbackAccountAllocationInput): AccountAllocation {
    const allocation = this.allocations.find(
      (item) => item.id === input.allocationId
    );
    if (!allocation) {
      throw new P1DomainError('NOT_FOUND', 'AccountAllocation was not found.');
    }
    if (allocation.status === 'rolled_back') {
      return structuredClone(allocation);
    }
    allocation.status = 'rolled_back';
    allocation.rolledBackAt = new Date().toISOString();
    return structuredClone(allocation);
  }

  /**
   * Active allocations for an account/workspace at `now`.
   * Expired rows are marked expired and excluded (auto fall-back to plan default).
   */
  listActive(input: {
    accountId: string;
    workspaceId: string;
    now?: Date;
  }): AccountAllocation[] {
    const nowMs = (input.now ?? new Date()).getTime();
    const active: AccountAllocation[] = [];
    for (const allocation of this.allocations) {
      if (
        allocation.accountId !== input.accountId ||
        allocation.workspaceId !== input.workspaceId
      ) {
        continue;
      }
      if (allocation.status === 'rolled_back') continue;
      const startsAtMs = Date.parse(allocation.startsAt);
      const endsAtMs =
        allocation.endsAt === null ? null : Date.parse(allocation.endsAt);
      if (startsAtMs > nowMs) continue;
      if (endsAtMs !== null && endsAtMs <= nowMs) {
        allocation.status = 'expired';
        continue;
      }
      if (allocation.status === 'expired') continue;
      active.push(structuredClone(allocation));
    }
    return active;
  }

  listAll(accountId?: string): AccountAllocation[] {
    return structuredClone(
      accountId
        ? this.allocations.filter((item) => item.accountId === accountId)
        : this.allocations
    );
  }

  private assertDelta(
    kind: AccountAllocationKind,
    delta: AccountAllocationDelta
  ) {
    if (delta.mode === 'set') return;
    if (!Number.isInteger(delta.amount)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'AccountAllocation delta/cap amount must be an integer.'
      );
    }
    if (kind === 'grant' && delta.mode === 'delta' && delta.amount <= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Grant delta must be a positive integer.'
      );
    }
    if (kind === 'restrict' && delta.mode === 'delta' && delta.amount >= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Restrict delta must be a negative integer.'
      );
    }
    if (delta.mode === 'cap' && delta.amount < 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Allocation cap must be a non-negative integer.'
      );
    }
  }
}
