/**
 * V31-05 production wiring gate: Thread-root host must land on the real
 * dashboard create path; recent must be Thread list projection. V31-10 adds:
 * Living Plan must land on the real dashboard create host — not library-only.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const readSource = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8');

test('V31-24 Idle goal-proactive panel is mounted from AgentWorkbenchHost Idle path', () => {
  const host = readSource('src/product/agent-workbench/agent-workbench.tsx');
  assert.match(host, /IdleGoalProactivePanel/u);
  assert.match(host, /rootMode === 'idle'/u);
  assert.match(host, /enableIdleGoalProactive/u);
  const panel = readSource(
    'src/product/agent-workbench/idle-goal-proactive.tsx'
  );
  assert.match(panel, /idle-suggestion-why-now/u);
  assert.match(panel, /accept_opportunity/u);
});

test('ComposerHome imports and mounts AgentWorkbenchHost with Thread-root props', () => {
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /from '@\/product\/agent-workbench'/u);
  assert.match(home, /AgentWorkbenchHost/u);
  assert.match(home, /explicitThreadId=\{activeAgentThreadId/u);
  assert.match(
    home,
    /activeAgentThreadId\s*=\s*session\.task\?\.agentThreadId\s*\?\?\s*agentBinding\?\.threadId\s*\?\?\s*initialThreadId\s*\?\?\s*null/u
  );
  assert.match(home, /readActiveHarnessTasks/u);
  assert.match(home, /currentTask\.agentThreadId/u);
  // Task identity follows the same precedence as the thread above: the live
  // server session projection wins, the URL param is only the pre-hydration
  // fallback. The host scopes MemoryInjectionReceiptPanel by this id, and a
  // plan_change steering command replaces the running task with a requoted
  // successor — pinned to the URL, the panel would keep showing the superseded
  // task's receipts after the merchant confirmed the new plan.
  assert.match(
    home,
    /explicitTaskId=\{session\.task\?\.taskId \?\? initialTaskId \?\? null\}/u
  );
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
  assert.match(index, /reconnectAgentWorkbench/u);
  assert.match(index, /AgentWorkbenchHost/u);
  assert.match(index, /AgentWorkstream/u);
  assert.match(index, /resolveDashboardThreadTarget/u);
  assert.match(index, /threadDashboardHref/u);
  assert.match(index, /ArtifactCanvas/u);
  assert.match(index, /projectVisibleArtifacts/u);
});

test('V31-15: Workstream production path mounts ArtifactCanvas (not worksSlot-only)', () => {
  const stream = readSource('src/product/agent-workbench/agent-workstream.tsx');
  assert.match(stream, /ArtifactCanvas/u);
  assert.match(stream, /ArtifactMobileSheet/u);
  assert.match(stream, /projectVisibleArtifacts/u);
  const host = readSource('src/product/agent-workbench/agent-workbench.tsx');
  assert.match(host, /set_artifact_viewing_revision/u);
  assert.match(host, /onArtifactViewRevision/u);
});

test('V31-17: Delivered publish handoff wired into Workstream + ComposerHome', () => {
  const stream = readSource('src/product/agent-workbench/agent-workstream.tsx');
  assert.match(stream, /PublishHandoffPanel/u);
  assert.match(stream, /publishHandoffView/u);
  assert.match(stream, /data-delivered/u);
  const home = readSource('src/product/composer/composer-home.tsx');
  assert.match(home, /usePublishHandoff/u);
  assert.match(
    home,
    /publishHandoffView=\{publishHandoff\.publishHandoffView\}/u
  );
  assert.match(home, /prepare_mobile_publish_handoff|usePublishHandoff/u);
  const index = readSource('src/product/agent-workbench/index.ts');
  assert.match(index, /PublishHandoffPanel/u);
  assert.match(index, /usePublishHandoff/u);
  assert.match(index, /projectPublishHandoffPanel/u);
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
  assert.match(host, /AgentWorkstream/u);

  const index = readSource('src/product/agent-workbench/index.ts');
  assert.match(index, /LivingPlan/u);
  assert.match(index, /projectActivePlanRevisions/u);
});
