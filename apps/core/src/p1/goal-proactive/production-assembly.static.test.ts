/**
 * V31-24 production wiring gate: Goal + Proactive must land on PG stores
 * and real API/UI paths — Memory stores are tests only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(process.cwd(), '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

test('api-runtime mounts GoalProactiveFoundationModule with Postgres stores', () => {
  const source = read('apps/core/src/assembly/api-runtime.ts');
  assert.match(source, /GoalProactiveFoundationModule/u);
  assert.match(source, /PostgresMarketingGoalStore/u);
  assert.match(source, /PostgresOpportunityDecisionStore/u);
  assert.match(source, /new GoalService/u);
  assert.match(source, /new ProactiveService/u);
  assert.match(source, /ContentPackageEvidenceCoveragePort/u);
  assert.match(source, /listContentPackages/u);
  assert.match(source, /contentPackages:\s*contentPackageFactsReader/u);
  assert.doesNotMatch(
    source,
    /GoalProactiveFoundationModule\(\s*new MemoryMarketingGoalStore/u,
  );
});

test('core-assembly migrates p1_marketing_goals and opportunity decisions', () => {
  const source = read('apps/core/src/assembly/core-assembly.ts');
  assert.match(source, /PostgresMarketingGoalStore/u);
  assert.match(source, /PostgresOpportunityDecisionStore/u);
  assert.match(source, /marketingGoalStore/u);
  assert.match(source, /opportunityDecisionStore/u);
});

test('ops kill switch disable_proactive_agent is landed for V31-24', () => {
  const source = read('apps/core/src/p1/ops-console/kill-switches.ts');
  assert.match(
    source,
    /disable_proactive_agent:\s*\{\s*landed:\s*true/u,
  );
});
