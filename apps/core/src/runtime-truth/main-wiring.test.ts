import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Core entrypoint rebuilds provider evidence for both runtime-truth surfaces', async () => {
  const main = await readFile(new URL('../main.ts', import.meta.url), 'utf8');

  assert.match(main, /assembleCapabilitiesFromEnv\(process\.env\)/);
  assert.match(
    main,
    /providerLive:\s*\(\)\s*=>\s*providerEvidence\.providerLiveReadiness/,
  );
  assert.match(main, /evaluateReadiness:\s*\(\)\s*=>\s*resolveRuntimeTruth\(\)/);
  assert.match(
    main,
    /listMerchantCapabilities:\s*\(\)\s*=>\s*\n?\s*resolveRuntimeTruth\(\)/,
  );
  assert.match(main, /p1ApplicationService,\s*\n\s*runtimeTruth,/);
});

test('Core recurring recovery owns committed Harness starts after boot', async () => {
  const main = await readFile(new URL('../main.ts', import.meta.url), 'utf8');

  assert.match(
    main,
    /const runPendingStartRecovery = async \(\) =>[\s\S]*recoverPendingStarts\(\)/,
  );
  assert.match(
    main,
    /harnessPendingStartRecoveryInterval = setInterval\([\s\S]*runPendingStartRecovery\(\)/,
  );
});
