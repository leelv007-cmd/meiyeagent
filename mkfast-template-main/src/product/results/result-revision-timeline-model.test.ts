/**
 * ContentPackage revision timeline pure projection tests (P1-B1 / #150).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectRevisionTimeline,
  revisionOperatorLabel,
  revisionSourceLabel,
} from './result-revision-timeline-model';

test('timeline projects ContentPackage revisions newest-first with derived-from', () => {
  const view = projectRevisionTimeline({
    currentVersionId: 'ver-2',
    versions: [
      {
        versionId: 'ver-1',
        title: '初稿',
        createdAt: '2026-07-20T08:00:00.000Z',
        source: 'ai_generated',
      },
      {
        versionId: 'ver-2',
        title: '手改版',
        createdAt: '2026-07-20T09:00:00.000Z',
        source: 'merchant_edited',
        derivedFromVersionId: 'ver-1',
        operatorDisplayName: '店长小美',
      },
    ],
  });

  assert.equal(view.empty, false);
  assert.equal(view.entries.length, 2);
  assert.equal(view.entries[0]?.versionId, 'ver-2');
  assert.equal(view.entries[0]?.isCurrent, true);
  assert.equal(view.entries[0]?.operatorLabel, '店长小美');
  assert.equal(view.entries[0]?.sourceLabel, '本店修改');
  assert.equal(view.entries[0]?.derivedFromLabel, '基于「初稿」');
  assert.equal(view.entries[0]?.recoverAction, null);
  assert.equal(view.entries[1]?.recoverAction?.kind, 'restore_version');
  assert.equal(view.entries[1]?.recoverAction?.label, '恢复此版本');
  assert.equal(view.entries[1]?.recoverAction?.enabled, true);
  assert.equal(view.entries[1]?.operatorLabel, '系统');
});

test('timeline never surfaces UUID operators; uses merchant source labels', () => {
  assert.equal(revisionSourceLabel('rollback_restored'), '版本恢复');
  assert.equal(
    revisionOperatorLabel(
      'merchant_edited',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    ),
    '本店同事'
  );
  const view = projectRevisionTimeline({
    currentVersionId: 'ver-1',
    versions: [
      {
        versionId: 'ver-1',
        title: '恢复稿',
        createdAt: '2026-07-21T10:00:00.000Z',
        source: 'rollback_restored',
        operatorDisplayName: 'user_0123456789abcdef',
      },
    ],
  });
  assert.equal(view.entries[0]?.operatorLabel, '本店恢复');
  assert.doesNotMatch(view.entries[0]?.operatorLabel ?? '', /user_/u);
});

test('timeline empty state is honest when no revisions exist', () => {
  const view = projectRevisionTimeline({ versions: [] });
  assert.equal(view.empty, true);
  assert.equal(view.entries.length, 0);
  assert.match(view.emptyMessage, /采用或保存后/);
});
