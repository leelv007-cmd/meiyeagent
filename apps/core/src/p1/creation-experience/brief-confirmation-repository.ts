import { isDeepStrictEqual } from 'node:util';

import type { BriefConfirmation } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

export interface BriefConfirmationRepository {
  putBriefConfirmation(
    workspaceId: string,
    confirmationId: string,
    confirmation: BriefConfirmation,
  ): Promise<BriefConfirmation> | BriefConfirmation;
  getBriefConfirmation(
    workspaceId: string,
    confirmationId: string,
  ): Promise<BriefConfirmation | null> | BriefConfirmation | null;
}

export class MemoryBriefConfirmationRepository
  implements BriefConfirmationRepository
{
  private readonly confirmations = new Map<string, BriefConfirmation>();

  private key(workspaceId: string, confirmationId: string) {
    return `${workspaceId}:${confirmationId}`;
  }

  putBriefConfirmation(
    workspaceId: string,
    confirmationId: string,
    confirmation: BriefConfirmation,
  ): BriefConfirmation {
    const key = this.key(workspaceId, confirmationId);
    const existing = this.confirmations.get(key);
    if (existing) {
      if (isDeepStrictEqual(existing, confirmation)) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Brief confirmation id is already bound to another revision snapshot.',
      );
    }
    const stored = structuredClone(confirmation);
    this.confirmations.set(key, stored);
    return structuredClone(stored);
  }

  getBriefConfirmation(
    workspaceId: string,
    confirmationId: string,
  ): BriefConfirmation | null {
    const stored = this.confirmations.get(this.key(workspaceId, confirmationId));
    return stored ? structuredClone(stored) : null;
  }
}
