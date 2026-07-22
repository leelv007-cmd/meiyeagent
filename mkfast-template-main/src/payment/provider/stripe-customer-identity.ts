export const STRIPE_USER_ID_METADATA_KEY = 'meiye_user_id';

export class StripeCustomerIdentityError extends Error {
  constructor(
    readonly code:
      | 'STRIPE_CUSTOMER_IDENTITY_INVALID'
      | 'STRIPE_CUSTOMER_IDENTITY_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'StripeCustomerIdentityError';
  }
}

export interface StripeCustomerIdentityRecord {
  deleted?: unknown;
  id: string;
  metadata?: Record<string, string>;
}

export async function assertStripeCustomerBoundToUser(
  customer: StripeCustomerIdentityRecord,
  userId: string
): Promise<void> {
  const expectedUserId = requireUserId(userId);
  if (
    customer.deleted === true ||
    customer.metadata?.[STRIPE_USER_ID_METADATA_KEY] !== expectedUserId
  ) {
    throw new StripeCustomerIdentityError(
      'STRIPE_CUSTOMER_IDENTITY_MISMATCH',
      'Stripe customer is not bound to the authenticated user.'
    );
  }
}

export async function assertStripeSubscriptionCustomerBoundToLocalUser(
  customerReference: unknown,
  dependencies: {
    findUserIdByCustomerId(customerId: string): Promise<string | undefined>;
    retrieveCustomer(customerId: string): Promise<StripeCustomerIdentityRecord>;
  }
): Promise<string> {
  const customerId = customerIdFromReference(customerReference);
  if (!customerId) {
    throw new StripeCustomerIdentityError(
      'STRIPE_CUSTOMER_IDENTITY_INVALID',
      'Stripe subscription customer identity is required.'
    );
  }

  const userId = await dependencies.findUserIdByCustomerId(customerId);
  if (!userId) {
    throw new StripeCustomerIdentityError(
      'STRIPE_CUSTOMER_IDENTITY_MISMATCH',
      'Stripe subscription customer has no local user binding.'
    );
  }

  await assertStripeCustomerBoundToUser(
    await dependencies.retrieveCustomer(customerId),
    userId
  );
  return userId;
}

function requireUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new StripeCustomerIdentityError(
      'STRIPE_CUSTOMER_IDENTITY_INVALID',
      'Authenticated user identity is required for Stripe customer validation.'
    );
  }
  return normalized;
}

function customerIdFromReference(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (
    value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.trim()
  ) {
    return value.id;
  }
  return null;
}
