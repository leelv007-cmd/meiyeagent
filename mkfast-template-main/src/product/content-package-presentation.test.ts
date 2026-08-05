import assert from 'node:assert/strict';
import test from 'node:test';

import { contentPackageStatusSchema } from '@meiye/contracts';
import {
  ACTIONABLE_INBOX_STATUS_LABEL,
  contentPackageProjectionListSchema,
  contentPackageStatusLabel,
} from './content-package-presentation';

const wirePackage = {
  compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
  createdAt: '2026-08-05T00:00:00.000Z',
  exportReceipts: [],
  generated: { assetIds: [], childRuns: [] },
  id: 'package-1',
  kind: 'image_text',
  lineage: {},
  rights: { state: 'authorized' },
  source: { assetIds: [] },
  status: 'review_ready',
  updatedAt: '2026-08-05T00:00:00.000Z',
  variants: [],
  versions: [],
  workspaceId: 'workspace-1',
} as const;

test('maps every ContentPackage status to merchant-facing Chinese', () => {
  for (const status of contentPackageStatusSchema.options) {
    assert.ok(
      ['创作中', '可使用', '需处理'].includes(contentPackageStatusLabel(status))
    );
  }
});

test('keeps actionable inbox labels on the web presentation side', () => {
  assert.equal(ACTIONABLE_INBOX_STATUS_LABEL.result_available, '结果可用');
  assert.equal(ACTIONABLE_INBOX_STATUS_LABEL.task_failed, '任务最终失败');
});

test('contentPackageProjectionListSchema accepts real wire shape with statusGroup', () => {
  const parsed = contentPackageProjectionListSchema.safeParse([
    { ...wirePackage, statusGroup: 'usable' },
  ]);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data[0]?.statusGroup, 'usable');
  assert.equal(parsed.data[0]?.statusLabel, '可使用');
});

test('contentPackageProjectionListSchema recomputes statusGroup from status, ignoring server value', () => {
  // review_ready → usable; feed a mismatched group and assert it is not trusted.
  const parsed = contentPackageProjectionListSchema.safeParse([
    { ...wirePackage, status: 'review_ready', statusGroup: 'creating' },
  ]);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data[0]?.statusGroup, 'usable');
  assert.equal(parsed.data[0]?.statusLabel, '可使用');
});

test('contentPackageProjectionListSchema still rejects undeclared keys (strict)', () => {
  const parsed = contentPackageProjectionListSchema.safeParse([
    { ...wirePackage, statusGroup: 'usable', unexpectedWireKey: true },
  ]);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  assert.equal(issue?.code, 'unrecognized_keys');
  assert.deepEqual((issue as { keys?: string[] } | undefined)?.keys, [
    'unexpectedWireKey',
  ]);
});
