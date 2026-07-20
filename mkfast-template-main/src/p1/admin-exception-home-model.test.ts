import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ActionableInboxItem,
  CapabilityRegistryEntry,
} from '@meiye/contracts';
import {
  assertNoAckAssignOwnerUi,
  buildExceptionHomeView,
  buildPanoramaStatCards,
  dedupeExceptionCandidates,
  EXCEPTION_SEVERITY_RANK,
  projectCapabilityExceptionCandidates,
  projectEvidenceFreshness,
  projectInboxExceptionCandidates,
  redactHandoffContext,
  sortExceptionRows,
  type ExceptionHomeRow,
} from './admin-exception-home-model';
import {
  buildCapabilityRegistry,
  knownMetric,
} from './admin-capability-registry-model';

const NOW = '2026-07-20T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function inboxItem(
  partial: Partial<ActionableInboxItem> &
    Pick<ActionableInboxItem, 'statusKind' | 'title' | 'eventSource'>
): ActionableInboxItem {
  return {
    createdAt: partial.createdAt ?? '2026-07-20T11:00:00.000Z',
    nextActionLabel: partial.nextActionLabel ?? '处理当前问题',
    ...partial,
  };
}

test('projectEvidenceFreshness: fresh / stale / unknown + long stale window', () => {
  const fresh = projectEvidenceFreshness({
    capturedAt: '2026-07-20T11:55:00.000Z',
    staleAfterMs: 15 * 60 * 1000,
    nowMs: NOW_MS,
  });
  assert.equal(fresh.freshness, 'fresh');
  assert.equal(fresh.isLongStale, false);

  const stale = projectEvidenceFreshness({
    capturedAt: '2026-07-20T10:00:00.000Z',
    staleAfterMs: 15 * 60 * 1000,
    nowMs: NOW_MS,
  });
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.isLongStale, true);
  assert.ok((stale.ageMs ?? 0) >= 15 * 60 * 1000);

  const unknown = projectEvidenceFreshness({
    nowMs: NOW_MS,
  });
  assert.equal(unknown.freshness, 'unknown');
  assert.equal(unknown.isLongStale, false);
});

test('inbox projection maps exception kinds and skips success noise', () => {
  const items: ActionableInboxItem[] = [
    inboxItem({
      statusKind: 'task_failed',
      title: '任务最终失败',
      eventSource: {
        kind: 'task_terminal',
        taskId: 'task-1',
        taskStatus: 'failed',
      },
    }),
    inboxItem({
      statusKind: 'result_available',
      title: '结果可用',
      nextActionLabel: '查看结果',
      eventSource: {
        kind: 'task_terminal',
        taskId: 'task-2',
        taskStatus: 'completed',
      },
    }),
    inboxItem({
      statusKind: 'delivery_completed',
      title: '交付完成',
      nextActionLabel: '查看结果',
      eventSource: {
        kind: 'delivery_event',
        packageId: 'pkg-1',
        eventId: 'ev-1',
        eventType: 'manual_publish_result',
        deliveryStatus: 'published',
      },
    }),
    inboxItem({
      statusKind: 'delivery_partial_or_unknown',
      title: '交付部分失败',
      nextActionLabel: '继续交付',
      eventSource: {
        kind: 'delivery_event',
        packageId: 'pkg-2',
        eventId: 'ev-2',
        eventType: 'automatic_publish_result',
        deliveryStatus: 'failed',
      },
    }),
  ];

  const candidates = projectInboxExceptionCandidates(items, NOW_MS);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.severity, 'blocked');
  assert.equal(candidates[1]?.severity, 'degraded');
  assert.ok(
    candidates.every((item) => item.origin === 'actionable_inbox'),
    'inbox origin only'
  );
});

