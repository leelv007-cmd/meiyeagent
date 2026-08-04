import assert from 'node:assert/strict';
import test from 'node:test';

import { contentPackageStatusSchema } from '@meiye/contracts';
import {
  ACTIONABLE_INBOX_STATUS_LABEL,
  contentPackageStatusLabel,
} from './content-package-presentation';

test('maps every ContentPackage status to merchant-facing Chinese', () => {
  for (const status of contentPackageStatusSchema.options) {
    assert.ok(
      ['创作中', '可使用', '需处理'].includes(
        contentPackageStatusLabel(status),
      ),
    );
  }
});

test('keeps actionable inbox labels on the web presentation side', () => {
  assert.equal(ACTIONABLE_INBOX_STATUS_LABEL.result_available, '结果可用');
  assert.equal(ACTIONABLE_INBOX_STATUS_LABEL.task_failed, '任务最终失败');
});
