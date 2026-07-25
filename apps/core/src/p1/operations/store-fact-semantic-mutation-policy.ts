import type {
  AppendStoreFactInput,
  StoreFactLedger,
} from './store-fact-ledger.js';

export type StoreFactSemanticMutation =
  | 'new_fact'
  | 'correction'
  | 'revocation';

export class StoreFactSemanticMutationError extends Error {
  readonly status = 400;

  constructor(
    readonly code:
      | 'STORE_FACT_REVOCATION_VALUE_NOT_NULL'
      | 'STORE_FACT_REVOCATION_WITHOUT_PREDECESSOR',
    message: string,
  ) {
    super(message);
    this.name = 'StoreFactSemanticMutationError';
  }
}

export function classifyStoreFactMutation(
  input: AppendStoreFactInput,
): StoreFactSemanticMutation {
  if (input.revisionKind === 'revocation') return 'revocation';
  return input.expectedRevision === 0 ? 'new_fact' : 'correction';
}

/**
 * Sole semantic entry for StoreFact writes.
 *
 * A new fact starts a stream at expectedRevision=0, a correction appends a
 * normal revision to that stream, and a revocation appends a null superseding
 * revision. The ledger remains the sole OCC/storage adapter and preserves its
 * 409 conflict contract under concurrent writes.
 */
export class StoreFactSemanticMutationPolicy {
  constructor(private readonly ledger: Pick<StoreFactLedger, 'append'>) {}

  async append(input: AppendStoreFactInput) {
    const mutation = classifyStoreFactMutation(input);
    if (mutation === 'revocation' && input.expectedRevision === 0) {
      throw new StoreFactSemanticMutationError(
        'STORE_FACT_REVOCATION_WITHOUT_PREDECESSOR',
        'A revocation must supersede an existing StoreFact revision.',
      );
    }
    if (mutation === 'revocation' && input.value !== null) {
      throw new StoreFactSemanticMutationError(
        'STORE_FACT_REVOCATION_VALUE_NOT_NULL',
        'A revocation revision must carry a null value.',
      );
    }
    return this.ledger.append(input);
  }
}
