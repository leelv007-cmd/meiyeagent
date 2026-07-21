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
  buildComposerQuote,
  confirmQuotePrice,
  projectComposerQuoteView,
  requoteOnParamChange,
} from './quote-wiring';
import {
  buildDynamicSettingsRow,
  assertSettingsRowContract,
} from './settings-row';

test('changing model or quantity re-quotes and updates revision', () => {
  const base = buildComposerQuote({
    quoteId: 'q-1',
    catalogModelId: 'model.copy.basic',
    catalogModelRevision: 'cm-1',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    unitRate: 1,
    quantity: 3,
  });

  const afterQty = requoteOnParamChange(base, {
    quoteId: 'q-1',
    catalogModelId: 'model.copy.basic',
    catalogModelRevision: 'cm-1',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    unitRate: 1,
    quantity: 5,
  });
  assert.equal(afterQty.revisionChanged, true);
  assert.notEqual(afterQty.snapshot.revision, base.revision);
  assert.equal(afterQty.snapshot.confirmedAmount, 5);

  const afterModel = requoteOnParamChange(afterQty.snapshot, {
    quoteId: 'q-1',
    catalogModelId: 'model.copy.pro',
    catalogModelRevision: 'cm-2',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    unitRate: 2,
    quantity: 5,
  });
  assert.equal(afterModel.revisionChanged, true);
  assert.notEqual(afterModel.snapshot.revision, afterQty.snapshot.revision);
  assert.equal(afterModel.snapshot.confirmedAmount, 10);
  assert.equal(afterModel.snapshot.catalogModelId, 'model.copy.pro');
});

test('confirm price equals charge price after re-quote', () => {
  const quoted = buildComposerQuote({
    quoteId: 'q-match',
    catalogModelId: 'model.video.std',
    quotePolicyRevision: 'qp-v',
    billingMode: 'per_output_second',
    unitRate: 2,
    targetSeconds: 15,
    minChargeSeconds: 5,
    roundingStepSeconds: 1,
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

  const q1 = buildComposerQuote({
    quoteId: 'q-wire',
    catalogModelId: 'model.copy.basic',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    unitRate: 1,
    quantity: 3,
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

  const q2 = buildComposerQuote({
    quoteId: 'q-wire',
    catalogModelId: 'model.copy.pro',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_request',
    unitRate: 2,
    quantity: 6,
  });
  const requoted = requoteOnParamChange(
    { ...q1, revision: rev1! },
    {
      quoteId: 'q-wire',
      catalogModelId: 'model.copy.pro',
      quotePolicyRevision: 'qp-1',
      billingMode: 'per_request',
      unitRate: 2,
      quantity: 6,
    }
  );
  assert.equal(requoted.revisionChanged, true);
  state = bindQuoteView(state, projectComposerQuoteView(requoted.snapshot, 6));

  assert.notEqual(state.draft.quoteRevisionId, rev1);
  assert.equal(state.draft.quoteView?.amount, 12);

  const price = confirmQuotePrice(q2);
  assert.equal(price.matches, true);
  assert.equal(price.confirmPrice, state.draft.quoteView?.amount);
  assert.equal(price.chargePrice, state.draft.quoteView?.amount);
});

test('video per_output_second billing note uses quotedSeconds', () => {
  const quoted = buildComposerQuote({
    quoteId: 'q-sec',
    catalogModelId: 'model.video.std',
    quotePolicyRevision: 'qp-v',
    billingMode: 'per_output_second',
    unitRate: 1,
    targetSeconds: 12,
    minChargeSeconds: 10,
    roundingStepSeconds: 5,
  });
  // max(12, 10) = 12, ceil to 5 → 15
  assert.equal(quoted.quotedSeconds, 15);
  const view = projectComposerQuoteView(quoted);
  assert.equal(view.billingNote, '按生成成片 15 秒计费');
  assert.equal(view.amount, 15);
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
