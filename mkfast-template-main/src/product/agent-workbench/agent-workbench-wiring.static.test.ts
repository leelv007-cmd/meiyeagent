/**
 * V31-05 production wiring gate: Thread-root host must land on the real
 * dashboard create path; recent must be Thread list projection. V31-10 adds:
 * Living Plan must land on the real dashboard create host — not library-only.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  callArgumentObjects,
  calls,
  equalityTargets,
  hasCall,
  hasValueImport,
  identifiers,
  jsxOf,
  literals,
  parseProductionSource,
  parseSourceText,
  propertyAccesses,
  propertyValues,
  typeMembers,
  valueImports,
} from '../../test-support/ast-boundary';

const parse = (rel: string) =>
  parseProductionSource(resolve(process.cwd(), rel));

test('pre-fix Idle goal panel outside the host fails the mount boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.tsx',
    'export function ComposerHome() { return <IdleGoalProactivePanel />; }'
  );
  assert.equal(jsxOf(preFix, 'IdleGoalProactivePanel').length, 1);
});

test('V31-24 Idle goal-proactive panel is mounted from AgentWorkbenchHost Idle path', () => {
  const host = parse('src/product/agent-workbench/agent-workbench.tsx');
  assert.equal(hasValueImport(host, 'IdleGoalProactivePanel'), true);
  assert.ok(
    equalityTargets(host).some(
      (pair) => pair.left === 'rootMode' && pair.right === 'idle'
    )
  );
  assert.ok(identifiers(host).has('enableIdleGoalProactive'));
  assert.equal(jsxOf(host, 'IdleGoalProactivePanel').length, 1);

  const panel = parse('src/product/agent-workbench/idle-goal-proactive.tsx');
  assert.ok(literals(panel).includes('idle-suggestion-why-now'));
  assert.ok(literals(panel).includes('accept_opportunity'));
});

test('ComposerHome keeps IdleGoalProactive off between segmenter and composer', () => {
  const home = parse('src/product/composer/composer-home.tsx');
  const controller = parse(
    'src/product/composer/use-composer-workbench-controller.tsx'
  );
  assert.equal(jsxOf(home, 'AgentWorkbenchHost').length, 0);
  assert.ok(jsxOf(home, 'ComposerWorkbenchHost').length >= 1);
  assert.equal(jsxOf(controller, 'AgentWorkbenchHost').length, 1);
  assert.equal(
    propertyValues(controller, 'enableIdleGoalProactive').includes('false'),
    true
  );
});

test('ComposerHome imports and mounts AgentWorkbenchHost with Thread-root props', () => {
  const home = parse('src/product/composer/composer-home.tsx');
  const controller = parse(
    'src/product/composer/use-composer-workbench-controller.tsx'
  );
  assert.equal(hasValueImport(home, 'ComposerWorkbenchHost'), true);
  assert.equal(
    hasValueImport(
      controller,
      'AgentWorkbenchHost',
      '@/product/agent-workbench/agent-workbench'
    ),
    true
  );
  const host = jsxOf(home, 'ComposerWorkbenchHost')[0];
  assert.ok(host, 'ComposerHome must mount ComposerWorkbenchHost');
  assert.equal(host.attrs.explicitThreadId, 'activeAgentThreadId');
  assert.equal(host.attrs.accountId, 'accountId');
  assert.equal(host.attrs.workspaceId, 'product.state?.workspaceId ?? null');
  assert.equal(
    host.attrs.explicitTaskId,
    'campaignLivingPlan.taskId ?? initialTaskId ?? null'
  );
  assert.equal(hasCall(home, 'selectCampaignLivingPlanBinding'), true);
  assert.equal(hasCall(home, 'selectActiveAgentThreadId'), true);
  assert.equal(hasCall(home, 'readActiveHarnessTasks'), true);
  assert.ok(propertyAccesses(home).includes('currentTask.agentThreadId'));
  assert.ok(typeMembers(home, 'ComposerHomeProps').includes('initialThreadId'));
});

test('dashboard route accepts threadId and passes it to ComposerHome', () => {
  const route = parse('src/routes/dashboard/index.tsx');
  assert.ok(typeMembers(route, 'DashboardSearch').includes('threadId'));
  const home = jsxOf(route, 'ComposerHome')[0];
  assert.ok(home);
  assert.equal(home.attrs.initialThreadId, 'search.threadId');
  assert.ok(calls(route).some((name) => name.endsWith('useSession')));
  assert.equal(home.attrs.accountId, 'authSession?.user.id ?? null');
});

test('AgentEventStore owner binds the account/workspace/Thread identity tuple', () => {
  const host = parse('src/product/agent-workbench/agent-workbench.tsx');
  const reducer = parse('src/product/agent-workbench/agent-event-reducer.ts');
  assert.ok(literals(host).includes('bind_identity'));
  assert.ok(identifiers(host).has('useLayoutEffect'));
  assert.ok(identifiers(reducer).has('emptyProjectionForIdentity'));
  assert.ok(identifiers(reducer).has('expectedIdentity'));
});

test('/dashboard/recent is Thread list projection (supersede D-088)', () => {
  const recent = parse('src/routes/dashboard/recent.tsx');
  assert.equal(jsxOf(recent, 'ThreadListPage').length, 1);
  assert.equal(jsxOf(recent, 'CanonicalHistoryPage').length, 0);
  const page = parse('src/product/thread-list-page.tsx');
  assert.ok(
    valueImports(page).some((entry) =>
      entry.module.includes('agent-workbench/thread-session')
    )
  );
  assert.ok(literals(page).includes('list_threads'));
  assert.ok(
    identifiers(page).has('threadDashboardHref') ||
      literals(page).some((value) => value.includes('threadId='))
  );
});

test('MEM-02: Artifact/Work this-run experience is a stable entry', () => {
  const stream = parse('src/product/agent-workbench/agent-workstream.tsx');
  assert.equal(hasValueImport(stream, 'ThisRunExperienceEntry'), true);
  assert.equal(jsxOf(stream, 'ThisRunExperienceEntry').length, 1);
  assert.equal(hasCall(stream, 'boundWorkbenchTaskId'), true);
  const works = parse('src/product/works/works-detail-page.tsx');
  const entry = jsxOf(works, 'ThisRunExperienceEntry')[0];
  assert.ok(entry);
  assert.equal(entry.attrs.taskId, 'detail.sourceTaskId');
});

test('V31-15: Workstream production path mounts ArtifactCanvas (not worksSlot-only)', () => {
  const stream = parse('src/product/agent-workbench/agent-workstream.tsx');
  assert.equal(hasValueImport(stream, 'ArtifactCanvas'), true);
  assert.equal(hasValueImport(stream, 'ArtifactMobileSheet'), true);
  assert.ok(jsxOf(stream, 'ArtifactCanvas').length >= 1);
  assert.ok(jsxOf(stream, 'ArtifactMobileSheet').length >= 1);
  assert.equal(hasCall(stream, 'projectVisibleArtifacts'), true);
  const host = parse('src/product/agent-workbench/agent-workbench.tsx');
  assert.ok(literals(host).includes('set_artifact_viewing_revision'));
  assert.ok(identifiers(host).has('onArtifactViewRevision'));
});

test('without live SSE the host polls replay so Artifact can grow', () => {
  const host = parse('src/product/agent-workbench/agent-workbench.tsx');
  assert.equal(hasCall(host, 'startWorkbenchReplayPoll'), true);
  assert.ok(identifiers(host).has('subscribeLive'));
  assert.ok(identifiers(host).has('loadReplay'));
});

test('V31-17: Delivered publish handoff wired into Workstream + ComposerHome', () => {
  const stream = parse('src/product/agent-workbench/agent-workstream.tsx');
  assert.equal(hasValueImport(stream, 'PublishHandoffPanel'), true);
  assert.ok(jsxOf(stream, 'PublishHandoffPanel').length >= 1);
  assert.ok(identifiers(stream).has('publishHandoffView'));
  assert.ok(
    jsxOf(stream, 'div').some(
      (element) => element.attrs['data-delivered'] !== undefined
    )
  );
  const home = parse('src/product/composer/composer-home.tsx');
  const delivery = parse(
    'src/product/composer/use-composer-delivery-controller.ts'
  );
  const workbench = parse(
    'src/product/composer/use-composer-workbench-controller.tsx'
  );
  assert.equal(hasCall(home, 'useComposerDeliveryController'), true);
  assert.equal(hasCall(delivery, 'usePublishHandoff'), true);
  const host = jsxOf(home, 'ComposerWorkbenchHost')[0];
  assert.equal(host?.attrs.publishHandoff, 'delivery');
  assert.ok(identifiers(home).has('lastDeliveredWorkId'));
  assert.ok(identifiers(home).has('lastDeliveredPackageId'));
  assert.equal(
    identifiers(workbench).has('subscribeAgentSemanticEvents'),
    true,
    'ARCH-02: production Composer must subscribe SSE, not poll-only undefined'
  );
  assert.ok(
    propertyValues(workbench, 'subscribeLive').includes(
      'subscribeAgentSemanticEvents'
    )
  );
  const handoffArgs = callArgumentObjects(
    home,
    'useComposerDeliveryController'
  );
  assert.ok(handoffArgs.length >= 1);
  assert.equal(
    Object.hasOwn(handoffArgs[0] ?? {}, 'harnessDelivery'),
    false,
    'handoff variant must be the platform currentVersionId, not a harness page id'
  );
});

test('EXEC-05 self_report_ask hydrates only for the identity-matched delivered view', () => {
  const hook = parse(
    'src/product/agent-workbench/publish-handoff/use-publish-handoff.ts'
  );
  assert.ok(literals(hook).includes('self_report_ask'));
  assert.ok(identifiers(hook).has('askedPackageRef'));
  assert.ok(identifiers(hook).has('stateMatchesIdentity'));
  assert.equal(identifiers(hook).has('publishedAtRef'), false);
  const resultView = parse('src/product/results/use-result-center-view.tsx');
  assert.equal(hasCall(resultView, 'usePublishHandoff'), true);
  const resultPage = parse('src/product/results/result-center-page.tsx');
  assert.ok(literals(resultPage).includes('self-report-journey'));
});

test('no second global state library introduced for workbench', () => {
  const files = [
    'src/product/agent-workbench/agent-event-store.ts',
    'src/product/agent-workbench/agent-event-reducer.ts',
    'src/product/agent-workbench/agent-workbench.tsx',
  ];
  for (const rel of files) {
    const modules = valueImports(parse(rel)).map((entry) => entry.module);
    assert.equal(modules.includes('zustand'), false, rel);
    assert.equal(modules.includes('@reduxjs/toolkit'), false, rel);
    assert.equal(modules.includes('redux'), false, rel);
  }
  const store = parse('src/product/agent-workbench/agent-event-store.ts');
  assert.equal(hasCall(store, 'useSyncExternalStore'), true);
});

test('V31-10: Living Plan is wired into Workstream render path (not library-only)', () => {
  const workstream = parse('src/product/agent-workbench/agent-workstream.tsx');
  assert.ok(
    valueImports(workstream).some(
      (entry) => entry.name === 'LivingPlan' && entry.module.includes('./plan')
    )
  );
  assert.ok(jsxOf(workstream, 'LivingPlan').length >= 1);
  assert.equal(hasCall(workstream, 'projectActivePlanRevisions'), true);
  assert.ok(
    jsxOf(workstream, 'div').some(
      (element) => element.attrs['data-testid'] === 'agent-workstream'
    )
  );

  const host = parse('src/product/agent-workbench/agent-workbench.tsx');
  assert.equal(hasValueImport(host, 'AgentWorkstream'), true);
  assert.ok(jsxOf(host, 'AgentWorkstream').length >= 1);
  const living = parse('src/product/agent-workbench/plan/living-plan.tsx');
  assert.equal(hasCall(living, 'projectCommitStrip'), true);
  assert.equal(hasCall(living, 'commitStripInputFromPlanFacts'), true);
});