test('capability metric projection includes not_verified and long stale', () => {
  const registry = buildCapabilityRegistry();
  // Force one entry into long-stale available state via overlay.
  const entries: CapabilityRegistryEntry[] = registry.entries.map((entry) => {
    if (entry.id === 'job_queue_harness') {
      return {
        ...entry,
        availability: 'available',
        evidenceFreshness: {
          capturedAt: '2026-07-20T00:00:00.000Z',
          staleAfterMs: 5 * 60 * 1000,
          source: 'job_queue_self_report_skeleton',
        },
        runtimeFacts: {
          ...entry.runtimeFacts,
          calls: knownMetric(12, 'job-runtime'),
        },
      };
    }
    return entry;
  });
  const overlay = { ...registry, entries };

  const candidates = projectCapabilityExceptionCandidates(overlay, NOW_MS);
  assert.ok(candidates.length > 0, 'expected capability exceptions');

  const notVerified = candidates.filter((c) => c.severity === 'not_verified');
  assert.ok(notVerified.length > 0, 'skeleton instrumented domains are not_verified');

  const longStale = candidates.find(
    (c) => c.capabilityId === 'job_queue_harness' && c.severity === 'stale'
  );
  assert.ok(longStale, 'long stale available capability elevates to stale');
  assert.equal(longStale.freshness, 'stale');

  // not_instrumented must not appear as home exceptions by itself.
  assert.ok(
    candidates.every((c) => c.severity !== ('not_instrumented' as never)),
    'not_instrumented is not an exception severity'
  );
});

test('root-cause dedupe collapses shared source+severity into primary + affected list', () => {
  const registry = buildCapabilityRegistry();
  const candidates = projectCapabilityExceptionCandidates(registry, NOW_MS);
  const rows = dedupeExceptionCandidates(candidates, registry, NOW_MS);

  // Model supply skeleton shares evidence source → one root-cause group.
  const modelGroup = rows.find((row) =>
    row.rootCauseKey.startsWith('registry:model_supply_self_report_skeleton:')
  );
  assert.ok(modelGroup, 'expected model supply root-cause group');
  assert.ok(
    modelGroup.affectedCapabilityIds.length >= 2,
    `expected multi-capability collapse, got ${modelGroup.affectedCapabilityIds.join(',')}`
  );
  assert.ok(modelGroup.primaryCapabilityId);
  assert.ok(
    modelGroup.affectedCapabilityIds.includes(modelGroup.primaryCapabilityId!)
  );

  // Unique keys stay unique.
  const keys = rows.map((row) => row.rootCauseKey);
  assert.equal(keys.length, new Set(keys).size, 'rootCauseKey must be unique');
});

test('sort: severity × scope × duration × recent change', () => {
  const base: Omit<
    ExceptionHomeRow,
    | 'severity'
    | 'scopeWeight'
    | 'durationMs'
    | 'recencyMs'
    | 'rootCauseKey'
    | 'title'
  > = {
    affectedCapabilityIds: [],
    affectedScope: [],
    startedAt: NOW,
    lastChangedAt: NOW,
    evidenceSource: 'test',
    evidenceCapturedAt: NOW,
    freshness: 'fresh',
    recentChangeSummary: 'n/a',
    technicalHandoff: {
      href: '/admin/audit',
      label: '技术台移交（脱敏）',
      oneClickRepair: false,
      correlationHints: [],
      redactedContext: { note: 'x' },
    },
    origin: 'capability_metric',
  };

  const rows: ExceptionHomeRow[] = [
    {
      ...base,
      rootCauseKey: 'b-attention-small',
      severity: 'attention',
      title: 'attention small',
      scopeWeight: 1,
      durationMs: 1000,
      recencyMs: 500,
    },
    {
      ...base,
      rootCauseKey: 'a-blocked-small',
      severity: 'blocked',
      title: 'blocked small',
      scopeWeight: 1,
      durationMs: 1000,
      recencyMs: 100,
    },
    {
      ...base,
      rootCauseKey: 'a-blocked-large-old',
      severity: 'blocked',
      title: 'blocked large old',
      scopeWeight: 5,
      durationMs: 9000,
      recencyMs: 800,
    },
    {
      ...base,
      rootCauseKey: 'a-blocked-large-recent',
      severity: 'blocked',
      title: 'blocked large recent',
      scopeWeight: 5,
      durationMs: 9000,
      recencyMs: 50,
    },
  ];

  const sorted = sortExceptionRows(rows);
  assert.deepEqual(
    sorted.map((row) => row.rootCauseKey),
    [
      'a-blocked-large-recent',
      'a-blocked-large-old',
      'a-blocked-small',
      'b-attention-small',
    ]
  );
  assert.ok(
    EXCEPTION_SEVERITY_RANK[sorted[0]!.severity] <
      EXCEPTION_SEVERITY_RANK[sorted[sorted.length - 1]!.severity]
  );
});

