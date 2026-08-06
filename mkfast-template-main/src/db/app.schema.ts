/**
 * Application database schema (non-auth tables).
 * Add your app tables here; keep Better Auth tables in auth.schema.ts.
 */

import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  PaymentScene,
  PaymentStatus,
  PaymentType,
  PaymentProviderName,
  PlanInterval,
  VerifiedPaymentWebhookEvent,
} from '@/payment/types';
import { session as authSession, user } from './auth.schema';

export type WorkspaceRole = 'owner' | 'operator' | 'reviewer' | 'admin';

/**
 * Immutable platform role-change audit (Spec A / #366).
 * Database trigger rejects UPDATE and DELETE.
 */
export const adminRoleChangeAudit = pgTable(
  'admin_role_change_audit',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').notNull(),
    subjectUserId: text('subject_user_id').notNull(),
    fromRole: text('from_role').notNull(),
    toRole: text('to_role').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('admin_role_change_audit_subject_idx').on(table.subjectUserId),
    index('admin_role_change_audit_actor_idx').on(table.actorUserId),
  ]
);

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .default('')
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<WorkspaceRole>().default('owner').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId],
      name: 'workspace_memberships_workspace_id_user_id_pk',
    }),
    index('workspace_memberships_user_id_idx').on(table.userId),
  ]
);

export const workspaceRelations = relations(workspaces, ({ many }) => ({
  memberships: many(workspaceMemberships),
}));

export const workspaceMembershipRelations = relations(
  workspaceMemberships,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMemberships.workspaceId],
      references: [workspaces.id],
    }),
    user: one(user, {
      fields: [workspaceMemberships.userId],
      references: [user.id],
    }),
  })
);

export type WorkspaceProvisioningStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'completed';
export type WorkspaceProvisioningStepStatus = 'pending' | 'completed';

