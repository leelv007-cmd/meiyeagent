/**
 * V31-04 + V31-10 production wiring gate: reducer / Workstream / registry /
 * Living Plan must land on the real dashboard create host — not library-only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const readSource = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8');

test('ComposerHome imports and mounts AgentWorkbenchHost', () => {
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /from '@\/product\/agent-workbench'/u);
  assert.match(home, /AgentWorkbenchHost/u);
  assert.match(home, /data-testid="agent-workbench-host"|AgentWorkbenchHost/u);
});

test('agent-workbench module exports reducer + registry + reconnect client', () => {
  const index = readSource('src/product/agent-workbench/index.ts');
  assert.match(index, /reduceAgentWorkbench/u);
  assert.match(index, /resolveControlledSurface/u);
  assert.match(index, /reconnectAgentWorkbench/u);
  assert.match(index, /AgentWorkbenchHost/u);
  assert.match(index, /AgentWorkstream/u);
});

test('no second global state library introduced for workbench', () => {
  const files = [
    'src/product/agent-workbench/agent-event-store.ts',
    'src/product/agent-workbench/agent-event-reducer.ts',
    'src/product/agent-workbench/agent-workbench.tsx',
  ];
  for (const rel of files) {
    const source = readSource(rel);
    assert.doesNotMatch(source, /from ['"]zustand['"]/u);
    assert.doesNotMatch(source, /from ['"]@reduxjs\/toolkit['"]/u);
    assert.doesNotMatch(source, /from ['"]redux['"]/u);
  }
  const store = readSource('src/product/agent-workbench/agent-event-store.ts');
  assert.match(store, /useSyncExternalStore/u);
});

test('V31-10: Living Plan is wired into Workstream render path (not library-only)', () => {
  const workstream = readSource(
    'src/product/agent-workbench/agent-workstream.tsx'
  );
  assert.match(workstream, /from '\.\/plan'/u);
  assert.match(workstream, /LivingPlan/u);
  assert.match(workstream, /projectActivePlanRevisions/u);
  assert.match(workstream, /data-testid="agent-workstream"/u);

  const host = readSource('src/product/agent-workbench/agent-workbench.tsx');
  assert.match(host, /registerPlanSurfaces/u);
  assert.match(host, /AgentWorkstream/u);

  const index = readSource('src/product/agent-workbench/index.ts');
  assert.match(index, /LivingPlan/u);
  assert.match(index, /registerPlanSurfaces/u);
  assert.match(index, /projectActivePlanRevisions/u);
});

test('V31-10: plan surfaces register only this ticket keys via registerAgentSurface', () => {
  const reg = readSource(
    'src/product/agent-workbench/plan/register-plan-surfaces.ts'
  );
  assert.match(reg, /registerAgentSurface\('living_plan'/u);
  assert.match(reg, /registerAgentSurface\('plan_section'/u);
  assert.match(reg, /registerAgentSurface\('plan_diff'/u);
  assert.match(reg, /registerAgentSurface\('compact_plan'/u);
  assert.match(reg, /registerAgentSurface\('commit_strip'/u);
  // Must not re-bootstrap foundation keys or touch negative-gate ownership
  assert.doesNotMatch(reg, /registerAgentSurface\('narrative'/u);
  assert.doesNotMatch(reg, /registerAgentSurface\('activity'/u);
});
