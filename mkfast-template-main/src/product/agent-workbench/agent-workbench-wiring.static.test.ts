/**
 * V31-04 production wiring gate: reducer / Workstream / registry must land on
 * the real dashboard create host — not library-only.
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
