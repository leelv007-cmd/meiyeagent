/**
 * Z2-ACCEPT same-increment AP gates (capability skeleton + D-048 + dual-end labels).
 *
 * Gate 1: inventory coverage + D-051 six-question completeness + drilldown + exceptions aggregable.
 * Gate 3 (UI): multi-channel ready projection + single-channel no-fallback dual-end labels.
 * Gate 4: D-048 interaction ban on ops main paths (catalog / exception home / supply).
 *
 * Live Playwright four-service e2e and merchant selection-page labels that are
 * not yet instrumented are listed in docs/evidence/admin-supply-accept-gaps-2026-07-20.md.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAPABILITY_INVENTORY } from '@meiye/contracts';

import { AdminCapabilityCatalog } from './admin-capability-catalog';
import {
  assertOpsPathHasNoD048BannedControls,
  D048_BANNED_OPS_CONTROLS,
  buildCapabilityCatalog,
} from './admin-capability-catalog-model';
import {
  REQUIRED_SIX_QUESTION_KEYS,
  buildCapabilityRegistry,
  getProjection,
  getRegistryEntry,
} from './admin-capability-registry-model';
import { AdminExceptionHome } from './admin-exception-home';
import {
  assertNoAckAssignOwnerUi,
  buildExceptionHomeView,
  dedupeExceptionCandidates,
  projectCapabilityExceptionCandidates,
  projectInboxExceptionCandidates,
} from './admin-exception-home-model';
import { AdminSupplyControl } from './admin-supply-control';
import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import {
  buildSupplyOverviewView,
  projectDualChannelCoverage,
} from './admin-supply-overview-model';
import type { ActionableInboxItem } from '@meiye/contracts';

const NOW = '2026-07-20T12:00:00.000Z';

// ---------------------------------------------------------------------------
// Gate 1: capability skeleton completion contract (D-051 / D-056)
// ---------------------------------------------------------------------------

test('Z2-ACCEPT gate1: registry covers every inventory item with real status or explicit gap', () => {
  const view = buildCapabilityRegistry();
  assert.equal(view.entries.length, CAPABILITY_INVENTORY.items.length);
  assert.equal(view.projections.length, CAPABILITY_INVENTORY.items.length);

  for (const item of CAPABILITY_INVENTORY.items) {
    const entry = getRegistryEntry(view, item.id);
    assert.ok(entry, `missing registry entry for ${item.id}`);
    assert.ok(entry.purpose.length > 0);
    assert.ok(entry.owner.length > 0);
    assert.ok(entry.drilldownKey.length > 0);
    assert.ok(
      [
        'instrumented',
        'stub',
        'not_instrumented',
        'not_verified',
        'not_in_scope_for_supply_v1',
      ].includes(entry.instrumentStatus),
      `${item.id} instrumentStatus`,
    );
    // Availability is never a silent fake-green for stubs.
    if (
      entry.instrumentStatus === 'stub' ||
      entry.instrumentStatus === 'not_instrumented' ||
      entry.instrumentStatus === 'not_in_scope_for_supply_v1'
    ) {
      assert.ok(
        entry.availability === 'not_verified' ||
          entry.availability === 'not_instrumented',
        `${item.id} stub must not fake available`,
      );
    }
  }
});

test('Z2-ACCEPT gate1: D-051 six-question completeness + drilldown on every capability', () => {
  const view = buildCapabilityRegistry();
  for (const projection of view.projections) {
    assert.equal(
      projection.requiredComplete,
      true,
      `${projection.capabilityId} required six-question incomplete: ${JSON.stringify(projection.questions)}`,
    );
    for (const key of REQUIRED_SIX_QUESTION_KEYS) {
      assert.equal(
        projection.questions[key].status,
        'complete',
        `${projection.capabilityId}.${key}`,
      );
    }
    const entry = getRegistryEntry(view, projection.capabilityId);
    assert.ok(entry?.drilldownKey);
  }

  // Audio must remain visible as explicit gap, not disappear.
  const audio = getProjection(view, 'generation_audio');
  assert.ok(audio);
  assert.equal(audio.requiredComplete, true);
  assert.equal(audio.questions.runtimeFacts.status, 'not_instrumented');
});

test('Z2-ACCEPT gate1: exceptions are aggregable by root-cause key', () => {
  const registry = buildCapabilityRegistry();
  const nowMs = Date.parse(NOW);
  const inbox: ActionableInboxItem[] = [
    {
      statusKind: 'task_failed',
      title: '任务失败 A',
      nextActionLabel: '处理当前问题',
      createdAt: '2026-07-20T11:00:00.000Z',
      eventSource: {
        kind: 'task_terminal',
        taskId: 'task-a',
        taskStatus: 'failed',
      },
    },
    {
      statusKind: 'task_failed',
      title: '任务失败 B (same root)',
      nextActionLabel: '处理当前问题',
      createdAt: '2026-07-20T11:05:00.000Z',
      eventSource: {
        kind: 'task_terminal',
        taskId: 'task-b',
        taskStatus: 'failed',
      },
    },
    {
      statusKind: 'acceptance_unknown_recovery',
      title: '受理未知',
      nextActionLabel: '处理当前问题',
      createdAt: '2026-07-20T11:10:00.000Z',
      eventSource: {
        kind: 'task_terminal',
        taskId: 'task-c',
        taskStatus: 'acceptance_unknown',
      },
    },
  ];

  const fromInbox = projectInboxExceptionCandidates(inbox, nowMs);
  const fromCaps = projectCapabilityExceptionCandidates(registry, nowMs);
  const deduped = dedupeExceptionCandidates(
    [...fromInbox, ...fromCaps],
    registry,
    nowMs,
  );
  const keys = new Set(deduped.map((row) => row.rootCauseKey));
  assert.equal(keys.size, deduped.length, 'rootCauseKey must uniquely identify rows');
  assert.ok(deduped.length >= 1, 'exceptions must aggregate into rows');

  const home = buildExceptionHomeView({
    inboxItems: inbox,
    registry,
    now: NOW,
  });
  assert.equal(home.readOnly, true);
  assert.equal(home.supportsAck, false);
  assert.equal(home.supportsAssign, false);
  // Not measured by chart count — by presence of aggregable exception list or empty panorama.
  assert.ok(
    home.exceptions.length > 0 || home.panoramaStats.length >= 3,
    'either exception rows or panorama cards must be present',
  );
});

// ---------------------------------------------------------------------------
// Gate 3 (UI): multi-channel publish projection + single-channel dual-end labels
// ---------------------------------------------------------------------------

test('Z2-ACCEPT gate3 UI: featured core ops project multi_channel_ready only with ≥2 domains', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  for (const operation of [
    'copy.generate',
    'image.generate',
    'video.generate',
  ] as const) {
    const modelId = snapshot.featuredCoreModelIds[operation]!;
    const coverage = projectDualChannelCoverage({
      operation,
      catalogModelId: modelId,
      snapshot,
    });
    assert.equal(coverage.multiChannelReady, true, operation);
    assert.ok(coverage.independentFaultDomainCount >= 2, operation);
    assert.ok(coverage.qualifiedDeployments.length >= 2, operation);
  }
});

test('Z2-ACCEPT gate3 UI: single-channel model cannot be multi_channel_ready; labeled no-fallback', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const coverage = projectDualChannelCoverage({
    operation: 'image.generate',
    catalogModelId: 'model-image-single',
    snapshot,
  });
  assert.equal(coverage.multiChannelReady, false);
  assert.equal(coverage.status, 'single_channel');
  assert.match(coverage.label, /单渠道|无回退/);
  assert.match(coverage.note, /发布门|multi-channel|单渠道|无回退/i);
});

test('Z2-ACCEPT gate3 UI: admin supply overview SSR surfaces single-channel / multi-channel labels', () => {
  const view = buildSupplyOverviewView();
  assert.ok(view.operationReadiness.length === 3);
  const html = renderToStaticMarkup(<AdminSupplyControl />);
  assert.match(html, /双渠道就绪|multi_channel_ready/);
  assert.match(html, /单渠道|single-channel|无回退/);
  assert.match(html, /data-multi-channel-ready=/);
  // Admin end of dual-end single-channel labeling.
  assert.ok(
    view.dualChannelCoverage.some(
      (row) =>
        row.status === 'single_channel' ||
        row.multiChannelReady === false ||
        /单渠道|无回退/.test(row.label),
    ) || /单渠道|无回退|single-channel/.test(html),
    'admin supply surface must expose single-channel / no-fallback labeling',
  );
});

// ---------------------------------------------------------------------------
// Gate 4: D-048 interaction ban final check (ops main paths)
// ---------------------------------------------------------------------------

test('Z2-ACCEPT gate4: D-048 ban list is complete (code/SQL/env/raw JSON/CLI)', () => {
  assert.deepEqual(
    [...D048_BANNED_OPS_CONTROLS].sort(),
    [
      'cli-console',
      'code-editor',
      'env-editor',
      'raw-json-editor',
      'sql-console',
    ].sort(),
  );
});

test('Z2-ACCEPT gate4: capability catalog ops path has zero banned controls', () => {
  const catalog = buildCapabilityCatalog();
  assert.deepEqual(catalog.opsPathBannedControls, [...D048_BANNED_OPS_CONTROLS]);
  const html = renderToStaticMarkup(<AdminCapabilityCatalog />);
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(html), []);
  assert.match(html, /data-ops-path="daily"/);
  assert.doesNotMatch(html, /data-testid="one-click-repair"/);
  for (const id of D048_BANNED_OPS_CONTROLS) {
    assert.doesNotMatch(html, new RegExp(`data-testid="${id}"`));
  }
});

test('Z2-ACCEPT gate4: exception home ops path has zero banned controls + no ack/assign', () => {
  const html = renderToStaticMarkup(
    <AdminExceptionHome input={{ now: NOW }} />,
  );
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(html), []);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
  assert.match(html, /data-read-only="true"/);
  assert.match(html, /data-one-click-repair="false"/);
  for (const id of D048_BANNED_OPS_CONTROLS) {
    assert.doesNotMatch(html, new RegExp(`data-testid="${id}"`));
  }
});

test('Z2-ACCEPT gate4: supply control center ops path has zero banned controls', () => {
  const html = renderToStaticMarkup(<AdminSupplyControl />);
  assert.deepEqual(assertOpsPathHasNoD048BannedControls(html), []);
  for (const id of D048_BANNED_OPS_CONTROLS) {
    assert.doesNotMatch(html, new RegExp(`data-testid="${id}"`));
  }
  assert.doesNotMatch(html, /data-ops-control="(code|sql|env|raw-json|cli)"/);
});
