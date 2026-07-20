/**
 * ResultTargetResolver client wiring tests (B4 contracts / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGACY_ARCHIVE_LABEL } from '@meiye/contracts';

import {
  isResultTargetForbidden,
  isResultTargetMissing,
  isResultTargetRecoverableMismatch,
  parseResultCenterSearch,
  resolveResultTargetClient,
  type ClientResolverLegacyPackage,
  type ClientResolverWorkRecord,
} from './result-target-wiring';

const workA: ClientResolverWorkRecord = {
  workId: 'work-a',
  workspaceId: 'ws-1',
  contentIds: ['pkg-a'],
  versionIdsByContentId: {
    'pkg-a': ['ver-a1', 'ver-a2'],
  },
  allowedFocusKeys: ['candidate-primary', 'delivery-checklist'],
};

const workB: ClientResolverWorkRecord = {
  workId: 'work-b',
  workspaceId: 'ws-1',
  contentIds: ['pkg-b'],
  versionIdsByContentId: {
    'pkg-b': ['ver-b1'],
  },
};

const legacyPkg: ClientResolverLegacyPackage = {
  contentId: 'legacy-pkg',
  workspaceId: 'ws-1',
  versionIds: ['legacy-ver-1'],
  hasSourceWork: false,
};

const viewer = { userId: 'owner-1', workspaceId: 'ws-1' };

test('valid lineage resolves to active ok target', () => {
  const outcome = resolveResultTargetClient({
    request: {
      workId: 'work-a',
      contentId: 'pkg-a',
      versionId: 'ver-a2',
      panel: 'adjust',
      focusKey: 'candidate-primary',
    },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });

  assert.equal(outcome.kind, 'ok');
  if (outcome.kind !== 'ok') return;
  assert.equal(outcome.mode, 'active');
  assert.deepEqual(outcome.target, {
    workId: 'work-a',
    contentId: 'pkg-a',
    versionId: 'ver-a2',
    panel: 'adjust',
    focusKey: 'candidate-primary',
  });
});

test('missing workId is not_found and never picks latest catalog work', () => {
  const outcome = resolveResultTargetClient({
    request: { workId: 'does-not-exist' },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(outcome.kind, 'not_found');
  assert.equal(isResultTargetMissing(outcome), true);
  if (outcome.kind !== 'not_found') return;
  assert.equal(outcome.requested.workId, 'does-not-exist');
  assert.notEqual(outcome.requested.workId, 'work-a');
  assert.notEqual(outcome.requested.workId, 'work-b');
});

test('contentId lineage mismatch is recoverable', () => {
  const outcome = resolveResultTargetClient({
    request: { workId: 'work-a', contentId: 'pkg-b' },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(outcome.kind, 'lineage_mismatch');
  assert.equal(isResultTargetRecoverableMismatch(outcome), true);
  if (outcome.kind !== 'lineage_mismatch') return;
  assert.equal(outcome.requested.workId, 'work-a');
});

test('forbidden when no membership', () => {
  const outcome = resolveResultTargetClient({
    request: { workId: 'work-a' },
    viewer,
    hasMembership: false,
    works: [workA],
  });
  assert.equal(outcome.kind, 'forbidden');
  assert.equal(isResultTargetForbidden(outcome), true);
});

test('legacy readonly branch returns 历史档案 without inventing workId', () => {
  const outcome = resolveResultTargetClient({
    request: { workId: '', contentId: 'legacy-pkg' },
    viewer,
    hasMembership: true,
    works: [workA],
    legacyPackages: [legacyPkg],
  });
  assert.equal(outcome.kind, 'legacy_readonly');
  if (outcome.kind !== 'legacy_readonly') return;
  assert.equal(outcome.archiveLabel, LEGACY_ARCHIVE_LABEL);
  assert.equal(outcome.contentId, 'legacy-pkg');
});

test('parseResultCenterSearch keeps only shareable keys', () => {
  const target = parseResultCenterSearch('work-z', {
    contentId: 'pkg-z',
    versionId: 'ver-z',
    panel: 'delivery',
    focusKey: 'cta',
    stage: 'action', // must not be copied into target
    workId: 'should-ignore',
  });
  assert.deepEqual(target, {
    workId: 'work-z',
    contentId: 'pkg-z',
    versionId: 'ver-z',
    panel: 'delivery',
    focusKey: 'cta',
  });
});

test('invalid panel in search is dropped (not coerced to latest)', () => {
  const target = parseResultCenterSearch('work-z', {
    panel: 'not-a-panel',
  });
  assert.deepEqual(target, { workId: 'work-z' });
});
