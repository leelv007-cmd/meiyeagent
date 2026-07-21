import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { user } from '@/db/auth.schema';
import type { Payment } from '@/db/types';
import {
  PAYMENT_RECORD_RETRY_ATTEMPTS,
  PAYMENT_RECORD_RETRY_DELAY,
} from '@/payment/constants';
import { sendPaymentNotification } from '@/notification';
import {
  PostgresPaymentRecordEffectStore,
  persistPaymentRecordEffect,
} from '@/payment/payment-record-effect';
import { StripeNewCommerceRetiredError } from '@/payment/checkout-policy';
import { logPaymentWebhookError } from '@/payment/webhook-logging';
import { desc, eq } from 'drizzle-orm';
import { Stripe } from 'stripe';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  CreatePortalParams,
  PaymentProvider,
  PaymentStatus,
  PlanInterval,
  PortalResult,
  ServerCatalogOffer,
} from '../types';
import { PlanIntervals, PaymentScenes, PaymentTypes } from '../types';
import { normalizeStripeVerifiedPaymentEvent } from '../verified-webhook-event';

export const STRIPE_HISTORICAL_API_VERSION: Stripe.LatestApiVersion =
  '2025-02-24.acacia';

/**
 * Stripe payment provider implementation
 */
export class StripeProvider implements PaymentProvider {
  private stripe: Stripe;
  private webhookSecret: string;

  /**
   * Initialize Stripe provider with API key
   */
  constructor() {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set.');
    }

