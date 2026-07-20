import type { BriefBoundRevisions, BriefQuoteSignal } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

/** Resolves the live tuple from server-owned facts, never request revisions. */
export interface BriefRevisionResolver {
  resolveCurrentRevisions(
    workspaceId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<BriefBoundRevisions> | BriefBoundRevisions;
  resolveCurrentQuoteSignal(
    workspaceId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<BriefQuoteSignal | null> | BriefQuoteSignal | null;
}

export class MissingBriefRevisionResolver implements BriefRevisionResolver {
  resolveCurrentRevisions(): never {
    throw new P1DomainError(
      'INVALID_STATE',
      'Brief revision resolver is not configured.',
    );
  }

  resolveCurrentQuoteSignal(): never {
    throw new P1DomainError(
      'INVALID_STATE',
      'Brief revision resolver is not configured.',
    );
  }
}
