/**
 * U14 legacy replay archive gate unit tests (V31-26a).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateLegacyReplayArchiveGate,
  LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS,
  LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS,
  MemoryLegacyReplayInventory,
} from './legacy-replay-archive-gate.js';

const NOW = '2026-08-09T00:00:00.000Z';

function daysAgo(days: number, base = NOW): string {
  return new Date(Date.parse(base) - days * 24 * 60 * 60 * 1000).toISOString();
}

test('U14 gate fails closed when active pending legacy > 0', () => {
  const result = evaluateLegacyReplayArchiveGate({
    inventory: {
      activePendingCount: 2,
      oldestActiveCreatedAt: daysAgo(1),
      sampleTaskIds: ['t1', 't2'],
      lastLegacyTerminalAt: daysAgo(40),
    },
    now: NOW,
    rollbackDrillPassed: true,
    auditExportAvailable: true,
  });
  assert.equal(result.archiveAllowed, false);
  assert.equal(result.conditions.zeroActivePendingLegacy.ok, false);
  assert.ok(result.blockingReasons.length >= 1);
});

test('U14 gate fails closed when hold window incomplete even with zero active', () => {
  const result = evaluateLegacyReplayArchiveGate({
    inventory: {
      activePendingCount: 0,
      oldestActiveCreatedAt: null,
      sampleTaskIds: [],
      lastLegacyTerminalAt: daysAgo(10),
    },
    now: NOW,
    rollbackDrillPassed: true,
    auditExportAvailable: true,
  });
  assert.equal(result.archiveAllowed, false);
  assert.equal(result.conditions.holdWindowComplete.ok, false);
  assert.equal(result.conditions.opsPolicyBufferComplete.ok, false);
});

test('U14 gate fails closed without rollback proof or audit export', () => {
  const base = {
    inventory: {
      activePendingCount: 0,
      oldestActiveCreatedAt: null,
      sampleTaskIds: [],
      lastLegacyTerminalAt: daysAgo(
        LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS +
          LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS +
          1,
      ),
    },
    now: NOW,
  };
  const noRollback = evaluateLegacyReplayArchiveGate({
    ...base,
    rollbackDrillPassed: false,
    auditExportAvailable: true,
  });
  assert.equal(noRollback.archiveAllowed, false);
  assert.equal(noRollback.conditions.rollbackProofPresent.ok, false);

  const noAudit = evaluateLegacyReplayArchiveGate({
    ...base,
    rollbackDrillPassed: true,
    auditExportAvailable: false,
  });
  assert.equal(noAudit.archiveAllowed, false);
  assert.equal(noAudit.conditions.auditExportAvailable.ok, false);
});

test('U14 gate fails closed when hold complete but ops buffer incomplete', () => {
  const result = evaluateLegacyReplayArchiveGate({
    inventory: {
      activePendingCount: 0,
      oldestActiveCreatedAt: null,
      sampleTaskIds: [],
      // past 30d hold but not 30+7 buffer
      lastLegacyTerminalAt: daysAgo(LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS + 1),
    },
    now: NOW,
    rollbackDrillPassed: true,
    auditExportAvailable: true,
  });
  assert.equal(result.conditions.holdWindowComplete.ok, true);
  assert.equal(result.conditions.opsPolicyBufferComplete.ok, false);
  assert.equal(result.archiveAllowed, false);
});

test('U14 gate allows archive only when all conditions pass', () => {
  const result = evaluateLegacyReplayArchiveGate({
    inventory: {
      activePendingCount: 0,
      oldestActiveCreatedAt: null,
      sampleTaskIds: [],
      lastLegacyTerminalAt: daysAgo(
        LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS +
          LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS +
          2,
      ),
    },
    now: NOW,
    rollbackDrillPassed: true,
    auditExportAvailable: true,
  });
  assert.equal(result.archiveAllowed, true);
  assert.deepEqual(result.blockingReasons, []);
  for (const condition of Object.values(result.conditions)) {
    assert.equal(condition.ok, true);
  }
});

test('U14 gate fails closed on null history without an audited no-history proof', () => {
  const result = evaluateLegacyReplayArchiveGate({
    inventory: {
      activePendingCount: 0,
      oldestActiveCreatedAt: null,
      sampleTaskIds: [],
      lastLegacyTerminalAt: null,
    },
    now: NOW,
    rollbackDrillPassed: true,
    auditExportAvailable: true,
  });
  assert.equal(result.archiveAllowed, false);
  assert.equal(result.conditions.holdWindowComplete.ok, false);
});

test('U14 gate accepts null history only with explicit audited no-history proof', () => {
  const result = evaluateLegacyReplayArchiveGate({
    inventory: {
      activePendingCount: 0,
      oldestActiveCreatedAt: null,
      sampleTaskIds: [],
      lastLegacyTerminalAt: null,
      noHistoryProofAuditId: 'audit:no-legacy-history:2026-08-09',
    },
    now: NOW,
    rollbackDrillPassed: true,
    auditExportAvailable: true,
  });
  assert.equal(result.archiveAllowed, true);
});

test('MemoryLegacyReplayInventory is snapshot-isolated', async () => {
  const inv = new MemoryLegacyReplayInventory({
    activePendingCount: 1,
    oldestActiveCreatedAt: NOW,
    sampleTaskIds: ['a'],
    lastLegacyTerminalAt: null,
  });
  const first = await inv.snapshot();
  first.activePendingCount = 99;
  const second = await inv.snapshot();
  assert.equal(second.activePendingCount, 1);
});
