import assert from 'node:assert/strict';
import test from 'node:test';

import { generateContentPackageVariantsCommandSchema } from './content-package.js';

const command = {
  billingQuoteId: 'quote-1',
  billingTaskId: 'content-package-variants:package-1:submission-1',
  contract: {
    aigcLabelEnabled: true,
    catalogModelId: 'llm-openai',
    catalogRevision: 'catalog-v1',
    currency: 'CNY',
    dataClass: [],
    estimatedAmount: 0.18,
    operation: 'copy.adapt' as const,
    outputCount: 3 as const,
    outputLabel: '三平台版本',
    quoteAcceptedAt: '2026-07-22T08:00:00.000Z',
    quoteRevision: 'quote-revision-1',
    watermarkEnabled: false,
  },
  expectedRevision: 1,
  packageId: 'package-1',
  submissionKey: 'submission-1',
};

test('requires a paired confirmed Product quote binding for platform variants', () => {
  assert.equal(
    generateContentPackageVariantsCommandSchema.safeParse(command).success,
    true,
  );
  assert.equal(
    generateContentPackageVariantsCommandSchema.safeParse({
      ...command,
      billingTaskId: undefined,
    }).success,
    false,
  );
});
