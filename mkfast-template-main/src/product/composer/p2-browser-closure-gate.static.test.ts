import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('#323 browser gate requires paid-media confirmation before AI cover execution', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'tests/e2e/specs/p2-browser-closure.spec.ts'),
    'utf8'
  );
  const start = source.indexOf(
    "test('delivered AI cover exposes five presets, signed ratios, style-role analysis, and a Result image'"
  );
  const end = source.indexOf(
    "test('viral chip uses honest paste fallback",
    start
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const aiCoverJourney = source.slice(start, end);

  // Follow-on AI cover: Living Plan start when the strip is still armed,
  // otherwise the reserved-stage 确认执行 card (campaign poster admit).
  assert.match(aiCoverJourney, /getByTestId\('agent-commit-strip-start'\)/u);
  assert.match(
    aiCoverJourney,
    /getByTestId\(\s*'execution-confirmation-interaction-card'\s*\)/u
  );
  assert.match(aiCoverJourney, /startAction\.or\(confirmation\)\.first\(\)/u);
  assert.match(
    aiCoverJourney,
    /\/api\/core\/p1\/composer\/tasks\/\$\{coverTaskId\}\/start/u
  );
  assert.match(aiCoverJourney, /await startAction\.click\(\)/u);
  assert.match(aiCoverJourney, /确认执行/u);
  assert.match(
    aiCoverJourney,
    /startAction\.click\(\)[\s\S]*waitForDeliveryOrFailure|确认执行[\s\S]*waitForDeliveryOrFailure/u
  );
});
