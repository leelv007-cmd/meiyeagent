/**
 * V31-24 production wiring gate: Goal + Proactive must land on PG stores
 * and real API/UI paths — Memory stores are tests only.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { OPS_KILL_SWITCH_CATALOG } from '../ops-console/kill-switches.js';
import {
  constructors,
  hasCall,
  hasValueImport,
  identifiers,
  objectLiteralProps,
  parseProductionSource,
  parseSourceText,
  propertyValues,
} from '../testing/ast-boundary.js';

const root = resolve(process.cwd(), '../..');
const parse = (rel: string) => parseProductionSource(resolve(root, rel));

test('pre-fix Memory Goal store wiring fails the assembly boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    `new GoalProactiveFoundationModule(new MemoryMarketingGoalStore(), proactive);`,
  );
  assert.ok(constructors(preFix).includes('MemoryMarketingGoalStore'));
});

test('api-runtime mounts GoalProactiveFoundationModule with Postgres stores', () => {
  const parsed = parse('apps/core/src/assembly/api-runtime.ts');
  assert.equal(
    hasValueImport(parsed, 'GoalProactiveFoundationModule'),
    true,
  );
  assert.equal(hasValueImport(parsed, 'PostgresMarketingGoalStore'), true);
  assert.equal(
    hasValueImport(parsed, 'PostgresOpportunityDecisionStore'),
    true,
  );
  assert.ok(constructors(parsed).includes('GoalService'));
  assert.ok(constructors(parsed).includes('ProactiveService'));
  assert.ok(constructors(parsed).includes('PostgresMarketingGoalStore'));
  assert.ok(constructors(parsed).includes('PostgresOpportunityDecisionStore'));
  assert.ok(
    constructors(parsed).includes('GoalProactiveFoundationModule'),
  );
  assert.ok(
    constructors(parsed).includes('ContentPackageEvidenceCoveragePort'),
  );
  assert.equal(hasCall(parsed, 'listContentPackages'), true);
  assert.ok(
    objectLiteralProps(parsed, 'signals').some(
      (props) => props.contentPackages === 'contentPackageFactsReader',
    ) ||
      propertyValues(parsed, 'contentPackages').includes(
        'contentPackageFactsReader',
      ),
  );
  assert.equal(
    constructors(parsed).includes('MemoryMarketingGoalStore'),
    false,
    'production must not construct the in-memory Goal store',
  );
});

test('core-assembly constructs Postgres Goal and opportunity stores', () => {
  const parsed = parse('apps/core/src/assembly/core-assembly.ts');
  assert.ok(constructors(parsed).includes('PostgresMarketingGoalStore'));
  assert.ok(
    constructors(parsed).includes('PostgresOpportunityDecisionStore'),
  );
  const names = identifiers(parsed);
  assert.equal(names.has('marketingGoalStore'), true);
  assert.equal(names.has('opportunityDecisionStore'), true);
});

test('ops kill switch disable_proactive_agent is landed for V31-24', () => {
  assert.equal(OPS_KILL_SWITCH_CATALOG.disable_proactive_agent.landed, true);
  assert.equal(
    OPS_KILL_SWITCH_CATALOG.disable_proactive_agent.providerTicket,
    'V31-24',
  );
});