test('handoff link redaction strips secrets / tokens / sql / env dumps', () => {
  const redacted = redactHandoffContext({
    domain: 'task_orchestration',
    apiKey: 'fixture-secret',
    password: 'hunter2',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
    note: 'safe operator note',
    dump: 'SELECT * FROM secrets',
    envBlob: 'DATABASE_URL=postgres://user:pass@host/db',
  });

  assert.equal(redacted.domain, 'task_orchestration');
  assert.equal(redacted.note, 'safe operator note');
  assert.equal(redacted.apiKey, '[redacted]');
  assert.equal(redacted.password, '[redacted]');
  assert.equal(redacted.authorization, '[redacted]');
  assert.equal(redacted.dump, '[redacted]');
  assert.equal(redacted.envBlob, '[redacted]');
});

test('buildExceptionHomeView combines inbox + metrics, C1 flags, empty panorama', () => {
  const view = buildExceptionHomeView({
    now: NOW,
    inboxItems: [
      inboxItem({
        statusKind: 'task_failed',
        title: '生成任务失败',
        eventSource: {
          kind: 'task_terminal',
          taskId: 'task-fail-1',
          taskStatus: 'failed',
        },
      }),
    ],
  });

  assert.equal(view.readOnly, true);
  assert.equal(view.supportsAck, false);
  assert.equal(view.supportsAssign, false);
  assert.equal(view.supportsOwnerWorkflow, false);
  assert.equal(view.empty, false);
  assert.ok(view.exceptions.length > 0);
  assert.ok(
    view.exceptions.some((row) => row.origin === 'actionable_inbox'),
    'inbox candidate present'
  );
  assert.ok(
    view.exceptions.some((row) => row.origin === 'capability_metric'),
    'capability metric candidate present'
  );

  // Sorted: first row is highest severity among all.
  for (let i = 1; i < view.exceptions.length; i++) {
    const prev = view.exceptions[i - 1]!;
    const curr = view.exceptions[i]!;
    assert.ok(
      EXCEPTION_SEVERITY_RANK[prev.severity] <=
        EXCEPTION_SEVERITY_RANK[curr.severity],
      'severity order'
    );
  }

  // Handoff is redacted + never one-click repair.
  for (const row of view.exceptions) {
    assert.equal(row.technicalHandoff.oneClickRepair, false);
    assert.ok(row.technicalHandoff.href.startsWith('/admin/'));
    assert.ok(!('apiKey' in row.technicalHandoff.redactedContext));
    assert.match(
      row.technicalHandoff.redactedContext.note ?? '',
      /not a one-click repair/i
    );
  }

  assert.equal(view.catalogEntry.path, '/admin/capabilities');
  assert.ok(view.panoramaStats.length >= 3 && view.panoramaStats.length <= 5);
});

test('empty state when no inbox exceptions and all capabilities available+fresh', () => {
  const registry = buildCapabilityRegistry();
  const entries = registry.entries.map((entry) => ({
    ...entry,
    availability: 'available' as const,
    evidenceFreshness: {
      capturedAt: NOW,
      staleAfterMs: 60 * 60 * 1000,
      source: entry.evidenceFreshness?.source ?? 'test_fresh',
    },
  }));
  const healthy = { ...registry, entries };

  const view = buildExceptionHomeView({
    registry: healthy,
    inboxItems: [
      inboxItem({
        statusKind: 'result_available',
        title: '结果可用',
        nextActionLabel: '查看结果',
        eventSource: {
          kind: 'task_terminal',
          taskId: 'ok-1',
          taskStatus: 'completed',
        },
      }),
    ],
    now: NOW,
  });

  assert.equal(view.empty, true);
  assert.equal(view.exceptions.length, 0);
  assert.ok(view.panoramaStats.length >= 3);
  assert.equal(view.catalogEntry.path, '/admin/capabilities');

  const stats = buildPanoramaStatCards(healthy);
  assert.ok(stats.some((card) => card.id === 'instrumented'));
  assert.ok(stats.some((card) => card.id === 'drilldowns'));
});

test('assertNoAckAssignOwnerUi negative patterns', () => {
  assert.deepEqual(assertNoAckAssignOwnerUi('<div data-read-only="true" />'), []);
  assert.ok(
    assertNoAckAssignOwnerUi(
      '<button data-testid="exception-ack">确认异常</button>'
    ).length > 0
  );
  assert.ok(
    assertNoAckAssignOwnerUi(
      '<button data-action="assign">指派负责人</button>'
    ).length > 0
  );
});