export const workspaceProvisioningOutbox = pgTable(
  'workspace_provisioning_outbox',
  {
    workspaceId: text('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ownerEmail: text('owner_email').notNull(),
    ownerName: text('owner_name').notNull(),
    workspaceName: text('workspace_name').notNull(),
    status: text('status')
      .$type<WorkspaceProvisioningStatus>()
      .default('pending')
      .notNull(),
    trialStatus: text('trial_status')
      .$type<WorkspaceProvisioningStepStatus>()
      .default('pending')
      .notNull(),
    modelDefaultStatus: text('model_default_status')
      .$type<WorkspaceProvisioningStepStatus>()
      .default('pending')
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimToken: text('claim_token'),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('workspace_provisioning_outbox_ready_idx').on(
      table.status,
      table.availableAt,
    ),
    index('workspace_provisioning_outbox_owner_idx').on(table.ownerUserId),
  ],
);

/**
 * Payment: subscription and one-time.
 */
export const payment = pgTable(
  'payment',
  {
    id: text('id').primaryKey(),
    provider: text('provider').$type<PaymentProviderName>(),
    priceId: text('price_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    customerId: text('customer_id').notNull(),
    subscriptionId: text('subscription_id'),
    waffoProviderOccurredAt: timestamp('waffo_provider_occurred_at', {
      withTimezone: true,
    }),
    waffoEventId: text('waffo_event_id'),
    waffoEventRank: integer('waffo_event_rank'),
    sessionId: text('session_id'),
    invoiceId: text('invoice_id').unique(),
    type: text('type').notNull().$type<PaymentType>(),
    scene: text('scene').$type<PaymentScene>(),
    interval: text('interval').$type<PlanInterval>(),
    status: text('status').notNull().$type<PaymentStatus>(),
    paid: boolean('paid').notNull().default(false),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end'),
    trialStart: timestamp('trial_start', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('payment_provider_idx').on(table.provider),
    index('payment_user_id_idx').on(table.userId),
    index('payment_customer_id_idx').on(table.customerId),
    index('payment_subscription_id_idx').on(table.subscriptionId),
    index('payment_session_id_idx').on(table.sessionId),
    uniqueIndex('payment_subscription_id_unique').on(table.subscriptionId),
    uniqueIndex('payment_session_id_unique').on(table.sessionId),
    index('payment_invoice_id_idx').on(table.invoiceId),
    index('payment_paid_idx').on(table.paid),
    index('payment_user_paid_idx').on(table.userId, table.paid),
  ]
);

export const paymentRelations = relations(payment, ({ one }) => ({
  user: one(user, { fields: [payment.userId], references: [user.id] }),
}));

/**
 * Tc-1: plan checkout → workspace binding (multi-workspace safe).
 * Workspace is claimed at checkout create; webhook settlement joins on
 * provider_checkout_id / subscription_id.
 */
export const planCheckoutBindings = pgTable(
  'plan_checkout_bindings',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().$type<PaymentProviderName>(),
    priceId: text('price_id').notNull(),
    paymentType: text('payment_type').notNull().$type<PaymentType>(),
    interval: text('interval').$type<PlanInterval | 'lifetime'>(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerCheckoutId: text('provider_checkout_id'),
    subscriptionId: text('subscription_id'),
    replacesSubscriptionId: text('replaces_subscription_id'),
    status: text('status')
      .$type<'pending' | 'checkout_created' | 'active' | 'canceled' | 'failed'>()
      .default('pending')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('plan_checkout_bindings_provider_checkout_uidx').on(
      table.provider,
      table.providerCheckoutId
    ),
    index('plan_checkout_bindings_workspace_id_idx').on(table.workspaceId),
    index('plan_checkout_bindings_owner_user_id_idx').on(table.ownerUserId),
    index('plan_checkout_bindings_subscription_id_idx').on(
      table.subscriptionId
    ),
    index('plan_checkout_bindings_replaces_subscription_id_idx').on(
      table.replacesSubscriptionId
    ),
    // One in-flight Waffo checkout per owner and workspace: closes the
    // concurrent double-checkout race at the storage layer.
    uniqueIndex('plan_checkout_bindings_waffo_inflight_uidx')
      .on(table.ownerUserId, table.workspaceId)
      .where(
        sql`provider = 'waffo' AND status IN ('pending', 'checkout_created')`
      ),
  ]
);

/**
 * A Waffo one-time credit package is independent from subscription plan
 * lifecycle state. Its signed order reference points at this owner/workspace
 * binding, which in turn selects the Core credit-package SKU.
 */
export const creditPackageCheckoutBindings = pgTable(
  'credit_package_checkout_bindings',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().$type<PaymentProviderName>(),
    productId: text('product_id').notNull(),
    offerId: text('offer_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    skuAmountMicros: bigint('sku_amount_micros', { mode: 'number' }),
    skuCurrency: text('sku_currency'),
    skuCredits: integer('sku_credits'),
    skuExpireDays: integer('sku_expire_days'),
    skuFingerprint: text('sku_fingerprint'),
    providerCheckoutId: text('provider_checkout_id'),
    providerOrderId: text('provider_order_id'),
    providerPaymentEventId: text('provider_payment_event_id'),
    status: text('status')
      .$type<'pending' | 'checkout_created' | 'settled' | 'failed'>()
      .default('pending')
      .notNull(),
    settlementStatus: text('settlement_status')
      .$type<'pending' | 'processing' | 'settled'>()
      .default('pending')
      .notNull(),
    settlementClaimToken: text('settlement_claim_token'),
    settlementLeaseExpiresAt: timestamp('settlement_lease_expires_at', {
      withTimezone: true,
    }),
    settlementCompletedAt: timestamp('settlement_completed_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('credit_package_checkout_bindings_provider_checkout_uidx').on(
      table.provider,
      table.providerCheckoutId
    ),
    index('credit_package_checkout_bindings_workspace_idx').on(
      table.workspaceId,
      table.ownerUserId
    ),
    // A retry must not create a second Waffo checkout for the same package.
    // Terminal bindings stay replayable but release the next package purchase.
    uniqueIndex('credit_package_checkout_bindings_waffo_inflight_uidx')
      .on(table.provider, table.workspaceId, table.ownerUserId, table.offerId)
      .where(sql`status IN ('pending', 'checkout_created')`),
    uniqueIndex('credit_package_checkout_bindings_provider_order_uidx')
      .on(table.provider, table.providerOrderId)
      .where(sql`provider_order_id IS NOT NULL`),
    uniqueIndex('credit_package_checkout_bindings_provider_payment_event_uidx')
      .on(table.provider, table.providerPaymentEventId)
      .where(sql`provider_payment_event_id IS NOT NULL`),
  ]
);

/** Waffo downgrade/interval changes are parked until a provider primitive exists. */
export const waffoSubscriptionChanges = pgTable(
  'waffo_subscription_changes',
  {
    subscriptionId: text('subscription_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    targetPriceId: text('target_price_id').notNull(),
    targetInterval: text('target_interval').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'pending' | 'applied' | 'canceled'>()
      .default('pending')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('waffo_subscription_changes_workspace_idx').on(table.workspaceId),
    index('waffo_subscription_changes_status_idx').on(table.status),
  ]
);

/**
 * Durable provider side-effect checkpoint for one-time Waffo single-month
 * cancellation. The subscription+period key is stable across delivery
 * replays and worker restarts.
 */
export const waffoSubscriptionCancellationReceipts = pgTable(
  'waffo_subscription_cancellation_receipts',
  {
    subscriptionId: text('subscription_id').notNull(),
    periodStartsAt: timestamp('period_starts_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'pending' | 'processing' | 'completed'>()
      .default('pending')
      .notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimToken: text('claim_token'),
    lastErrorCode: text('last_error_code'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.subscriptionId, table.periodStartsAt],
      name: 'waffo_subscription_cancellation_receipts_pk',
    }),
    index('waffo_subscription_cancellation_receipts_status_idx').on(
      table.status,
    ),
  ],
);

export const proStudioCheckoutBindings = pgTable(
  'pro_studio_checkout_bindings',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().$type<PaymentProviderName>(),
    offerId: text('offer_id').notNull(),
    priceId: text('price_id').notNull(),
    paymentType: text('payment_type').notNull().$type<PaymentType>(),
    interval: text('interval').$type<PlanInterval>(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ownerSessionId: text('owner_session_id')
      .references(() => authSession.id, { onDelete: 'set null' }),
    providerCheckoutId: text('provider_checkout_id'),
    status: text('status')
      .$type<'pending' | 'checkout_created' | 'failed'>()
      .default('pending')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('pro_studio_checkout_bindings_provider_checkout_uidx').on(
      table.provider,
      table.providerCheckoutId
    ),
    index('pro_studio_checkout_bindings_workspace_id_idx').on(
      table.workspaceId
    ),
    index('pro_studio_checkout_bindings_owner_user_id_idx').on(
      table.ownerUserId
    ),
  ]
);

export const proStudioPaymentClaims = pgTable(
  'pro_studio_payment_claims',
  {
    paymentId: text('payment_id')
      .primaryKey()
      .references(() => payment.id, { onDelete: 'cascade' }),
    paymentEventId: text('payment_event_id').notNull().unique(),
    provider: text('provider').notNull().$type<PaymentProviderName>(),
    providerEventId: text('provider_event_id').notNull(),
    providerCheckoutId: text('provider_checkout_id').notNull(),
    offerId: text('offer_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    priceId: text('price_id').notNull(),
    status: text('status')
      .notNull()
      .$type<'pending' | 'activating' | 'active'>()
      .default('pending'),
    activationAttempts: integer('activation_attempts').notNull().default(0),
    activationAvailableAt: timestamp('activation_available_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    activationLeaseUntil: timestamp('activation_lease_until', {
      withTimezone: true,
    }),
    lastActivationError: text('last_activation_error'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('pro_studio_payment_claims_workspace_id_idx').on(table.workspaceId),
    uniqueIndex('pro_studio_payment_claims_provider_event_uidx').on(
      table.provider,
      table.providerEventId
    ),
    index('pro_studio_payment_claims_activation_due_idx').on(
      table.status,
      table.activationAvailableAt
    ),
  ]
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    status: text('status')
      .$type<'verified' | 'processed'>()
      .notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.eventId],
      name: 'payment_webhook_events_provider_event_id_pk',
    }),
    index('payment_webhook_events_status_idx').on(table.status),
  ]
);

export type PaymentWebhookSettlementStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'completed';

export const paymentWebhookSettlementOutbox = pgTable(
  'payment_webhook_settlement_outbox',
  {
    provider: text('provider').notNull().$type<PaymentProviderName>(),
    eventId: text('event_id').notNull(),
    payload: text('payload').notNull(),
    signature: text('signature').notNull(),
    status: text('status')
      .$type<PaymentWebhookSettlementStatus>()
      .default('pending')
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimToken: text('claim_token'),
    lastErrorCode: text('last_error_code'),
    providerAppliedAt: timestamp('provider_applied_at', { withTimezone: true }),
    normalizedEvent: jsonb('normalized_event').$type<
      VerifiedPaymentWebhookEvent | null
    >(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.eventId],
      name: 'payment_webhook_settlement_outbox_provider_event_id_pk',
    }),
    foreignKey({
      columns: [table.provider, table.eventId],
      foreignColumns: [
        paymentWebhookEvents.provider,
        paymentWebhookEvents.eventId,
      ],
      name: 'payment_webhook_settlement_outbox_event_fk',
    }).onDelete('cascade'),
    index('payment_webhook_settlement_outbox_ready_idx').on(
      table.status,
      table.availableAt
    ),
  ]
);

/**
 * Waffo refunds are audit-only in the credit billing flow. A recorded refund
 * never reverses grant lots; an operator resolves the separate review item.
 */
