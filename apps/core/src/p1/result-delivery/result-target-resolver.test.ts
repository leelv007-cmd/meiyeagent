import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGACY_ARCHIVE_LABEL } from '@meiye/contracts';

import {
  resolveResultTarget,
  type ResolverLegacyPackage,
  type ResolverWorkRecord,
} from './result-target-resolver.js';

const workA: ResolverWorkRecord = {
  workId: 'work-a',
  workspaceId: 'ws-1',
  contentIds: ['pkg-a'],
  versionIdsByContentId: {
    'pkg-a': ['ver-a1', 'ver-a2'],
  },
  allowedFocusKeys: ['candidate-primary', 'delivery-checklist'],
};

const workB: ResolverWorkRecord = {
  workId: 'work-b',
  workspaceId: 'ws-1',
  contentIds: ['pkg-b'],
  versionIdsByContentId: {
    'pkg-b': ['ver-b1'],
  },
};

const legacyPkg: ResolverLegacyPackage = {
  contentId: 'legacy-pkg',
  workspaceId: 'ws-1',
  versionIds: ['legacy-ver-1'],
  hasSourceWork: false,
};

const viewer = { userId: 'owner-1', workspaceId: 'ws-1' };

test('valid lineage resolves to active ok target', () => {
  const outcome = resolveResultTarget({
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
  assert.equal(outcome.workspaceId, 'ws-1');
  assert.deepEqual(outcome.target, {
    workId: 'work-a',
    contentId: 'pkg-a',
    versionId: 'ver-a2',
    panel: 'adjust',
    focusKey: 'candidate-primary',
  });
});

test('workId-only target is valid when content keys omitted', () => {
  const outcome = resolveResultTarget({
    request: { workId: 'work-b', panel: 'run' },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(outcome.kind, 'ok');
  if (outcome.kind !== 'ok') return;
  assert.deepEqual(outcome.target, { workId: 'work-b', panel: 'run' });
});

test('recoverable lineage mismatch does not fall back to latest Work', () => {
  const mismatchedContent = resolveResultTarget({
    request: {
      workId: 'work-a',
      contentId: 'pkg-b', // belongs to work-b, not work-a
      versionId: 'ver-b1',
    },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(mismatchedContent.kind, 'lineage_mismatch');
  if (mismatchedContent.kind !== 'lineage_mismatch') return;
  assert.equal(mismatchedContent.recoverable, true);
  assert.equal(mismatchedContent.code, 'LINEAGE_MISMATCH');
  // Must keep the requested workId — never rewrite to work-b.
  assert.equal(mismatchedContent.requested.workId, 'work-a');

  const mismatchedVersion = resolveResultTarget({
    request: {
      workId: 'work-a',
      contentId: 'pkg-a',
      versionId: 'ver-missing',
    },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(mismatchedVersion.kind, 'lineage_mismatch');

  const versionWithoutContent = resolveResultTarget({
    request: { workId: 'work-a', versionId: 'ver-a1' },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(versionWithoutContent.kind, 'lineage_mismatch');

  const badFocus = resolveResultTarget({
    request: {
      workId: 'work-a',
      focusKey: 'not-owned-focus',
    },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(badFocus.kind, 'lineage_mismatch');
});

test('missing work is not_found and never guesses latest Work', () => {
  const outcome = resolveResultTarget({
    request: { workId: 'work-missing' },
    viewer,
    hasMembership: true,
    works: [workA, workB],
  });
  assert.equal(outcome.kind, 'not_found');
  if (outcome.kind !== 'not_found') return;
  assert.equal(outcome.requested.workId, 'work-missing');
  // Catalog still contains work-a/work-b — resolver must not rewrite to them.
  assert.ok(workA.workId === 'work-a' && workB.workId === 'work-b');
  assert.equal(outcome.code, 'NOT_FOUND');
});

test('legacy readonly branch returns 历史档案 without inventing Work', () => {
  const byContentOnly = resolveResultTarget({
    request: { workId: '', contentId: 'legacy-pkg', versionId: 'legacy-ver-1' },
    viewer,
    hasMembership: true,
    works: [workA, workB],
    legacyPackages: [legacyPkg],
  });
  assert.equal(byContentOnly.kind, 'legacy_readonly');
  if (byContentOnly.kind !== 'legacy_readonly') return;
  assert.equal(byContentOnly.archiveLabel, LEGACY_ARCHIVE_LABEL);
  assert.equal(byContentOnly.archiveLabel, '历史档案');
  assert.equal(byContentOnly.contentId, 'legacy-pkg');
  assert.equal(byContentOnly.versionId, 'legacy-ver-1');
  assert.equal(byContentOnly.workspaceId, 'ws-1');

  // Unknown workId + known legacy contentId still archives (no latest-work guess).
  const unknownWorkLegacyContent = resolveResultTarget({
    request: { workId: 'work-gone', contentId: 'legacy-pkg' },
    viewer,
    hasMembership: true,
    works: [workA],
    legacyPackages: [legacyPkg],
  });
  assert.equal(unknownWorkLegacyContent.kind, 'legacy_readonly');
  if (unknownWorkLegacyContent.kind !== 'legacy_readonly') return;
  assert.equal(unknownWorkLegacyContent.contentId, 'legacy-pkg');

  const badLegacyVersion = resolveResultTarget({
    request: {
      workId: '',
      contentId: 'legacy-pkg',
      versionId: 'nope',
    },
    viewer,
    hasMembership: true,
    works: [],
    legacyPackages: [legacyPkg],
  });
  assert.equal(badLegacyVersion.kind, 'lineage_mismatch');
});

test('unauthorized viewer is forbidden', () => {
  const noMembership = resolveResultTarget({
    request: { workId: 'work-a' },
    viewer,
    hasMembership: false,
    works: [workA, workB],
  });
  assert.equal(noMembership.kind, 'forbidden');
  if (noMembership.kind !== 'forbidden') return;
  assert.equal(noMembership.code, 'FORBIDDEN');

  const otherWorkspaceWork: ResolverWorkRecord = {
    ...workA,
    workspaceId: 'ws-other',
  };
  const crossWorkspace = resolveResultTarget({
    request: { workId: 'work-a' },
    viewer,
    hasMembership: true,
    works: [otherWorkspaceWork],
  });
  assert.equal(crossWorkspace.kind, 'forbidden');
});
