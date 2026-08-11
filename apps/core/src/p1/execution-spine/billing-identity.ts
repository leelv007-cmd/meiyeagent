/**
 * Canonical billing identity (R-P0-05 / V31-59 / V31-45).
 *
 * One frozen identity binds every settlement path — ordinary settle/refund,
 * hold-expiry sweeps, prepared retries, replay, provider attempts and derived
 * revision writes. It is produced once at admission from the frozen request and
 * never re-derived from ambient ids at settlement time. Missing or inconsistent
 * identity fails closed: no `workflowId ?? sourceTaskId` guesses anywhere.
 *
 * `planId` / `planRevision` / `snapshotHash` are present whenever the request
 * carries a plan snapshot (V31-12+); legacy durable requests without a plan
 * snapshot still settle through the effective quote ref, which is always
 * frozen. `carrierUnitId` marks the per-carrier Make when V31-47 fans a
 * package out into multiple attempts.
 */
import type {
  ExecutionPlanPackageBilling,
  MarketingPlanId,
} from '@meiye/contracts';
import { executionPlanPackageBillingSchema } from '@meiye/contracts';

export type BillingQuoteRef = {
  id: string;
  revision: string;
};

export type BillingIdentity = {
  workspaceId: string;
  /** Merchant task — the ProductQuote / ProductUsage ledger key. */
  taskId: string;
  /** Work aggregate this billing belongs to. */
  workId: string;
  /** Execution attempt (DBOS workflow) id. */
  workflowId: string;
  quoteRef: BillingQuoteRef;
  /** Explicit confirmation credit-hold operation, when a hold was created. */
  creditHoldOperationId?: string;
  /** Explicit credit-ledger consume operation used by refund/reconciliation. */
  creditUsageOperationId?: string;
  /** Explicit ProductUsage reservation row id (not a credit operation). */
  productUsageReservationId?: string;
  /**
   * Deprecated compatibility fingerprint. It is derived from the typed
   * operation fields and is never used as a credit refund operation id.
   */
  reservationId: string;
  /** Per-carrier Make unit when the package fans out (V31-47). */
  carrierUnitId?: string;
  /** Full package carrier set frozen at admission for Work-level settlement. */
  carrierUnitIds?: readonly string[];
  /** Frozen billable allocation for this carrier within the package quote. */
  carrierBillableUnits?: number;
  /**
   * Full immutable package allocation authority. It is present iff the
   * accepted execution-plan snapshot carries a package quote. Keeping the
   * whole table lets the Work receipt reducer prove exact allocation coverage
   * without inferring an allocation from a carrier label.
   */
  packageBilling?: ExecutionPlanPackageBilling;
  planId?: MarketingPlanId;
  planRevision?: number;
  snapshotHash?: string;
};

/**
 * Structural view of the durable request the identity is built from. Kept
 * local so execution-spine never imports harness/task-admission at runtime.
 */
export type BillingIdentitySource = {
  workspaceId?: string;
  /** Explicit typed operation fields persisted by a new admission writer. */
  creditHoldOperationId?: string;
  creditUsageOperationId?: string;
  productUsageReservationId?: string;
  /** Legacy alias accepted only when it matches the typed fingerprint. */
  reservationId?: string;
  /** Explicit ProductBilling task key frozen by task admission. */
  billingTaskId?: string;
  /** Explicit carrier selected by the compiled freeze, never inferred at settlement. */
  carrierUnitId?: string;
  carrierUnitIds?: readonly string[];
  carrierBillableUnits?: number;
  executionSnapshot?: {
    work?: { id?: string };
    quote?: { id: string; revision: string | number };
  } | null;
  executionPlanSnapshot?: {
    planId?: string;
    planRevision?: number;
    snapshotHash?: string;
    quoteRef?: { id: string; revision: string | number };
    packageBilling?: ExecutionPlanPackageBilling;
  } | null;
  pendingExecutionPlanSnapshot?: {
    snapshotHash?: string;
    content?: {
      planId?: string;
      planRevision?: number;
      quoteRef?: { id: string; revision: string | number };
      packageBilling?: ExecutionPlanPackageBilling;
    };
  } | null;
  executionConfirmationReservationIdempotencyKey?: string;
  usageReservation?: {
    id?: string;
    creditUsageOperationId?: string;
  } | null;
};

