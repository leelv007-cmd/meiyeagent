/**
 * SupplyPool first-class entity (H2 / D-066 / D-080 C4).
 *
 * Shared pool is the default; DedicatedSupplyPool is a first-class exception
 * for enterprise contract / region / restricted data / exclusive billing /
 * reserved capacity. Shared ↔ dedicated never silently fallback unless both
 * contract entitlement and data policy explicitly authorize it.
 */

import type {
  DedicatedSupplyPool,
  SupplyCapacityLimits,
  SupplyDataClass,
  SupplyPool,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import type { AccountAllocation } from './contracts.js';

export type SupplyPoolKind = SupplyPool['kind'];

export type PoolFallbackAuthorization = {
  /** Contract / AccountAllocation entitlement that allows cross-kind fallback. */
  contractEntitlementAuthorized: boolean;
  /** DataPolicy revision that allows the requested data classes on the target pool. */
  dataPolicyAuthorized: boolean;
};

export type ResolveSupplyPoolInput = {
  /** Preferred pool from entitlement / request. */
  preferredPoolId: string;
  /**
   * Candidate fallback pool when preferred is unavailable.
   * Cross-kind fallback is denied unless authorization is explicit.
   */
  fallbackPoolId?: string;
  /** Why the preferred pool is unavailable (capacity, health, etc.). */
  preferredUnavailable?: boolean;
  authorization?: PoolFallbackAuthorization;
  /** Active allocations that may bind dedicated pools to this workspace. */
  allocations?: AccountAllocation[];
  workspaceId: string;
  accountId: string;
  dataClasses?: SupplyDataClass[];
};

export type ResolveSupplyPoolResult =
  | { status: 'resolved'; pool: SupplyPool; via: 'preferred' | 'authorized_fallback' }
  | {
      status: 'denied';
      code:
        | 'POOL_NOT_FOUND'
        | 'DEDICATED_NOT_AUTHORIZED'
        | 'CROSS_KIND_FALLBACK_DENIED'
        | 'DATA_CLASS_RESTRICTED';
      message: string;
    };

export type RegisterSharedPoolInput = {
  id: string;
  displayName: string;
  credentialAccountIds: string[];
  deploymentIds: string[];
  capacity?: SupplyCapacityLimits;
  revisionId: string;
};

export type RegisterDedicatedPoolInput = RegisterSharedPoolInput & {
  contractRef: string;
  authorizedWorkspaceIds: string[];
  regionRestriction?: string[];
  dataClassRestriction?: SupplyDataClass[];
  exclusiveBilling?: boolean;
  reservedCapacity?: SupplyCapacityLimits;
};

/**
 * In-memory SupplyPool registry (domain service; persistence via Z2-WIRING).
 */
export class SupplyPoolRegistry {
  private readonly pools = new Map<string, SupplyPool | DedicatedSupplyPool>();

  registerShared(input: RegisterSharedPoolInput): SupplyPool {
    this.assertRegisterBase(input);
    if (this.pools.has(input.id)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `SupplyPool ${input.id} already exists.`
      );
    }
    const pool: SupplyPool = {
      id: input.id,
      kind: 'shared',
      displayName: input.displayName,
      credentialAccountIds: [...input.credentialAccountIds],
      deploymentIds: [...input.deploymentIds],
      ...(input.capacity ? { capacity: structuredClone(input.capacity) } : {}),
      revisionId: input.revisionId,
    };
    this.pools.set(pool.id, pool);
    return structuredClone(pool);
  }

  registerDedicated(input: RegisterDedicatedPoolInput): DedicatedSupplyPool {
    this.assertRegisterBase(input);
    if (!input.contractRef.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'DedicatedSupplyPool requires contractRef.'
      );
    }
    if (input.authorizedWorkspaceIds.length === 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'DedicatedSupplyPool requires at least one authorized workspace.'
      );
    }
    if (this.pools.has(input.id)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `SupplyPool ${input.id} already exists.`
      );
    }
    const pool: DedicatedSupplyPool = {
      id: input.id,
      kind: 'dedicated',
      displayName: input.displayName,
      credentialAccountIds: [...input.credentialAccountIds],
      deploymentIds: [...input.deploymentIds],
      ...(input.capacity ? { capacity: structuredClone(input.capacity) } : {}),
      revisionId: input.revisionId,
      contractRef: input.contractRef,
      authorizedWorkspaceIds: [...input.authorizedWorkspaceIds],
      ...(input.regionRestriction
        ? { regionRestriction: [...input.regionRestriction] }
        : {}),
      ...(input.dataClassRestriction
        ? { dataClassRestriction: [...input.dataClassRestriction] }
        : {}),
      ...(input.exclusiveBilling !== undefined
        ? { exclusiveBilling: input.exclusiveBilling }
        : {}),
      ...(input.reservedCapacity
        ? { reservedCapacity: structuredClone(input.reservedCapacity) }
        : {}),
    };
    this.pools.set(pool.id, pool);
    return structuredClone(pool);
  }

  get(poolId: string): SupplyPool | DedicatedSupplyPool | null {
    const pool = this.pools.get(poolId);
    return pool ? structuredClone(pool) : null;
  }

  list(kind?: SupplyPoolKind): Array<SupplyPool | DedicatedSupplyPool> {
    return [...this.pools.values()]
      .filter((pool) => (kind === undefined ? true : pool.kind === kind))
      .map((pool) => structuredClone(pool));
  }

  /**
   * Bind a dedicated CredentialAccount / Deployment via AccountAllocation or
   * contract entitlement (authorizedWorkspaceIds).
   */
  isWorkspaceAuthorizedForPool(input: {
    poolId: string;
    workspaceId: string;
    accountId: string;
    allocations?: AccountAllocation[];
  }): boolean {
    const pool = this.pools.get(input.poolId);
    if (!pool) return false;
    if (pool.kind === 'shared') return true;
    const dedicated = pool as DedicatedSupplyPool;
    if (dedicated.authorizedWorkspaceIds?.includes(input.workspaceId)) {
      return true;
    }
    return (input.allocations ?? []).some(
      (allocation) =>
        allocation.status === 'active' &&
        allocation.accountId === input.accountId &&
        allocation.workspaceId === input.workspaceId &&
        allocation.target.type === 'supply_pool' &&
        allocation.target.supplyPoolId === input.poolId &&
        allocation.kind === 'grant' &&
        (allocation.delta.mode === 'set' ? allocation.delta.enabled : true)
    );
  }

  /**
   * Resolve pool for a request. Cross-kind silent fallback is denied unless
   * both contract entitlement and data policy authorize it.
   */
  resolve(input: ResolveSupplyPoolInput): ResolveSupplyPoolResult {
    const preferred = this.pools.get(input.preferredPoolId);
    if (!preferred) {
      return {
        status: 'denied',
        code: 'POOL_NOT_FOUND',
        message: `SupplyPool ${input.preferredPoolId} was not found.`,
      };
    }

    const preferredAuth = this.authorizeWorkspace(preferred, input);
    if (preferredAuth !== null) return preferredAuth;

    if (!input.preferredUnavailable) {
      return { status: 'resolved', pool: structuredClone(preferred), via: 'preferred' };
    }

    if (!input.fallbackPoolId) {
      return {
        status: 'denied',
        code: 'CROSS_KIND_FALLBACK_DENIED',
        message:
          'Preferred SupplyPool is unavailable and no authorized fallback was provided.',
      };
    }

    const fallback = this.pools.get(input.fallbackPoolId);
    if (!fallback) {
      return {
        status: 'denied',
        code: 'POOL_NOT_FOUND',
        message: `Fallback SupplyPool ${input.fallbackPoolId} was not found.`,
      };
    }

    const fallbackAuth = this.authorizeWorkspace(fallback, input);
    if (fallbackAuth !== null) return fallbackAuth;

    if (preferred.kind !== fallback.kind) {
      const auth = input.authorization;
      if (
        !auth ||
        !auth.contractEntitlementAuthorized ||
        !auth.dataPolicyAuthorized
      ) {
        return {
          status: 'denied',
          code: 'CROSS_KIND_FALLBACK_DENIED',
          message:
            `Cross-kind fallback from ${preferred.kind} pool ${preferred.id} ` +
            `to ${fallback.kind} pool ${fallback.id} requires explicit contract ` +
            `entitlement and data policy authorization.`,
        };
      }
    }

    return {
      status: 'resolved',
      pool: structuredClone(fallback),
      via: 'authorized_fallback',
    };
  }

  private authorizeWorkspace(
    pool: SupplyPool | DedicatedSupplyPool,
    input: ResolveSupplyPoolInput
  ): Extract<ResolveSupplyPoolResult, { status: 'denied' }> | null {
    if (
      !this.isWorkspaceAuthorizedForPool({
        poolId: pool.id,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        allocations: input.allocations,
      })
    ) {
      return {
        status: 'denied',
        code: 'DEDICATED_NOT_AUTHORIZED',
        message: `Workspace ${input.workspaceId} is not authorized for SupplyPool ${pool.id}.`,
      };
    }

    if (pool.kind === 'dedicated') {
      const dedicated = pool as DedicatedSupplyPool;
      const restricted = dedicated.dataClassRestriction ?? [];
      if (restricted.length > 0 && input.dataClasses?.length) {
        const allowed = new Set(restricted);
        const offender = input.dataClasses.find((dc) => !allowed.has(dc));
        if (offender) {
          return {
            status: 'denied',
            code: 'DATA_CLASS_RESTRICTED',
            message: `Data class ${offender} is not permitted on DedicatedSupplyPool ${pool.id}.`,
          };
        }
      }
    }
    return null;
  }

  private assertRegisterBase(input: RegisterSharedPoolInput) {
    if (!input.id.trim() || !input.displayName.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'SupplyPool requires id and displayName.'
      );
    }
    if (input.credentialAccountIds.length === 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'SupplyPool requires at least one CredentialAccount binding.'
      );
    }
    if (input.deploymentIds.length === 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'SupplyPool requires at least one Deployment binding.'
      );
    }
    if (!input.revisionId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'SupplyPool requires revisionId.'
      );
    }
  }
}
