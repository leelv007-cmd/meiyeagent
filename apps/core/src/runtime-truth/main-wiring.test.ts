import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Core entrypoint rebuilds provider evidence for both runtime-truth surfaces', async () => {
  const main = await readFile(
    new URL('../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );

  assert.match(main, /assembleCapabilitiesFromEnv\(env\)/);
  assert.match(
    main,
    /providerLive:\s*\(\)\s*=>\s*providerEvidence\.providerLiveReadiness/,
  );
  assert.match(main, /evaluateReadiness:\s*\(\)\s*=>\s*resolveRuntimeTruth\(\)/);
  assert.match(main, /evaluateWorkerReadiness:\s*\(\)\s*=>/);
  assert.match(main, /shouldStartDurablePollers/);
  assert.match(main, /role:\s*'api'/);
  assert.match(
    main,
    /listMerchantCapabilities:\s*\(\)\s*=>\s*\n?\s*resolveRuntimeTruth\(\)/,
  );
  assert.match(main, /p1ApplicationService,\s*\n\s*runtimeTruth,/);
});

test('Core recurring recovery owns committed Harness starts after boot', async () => {
  const main = await readFile(
    new URL('../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    main,
    /const runPendingStartRecovery = async \(\) =>[\s\S]*recoverPendingStarts\(/,
  );
  assert.match(
    main,
    /harnessPendingStartRecoveryInterval = setInterval\([\s\S]*runPendingStartRecovery\(\)/,
  );
  // V31-41: production recovery must pass the terminal prepare refund hook.
  assert.match(main, /onPrepareTerminalRefund/);
  assert.match(main, /refundPrepareTerminalReservation/);
});

test('Worker runtime starts worker-owned durable background loops', async () => {
  const worker = await readFile(
    new URL('../assembly/worker-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(worker, /startWorkerDurableBackground/);
  assert.match(worker, /harnessObservabilityStore/);
});

test('Core compensation owns the stalled-work timeout sweeper', async () => {
  const main = await readFile(
    new URL('../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(main, /stalledWorkSweeper\.runOnce\(\)/);
  assert.match(main, /PostgresStalledWorkSweepStore/);
  assert.match(main, /e2eStalledWorkExpiryRunner/);
});

test('Campaign paid Work submit mints quote when signed fields diverge (Work2)', async () => {
  const main = await readFile(
    new URL('../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(main, /createCampaignWorkQuoteMinter/);
  assert.match(main, /ensureQuoteForSubmission/);
  assert.match(
    main,
    /await campaignWorkQuoteMinter\.ensureQuoteForSubmission\(\s*input\.submission,\s*\)/,
  );
});