export class BillingIdentityError extends Error {
  constructor(
    readonly code:
      | 'BILLING_IDENTITY_UNAVAILABLE'
      | 'BILLING_IDENTITY_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'BillingIdentityError';
  }
}

function effectivePlan(request: BillingIdentitySource): {
  planId?: string;
  planRevision?: number;
  snapshotHash?: string;
  quoteRef?: { id: string; revision: string | number };
  packageBilling?: ExecutionPlanPackageBilling;
} | null {
  const admitted = request.executionPlanSnapshot;
  const pending = request.pendingExecutionPlanSnapshot?.content;
  if (!admitted && !pending) return null;
  const pendingWins =
    pending &&
    (!admitted || (pending.planRevision ?? 0) > (admitted.planRevision ?? 0));
  const plan = pendingWins
    ? { ...pending, snapshotHash: request.pendingExecutionPlanSnapshot?.snapshotHash }
    : admitted;
  if (!plan) return null;
  return {
    planId: plan.planId,
    planRevision: plan.planRevision,
    snapshotHash: plan.snapshotHash,
    quoteRef: plan.quoteRef,
    packageBilling: plan.packageBilling,
  };
}

function effectiveQuoteRef(
  request: BillingIdentitySource,
): BillingQuoteRef | null {
  const plan = effectivePlan(request);
  if (plan) {
    const planRef = plan.quoteRef;
    if (!planRef?.id?.trim() || !String(planRef.revision ?? '').trim()) {
      return null;
    }
    return { id: planRef.id, revision: String(planRef.revision) };
  }
  const snapshotRef = request.executionSnapshot?.quote;
  if (!snapshotRef?.id?.trim()) return null;
  return { id: snapshotRef.id, revision: String(snapshotRef.revision) };
}

/**
 * Canonical identity producer. Deterministic over the frozen request — the
 * same pure derivation runs at admission (freeze) and at settlement
 * (re-verification against the frozen copy). Returns null only when the
 * request carries no execution snapshot, i.e. nothing billable. Any other
 * missing required field fails closed instead of guessing.
 */
export function buildBillingIdentity(
  request: BillingIdentitySource,
  workflowId: string,
): BillingIdentity | null {
  const snapshot = request.executionSnapshot;
  if (!snapshot) return null;
  const workspaceId = request.workspaceId?.trim();
  if (!workspaceId) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires the frozen workspace.',
    );
  }
  const workId = snapshot.work?.id?.trim();
  if (!workId) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires the frozen work id.',
    );
  }
  const taskId = request.billingTaskId?.trim();
  if (!taskId) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires the frozen billing task id.',
    );
  }
  const quoteRef = effectiveQuoteRef(request);
  if (!quoteRef) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires the frozen quote reference.',
    );
  }
  const reservationId =
    request.reservationId?.trim();
  const creditHoldOperationId = resolveTypedOperation(
    'creditHoldOperationId',
    request.creditHoldOperationId,
    request.executionConfirmationReservationIdempotencyKey,
  );
  const creditUsageOperationId = resolveTypedOperation(
    'creditUsageOperationId',
    request.creditUsageOperationId,
    request.usageReservation?.creditUsageOperationId,
  );
  const productUsageReservationId = resolveTypedOperation(
    'productUsageReservationId',
    request.productUsageReservationId,
    request.usageReservation?.id,
  );
  if (!creditHoldOperationId && !creditUsageOperationId && !productUsageReservationId) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires an explicit frozen hold, credit usage, or ProductUsage operation.',
    );
  }
  const typedReservationId = billingIdentityReservationFingerprint({
    creditHoldOperationId,
    creditUsageOperationId,
    productUsageReservationId,
    ...(reservationId ? { reservationId } : {}),
  });
  const plan = effectivePlan(request);
  if (
    plan &&
    (!plan.planId?.trim() ||
      !Number.isSafeInteger(plan.planRevision) ||
      (plan.planRevision ?? 0) < 1 ||
      !plan.snapshotHash?.trim() ||
      !plan.quoteRef?.id?.trim() ||
      !String(plan.quoteRef.revision ?? '').trim())
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires the exact frozen plan, snapshot, and quote facts.',
    );
  }
  const carrierUnitId = request.carrierUnitId?.trim();
  const carrierUnitIds = request.carrierUnitIds?.map((value) => value.trim());
  if (
    !carrierUnitId ||
    !carrierUnitIds ||
    carrierUnitIds.length === 0 ||
    carrierUnitIds.some((value) => !value) ||
    new Set(carrierUnitIds).size !== carrierUnitIds.length ||
    !carrierUnitIds.includes(carrierUnitId)
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires one exact frozen carrier set containing its unit.',
    );
  }
  const carrierBillableUnits = request.carrierBillableUnits;
  if (
    typeof carrierBillableUnits !== 'number' ||
    !Number.isSafeInteger(carrierBillableUnits) ||
    carrierBillableUnits < 1
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires a positive frozen carrier billable allocation.',
    );
  }
  const packageBilling = plan?.packageBilling;
  if (packageBilling) {
    assertPackageBillingForCarrier({
      packageBilling,
      carrierUnitId,
      carrierUnitIds,
      carrierBillableUnits,
    });
  }
  return {
    workspaceId,
    taskId,
    workId,
    workflowId,
    quoteRef,
    ...(creditHoldOperationId ? { creditHoldOperationId } : {}),
    ...(creditUsageOperationId ? { creditUsageOperationId } : {}),
    ...(productUsageReservationId ? { productUsageReservationId } : {}),
    reservationId: typedReservationId,
    ...(plan
      ? {
          planId: plan.planId as MarketingPlanId,
          planRevision: plan.planRevision!,
          snapshotHash: plan.snapshotHash,
        }
      : {}),
    carrierUnitId,
    carrierUnitIds: [...carrierUnitIds].sort(),
    carrierBillableUnits,
    ...(packageBilling ? { packageBilling: structuredClone(packageBilling) } : {}),
  };
}

