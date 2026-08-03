import type { getDb as getDatabase } from '@/db';
import { sql } from 'drizzle-orm';
import type {
  CreditPackageCheckoutBindingFacts,
  CreditPackageSettlementClaim,
  CreditPackageOrderEvent,
} from './credit-package-commerce';
import type { PaymentProviderName } from './types';

type PaymentDatabase = ReturnType<typeof getDatabase>;

interface IdentifierRow extends Record<string, unknown> {
  id: string;
}

interface BindingRow extends Record<string, unknown> {
  id: string;
  offerId: string;
  ownerUserId: string;
  productId: string;
  workspaceId: string;
}

interface SettlementRow extends BindingRow {
  providerOrderId: string | null;
  providerPaymentEventId: string | null;
  settlementStatus: 'pending' | 'processing' | 'settled';
}

export class CreditPackageSettlementContractError extends Error {
  readonly code = 'CREDIT_PACKAGE_SETTLEMENT_CONTRACT_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CreditPackageSettlementContractError';
  }
}

export class CreditPackageSettlementConflictError extends Error {
  readonly code = 'CREDIT_PACKAGE_SETTLEMENT_CONFLICT' as const;

  constructor() {
    super('Waffo credit package order conflicts with its checkout binding.');
    this.name = 'CreditPackageSettlementConflictError';
  }
}

export class CreditPackageSettlementInProgressError extends Error {
  readonly code = 'CREDIT_PACKAGE_SETTLEMENT_IN_PROGRESS' as const;

  constructor() {
    super('Waffo credit package settlement is already in progress.');
    this.name = 'CreditPackageSettlementInProgressError';
  }
}

export class PostgresCreditPackageCheckoutBindingStore {
  constructor(private readonly database: PaymentDatabase) {}

  async createOwnerBinding(input: {
    offerId: string;
    ownerUserId: string;
    productId: string;
    provider: PaymentProviderName;
    workspaceId: string;
  }) {
    const id = `cpb_${crypto.randomUUID()}`;
    const rows = await this.database.execute<IdentifierRow>(sql`
      INSERT INTO credit_package_checkout_bindings
        (id, provider, product_id, offer_id, workspace_id, owner_user_id,
         status, created_at, updated_at)
      SELECT
        ${id}, ${input.provider}, ${input.productId}, ${input.offerId},
        ${input.workspaceId}, ${input.ownerUserId}, 'pending', now(), now()
      FROM workspace_memberships
      WHERE workspace_memberships.workspace_id = ${input.workspaceId}
        AND workspace_memberships.user_id = ${input.ownerUserId}
        AND workspace_memberships.role = 'owner'
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return rows[0] ?? null;
  }

  async attachProviderCheckout(input: {
    bindingId: string;
    providerCheckoutId: string;
  }) {
    const rows = await this.database.execute<IdentifierRow>(sql`
      UPDATE credit_package_checkout_bindings
      SET provider_checkout_id = COALESCE(
            provider_checkout_id,
            ${input.providerCheckoutId}
          ),
          status = CASE
            WHEN status = 'pending' THEN 'checkout_created'
            ELSE status
          END,
          updated_at = now()
      WHERE id = ${input.bindingId}
        AND status IN ('pending', 'checkout_created', 'settled')
        AND (
          provider_checkout_id IS NULL
          OR provider_checkout_id = ${input.providerCheckoutId}
        )
      RETURNING id
    `);
    if (!rows[0]) {
      throw new Error('Credit package checkout binding was not attached.');
    }
  }

  async markCheckoutFailed(bindingId: string) {
    await this.database.execute(sql`
      UPDATE credit_package_checkout_bindings
      SET status = 'failed', updated_at = now()
      WHERE id = ${bindingId} AND status = 'pending'
    `);
  }

  async claimSettlement(
    event: CreditPackageOrderEvent
  ): Promise<CreditPackageSettlementClaim | null> {
    const bindingId = requiredValue(
      event.packageCheckoutBindingId,
      'checkout binding id'
    );
    const buyerIdentity = requiredValue(event.buyerIdentity, 'buyer identity');
    const orderId = requiredValue(event.reference.id, 'provider order id');
    const paymentEventId = requiredValue(
      event.providerEventId,
      'provider payment event id'
    );
    const claimToken = crypto.randomUUID();
    const claimed = await this.database.execute<BindingRow>(sql`
      UPDATE credit_package_checkout_bindings
      SET provider_order_id = COALESCE(provider_order_id, ${orderId}),
          provider_payment_event_id = COALESCE(
            provider_payment_event_id,
            ${paymentEventId}
          ),
          settlement_status = 'processing',
          settlement_claim_token = ${claimToken},
          settlement_lease_expires_at = now() + interval '5 minutes',
          updated_at = now()
      WHERE id = ${bindingId}
        AND provider = ${event.provider}
        AND owner_user_id = ${buyerIdentity}
        AND status IN ('pending', 'checkout_created', 'settled')
        AND (
          provider_order_id IS NULL OR provider_order_id = ${orderId}
        )
        AND (
          settlement_status = 'pending'
          OR (
            settlement_status = 'processing'
            AND (
              settlement_lease_expires_at IS NULL
              OR settlement_lease_expires_at <= now()
            )
          )
        )
      RETURNING
        id,
        offer_id AS "offerId",
        owner_user_id AS "ownerUserId",
        product_id AS "productId",
        workspace_id AS "workspaceId"
    `);
    if (claimed[0]) {
      return { binding: claimed[0], claimToken, status: 'claimed' };
    }

    const rows = await this.database.execute<SettlementRow>(sql`
      SELECT
        id,
        offer_id AS "offerId",
        owner_user_id AS "ownerUserId",
        product_id AS "productId",
        workspace_id AS "workspaceId",
        provider_order_id AS "providerOrderId",
        provider_payment_event_id AS "providerPaymentEventId",
        settlement_status AS "settlementStatus"
      FROM credit_package_checkout_bindings
      WHERE id = ${bindingId}
        AND provider = ${event.provider}
        AND owner_user_id = ${buyerIdentity}
      LIMIT 1
    `);
    const current = rows[0];
    if (!current) return null;
    if (current.providerOrderId && current.providerOrderId !== orderId) {
      throw new CreditPackageSettlementConflictError();
    }
    if (current.settlementStatus === 'settled') {
      return { binding: bindingFacts(current), status: 'duplicate' };
    }
    throw new CreditPackageSettlementInProgressError();
  }

  async completeSettlement(input: { bindingId: string; claimToken: string }) {
    const rows = await this.database.execute<IdentifierRow>(sql`
      UPDATE credit_package_checkout_bindings
      SET status = 'settled',
          settlement_status = 'settled',
          settlement_completed_at = now(),
          settlement_claim_token = NULL,
          settlement_lease_expires_at = NULL,
          updated_at = now()
      WHERE id = ${input.bindingId}
        AND settlement_status = 'processing'
        AND settlement_claim_token = ${input.claimToken}
      RETURNING id
    `);
    if (!rows[0]) {
      throw new Error('Credit package settlement claim was not completed.');
    }
  }
}

function requiredValue(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new CreditPackageSettlementContractError(
      `Waffo credit package settlement is missing ${field}.`
    );
  }
  return normalized;
}

function bindingFacts(row: BindingRow): CreditPackageCheckoutBindingFacts {
  return {
    id: row.id,
    offerId: row.offerId,
    ownerUserId: row.ownerUserId,
    productId: row.productId,
    workspaceId: row.workspaceId,
  };
}
