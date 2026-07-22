/**
 * Result Run Detail safe projection tests (P1-B1 / #150).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { projectResultRunDetail } from './result-run-detail-model';

test('run detail is collapsed by default with merchant stage/cost language', () => {
  const view = projectResultRunDetail({
    phase: 'running',
    progressState: 'running',
    jobStatus: 'running',
    productUsageQuantity: 1,
    modelDisplayName: '门店文案助手',
    supportReference: 'MY-ABC123',
  });

  assert.equal(view.collapsedByDefault, true);
  assert.equal(view.heading, '运行详情');
  assert.equal(view.stageSummary, '正在生成');
  assert.equal(view.costSummary.includes('1 次创作'), true);
  assert.equal(view.modelSummary, '使用模型：门店文案助手');
  assert.match(view.supportHint, /MY-ABC123/);
  assert.equal(
    view.stages.find((stage) => stage.id === 'generate')?.state,
    'current'
  );
});

test('run detail maps failure and recovery without tech leaks', () => {
  const view = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'failed',
    failureCode: 'PROVIDER_ERROR',
    supportReference: 'MY-FAIL01',
  });

  assert.equal(view.stageSummary, '生成失败，可恢复');
  assert.equal(view.failureSummary, '生成服务暂时不可用，请稍后重试。');
  assert.match(view.recoveryHint ?? '', /重试/);
  assert.doesNotMatch(JSON.stringify(view), /PROVIDER_ERROR/u);
  assert.doesNotMatch(JSON.stringify(view), /openai|provider/iu);
});

test('run detail strips provider/model slug and UUID from model summary', () => {
  const slug = projectResultRunDetail({
    phase: 'ready',
    jobStatus: 'completed',
    modelDisplayName: 'openai/gpt-4o-mini',
    supportReference: 'MY-SAFE01',
  });
  assert.equal(slug.modelSummary, undefined);

  const uuid = projectResultRunDetail({
    phase: 'ready',
    jobStatus: 'completed',
    modelDisplayName: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    supportReference: 'MY-SAFE02',
  });
  assert.equal(uuid.modelSummary, undefined);
});

test('run detail recovery path for acceptance unknown / suspended', () => {
  const view = projectResultRunDetail({
    phase: 'needs_input',
    progressState: 'suspended',
    jobStatus: 'recoverable',
    supportReference: 'MY-REC001',
  });
  assert.equal(view.stageSummary, '需要你处理当前问题');
  assert.match(view.recoveryHint ?? '', /恢复或核验/);
  assert.equal(
    view.stages.find((stage) => stage.id === 'recover')?.state,
    'current'
  );
});