/**
 * Stable settlement ownership for one frozen carrier unit. This is separate
 * from `taskId`, which remains the aggregate ProductUsage ledger key.
 */
export function settlementIdempotencyKey(identity: BillingIdentity): string {
  const carrierUnitId = identity.carrierUnitId?.trim();
  if (!carrierUnitId) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Settlement idempotency requires the frozen carrier unit id.',
    );
  }
  const facts = [
    identity.workspaceId,
    identity.workId,
    identity.quoteRef.id,
    identity.quoteRef.revision,
    billingIdentityReservationFingerprint(identity),
    carrierUnitId,
    ...(identity.packageBilling
      ? [identity.packageBilling.contractHash, allocationIdForIdentity(identity)]
      : []),
  ];
  return `billing-unit:${facts.map(encodeSettlementFact).join(':')}`;
}

/**
 * Stable compatibility key for database ownership. The key includes every
 * explicit operation source, so no caller can silently substitute a hold key
 * for a credit consume operation (or a ProductUsage row id).
 */
export function billingIdentityReservationFingerprint(input: {
  creditHoldOperationId?: string;
  creditUsageOperationId?: string;
  productUsageReservationId?: string;
  reservationId?: string;
}): string {
  const creditHoldOperationId = optionalOperation(input.creditHoldOperationId);
  const creditUsageOperationId = optionalOperation(input.creditUsageOperationId);
  const productUsageReservationId = optionalOperation(input.productUsageReservationId);
  if (!creditHoldOperationId && !creditUsageOperationId && !productUsageReservationId) {
    const legacy = optionalOperation(input.reservationId);
    if (!legacy) {
      throw new BillingIdentityError(
        'BILLING_IDENTITY_UNAVAILABLE',
        'Billing identity has no explicit operation source.',
      );
    }
    return legacy;
  }
  const fingerprint = [
    'typed',
    creditHoldOperationId ?? '-',
    creditUsageOperationId ?? '-',
    productUsageReservationId ?? '-',
  ].join('|');
  const legacy = optionalOperation(input.reservationId);
  if (legacy && legacy !== fingerprint) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_MISMATCH',
      'Legacy reservationId does not match the explicit typed operation sources.',
    );
  }
  return fingerprint;
}

function optionalOperation(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function resolveTypedOperation(
  field: string,
  direct: string | undefined,
  legacy: string | undefined,
): string | undefined {
  const directValue = optionalOperation(direct);
  const legacyValue = optionalOperation(legacy);
  if (directValue && legacyValue && directValue !== legacyValue) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_MISMATCH',
      `Billing identity ${field} disagrees with its durable source.`,
    );
  }
  return directValue ?? legacyValue;
}

function allocationIdForIdentity(identity: BillingIdentity): string {
  const allocation = billingPackageAllocation(identity);
  if (!allocation) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity package allocation does not match its carrier unit.',
    );
  }
  return allocation.allocationId;
}

