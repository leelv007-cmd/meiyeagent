import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MERCHANT_ARTIFACT_STATUS,
  MERCHANT_DELIVERY_MODE,
  MERCHANT_MEMORY_KEY,
  MERCHANT_OBJECT_NAME,
  MERCHANT_OUTCOME_SIGNAL,
  MERCHANT_THREAD_LIST_DESCRIPTION,
  MERCHANT_THREAD_STATUS,
  UnmappedMerchantVocabularyError,
  merchantVocabularyIssues,
  projectMerchantArtifactStatus,
  projectMerchantDeliveryMode,
  projectMerchantMemoryFieldLabel,
  projectMerchantMemoryKey,
  projectMerchantObjectName,
  projectMerchantOutcomeSignal,
  projectMerchantRevision,
  projectMerchantThreadStatus,
} from './merchant-vocabulary';

test('Agent Thread and thread statuses project to merchant language', () => {
  assert.equal(projectMerchantObjectName('Agent Thread'), '这次对话');
  assert.equal(projectMerchantThreadStatus('idle'), '待开始');
  assert.equal(projectMerchantThreadStatus('waiting'), '等你处理');
  assert.equal(projectMerchantThreadStatus('delivered'), '已完成');
  assert.equal(projectMerchantThreadStatus('archived'), '已归档');
  assert.deepEqual(
    merchantVocabularyIssues(MERCHANT_THREAD_LIST_DESCRIPTION),
    []
  );
  assert.doesNotMatch(MERCHANT_THREAD_LIST_DESCRIPTION, /Agent Thread/iu);
});

test('artifact statuses and revisions never render raw tokens', () => {
  assert.equal(projectMerchantArtifactStatus('skeleton'), '起草中');
  assert.equal(projectMerchantArtifactStatus('partial'), '还在生成');
  assert.equal(projectMerchantArtifactStatus('ready'), '已就绪');
  assert.equal(projectMerchantArtifactStatus('failed'), '没做成');
  assert.equal(projectMerchantRevision(4), '第 4 版');
  assert.doesNotMatch(projectMerchantRevision(4), /\br\d+\b/u);
  for (const [raw, label] of Object.entries(MERCHANT_ARTIFACT_STATUS)) {
    assert.notEqual(label, raw);
    assert.deepEqual(merchantVocabularyIssues(label), []);
  }
});

test('delivery modes and outcome signals never echo the enum', () => {
  assert.equal(projectMerchantDeliveryMode('automatic_verified'), '暂不可用');
  assert.equal(projectMerchantDeliveryMode('assisted'), '辅助交接');
  assert.equal(projectMerchantDeliveryMode('unavailable'), '暂不可用');
  assert.equal(projectMerchantOutcomeSignal('no_activity'), '没动静');
  assert.equal(projectMerchantOutcomeSignal('inquiry'), '有人问');
  for (const [raw, label] of Object.entries({
    ...MERCHANT_DELIVERY_MODE,
    ...MERCHANT_OUTCOME_SIGNAL,
  })) {
    assert.notEqual(label, raw);
    assert.ok(!label.includes(raw));
  }
});

test('Memory keys project; unknown field labels stay hidden', () => {
  assert.equal(projectMerchantMemoryKey('memoryId'), '这条经验');
  assert.equal(projectMerchantMemoryKey('authority'), '效力');
  assert.equal(projectMerchantMemoryFieldLabel('statement'), '内容');
  assert.equal(projectMerchantMemoryFieldLabel('semanticKey'), null);
  assert.equal(projectMerchantMemoryFieldLabel('candidateId'), null);
  assert.equal(projectMerchantMemoryFieldLabel('tone'), 'tone');
  assert.equal(projectMerchantMemoryFieldLabel('primary'), 'primary');
});

test('raw enum fallback must fail: unknown values do not echo the token', () => {
  const cases: Array<{
    project: (raw: string) => string;
    raw: string;
    kind: string;
  }> = [
    {
      project: projectMerchantArtifactStatus,
      raw: 'not_a_real_status',
      kind: 'artifactStatus',
    },
    {
      project: projectMerchantThreadStatus,
      raw: 'cancel_requested',
      kind: 'threadStatus',
    },
    {
      project: projectMerchantDeliveryMode,
      raw: 'system_driven',
      kind: 'deliveryMode',
    },
    {
      project: projectMerchantOutcomeSignal,
      raw: 'add_wechat',
      kind: 'outcomeSignal',
    },
    {
      project: projectMerchantMemoryKey,
      raw: 'semanticKey',
      kind: 'memoryKey',
    },
    {
      project: projectMerchantObjectName,
      raw: 'ExecutionPlanSnapshot',
      kind: 'objectName',
    },
  ];

  for (const { project, raw, kind } of cases) {
    try {
      const label = project(raw);
      assert.notEqual(
        label,
        raw,
        `${kind} leaked raw token ${raw} via fallback`
      );
      assert.fail(`${kind} must reject unmapped ${raw} instead of mapping it`);
    } catch (error) {
      assert.ok(
        error instanceof UnmappedMerchantVocabularyError,
        `${kind} rejected ${raw} with ${String(error)}`
      );
      assert.equal(error.kind, kind);
      assert.equal(error.raw, raw);
    }
  }

  assert.throws(
    () => projectMerchantRevision(Number.NaN),
    UnmappedMerchantVocabularyError
  );
  assert.throws(
    () => projectMerchantRevision(-1),
    UnmappedMerchantVocabularyError
  );
  assert.throws(
    () => projectMerchantRevision(1.5),
    UnmappedMerchantVocabularyError
  );
});

test('every dictionary entry is a real projection, not an identity map', () => {
  const tables = [
    MERCHANT_OBJECT_NAME,
    MERCHANT_THREAD_STATUS,
    MERCHANT_ARTIFACT_STATUS,
    MERCHANT_DELIVERY_MODE,
    MERCHANT_OUTCOME_SIGNAL,
    MERCHANT_MEMORY_KEY,
  ];
  for (const table of tables) {
    assert.ok(Object.keys(table).length > 0);
    for (const [raw, label] of Object.entries(table)) {
      assert.notEqual(label, raw, `identity fallback ${raw}`);
      assert.ok(label.trim().length > 0);
    }
  }
});
