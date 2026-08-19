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
  assert.match(view.costSummary, /积分/u);
  assert.doesNotMatch(view.costSummary, /1 次创作/u);
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

// #353: 「重试」 dispatches `retry_creative_job`, which needs a Job row. #350
// already took that button off a Job-less failed run; the Run Detail hint went
// on telling merchants to press it. Send them where the shell actually sends
// them, and keep the hint intact wherever the Job — and the button — exist.
test('run detail failure hint drops 重试 when the run has no retryable Job', () => {
  const noJob = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'none',
    supportReference: 'MY-NOJOB1',
  });
  assert.equal(noJob.recoveryHint, '请返回工作台重新发起本次创作。');
  assert.doesNotMatch(JSON.stringify(noJob), /可点「重试」/u);

  const withJob = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'failed',
    failureCode: 'PROVIDER_ERROR',
    supportReference: 'MY-JOB0001',
  });
  assert.equal(
    withJob.recoveryHint,
    '可点「重试」重新生成；重试前会确认费用。'
  );
  assert.equal(withJob.failureSummary, '生成服务暂时不可用，请稍后重试。');
});

// #358 / D-176: the pilot ships no in-place rerun. On a Job-less failed run
// 「可恢复」 and 「重新生成前会再次确认」 both name the 「重试」 button #350 took off
// the page, so they promise an exit the merchant cannot reach. Say what is
// actually there — and leave both lines alone wherever the Job, and therefore
// 「重试」, still exist.
test('run detail failure stage/cost drop the rerun promise when there is no Job', () => {
  const noJob = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'none',
    supportReference: 'MY-NOJOB2',
  });
  assert.equal(noJob.stageSummary, '生成失败，请返回工作台重新发起');
  assert.equal(
    noJob.costSummary,
    '积分扣费与退回请以账单记录为准；当前页面不会重新发起本次创作。'
  );
  assert.doesNotMatch(JSON.stringify(noJob), /可恢复|重新生成前会再次确认/u);

  const withJob = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'failed',
    supportReference: 'MY-JOB0002',
  });
  assert.equal(withJob.stageSummary, '生成失败，可恢复');
  assert.equal(
    withJob.costSummary,
    '本次预扣过积分，失败是否退回请以账单记录为准。'
  );

  // The fee gate is failure-shaped, not Job-shaped. A run still going before
  // its Job row shows up is not the world D-176 speaks to, and telling that
  // merchant the page will not regenerate would be its own false statement.
  const noJobRunning = projectResultRunDetail({
    phase: 'running',
    progressState: 'running',
    jobStatus: 'none',
    supportReference: 'MY-NOJOB3',
  });
  assert.equal(
    noJobRunning.costSummary,
    '费用以账单记录为准；重新生成前会再次确认。'
  );
});

// UX-01B / D-176: TIMEOUT copy that says 「可以重试」 is a fake exit. Retry
// needs a live Job *and* is not how a timed-out composer/harness run recovers.
// Even a Job-shaped TIMEOUT must name 返回工作台 and must not keep the retired
// 「按 1 次创作计费」 count line when the merchant-facing truth is Credits.
test('TIMEOUT copy never offers retry and names 返回工作台 instead of 1 次创作', () => {
  const timeout = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'failed',
    failureCode: 'TIMEOUT',
    productUsageQuantity: 1,
    supportReference: 'MY-TIME01',
  });
  assert.match(timeout.failureSummary ?? '', /返回工作台/u);
  assert.doesNotMatch(timeout.failureSummary ?? '', /可以重试|请稍后重试/u);
  assert.doesNotMatch(JSON.stringify(timeout), /可点「重试」|可以重试/u);
  assert.equal(timeout.recoveryHint, '请返回工作台重新发起本次创作。');
  assert.doesNotMatch(timeout.costSummary, /1 次创作|按1次创作/u);
  assert.match(timeout.costSummary, /积分/u);
});

test('a Job-less failed run with a reserved unit does not say 按 1 次创作计费', () => {
  const noJob = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'none',
    productUsageQuantity: 1,
    supportReference: 'MY-NOJOB4',
  });
  assert.doesNotMatch(noJob.costSummary, /1 次创作|按1次创作/u);
  assert.match(noJob.costSummary, /积分/u);
  assert.match(noJob.costSummary, /返回工作台|不会重新发起/u);
});

test('known refund copy names returned credits instead of 1 次创作', () => {
  const refunded = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'failed',
    productUsageQuantity: 1,
    quotaRefunded: true,
    supportReference: 'MY-REFUND',
  });
  assert.match(refunded.costSummary, /积分已退回/u);
  assert.doesNotMatch(refunded.costSummary, /1 次创作/u);
});

test('video run detail keeps same-task recovery without promising regeneration', () => {
  const view = projectResultRunDetail({
    phase: 'failed',
    progressState: 'failed',
    jobStatus: 'recoverable',
    failureCode: 'TIMEOUT',
    supportReference: 'MY-VIDEO1',
    workspaceKind: 'video',
  });

  assert.equal(view.stageSummary, '成片接收未完成');
  assert.equal(
    view.failureSummary,
    '成片接收未完成，请返回工作台查看任务状态或联系支持。'
  );
  assert.equal(
    view.recoveryHint,
    '可点「恢复或核验」继续接收同一上游任务，不会创建新的成片任务。'
  );
  assert.doesNotMatch(JSON.stringify(view), /可点「重试」|重新生成前会/u);
});
