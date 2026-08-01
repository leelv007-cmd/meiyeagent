/**
 * Result Center contract freeze tests (WT-D1 / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_ARCHIVE_LABEL,
  resultAdjustConfirmCommandSchema,
  resultAdjustCommandSchema,
  resultActionIds,
  resultAdoptCommandSchema,
  resultCenterPath,
  resultCenterSearchParams,
  resultExportCommandSchema,
  resultPanels,
  resultRevisionDriftChoices,
  type ResultCenterNavigation,
  type ResultCommandInput,
  type ResultShellModel,
  type ResultTarget,
  type ResultUncommittedEditKey,
} from './result-center.js';

test('ResultCenterNavigation freezes workId + optional return/focus keys', () => {
  const nav: ResultCenterNavigation = {
    workId: 'work-1',
    returnToDraftKey: 'draft-1',
    focusKey: 'primary',
  };
  assert.equal(nav.workId, 'work-1');
  assert.equal(nav.returnToDraftKey, 'draft-1');
  assert.equal(nav.focusKey, 'primary');
});

test('resultCenterPath encodes workId under /dashboard/results', () => {
  assert.equal(resultCenterPath('work/1'), '/dashboard/results/work%2F1');
  assert.equal(resultCenterPath('work-1'), '/dashboard/results/work-1');
});

test('resultCenterSearchParams only emits shareable keys', () => {
  assert.deepEqual(
    resultCenterSearchParams({
      contentId: 'pkg-1',
      versionId: 'ver-1',
      panel: 'delivery',
      focusKey: 'cta',
    }),
    {
      contentId: 'pkg-1',
      versionId: 'ver-1',
      panel: 'delivery',
      focusKey: 'cta',
    },
  );
  assert.deepEqual(resultCenterSearchParams({}), {});
});

test('canonical result commands keep adoption OCC and adjustment contract server-owned', () => {
  assert.deepEqual(
    resultAdoptCommandSchema.parse({
      expectedRevision: 3,
      selection: {
        kind: 'image_text',
        copyAssetId: 'copy-1',
        orderedAssetIds: ['image-2', 'image-1'],
      },
      workId: 'work-1',
    }).selection,
    {
      kind: 'image_text',
      copyAssetId: 'copy-1',
      orderedAssetIds: ['image-2', 'image-1'],
    },
  );
  assert.equal(
    resultAdjustCommandSchema.safeParse({
      contract: { quoteRevision: 'client-controlled' },
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '更突出价值感',
      source: { kind: 'legacy_job', baseJobId: 'job-1' },
      workId: 'work-1',
    }).success,
    false,
  );
  assert.deepEqual(
    resultAdjustCommandSchema.parse({
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '换成夏日风格',
      scope: { kind: 'set', assetIds: ['image-1', 'image-2'] },
      source: { kind: 'legacy_job', baseJobId: 'job-1' },
      workId: 'work-1',
    }),
    {
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '换成夏日风格',
      scope: { kind: 'set', assetIds: ['image-1', 'image-2'] },
      source: { kind: 'legacy_job', baseJobId: 'job-1' },
      workId: 'work-1',
    },
  );
  assert.deepEqual(
    resultAdjustCommandSchema.parse({
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '语气更亲切',
      scope: {
        end: 9,
        field: 'body',
        kind: 'text_selection',
        packageId: 'package-1',
        platform: 'douyin',
        selectedText: '预约到店',
        sourceTextSha256:
          '53bb35f895648a58695272f4be5b28010ddaaf5ff8adc4934f3f2130c3b25477',
        start: 5,
        versionId: 'version-1',
      },
      source: {
        kind: 'content_package_snapshot',
        expectedPackageRevision: 3,
        packageId: 'package-1',
        snapshotId: 'snapshot-task-1',
        workflowId: 'task-1',
      },
      workId: 'work-1',
    }).scope,
    {
      end: 9,
      field: 'body',
      kind: 'text_selection',
      packageId: 'package-1',
      platform: 'douyin',
      selectedText: '预约到店',
      sourceTextSha256:
        '53bb35f895648a58695272f4be5b28010ddaaf5ff8adc4934f3f2130c3b25477',
      start: 5,
      versionId: 'version-1',
    },
  );
  assert.equal(
    resultAdjustConfirmCommandSchema.safeParse({
      billingQuoteId: 'quote-1',
      derivedTaskId: 'work-derived-1',
      derivedWorkId: 'work-derived-1',
      confirmedAmount: 0,
      instruction: '语气更亲切',
      source: { kind: 'legacy_job', baseJobId: 'job-1' },
    }).success,
    false,
  );
  assert.deepEqual(
    resultAdjustConfirmCommandSchema.parse({
      billingQuoteId: 'quote-1',
      derivedWorkId: 'work-derived-1',
      source: { kind: 'legacy_job', baseJobId: 'job-1' },
    }),
    {
      billingQuoteId: 'quote-1',
      derivedWorkId: 'work-derived-1',
      source: { kind: 'legacy_job', baseJobId: 'job-1' },
    },
  );
  assert.deepEqual(
    resultAdjustConfirmCommandSchema.parse({
      billingQuoteId: 'quote-1',
      derivedTaskId: 'composer-task:result-adjust:prepared-1',
      derivedWorkId: 'work-derived-1',
      instruction: '语气更亲切',
      source: {
        kind: 'content_package_snapshot',
        expectedPackageRevision: 3,
        packageId: 'package-1',
        snapshotId: 'snapshot-task-1',
        workflowId: 'task-1',
      },
    }),
    {
      billingQuoteId: 'quote-1',
      derivedTaskId: 'composer-task:result-adjust:prepared-1',
      derivedWorkId: 'work-derived-1',
      instruction: '语气更亲切',
      source: {
        kind: 'content_package_snapshot',
        expectedPackageRevision: 3,
        packageId: 'package-1',
        snapshotId: 'snapshot-task-1',
        workflowId: 'task-1',
      },
    },
  );
  assert.equal(
    resultExportCommandSchema.safeParse({
      expectedRevision: 4,
      packageId: 'package-1',
      platform: 'xiaohongshu',
    }).success,
    true,
  );
});

test('result panels and action ids are frozen enumerations', () => {
  assert.deepEqual(resultPanels, [
    'result',
    'adjust',
    'delivery',
    'history',
    'run',
  ]);
  assert.ok(resultActionIds.includes('adopt_candidate'));
  assert.ok(resultActionIds.includes('leave_and_continue'));
  assert.deepEqual(resultRevisionDriftChoices, [
    'restore',
    'compare',
    'discard',
  ]);
});

test('ResultShellModel shape is projection-only (compile-time contract)', () => {
  const shell: ResultShellModel = {
    target: { workId: 'work-1' },
    phase: 'ready',
    workspaceKind: 'copy',
    primaryAction: {
      id: 'adopt_candidate',
      role: 'primary',
      label: '采用此版本',
      enabled: true,
    },
    secondaryActions: [],
    overflowActions: [],
    canonicalLinks: [{ kind: 'work', id: 'work-1' }],
    panel: 'result',
  };
  assert.equal(shell.phase, 'ready');
});

test('uncommitted edit key isolates workspaceKind/workId/revision/surface', () => {
  const key: ResultUncommittedEditKey = {
    workspaceKind: 'image',
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    surfaceVersion: 's1',
  };
  assert.equal(key.workspaceKind, 'image');
});

test('ResultCommandInput requires action + target + idempotencyKey', () => {
  const input: ResultCommandInput = {
    action: 'deliver',
    target: { workId: 'work-1' } satisfies ResultTarget,
    expectedRevision: 'rev-1',
    idempotencyKey: 'idem-1',
  };
  assert.equal(input.action, 'deliver');
});

test('legacy archive label stays 历史档案', () => {
  assert.equal(LEGACY_ARCHIVE_LABEL, '历史档案');
});
