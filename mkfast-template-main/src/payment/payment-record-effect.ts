import type { getDb as getDatabase } from '@/db';
import { payment } from '@/db/app.schema';
import { eq } from 'drizzle-orm';

type PaymentDatabase = ReturnType<typeof getDatabase>;

export type PaymentRecordEffectInput = Omit<
  typeof payment.$inferInsert,
  'createdAt' | 'id' | 'sessionId' | 'updatedAt'
> & {
  sessionId: string;
};

export type PaymentRecordEffectReceipt = 'already_applied' | 'applied';

export interface PaymentRecordEffectStore {
  insertOnce(
    input: PaymentRecordEffectInput
  ): Promise<PaymentRecordEffectReceipt | 'conflict'>;
}

export class PaymentRecordBusinessKeyConflictError extends Error {
  readonly code = 'PAYMENT_RECORD_BUSINESS_KEY_CONFLICT';

  constructor() {
    super('Payment record conflicts with a different immutable business key.');
    this.name = 'PaymentRecordBusinessKeyConflictError';
  }
}

export async function persistPaymentRecordEffect(
  input: PaymentRecordEffectInput,
  store: PaymentRecordEffectStore
): Promise<PaymentRecordEffectReceipt> {
  if (!input.sessionId.trim()) {
    throw new PaymentRecordBusinessKeyConflictError();
  }
  const receipt = await store.insertOnce(input);
  if (receipt === 'conflict') {
    throw new PaymentRecordBusinessKeyConflictError();
  }
  return receipt;
}

/**
 * A checkout session is the immutable provider business key for a payment
 * record. The unique session/subscription indexes make a worker retry after a
 * process crash return `already_applied` instead of writing a second payment.
 */
export class PostgresPaymentRecordEffectStore
  implements PaymentRecordEffectStore
{
  constructor(private readonly db: PaymentDatabase) {}

  async insertOnce(
    input: PaymentRecordEffectInput
  ): Promise<PaymentRecordEffectReceipt | 'conflict'> {
    const now = new Date();
    const [created] = await this.db
      .insert(payment)
      .values({
        ...input,
        createdAt: now,
        id: crypto.randomUUID(),
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: payment.id });
    if (created) return 'applied';

    const [sameCheckout] = await this.db
      .select({ id: payment.id })
      .from(payment)
      .where(eq(payment.sessionId, input.sessionId))
      .limit(1);
    return sameCheckout ? 'already_applied' : 'conflict';
  }
}
