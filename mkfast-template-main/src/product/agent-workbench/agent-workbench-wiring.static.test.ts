/**
 * V31-05 production wiring gate: Thread-root host must land on the real
 * dashboard create path; recent must be Thread list projection.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const readSource = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8');

test('ComposerHome imports and mounts AgentWorkbenchHost with Thread-root props', () => {
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /from '@\/product\/agent-workbench'/u);
  assert.match(home, /AgentWorkbenchHost/u);
  assert.match(home, /explicitThreadId=\{initialThreadId/u);
  assert.match(home, /explicitTaskId=\{initialTaskId/u);
  assert.match(home, /initialThreadId\?:/u);
});

test('dashboard route accepts threadId and passes it to ComposerHome', () => {
  const route = readSource('src/routes/dashboard/index.tsx');
  assert.match(route, /threadId\?: string/u);
  assert.match(route, /initialThreadId=\{search\.threadId\}/u);
});

test('/dashboard/recent is Thread list projection (supersede D-088)', () => {
  const recent = readSource('src/routes/dashboard/recent.tsx');
  assert.match(recent, /ThreadListPage/u);
  assert.doesNotMatch(recent, /CanonicalHistoryPage mode="recent"/u);
  const page = readSource('src/product/thread-list-page.tsx');
  assert.match(page, /agent-session/u);
  assert.match(page, /list_threads/u);
  assert.match(page, /threadDashboardHref|threadId=/u);
});

test('agent-workbench module exports Thread-root restore + reconnect client', () => {
  const index = readSource('src/product/agent-workbench/index.ts');
  assert.match(index, /reduceAgentWorkbench/u);
  assert.match(index, /resolveControlledSurface/u);
  assert.match(index, /reconnectAgentWorkbench/u);
  assert.match(index, /AgentWorkbenchHost/u);
  assert.match(index, /AgentWorkstream/u);
  assert.match(index, /resolveDashboardThreadTarget/u);
  assert.match(index, /threadDashboardHref/u);
  assert.match(index, /ArtifactCanvas/u);
  assert.match(index, /projectVisibleArtifacts/u);
  assert.match(index, /registerArtifactSurfaces/u);
});

test('V31-15: Workstream production path mounts ArtifactCanvas (not worksSlot-only)', () => {
  const stream = readSource('src/product/agent-workbench/agent-workstream.tsx');
  assert.match(stream, /ArtifactCanvas/u);
  assert.match(stream, /ArtifactMobileSheet/u);
  assert.match(stream, /projectVisibleArtifacts/u);
  assert.match(stream, /artifact-registry/u);
  const host = readSource('src/product/agent-workbench/agent-workbench.tsx');
  assert.match(host, /set_artifact_viewing_revision/u);
  assert.match(host, /onArtifactViewRevision/u);
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
