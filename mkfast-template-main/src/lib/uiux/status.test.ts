import assert from 'node:assert/strict';
import test from 'node:test';
import { productStatusView } from './status';

test('product statuses expose one normalized Chinese explanation and next action', () => {
  assert.deepEqual(productStatusView('running'), {
    label: '生成中',
    tone: 'progress',
    explanation: '正在为你生成内容，可以先去做别的。',
    nextAction: '可离开此页，稍后回来继续。',
  });
  assert.deepEqual(productStatusView('unknown'), {
    label: '结果待核验',
    tone: 'warning',
    explanation: '结果还在确认中，先别重复提交。',
    nextAction: '稍后再看，或联系支持帮忙确认。',
  });
  assert.deepEqual(productStatusView('permission_denied'), {
    label: '权限不足',
    tone: 'danger',
    explanation: '当前角色不能执行这项操作。',
    nextAction: '联系本店负责人调整权限。',
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
    explanation: '状态暂时无法识别。',
    nextAction: '保留当前内容并联系支持。',
  });
});
