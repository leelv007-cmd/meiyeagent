import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  auditCsvFilename,
  buildAuditCsv,
  emptyAuditListFilters,
  filterAuditEvents,
  hasActiveAuditFilters,
  type AuditListEvent,
  type AuditListFilters,
} from './admin-audit-filter-model';

/** Build an ISO timestamp that lands on a known local calendar day. */
function localDayIso(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

const events: AuditListEvent[] = [
  {
    id: 'evt-template',
    action: 'template.publish',
    actor: 'admin-alice',
    correlationId: 'corr-1',
    createdAt: localDayIso(2026, 8, 1),
    reason: 'ship template',
    scope: 'tmpl-1',
  },
  {
    id: 'evt-catalog',
    action: 'catalog.published',
    actor: 'admin-bob',
    correlationId: 'corr-2',
    createdAt: localDayIso(2026, 8, 5),
    reason: 'publish catalog',
    scope: 'rev-a → rev-b',
  },
  {
    id: 'evt-rollback',
    action: 'catalog.rollback',
    actor: 'admin-alice',
    correlationId: 'corr-3',
    createdAt: localDayIso(2026, 8, 6, 8),
    reason: 'revert bad catalog',
    scope: 'rev-b → rev-a',
  },
];

function ids(filtered: readonly AuditListEvent[]) {
  return filtered.map((event) => event.id);
}

describe('filterAuditEvents', () => {
  it('returns the full set when every dimension is empty', () => {
    assert.deepEqual(
      ids(filterAuditEvents(events, emptyAuditListFilters())),
      ['evt-template', 'evt-catalog', 'evt-rollback']
    );
    assert.equal(hasActiveAuditFilters(emptyAuditListFilters()), false);
  });

  it('filters by actor substring (case-insensitive)', () => {
    const filters: AuditListFilters = {
      ...emptyAuditListFilters(),
      actor: 'ALICE',
    };
    assert.deepEqual(ids(filterAuditEvents(events, filters)), [
      'evt-template',
      'evt-rollback',
    ]);
  });

  it('filters by action substring', () => {
    const filters: AuditListFilters = {
      ...emptyAuditListFilters(),
      action: 'rollback',
    };
    assert.deepEqual(ids(filterAuditEvents(events, filters)), [
      'evt-rollback',
    ]);
  });

  it('filters by inclusive local-day time window', () => {
    // Use UTC-noon-ish fixtures; bound as YYYY-MM-DD so local-day math still
    // includes the intended calendar day under typical test timezones.
    const filters: AuditListFilters = {
      ...emptyAuditListFilters(),
      fromDate: '2026-08-05',
      toDate: '2026-08-06',
    };
    assert.deepEqual(ids(filterAuditEvents(events, filters)), [
      'evt-catalog',
      'evt-rollback',
    ]);
  });

  it('combines time, actor, and action with AND semantics', () => {
    const filters: AuditListFilters = {
      fromDate: '2026-08-05',
      toDate: '2026-08-06',
      actor: 'alice',
      action: 'rollback',
    };
    assert.equal(hasActiveAuditFilters(filters), true);
    assert.deepEqual(ids(filterAuditEvents(events, filters)), [
      'evt-rollback',
    ]);
  });

  it('preserves input order', () => {
    const filters: AuditListFilters = {
      ...emptyAuditListFilters(),
      actor: 'admin',
    };
    assert.deepEqual(ids(filterAuditEvents(events, filters)), [
      'evt-template',
      'evt-catalog',
      'evt-rollback',
    ]);
  });
});

describe('buildAuditCsv', () => {
  it('emits a header-only document for an empty list', () => {
    assert.equal(
      buildAuditCsv([]),
      'id,action,actor,correlationId,createdAt,reason,scope\n'
    );
  });

  it('serializes the filtered rows with CSV escaping', () => {
    const filtered = filterAuditEvents(events, {
      ...emptyAuditListFilters(),
      action: 'rollback',
    });
    const csv = buildAuditCsv(filtered);
    assert.match(csv, /^id,action,actor,correlationId,createdAt,reason,scope\n/);
    assert.match(csv, /evt-rollback,catalog\.rollback,admin-alice/);
    assert.doesNotMatch(csv, /evt-template/);
    assert.doesNotMatch(csv, /evt-catalog/);
  });

  it('escapes commas and quotes inside cells', () => {
    const csv = buildAuditCsv([
      {
        id: 'evt-quote',
        action: 'template.publish',
        actor: 'admin',
        correlationId: 'c',
        createdAt: '2026-08-01T00:00:00.000Z',
        reason: 'said "ship it", now',
        scope: 'a,b',
      },
    ]);
    assert.match(csv, /"said ""ship it"", now"/);
    assert.match(csv, /"a,b"/);
  });
});

describe('auditCsvFilename', () => {
  it('stamps the filename with the local calendar day', () => {
    assert.equal(
      auditCsvFilename(new Date(2026, 7, 6, 15, 0, 0)),
      'audit-export-20260806.csv'
    );
  });
});
