import { createHash } from 'node:crypto';

export interface ProStudioEntitlementContext {
  userId: string;
  workspaceId: string;
  role: 'owner' | 'operator' | 'reviewer';
  correlationId: string;
}

export interface ProStudioOffer {
  id: string;
  priceLabel: string;
  description: string;
  demoUrl: string;
  purchasePath: string;
}

export interface ProStudioBillingVerificationPort {
  verifyPaidEvent(input: {
    workspaceId: string;
    offerId: string;
    paymentEventId: string;
  }): Promise<
    | {
        status: 'paid';
        workspaceId: string;
        offerId: string;
        eventId: string;
      }
    | { status: 'not_paid' }
  >;
}

interface ProStudioPurchase {
  id: string;
  workspaceId: string;
  offerId: string;
  paymentEventId: string;
  actorId: string;
  correlationId: string;
  activatedAt: string;
}

interface ProStudioPurchaseReceipt {
  workspaceId: string;
  idempotencyKey: string;
  payloadHash: string;
  result: ProStudioPurchase;
}

export interface ProStudioEntitlementState {
  purchases: ProStudioPurchase[];
  receipts: ProStudioPurchaseReceipt[];
}

export function createEmptyProStudioEntitlementState(): ProStudioEntitlementState {
  return { purchases: [], receipts: [] };
}

export class ProStudioEntitlementError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ProStudioEntitlementRepository {
  read(workspaceId: string): Promise<ProStudioEntitlementState>;
  transact<T>(
    workspaceId: string,
    action: (state: ProStudioEntitlementState) => T,
  ): Promise<T>;
}

export class MemoryProStudioEntitlementRepository
  implements ProStudioEntitlementRepository
{
  private readonly states = new Map<string, ProStudioEntitlementState>();

  async read(workspaceId: string) {
    return structuredClone(this.state(workspaceId));
  }

  async transact<T>(
    workspaceId: string,
    action: (state: ProStudioEntitlementState) => T,
  ) {
    const draft = structuredClone(this.state(workspaceId));
    const result = action(draft);
    this.states.set(workspaceId, draft);
    return structuredClone(result);
  }

  private state(workspaceId: string) {
    let state = this.states.get(workspaceId);
    if (!state) {
      state = createEmptyProStudioEntitlementState();
      this.states.set(workspaceId, state);
    }
    return state;
  }
}

export class ProStudioEntitlementApplicationService {
  constructor(
    private readonly repository: ProStudioEntitlementRepository,
    private readonly options: {
      offer: ProStudioOffer;
      billing?: ProStudioBillingVerificationPort;
      clock?: () => Date;
    },
  ) {}

  async getEntry(context: ProStudioEntitlementContext) {
    const purchase = await this.activePurchase(context.workspaceId);
    if (purchase) {
      return {
        status: 'active' as const,
        offerId: purchase.offerId,
        activatedAt: purchase.activatedAt,
      };
    }
    return {
      status: 'locked' as const,
      offer: {
        ...structuredClone(this.options.offer),
        canPurchase: context.role === 'owner',
      },
    };
  }