export const paymentRefundEvents = pgTable(
  'payment_refund_events',
  {
    provider: text('provider').notNull().$type<PaymentProviderName>(),
    providerEventId: text('provider_event_id').notNull(),
    providerDeliveryId: text('provider_delivery_id').notNull(),
    orderId: text('order_id').notNull(),
    orderMerchantExternalId: text('order_merchant_external_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    scene: text('scene').notNull().$type<'refund'>(),
    amount: text('amount').notNull(),
    currency: text('currency').notNull(),
    eventStatus: text('event_status').notNull().$type<'failed' | 'succeeded'>(),
    rawPayload: text('raw_payload').notNull(),
    providerOccurredAt: timestamp('provider_occurred_at', {
      withTimezone: true,
    }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    dispositionStatus: text('disposition_status')
      .$type<'pending_review' | 'resolved'>()
      .default('pending_review')
      .notNull(),
    dispositionActorUserId: text('disposition_actor_user_id').references(
      () => user.id,
      { onDelete: 'set null' }
    ),
    dispositionNote: text('disposition_note'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerEventId],
      name: 'payment_refund_events_provider_event_id_pk',
    }),
    index('payment_refund_events_pending_review_idx').on(
      table.dispositionStatus,
      table.receivedAt
    ),
  ]
);

/** Durable, retryable operations alert for one recorded Waffo refund. */
export const paymentRefundReviewAlertOutbox = pgTable(
  'payment_refund_review_alert_outbox',
  {
    provider: text('provider').notNull().$type<PaymentProviderName>(),
    providerEventId: text('provider_event_id').notNull(),
    status: text('status')
      .$type<'pending' | 'processing' | 'completed'>()
      .default('pending')
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimToken: text('claim_token'),
    lastErrorCode: text('last_error_code'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerEventId],
      name: 'payment_refund_review_alert_outbox_pk',
    }),
    foreignKey({
      columns: [table.provider, table.providerEventId],
      foreignColumns: [
        paymentRefundEvents.provider,
        paymentRefundEvents.providerEventId,
      ],
      name: 'payment_refund_review_alert_outbox_refund_fk',
    }).onDelete('cascade'),
    index('payment_refund_review_alert_outbox_ready_idx').on(
      table.status,
      table.availableAt
    ),
  ]
);

/**
 * User files: metadata for files uploaded to R2.
 */
export const userFiles = pgTable(
  'user_files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .default('')
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    originalName: text('original_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    r2Key: text('r2_key').notNull(),
    storageRevision: text('storage_revision'),
    purpose: text('purpose').default('private_file').notNull(),
    isPublic: boolean('is_public'),
    description: text('description'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('user_files_user_id_idx').on(table.userId),
    index('user_files_workspace_id_idx').on(table.workspaceId),
    index('user_files_r2_key_idx').on(table.r2Key),
  ]
);

/**
 * Immutable proof captured during the storage privacy migration for a
 * historical public avatar that had no user_files metadata row.
 */
export const legacyAvatarAccessClaims = pgTable(
  'legacy_avatar_access_claims',
  {
    objectKey: text('object_key').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    imageUrl: text('image_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('legacy_avatar_access_claims_user_idx').on(table.userId),
  ],
);

export type StorageObjectOutboxStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'completed';
export type StorageObjectDeleteReason =
  | 'upload_compensation'
  | 'user_delete';

export const storageObjectOutbox = pgTable(
  'storage_object_outbox',
  {
    id: text('id').primaryKey(),
    operation: text('operation').default('delete_object').notNull(),
    reason: text('reason').$type<StorageObjectDeleteReason>().notNull(),
    objectKey: text('object_key').notNull(),
    receiptStorageRevision: text('receipt_storage_revision'),
    userFileId: text('user_file_id'),
    userId: text('user_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    status: text('status')
      .$type<StorageObjectOutboxStatus>()
      .default('pending')
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimToken: text('claim_token'),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('storage_object_outbox_ready_idx').on(
      table.status,
      table.availableAt,
    ),
    uniqueIndex('storage_object_outbox_user_file_idx').on(table.userFileId),
  ],
);

export type StorageObjectCleanupClaimStatus =
  | 'delete_failed'
  | 'deleted'
  | 'deleting'
  | 'referenced'
  | 'registration_recovered';

/** Durable object identity state shared by registration and deletion workers. */
export const storageObjectCleanupClaims = pgTable(
  'storage_object_cleanup_claims',
  {
    workspaceId: text('workspace_id').notNull(),
    objectKey: text('object_key').notNull(),
    status: text('status').$type<StorageObjectCleanupClaimStatus>().notNull(),
    receiptStorageRevision: text('receipt_storage_revision'),
    deleteAttemptCount: integer('delete_attempt_count').default(0).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastError: text('last_error'),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.objectKey],
      name: 'storage_object_cleanup_claims_workspace_object_pk',
    }),
  ],
);

export const userFilesRelations = relations(userFiles, ({ one }) => ({
  user: one(user, {
    fields: [userFiles.userId],
    references: [user.id],
  }),
  workspace: one(workspaces, {
    fields: [userFiles.workspaceId],
    references: [workspaces.id],
  }),
}));
