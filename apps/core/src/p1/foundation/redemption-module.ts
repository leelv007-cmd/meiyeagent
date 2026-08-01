/**
 * Td-3/Td-4: P1 operation module for redemption codes.
 * Manage (manual create/void/list) = platform admin.
 * Redeem = workspace.billing.manage (owner path via authorizeP1Request).
 */

import { P1DomainError, type P1Context } from './domain.js';
import type { P1OperationModule } from './ports.js';
import type { RedemptionApplicationService } from './redemption.js';
import type { GrantLotResource } from './grant-lot.js';

function object(value: unknown, field = 'input'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError('INVALID_STATE', `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  return value.trim();
}

export class RedemptionFoundationModule implements P1OperationModule {
  readonly name = 'redemptions';

  constructor(private readonly redemptions: RedemptionApplicationService) {}

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    const action = string(args.input, 'action');
    const payload = object(args.input.payload ?? {}, 'payload');
    switch (action) {
      case 'create': {
        this.requireAdmin(args.context);
        const grants = object(payload.grants ?? {}, 'grants') as Partial<
          Record<GrantLotResource, number>
        >;
        const credits = payload.credits;
        return this.redemptions.createCodes(
          {
            grants,
            code: string(payload, 'code'),
            createdBy: args.context.userId,
            ...(typeof credits === 'number' ? { credits } : {}),
            ...(typeof payload.expiresAt === 'string' || payload.expiresAt === null
              ? { expiresAt: payload.expiresAt as string | null }
              : {}),
            ...(typeof payload.batchId === 'string'
              ? { batchId: payload.batchId }
              : {}),
          },
          {
            scope: args.context.workspaceId,
            idempotencyKey: args.idempotencyKey,
          }
        );
      }
      case 'void': {
        this.requireAdmin(args.context);
        return this.redemptions.voidCode(
          {
            code: string(payload, 'code'),
            expectedRevision: Number(payload.expectedRevision),
          },
          {
            scope: args.context.workspaceId,
            idempotencyKey: args.idempotencyKey,
          }
        );
      }
      case 'redeem': {
        this.requireBillingManager(args.context);
        return this.redemptions.redeem({
          code: string(payload, 'code'),
          workspaceId: args.context.workspaceId,
          userId: args.context.userId,
          correlationId: args.context.correlationId,
        });
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown redemptions command ${action}.`
        );
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const action = string(args.input, 'action');
    const payload = object(args.input.payload ?? {}, 'payload');
    if (action === 'list') {
      this.requireAdmin(args.context);
      const status = payload.status;
      if (
        status !== undefined &&
        status !== 'active' &&
        status !== 'redeemed' &&
        status !== 'voided' &&
        status !== 'expired'
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Redemption status filter is invalid.'
        );
      }
      return this.redemptions.list({
        ...(typeof payload.batchId === 'string'
          ? { batchId: payload.batchId }
          : {}),
        ...(typeof status === 'string' ? { status } : {}),
      });
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown redemptions query ${action}.`
    );
  }

  private requireAdmin(context: P1Context) {
    if (context.actor !== 'admin') {
      throw new P1DomainError(
        'FORBIDDEN',
        'Redemption management requires platform admin.'
      );
    }
  }

  private requireBillingManager(context: P1Context) {
    if (context.actor !== 'owner' && context.actor !== 'admin') {
      throw new P1DomainError(
        'FORBIDDEN',
        'Redeeming a code requires workspace billing management.'
      );
    }
  }
}