  async purchase(
    context: ProStudioEntitlementContext,
    input: {
      offerId: string;
      paymentEventId: string;
      idempotencyKey: string;
    },
  ) {
    if (context.role !== 'owner') {
      throw new ProStudioEntitlementError(
        'OWNER_REQUIRED',
        'Only the workspace owner can purchase Pro Studio.',
      );
    }
    if (input.offerId !== this.options.offer.id) {
      throw new ProStudioEntitlementError(
        'OFFER_NOT_FOUND',
        'Pro Studio offer was not found.',
      );
    }
    requireText(input.paymentEventId, 'paymentEventId');
    requireText(input.idempotencyKey, 'idempotencyKey');
    const payloadHash = digest(
      JSON.stringify({
        offerId: input.offerId,
        paymentEventId: input.paymentEventId,
      }),
    );
    const existingState = await this.repository.read(context.workspaceId);
    const existingReceipt = existingState.receipts.find(
      (candidate) => candidate.idempotencyKey === input.idempotencyKey,
    );
    if (existingReceipt) {
      if (existingReceipt.payloadHash !== payloadHash) {
        throw new ProStudioEntitlementError(
          'IDEMPOTENCY_CONFLICT',
          'Purchase key was reused with another payment.',
        );
      }
      return {
        status: 'active' as const,
        offerId: existingReceipt.result.offerId,
        activatedAt: existingReceipt.result.activatedAt,
      };
    }
    if (!this.options.billing) {
      throw new ProStudioEntitlementError(
        'BILLING_UNAVAILABLE',
        'Pro Studio purchase must complete through the billing system.',
      );
    }
    const verified = await this.options.billing.verifyPaidEvent({
      workspaceId: context.workspaceId,
      offerId: input.offerId,
      paymentEventId: input.paymentEventId,
    });
    if (
      verified.status !== 'paid' ||
      verified.workspaceId !== context.workspaceId ||
      verified.offerId !== input.offerId ||
      verified.eventId !== input.paymentEventId
    ) {
      throw new ProStudioEntitlementError(
        'PAYMENT_NOT_VERIFIED',
        'Pro Studio payment evidence was not verified.',
      );
    }
    const purchase = await this.repository.transact(
      context.workspaceId,
      (state) => {
        const receipt = state.receipts.find(
          (candidate) => candidate.idempotencyKey === input.idempotencyKey,
        );
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) {
            throw new ProStudioEntitlementError(
              'IDEMPOTENCY_CONFLICT',
              'Purchase key was reused with another payment.',
            );
          }
          return receipt.result;
        }
        const paid = state.purchases.find(
          (candidate) => candidate.paymentEventId === input.paymentEventId,
        );
        if (paid) return paid;
        const created: ProStudioPurchase = {
          id: `pro-studio-purchase-${digest(input.paymentEventId).slice(0, 24)}`,
          workspaceId: context.workspaceId,
          offerId: input.offerId,
          paymentEventId: input.paymentEventId,
          actorId: context.userId,
          correlationId: context.correlationId,
          activatedAt: this.now().toISOString(),
        };
        state.purchases.push(created);
        state.receipts.push({
          workspaceId: context.workspaceId,
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          result: created,
        });
        return created;
      },
    );
    return {
      status: 'active' as const,
      offerId: purchase.offerId,
      activatedAt: purchase.activatedAt,
    };
  }

  async assertCanEnter(context: ProStudioEntitlementContext) {
    await this.requireActive(context.workspaceId, 'enter');
  }

  async assertCanGenerate(context: ProStudioEntitlementContext) {
    await this.requireActive(context.workspaceId, 'generate');
  }

  async isActionAllowed(
    context: ProStudioEntitlementContext,
    action:
      | 'composer.edit'
      | 'composer.export'
      | 'pro_studio.enter'
      | 'pro_studio.generate'
      | 'pro_studio.adopt'
      | 'pro_studio.export',
  ) {
    if (action.startsWith('composer.')) return true;
    return Boolean(await this.activePurchase(context.workspaceId));
  }

  private async requireActive(workspaceId: string, action: string) {
    if (!(await this.activePurchase(workspaceId))) {
      throw new ProStudioEntitlementError(
        'PRO_STUDIO_ENTITLEMENT_REQUIRED',
        `Pro Studio entitlement is required to ${action}.`,
      );
    }
  }

  private async activePurchase(workspaceId: string) {
    const state = await this.repository.read(workspaceId);
    return state.purchases.at(-1) ?? null;
  }

  private now() {
    return this.options.clock?.() ?? new Date();
  }
}

function requireText(value: string, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProStudioEntitlementError(
      'INPUT_INVALID',
      `${field} is required.`,
    );
  }
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
