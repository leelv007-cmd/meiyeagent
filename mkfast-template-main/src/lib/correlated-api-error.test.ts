import assert from 'node:assert/strict';
import test from 'node:test';

import {
  correlatedApiErrorMessage,
  friendlyProductError,
  parseApiErrorEnvelope,
} from './correlated-api-error';

test('keeps the response correlation id visible for trace lookup', () => {
  assert.equal(
    correlatedApiErrorMessage('提交失败', 'corr-visible-123'),
    '提交失败\n关联 ID：corr-visible-123'
  );
  assert.equal(correlatedApiErrorMessage('提交失败', '  '), '提交失败');
  assert.equal(correlatedApiErrorMessage('提交失败'), '提交失败');
});

test('parses both Core envelopes and legacy proxy errors', () => {
  assert.deepEqual(
    parseApiErrorEnvelope(
      {
        error: {
          code: 'INVALID',
          message: '操作无效',
          details: { reason: '已冻结' },
        },
        meta: { correlationId: 'corr-core-123' },
      },
      '请求失败'
    ),
    {
      code: 'INVALID',
      correlationId: 'corr-core-123',
      details: { reason: '已冻结' },
      message: '操作无效',
    }
  );
  assert.deepEqual(
    parseApiErrorEnvelope({ error: 'Unauthorized' }, '请求失败'),
    {
      message: 'Unauthorized',
    }
  );
});

test('replaces technical API errors with product copy and keeps only the correlation id', () => {
  const error = friendlyProductError(
    new Error(
      'weekly_review failed: data is undefined {"action":"weekly_review"}\n关联 ID：corr-safe-123'
    ),
    '本周运营暂时无法读取，请稍后重试。'
  );

  assert.deepEqual(error, {
    correlationId: 'corr-safe-123',
    description: '本周运营暂时无法读取，请稍后重试。',
  });
  assert.equal(JSON.stringify(error).includes('weekly_review'), false);
  assert.equal(JSON.stringify(error).includes('undefined'), false);
  assert.equal(JSON.stringify(error).includes('action'), false);
});
