import assert from 'node:assert/strict';
import test from 'node:test';
import { productStatusView } from './status';

test('product statuses expose one normalized Chinese explanation and next action', () => {
  assert.deepEqual(productStatusView('running'), {
    label: '执行中',
    tone: 'progress',
    explanation: '任务已经接单，正在按冻结的执行合同处理。',
    nextAction: '可离开此页，稍后从执行记录恢复。',
  });
  assert.deepEqual(productStatusView('unknown'), {
    label: '结果待核验',
    tone: 'warning',
    explanation: '供应方是否接单尚不明确，系统不会自动重投。',
    nextAction: '先核验原任务，再决定是否新建重试。',
  });
  assert.deepEqual(productStatusView('permission_denied'), {
    label: '权限不足',
    tone: 'danger',
    explanation: '当前角色不能执行这项操作。',
    nextAction: '联系工作区负责人调整权限。',
  });
  assert.deepEqual(productStatusView('cancel_requested'), {
    label: '正在取消',
    tone: 'warning',
    explanation: '取消请求已送达，正在等待供应方确认最终状态。',
    nextAction: '无需重复操作，结果会自动更新。',
  });
});

test('unrecognized provider statuses stay explicit instead of pretending success', () => {
  assert.deepEqual(productStatusView('provider-new-state'), {
    label: '状态待识别',
    tone: 'neutral',
    explanation: '系统收到尚未映射的状态。',
    nextAction: '保留当前对象并联系支持人员核验。',
  });
});
