import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActionableInboxItem } from '@meiye/contracts';
import { AdminExceptionHome } from './admin-exception-home';
import {
  assertNoAckAssignOwnerUi,
  buildExceptionHomeView,
} from './admin-exception-home-model';
import { buildCapabilityRegistry } from './admin-capability-registry-model';

const NOW = '2026-07-20T12:00:00.000Z';

test('SSR exception home renders read-only list from default skeleton', () => {
  const html = renderToStaticMarkup(<AdminExceptionHome input={{ now: NOW }} />);

  assert.match(html, /data-testid="exception-home-panel"/);
  assert.match(html, /data-read-only="true"/);
  assert.match(html, /data-supports-ack="false"/);
  assert.match(html, /data-supports-assign="false"/);
  assert.match(html, /data-supports-owner-workflow="false"/);
  assert.match(html, /异常优先首页（只读）/);
  assert.match(html, /data-testid="exception-list"/);
  assert.match(html, /data-testid="exception-row"/);
  assert.match(html, /data-testid="exception-technical-handoff"/);
  assert.match(html, /data-one-click-repair="false"/);
  assert.match(html, /data-testid="exception-handoff-link"/);
  assert.match(html, /data-testid="exception-catalog-link"/);
  assert.match(html, /href="\/admin\/capabilities"/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});

test('SSR empty state shows 当前无待处理异常 + panorama + catalog entry', () => {
  const registry = buildCapabilityRegistry();
  const healthy = {
    ...registry,
    entries: registry.entries.map((entry) => ({
      ...entry,
      availability: 'available' as const,
      evidenceFreshness: {
        capturedAt: NOW,
        staleAfterMs: 60 * 60 * 1000,
        source: 'fresh_test',
      },
    })),
  };
  const view = buildExceptionHomeView({ registry: healthy, now: NOW });
  assert.equal(view.empty, true);

  const html = renderToStaticMarkup(<AdminExceptionHome view={view} />);
  assert.match(html, /data-empty="true"/);
  assert.match(html, /data-testid="exception-empty-state"/);
  assert.match(html, /当前无待处理异常/);
  assert.match(html, /data-testid="exception-panorama-stats"/);
  assert.match(html, /data-testid="exception-stat-card"/);
  assert.match(html, /data-testid="exception-catalog-entry"/);
  assert.match(html, /前往能力目录/);
  assert.doesNotMatch(html, /data-testid="exception-list"/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});

test('SSR handoff context is redacted (no secret-like values)', () => {
  const inboxItems: ActionableInboxItem[] = [
    {
      statusKind: 'task_failed',
      createdAt: '2026-07-20T11:00:00.000Z',
      title: '任务最终失败',
      nextActionLabel: '处理当前问题',
      eventSource: {
        kind: 'task_terminal',
        taskId: 'task-x',
        taskStatus: 'failed',
      },
    },
  ];
  const view = buildExceptionHomeView({ inboxItems, now: NOW });
  const html = renderToStaticMarkup(<AdminExceptionHome view={view} />);

  assert.match(html, /data-testid="exception-handoff-redacted-context"/);
  assert.doesNotMatch(html, /sk-live-/);
  assert.doesNotMatch(html, /Bearer\s+eyJ/);
  assert.doesNotMatch(html, /postgres(?:ql)?:\/\//);
  assert.match(html, /not a one-click repair/i);
});

test('SSR negative: no ack / assign / owner workflow UI', () => {
  const html = renderToStaticMarkup(<AdminExceptionHome input={{ now: NOW }} />);
  assert.doesNotMatch(html, /data-testid="exception-ack"/);
  assert.doesNotMatch(html, /data-testid="exception-assign"/);
  assert.doesNotMatch(html, /data-testid="exception-owner"/);
  assert.doesNotMatch(html, /data-action="ack"/);
  assert.doesNotMatch(html, /data-action="assign"/);
  assert.doesNotMatch(html, /指派负责人/);
  assert.doesNotMatch(html, /确认异常/);
  assert.doesNotMatch(html, /分配给/);
  assert.deepEqual(assertNoAckAssignOwnerUi(html), []);
});
