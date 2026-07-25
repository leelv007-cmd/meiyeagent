import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const structuredRunnerSource = readFileSync(
  new URL('./structured-node-runner.ts', import.meta.url),
  'utf8',
);
const mediaStageSource = readFileSync(
  new URL('../harness/unified-media-stage-ports.ts', import.meta.url),
  'utf8',
);

test('Harness ModelJobs are statically cost-only and share Coordinator billing lineage', () => {
  assert.match(structuredRunnerSource, /billingTaskId: string/u);
  assert.match(structuredRunnerSource, /billingQuoteRevision: string/u);
  assert.match(
    structuredRunnerSource,
    /billingTaskId: this\.options\.billingTaskId/u,
  );
  assert.match(
    structuredRunnerSource,
    /billingQuoteRevision: this\.options\.billingQuoteRevision/u,
  );
  assert.match(structuredRunnerSource, /productUsageQuantity: 0/u);
  assert.doesNotMatch(
    structuredRunnerSource,
    /productUsageQuantity: this\.options/u,
  );
  assert.match(mediaStageSource, /billingTaskId: snapshot\.task\.id/u);
  assert.match(mediaStageSource, /productUsageQuantity: 0/u);
});