/**
 * Returns the current carrier's explicit package allocation after validating
 * the entire frozen table. A missing package is valid for legacy/single quote
 * flows and returns undefined; a malformed present package is never ignored.
 */
export function billingPackageAllocation(
  identity: BillingIdentity,
): ExecutionPlanPackageBilling['allocations'][number] | undefined {
  const packageBilling = identity.packageBilling;
  if (!packageBilling) return undefined;
  const carrierUnitId = identity.carrierUnitId?.trim();
  const carrierUnitIds = identity.carrierUnitIds?.map((value) => value.trim());
  if (!carrierUnitId || !carrierUnitIds) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity package allocation requires frozen carrier membership.',
    );
  }
  return assertPackageBillingForCarrier({
    packageBilling,
    carrierUnitId,
    carrierUnitIds,
    carrierBillableUnits: identity.carrierBillableUnits,
  });
}

function assertPackageBillingForCarrier(input: {
  packageBilling: ExecutionPlanPackageBilling;
  carrierUnitId: string;
  carrierUnitIds: readonly string[];
  carrierBillableUnits: number | undefined;
}): ExecutionPlanPackageBilling['allocations'][number] {
  const parsed = executionPlanPackageBillingSchema.safeParse(input.packageBilling);
  if (!parsed.success) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity package allocation is malformed.',
    );
  }
  const carrierUnitIds = input.carrierUnitIds.map((value) => value.trim());
  const allocations = parsed.data.allocations;
  const allocationByCarrier = new Map(
    allocations.map((allocation) => [allocation.carrierUnitId, allocation]),
  );
  const allocation = allocationByCarrier.get(input.carrierUnitId);
  if (
    allocations.length !== carrierUnitIds.length ||
    allocationByCarrier.size !== allocations.length ||
    carrierUnitIds.length === 0 ||
    new Set(carrierUnitIds).size !== carrierUnitIds.length ||
    carrierUnitIds.some((carrierUnitId) => !allocationByCarrier.has(carrierUnitId)) ||
    !allocation ||
    allocation.deliveryUnits !== input.carrierBillableUnits
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_UNAVAILABLE',
      'Billing identity requires an exact frozen package allocation for its carrier unit.',
    );
  }
  return allocation;
}

function encodeSettlementFact(value: string): string {
  // PostgreSQL can reproduce this exact encoding during the migration and
  // orphan-recovery queries with encode(convert_to(...), 'base64'). Colon is
  // outside the Base64 alphabet, so it remains an unambiguous delimiter.
  return Buffer.from(value, 'utf8').toString('base64');
}

export function assertSameBillingIdentity(
  expected: BillingIdentity,
  actual: BillingIdentity,
): void {
  if (
    expected.workspaceId !== actual.workspaceId ||
    expected.taskId !== actual.taskId ||
    expected.workId !== actual.workId ||
    expected.workflowId !== actual.workflowId ||
    expected.quoteRef.id !== actual.quoteRef.id ||
    expected.quoteRef.revision !== actual.quoteRef.revision ||
    expected.reservationId !== actual.reservationId ||
    expected.creditHoldOperationId !== actual.creditHoldOperationId ||
    expected.creditUsageOperationId !== actual.creditUsageOperationId ||
    expected.productUsageReservationId !== actual.productUsageReservationId ||
    expected.carrierUnitId !== actual.carrierUnitId ||
    JSON.stringify(expected.carrierUnitIds ?? []) !==
      JSON.stringify(actual.carrierUnitIds ?? []) ||
    expected.carrierBillableUnits !== actual.carrierBillableUnits ||
    JSON.stringify(expected.packageBilling ?? null) !==
      JSON.stringify(actual.packageBilling ?? null) ||
    expected.planId !== actual.planId ||
    expected.planRevision !== actual.planRevision ||
    expected.snapshotHash !== actual.snapshotHash
  ) {
    throw new BillingIdentityError(
      'BILLING_IDENTITY_MISMATCH',
      'Billing identity does not match the identity frozen at admission.',
    );
  }
}

/** Credit consume idempotency keys always carry the `consume:` prefix. */
export function isCreditReservationId(reservationId: string): boolean {
  return reservationId.startsWith('consume:');
}

/** Branded constructor for plan ids flowing into a BillingIdentity. */
export function billingPlanId(value: string): MarketingPlanId {
  return value as MarketingPlanId;
}