    this.stripe = new Stripe(apiKey, {
      apiVersion: STRIPE_HISTORICAL_API_VERSION,
    });
    this.webhookSecret = webhookSecret;
  }

  getProviderName(): string {
    return 'stripe';
  }

  async validateServerCatalogOffer(offer: ServerCatalogOffer) {
    void offer;
    throw new StripeNewCommerceRetiredError();
  }

  /**
   * Finds a user by customerId
   * @param customerId Stripe customer ID
   * @returns User ID or undefined if not found
   */
  private async findUserIdByCustomerId(
    customerId: string
  ): Promise<string | undefined> {
    try {
      // Query the user table for a matching customerId
      const db = getDb();
      const result = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.customerId, customerId))
        .limit(1);

      if (result.length > 0) {
        return result[0].id;
      }
      console.warn('No user found with given customerId');

      return undefined;
    } catch (error) {
      logPaymentWebhookError({
        error,
        provider: 'stripe',
        stage: 'provider_effect',
      });
      return undefined;
    }
  }
  /**
   * Validates that a checkout session has required metadata
   * @param session Stripe checkout session
   * @returns Object with userId and customerId
   * @throws Error if required fields are missing
   */
  private validateSessionMetadata(session: Stripe.Checkout.Session): {
    userId: string;
    customerId: string;
  } {
    const userId = session.metadata?.userId;
    if (!userId || userId.trim() === '') {
      throw new Error(
        `Checkout session ${session.id} missing or empty userId in metadata - cannot process`
      );
    }

    const customerId = session.customer;
    if (!customerId || typeof customerId !== 'string') {
      throw new Error(
        `Checkout session ${session.id} missing or invalid customerId - cannot process`
      );
    }

    return { userId, customerId };
  }

  /**
   * Create a checkout session for a plan
   * @param params Parameters for creating the checkout session
   * @returns Checkout result
   */
  public async createCheckout(
    params: CreateCheckoutParams
  ): Promise<CheckoutResult> {
    void params;
    throw new StripeNewCommerceRetiredError();
  }

  /**
   * Create a customer portal session
   * @param params Parameters for creating the portal
   * @returns Portal result
   */
  public async createCustomerPortal(
    params: CreatePortalParams
  ): Promise<PortalResult> {
    void params;
    throw new StripeNewCommerceRetiredError();
  }

  /**
   * Handle webhook event
   * @param payload Raw webhook payload
   * @param signature Webhook signature
   */
  public async handleWebhookEvent(payload: string, signature: string) {
    try {
      // Verify the event signature if webhook secret is available
      const event = await this.stripe.webhooks.constructEventAsync(
        payload,
        signature,
        this.webhookSecret
      );
      const eventType = event.type;
      console.log(`handle webhook event, type: ${eventType}`);

      // Handle subscription events
      if (eventType.startsWith('customer.subscription.')) {
        const stripeSubscription = event.data.object as Stripe.Subscription;

        // Process based on subscription status and event type
        switch (eventType) {
          case 'customer.subscription.created': {
            await this.onCreateSubscription(stripeSubscription);
            break;
          }
          case 'customer.subscription.updated': {
            await this.onUpdateSubscription(stripeSubscription);
            break;
          }
          case 'customer.subscription.deleted': {
            await this.onDeleteSubscription(stripeSubscription);
            break;
          }
        }
      } else if (eventType.startsWith('invoice.')) {
        // Handle invoice events
        switch (eventType) {
          case 'invoice.paid': {
            const invoice = event.data.object as Stripe.Invoice;
            await this.onInvoicePaid(invoice);
            break;
          }
        }
      } else if (eventType.startsWith('checkout.')) {
        // Handle checkout events
        if (eventType === 'checkout.session.completed') {
          const session = event.data.object as Stripe.Checkout.Session;
          await this.onCheckoutCompleted(session);
        }
      }
      return normalizeStripeVerifiedPaymentEvent(event);
    } catch (error) {
      logPaymentWebhookError({
        error,
        provider: 'stripe',
        stage: 'provider_effect',
      });
      throw new Error('Failed to handle webhook event');
    }
  }

  private async findPaymentRecord(
    invoice: Stripe.Invoice
  ): Promise<Payment | null> {
    try {
      const db = getDb();

      // Strategy 1: Find by invoice ID (most reliable)
      if (invoice.id) {
        const paymentsByInvoice = await db
          .select()
          .from(payment)
          .where(eq(payment.invoiceId, invoice.id))
          .orderBy(desc(payment.createdAt))
          .limit(1);

        if (paymentsByInvoice.length > 0) {
          console.log('Found payment record by invoice ID');
          return paymentsByInvoice[0];
        }
      }

      // Strategy 2: For subscription payments, find by subscription ID
      const subscriptionId = this.extractSubscriptionId(invoice);
      if (subscriptionId) {
        const paymentsBySubscription = await db
          .select()
          .from(payment)
          .where(eq(payment.subscriptionId, subscriptionId))
          .orderBy(desc(payment.createdAt))
          .limit(1);

        if (paymentsBySubscription.length > 0) {
          console.log('Found payment record by subscription ID');
          return paymentsBySubscription[0];
        }
      }

      console.warn('No payment record found for invoice:', invoice.id);
      return null;
    } catch (error) {
      logPaymentWebhookError({
        error,
        provider: 'stripe',
        stage: 'provider_effect',
      });
      return null;
    }
  }

  /**
   * Find payment record with retry mechanism to handle race conditions
   * @param invoice Stripe invoice
   * @returns Payment record or null if not found after all retries
   */
  private async findPaymentRecordWithRetry(
    invoice: Stripe.Invoice
  ): Promise<Payment | null> {
    console.log(`>> Find payment record for invoice: ${invoice.id}`);

    for (let attempt = 1; attempt <= PAYMENT_RECORD_RETRY_ATTEMPTS; attempt++) {
      const paymentRecord = await this.findPaymentRecord(invoice);

      if (paymentRecord) {
        console.log(`<< Found payment record on attempt ${attempt}`);
        return paymentRecord;
      }

      if (attempt < PAYMENT_RECORD_RETRY_ATTEMPTS) {
        console.log(
          `Payment record not found, retry in ${PAYMENT_RECORD_RETRY_DELAY}ms`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, PAYMENT_RECORD_RETRY_DELAY)
        );
      }
    }

    console.error('<< Payment record not found after all attempts');
    return null;
  }

  /**
   * Handle successful invoice payment
   * Find existing payment record and update all fields appropriately
   *
   * For one-time payments, the order of events may be:
   * checkout.session.completed
   * invoice.paid
   *
   * For subscription payments, the order of events may be:
   * checkout.session.completed
   * customer.subscription.created
   * customer.subscription.updated
   * invoice.paid
   *
   * For subscription renewals, the order of events may be:
   * customer.subscription.updated
   * invoice.paid  (a new invoice, but same payment record is used)
   *
   * User can update the subscription in customer portal,
   * For subscription upgrades, the order of events may be:
   * invoice.paid  (a new invoice, but same payment record is used)
   *
   * @param invoice Stripe invoice
   */
  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    console.log('>> Handle invoice paid, invoiceId:', invoice.id);

    try {
      // Find existing payment record with retry mechanism
      const paymentRecord = await this.findPaymentRecordWithRetry(invoice);
      if (!paymentRecord) {
        console.error('<< Payment record not found for invoice:', invoice.id);
        throw new Error(`Payment record not found for invoice: ${invoice.id}`);
      }

      // Determine payment type based on existing payment record type
      // This is more reliable than checking invoice.subscription field
      const isSubscriptionPayment =
        paymentRecord.type === PaymentTypes.SUBSCRIPTION;

      if (isSubscriptionPayment) {
        // This is a subscription payment
        await this.updateSubscriptionPayment(invoice, paymentRecord);
      } else {
        // This is a one-time payment
        await this.updateOneTimePayment(invoice, paymentRecord);
      }
    } catch (error) {
      logPaymentWebhookError({
        error,
        provider: 'stripe',
        stage: 'provider_effect',
      });

      // Check if it's a duplicate invoice error (database constraint violation)
      if (
        error instanceof Error &&
        error.message.includes('unique constraint')
      ) {
        console.log('<< Invoice already processed:', invoice.id);
        return; // Don't throw, this is expected for duplicate processing
      }

      // For other errors, let Stripe retry
      throw error;
    }

    console.log('<< Handle invoice paid success');
  }

  /**
   * Update subscription payment record and process benefits
   *
   * The order of events may be:
   * checkout.session.completed
   * customer.subscription.created
   * customer.subscription.updated
   * invoice.paid
   *
   * @param invoice Stripe invoice
   * @param paymentRecord Payment record
   */
  private async updateSubscriptionPayment(
    invoice: Stripe.Invoice,
    paymentRecord: Payment
  ): Promise<void> {
    console.log('>> Update subscription payment record');

    try {
      let subscriptionId = invoice.subscription as string | null;

      // If invoice.subscription is null, try to use paymentRecord.subscriptionId
      if (!subscriptionId && paymentRecord.subscriptionId) {
        subscriptionId = paymentRecord.subscriptionId;
        console.log('subscriptionId from paymentRecord:', subscriptionId);
      }

      if (!subscriptionId) {
        console.warn('<< No subscriptionId found in invoice or paymentRecord');
        return;
      }

      // Get subscription details from Stripe
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      const customerId = subscription.customer as string;

      // Get priceId from subscription items
      const priceId = subscription.items.data[0]?.price.id;
      if (!priceId) {
        console.warn('<< No priceId found for subscription');
        return;
      }

      // Get userId from subscription metadata or fallback to customerId lookup
      let userId: string | undefined = subscription.metadata?.userId;

      // If no userId in metadata (common in renewals), find by customerId
      if (!userId) {
        console.log('No userId in metadata, finding by customerId');
        userId = await this.findUserIdByCustomerId(customerId);

        if (!userId) {
          console.error('<< No userId found, this should not happen');
          return;
        }
      }

      const periodStart = this.getPeriodStart(subscription);
      const periodEnd = this.getPeriodEnd(subscription);
      const trialStart = subscription.trial_start
        ? new Date(subscription.trial_start * 1000)
        : null;
      const trialEnd = subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null;
      const currentDate = new Date();

      // Update payment record with all subscription details
      const db = getDb();
      await db
        .update(payment)
        .set({
          // invoiceId: invoice.id, // do not update invoiceId
          paid: true, // Mark as paid
          interval: this.mapStripeIntervalToPlanInterval(subscription),
          status: this.mapSubscriptionStatusToPaymentStatus(
            subscription.status
          ),
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          trialStart,
          trialEnd,
          updatedAt: currentDate,
        })
        .where(eq(payment.id, paymentRecord.id));

      // Process subscription benefits (no credits in MkFast)
      await this.processSubscriptionPurchase(userId, priceId);
    } catch (error) {
      logPaymentWebhookError({
        error,
        provider: 'stripe',
        stage: 'provider_effect',
      });
      throw error;
    }

    console.log('<< Update subscription payment record success');
  }

  /**
   * Process subscription purchase
   * @param _userId User ID (reserved for future use, e.g. credits)
   * @param _priceId Price ID (reserved for future use, e.g. credits)
   */
  private async processSubscriptionPurchase(
    _userId: string,
    _priceId: string
  ): Promise<void> {
    console.log('>> Process subscription purchase');

    // No credits in MkFast; keep log for consistency with MkSaaS flow
    console.log('<< Process subscription purchase success');
  }

  /**
   * Update one-time payment record and process benefits
   *
   * The order of events may be:
   * checkout.session.completed
   * invoice.paid
   *
   * @param invoice Stripe invoice
   * @param paymentRecord Payment record
   */
  private async updateOneTimePayment(
    invoice: Stripe.Invoice,
    paymentRecord: Payment
  ): Promise<void> {
    console.log('>> Update one-time payment record');

    try {
      // Update payment record with invoice details
      const db = getDb();
      await db
        .update(payment)
        .set({
          // invoiceId: invoice.id, // do not update invoiceId
          status: 'completed', // One-time payments are completed when invoice is paid
          paid: true, // Mark as paid
          updatedAt: new Date(),
        })
        .where(eq(payment.id, paymentRecord.id));

      // Process benefits: lifetime plan purchase only (no credits in MkFast)
      if (paymentRecord.sessionId) {
        const session = await this.stripe.checkout.sessions.retrieve(
          paymentRecord.sessionId
        );
        await this.processLifetimePlanPurchase(invoice, paymentRecord, session);
      }
    } catch (error) {
      logPaymentWebhookError({
        error,
        provider: 'stripe',
        stage: 'provider_effect',
      });
      throw error;
    }

    console.log('<< Update one-time payment record success');
  }

  /**
   * Process lifetime plan purchase
   * @param invoice Stripe invoice
   * @param paymentRecord Payment record
   * @param session Checkout session (for userName in notification)
   */
  private async processLifetimePlanPurchase(
    invoice: Stripe.Invoice,
    paymentRecord: Payment,
    session: Stripe.Checkout.Session
  ): Promise<void> {
    console.log('>> Process lifetime plan purchase');

    // Send notification
    const amount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;
    await sendPaymentNotification({
      sessionId: paymentRecord.sessionId!,
      customerId: paymentRecord.customerId,
      userName: (session.metadata?.userName as string) ?? 'Customer',
      amount,
    });

    console.log('<< Process lifetime plan purchase success');
  }

  /**
   * Handle subscription creation
   * Only log the event, payment records created in checkout.session.completed
   * @param stripeSubscription Stripe subscription
   */
  private async onCreateSubscription(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    console.log('Handle subscription creation:', stripeSubscription.id);
  }

  /**
   * Update payment record when subscription is updated
   *
   * When subscription is renewed, the order of events may be:
   * customer.subscription.updated
   * invoice.paid
   *
   * When subscription is cancelled, the order of events may be:
   * customer.subscription.updated
   *
   * In this case, we need to update the payment record.
   *
   * @param stripeSubscription Stripe subscription
   */
  private async onUpdateSubscription(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    console.log('>> Handle subscription update:', stripeSubscription.id);

    // get priceId from subscription items (this is always available)
    const priceId = stripeSubscription.items.data[0]?.price.id;
    if (!priceId) {
      console.warn('<< No priceId found for subscription');
      return;
    }

    // get new period start and end
    const newPeriodStart = this.getPeriodStart(stripeSubscription);
    const newPeriodEnd = this.getPeriodEnd(stripeSubscription);
    const trialStart = stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : undefined;
    const trialEnd = stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : undefined;

    // update fields
    const updateFields: Record<string, unknown> = {
      priceId: priceId,
      interval: this.mapStripeIntervalToPlanInterval(stripeSubscription),
      status: this.mapSubscriptionStatusToPaymentStatus(
        stripeSubscription.status
      ),
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialStart: trialStart,
      trialEnd: trialEnd,
      updatedAt: new Date(),
    };

    const db = getDb();
    const result = await db
      .update(payment)
      .set(updateFields)
      .where(eq(payment.subscriptionId, stripeSubscription.id))
      .returning({ id: payment.id });

    if (result.length > 0) {
      console.log('<< Updated payment record for subscription');
    } else {
      console.warn('<< No payment record found for subscription update');
    }
  }

  /**
   * Update payment record when subscription is deleted
   *
   * When subscription is deleted, the order of events may be:
   * customer.subscription.deleted
   *
   * In this case, we need to update the payment record.
   *
   * @param stripeSubscription Stripe subscription
   */
  private async onDeleteSubscription(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    console.log('>> Handle subscription deletion:', stripeSubscription.id);

    const db = getDb();
    const result = await db
      .update(payment)
      .set({
        status: this.mapSubscriptionStatusToPaymentStatus(
          stripeSubscription.status
        ),
        updatedAt: new Date(),
      })
      .where(eq(payment.subscriptionId, stripeSubscription.id))
      .returning({ id: payment.id });

    if (result.length > 0) {
      console.log('<< Marked payment record for subscription as canceled');
    } else {
      console.warn('<< No payment record found for subscription deletion');
    }
  }

  /**
   * Handle checkout session completion
   * Create payment records with paid=false
   * @param session Stripe checkout session
   */
  private async onCheckoutCompleted(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    console.log('>> Handle checkout session completion:', session.id);

    // I have simulated with 10-second delay to test behavior when invoice paid event arrives first
    try {
      if (session.mode === 'subscription') {
        await this.createSubscriptionPaymentRecord(session);
      } else if (session.mode === 'payment') {
        await this.createOneTimePaymentRecord(session);
      } else {
        console.warn('<< Unsupported checkout session mode:', session.mode);
        return;
      }
    } catch (error) {
      logPaymentWebhookError({
        error,
        provider: 'stripe',
        stage: 'provider_effect',
      });
      throw error;
    }

    console.log('<< Handle checkout session completion success');
  }

  /**
   * Create subscription payment record in checkout.session.completed event
   * @param session Stripe checkout session
   */
  private async createSubscriptionPaymentRecord(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    console.log('>> Create subscription payment record');

    if (!session.subscription) {
      console.warn('<< No subscription found in session');
      return;
    }

    const subscriptionId = session.subscription as string;
    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);

    // Get priceId from subscription items
    const priceId = subscription.items.data[0]?.price.id;
    if (!priceId) {
      console.warn('<< No priceId found for subscription');
      return;
    }

    // Validate session metadata and get userId, customerId
    const { userId, customerId } = this.validateSessionMetadata(session);

    // No matter user uses coupon code or not, even amount=0, invoice id is available
    const invoiceId: string | null = session.invoice as string | null;
    console.log('createSubscriptionPaymentRecord, invoiceId:', invoiceId);

    const periodStart = this.getPeriodStart(subscription);
    const periodEnd = this.getPeriodEnd(subscription);
    const trialStart = subscription.trial_start
      ? new Date(subscription.trial_start * 1000)
      : null;
    const trialEnd = subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null;

    // Create subscription payment record with proper status and paid=false
    await this.insertPaymentRecord(
      {
        priceId,
        type: PaymentTypes.SUBSCRIPTION,
        scene: PaymentScenes.SUBSCRIPTION,
        userId,
        customerId,
        subscriptionId,
        sessionId: session.id,
        invoiceId, // may be null initially
        paid: false, // will be set to true when invoice.paid event occurs
        interval: this.mapStripeIntervalToPlanInterval(subscription),
        status: this.mapSubscriptionStatusToPaymentStatus(subscription.status),
        periodStart,
        periodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        trialStart,
        trialEnd,
      },
      'subscription'
    );
  }

  /**
   * Create one-time payment record in checkout.session.completed event
   * @param session Stripe checkout session
   */
  private async createOneTimePaymentRecord(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    console.log('>> Create one-time payment record');

    const priceId = session.metadata?.priceId;
    if (!priceId) {
      console.warn('<< No priceId found in session metadata');
      return;
    }

    // Validate session metadata and get userId, customerId
    const { userId, customerId } = this.validateSessionMetadata(session);

    // No matter user uses coupon code or not, even amount=0, invoice id is available
    const invoiceId: string | null = session.invoice as string | null;
    console.log('createOneTimePaymentRecord, invoiceId:', invoiceId);

    // One-time payments in MkFast are lifetime only (no credits)
    const scene = PaymentScenes.LIFETIME;

    // Create one-time payment record with proper status and paid=false
    await this.insertPaymentRecord(
      {
        priceId,
        type: PaymentTypes.ONE_TIME,
        scene,
        userId,
        customerId,
        sessionId: session.id,
        invoiceId, // may be null initially
        paid: session.payment_status === 'paid',
        status: 'completed', // one-time payments are completed once checkout is done
      },
      'one-time'
    );
  }

  /**
   * Unified helper for payment record insertion with error handling
   * Eliminates duplicate try-catch logic between subscription and one-time payments
   * Handles duplicate key constraint violations gracefully
   * @param paymentData Payment record data (excluding id, createdAt, updatedAt)
   * @param recordType Type for logging ("subscription" or "one-time")
   */
  private async insertPaymentRecord(
    paymentData: Omit<
      typeof payment.$inferInsert,
      'id' | 'createdAt' | 'updatedAt'
    >,
    recordType: string
  ): Promise<void> {
    const db = getDb();
    const sessionId = paymentData.sessionId?.trim();
    if (!sessionId) {
      throw new Error('Payment checkout session ID is required.');
    }
    const receipt = await persistPaymentRecordEffect(
      { ...paymentData, sessionId },
      new PostgresPaymentRecordEffectStore(db)
    );
    if (receipt === 'applied') {
      console.log(`<< Created ${recordType} payment record success`);
      return;
    }
    console.log(
      `<< ${recordType} payment record already exists, skipping creation`
    );
  }

  /**
   * Map Stripe subscription interval to our own interval types
   * @param subscription Stripe subscription
   * @returns PlanInterval
   */
  private mapStripeIntervalToPlanInterval(
    subscription: Stripe.Subscription
  ): PlanInterval {
    switch (subscription.items.data[0]?.plan.interval) {
      case 'month':
        return PlanIntervals.MONTH;
      case 'year':
        return PlanIntervals.YEAR;
      default:
        return PlanIntervals.MONTH;
    }
  }

  /**
   * Convert Stripe subscription status to PaymentStatus,
   * we narrow down the status to our own status types
   * @param status Stripe subscription status
   * @returns PaymentStatus
   */
  private mapSubscriptionStatusToPaymentStatus(
    status: Stripe.Subscription.Status
  ): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      active: 'active',
      canceled: 'canceled',
      incomplete: 'incomplete',
      incomplete_expired: 'incomplete_expired',
      past_due: 'past_due',
      trialing: 'trialing',
      unpaid: 'unpaid',
      paused: 'paused',
    };

    return statusMap[status] || 'failed';
  }

  /**
   * Find existing payment record by Invoice
   * @param invoice Stripe invoice
   * @returns Payment record or null if not found
   */
  private extractSubscriptionId(invoice: Stripe.Invoice): string | null {
    const invoiceSubscription = invoice.subscription;
    if (typeof invoiceSubscription === 'string') {
      console.log(`invoice.subscription is string: ${invoiceSubscription}`);
      return invoiceSubscription;
    }
    if (
      invoiceSubscription &&
      typeof invoiceSubscription === 'object' &&
      'id' in invoiceSubscription
    ) {
      console.log(`invoice.subscription is object: ${invoiceSubscription.id}`);
      return invoiceSubscription.id;
    }

    const invoiceAny = invoice as {
      parent?: { subscription_details?: { subscription?: string } };
    };
    if (invoiceAny.parent?.subscription_details?.subscription) {
      const subscriptionId =
        invoiceAny.parent.subscription_details.subscription;
      console.log(
        `invoice.parent.subscription_details.subscription is string: ${subscriptionId}`
      );
      return subscriptionId;
    }

    const lineItems = invoice.lines?.data ?? [];
    for (const lineItem of lineItems) {
      if (typeof lineItem.subscription === 'string') {
        console.log(
          `invoice.lineItem.subscription is string: ${lineItem.subscription}`
        );
        return lineItem.subscription;
      }
      if (
        lineItem.subscription &&
        typeof lineItem.subscription === 'object' &&
        'id' in lineItem.subscription
      ) {
        console.log(
          `invoice.lineItem.subscription is object: ${lineItem.subscription.id}`
        );
        return lineItem.subscription.id;
      }

      const lineItemAny = lineItem as {
        parent?: { subscription_item_details?: { subscription?: string } };
      };
      if (lineItemAny.parent?.subscription_item_details?.subscription) {
        const subscriptionId =
          lineItemAny.parent.subscription_item_details.subscription;
        console.log(
          `invoice.lineItem.parent.subscription_item_details.subscription is string: ${subscriptionId}`
        );
        return subscriptionId;
      }

      if (typeof lineItem.subscription_item === 'string') {
        console.log(
          `invoice.lineItem.subscription_item is string: ${lineItem.subscription_item}`
        );
        return lineItem.subscription_item;
      }
      if (
        lineItem.subscription_item &&
        typeof lineItem.subscription_item === 'object' &&
        'id' in lineItem.subscription_item
      ) {
        console.log(
          `invoice.lineItem.subscription_item is object: ${lineItem.subscription_item.id}`
        );
        return lineItem.subscription_item.id;
      }
    }

    return null;
  }

  private getPeriodStart(subscription: Stripe.Subscription): Date | undefined {
    const s = subscription as Stripe.Subscription & {
      current_period_start?: number;
      items?: { data?: { current_period_start?: number }[] };
    };
    const startUnix =
      s.current_period_start ??
      s?.items?.data?.[0]?.current_period_start ??
      undefined;
    return typeof startUnix === 'number'
      ? new Date(startUnix * 1000)
      : undefined;
  }

  private getPeriodEnd(subscription: Stripe.Subscription): Date | undefined {
    const s = subscription as Stripe.Subscription & {
      current_period_end?: number;
      items?: { data?: { current_period_end?: number }[] };
    };
    const endUnix =
      s.current_period_end ??
      s?.items?.data?.[0]?.current_period_end ??
      undefined;
    return typeof endUnix === 'number' ? new Date(endUnix * 1000) : undefined;
  }
}
