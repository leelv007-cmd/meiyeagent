import type { ProductQuoteSnapshot } from '@meiye/contracts';

export function productQuoteFixture(
  input: Partial<ProductQuoteSnapshot> &
    Pick<ProductQuoteSnapshot, 'catalogModelId' | 'quoteId' | 'revision'>
): ProductQuoteSnapshot {
  return {
    billingMode: 'per_request',
    formula: {
      expression: 'server-published fixture',
      unitRate: 1,
    },
    lifecycleStatus: 'quoted',
    quotePolicyRevision: 'quote-policy-fixture',
    ...input,
  };
}
