import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('./workflow-core.ts', import.meta.url),
  'utf8'
);

// Regression: ISSUE-010 — explicit free creation followed customized grounding
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('free creation overrides model routing before the no-question shortcut', () => {
  const routeFunction = workflow.slice(
    workflow.indexOf('async function resolveIntentRoute'),
    workflow.indexOf('async function awaitResolvedDecision')
  );
  const freeGuard = routeFunction.indexOf(
    "if (input.request.creationMode === 'free')"
  );
  const noQuestion = routeFunction.indexOf(
    'if (!input.intent.blockingQuestion)'
  );

  assert.ok(freeGuard >= 0);
  assert.ok(noQuestion > freeGuard);
  assert.match(
    routeFunction,
    /declaration: freeRouteDeclaration\(input\.intent\.declaration\)/u
  );
});
