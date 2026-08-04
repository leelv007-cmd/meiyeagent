/**
 * Quote recompute wiring: change model/qty → confirm price = charge price.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindQuoteView,
  createComposerLensState,
  selectLens,
  updateSettings,
  type ComposerLensState,
} from './lens-state-machine';
import {
  confirmQuotePrice,
  projectComposerQuoteView,
} from './quote-wiring';
import { productQuoteFixture } from './quote-fixture.test-helper';
import {
  buildDynamicSettingsRow,
  assertSettingsRowContract,
} from './settings-row';

test('confirm price equals charge price after re-quote', () => {
  const quoted = productQuoteFixture({
    quoteId: 'q-match',
    revision: 'server-revision-video',
    catalogModelId: 'model.video.std',
    quotePolicyRevision: 'qp-v',
    billingMode: 'per_output_second',
    targetSeconds: 15,
    quotedSeconds: 15,
    confirmedAmount: 30,
    authorizedCeiling: 30,
    formula: { expression: '2 × 15s', unitRate: 2 },
  });

  const check = confirmQuotePrice(quoted);
  assert.equal(check.matches, true);
  assert.equal(check.confirmPrice, check.chargePrice);
  assert.equal(check.confirmPrice, 30); // 2 × 15s
  assert.equal(quoted.quotedSeconds, 15);
});

test('composer draft re-quote wiring: model/qty change updates bound revision', () => {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'copy');

  const q1 = productQuoteFixture({
    quoteId: 'q-wire',
    revision: 'server-revision-1',
    catalogModelId: 'model.copy.basic',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    confirmedAmount: 3,
    authorizedCeiling: 3,
  });
  state = bindQuoteView(state, projectComposerQuoteView(q1, 3));
  const rev1 = state.draft.quoteRevisionId;
  assert.ok(rev1);

  state = updateSettings(
    state,
    {
      catalogModelId: 'model.copy.pro',
      catalogModelName: '文案专业版',
      quantity: 6,
      modelPolicyMode: 'fixed',
    },
    'user'
  );

  const q2 = productQuoteFixture({
    quoteId: 'q-wire',
    revision: 'server-revision-2',
    catalogModelId: 'model.copy.pro',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    confirmedAmount: 12,
    authorizedCeiling: 12,
  });
  assert.notEqual(q2.revision, q1.revision);
  state = bindQuoteView(state, projectComposerQuoteView(q2, 6));

  assert.notEqual(state.draft.quoteRevisionId, rev1);
  assert.equal(state.draft.quoteView?.amount, 12);

  const price = confirmQuotePrice(q2);
  assert.equal(price.matches, true);
  assert.equal(price.confirmPrice, state.draft.quoteView?.amount);
  assert.equal(price.chargePrice, state.draft.quoteView?.amount);
});

test('video per_output_second billing note uses quotedSeconds', () => {
  const quoted = productQuoteFixture({
    quoteId: 'q-sec',
    revision: 'server-revision-seconds',
    catalogModelId: 'model.video.std',
    quotePolicyRevision: 'qp-v',
    billingMode: 'per_output_second',
    targetSeconds: 12,
    quotedSeconds: 15,
    confirmedAmount: 15,
    authorizedCeiling: 15,
    formula: { expression: '1 × 15s', unitRate: 1 },
  });
  // max(12, 10) = 12, ceil to 5 → 15
  assert.equal(quoted.quotedSeconds, 15);
  const view = projectComposerQuoteView(quoted);
  assert.equal(view.billingNote, '按生成成片 15 秒计费');
  assert.equal(view.amount, 15);
});

test('credit-facing composer view uses only the published credit quote fields', () => {
  const quoted = productQuoteFixture({
    quoteId: 'q-credit',
    revision: 'server-revision-credit',
    catalogModelId: 'model.image.credit',
    quotePolicyRevision: 'qp-credit',
    billingMode: 'per_request',
    confirmedAmount: 0.06,
    authorizedCeiling: 0.06,
  });
  quoted.creditCost = 42;
  quoted.failureRefundsCredits = false;

  const view = projectComposerQuoteView(quoted);
  assert.equal(view.amount, 42);
  assert.equal(view.creditCost, 42);
  assert.equal(view.failureRefundsCredits, false);
});

test('dynamic settings row includes CatalogModel and stays 3–5 fields', () => {
  for (const lensId of ['copy', 'image_text', 'video'] as const) {
    const row = buildDynamicSettingsRow({
      lensId,
      catalogModel: { id: 'm1', displayName: '测试模型' },
      aspectRatio: '3:4',
      quantity: 1,
      durationSeconds: 15,
      platform: 'xiaohongshu',
      deliverableKind: 'note',
    });
    const contract = assertSettingsRowContract(row);
    assert.equal(contract.ok, true, contract.errors.join('; '));
    assert.ok(row.length >= 3 && row.length <= 5);
    assert.equal(row[0]?.def.isCatalogModel, true);
    assert.equal(row[0]?.displayValue, '测试模型');
  }

  assert.deepEqual(buildDynamicSettingsRow({ lensId: null }), []);
});
