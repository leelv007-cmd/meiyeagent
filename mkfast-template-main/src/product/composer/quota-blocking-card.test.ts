/**
 * GL-23 credit blocking card pure model — redeem unlocks continue creation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as quotaBlocking from './quota-blocking';
import {
  beginQuotaRedeem,
  buildQuotaRedeemCommand,
  completeQuotaRedeem,
  composerQuotaRequirements,
  createQuotaBlockingState,
  isQuotaRedeemCodeValid,
  projectQuotaBlockingView,
  setQuotaRedeemCode,
  showQuotaBlocking,
} from './quota-blocking';

describe('GL-23 quota blocking model', () => {
  it('starts hidden / not unlocked', () => {
    const state = createQuotaBlockingState();
    const view = projectQuotaBlockingView(state);
    assert.equal(view.visible, false);
    assert.equal(view.canContinueCreation, false);
  });

  it('showQuotaBlocking makes card visible and blocked', () => {
    const state = showQuotaBlocking(createQuotaBlockingState());
    const view = projectQuotaBlockingView(state);
    assert.equal(view.visible, true);
    assert.equal(view.unlocked, false);
    assert.equal(view.canSubmit, false);
  });

  it('accepts code and enables submit at length >= 4', () => {
    let state = showQuotaBlocking(createQuotaBlockingState());
    state = setQuotaRedeemCode(state, 'ab');
    assert.equal(projectQuotaBlockingView(state).canSubmit, false);
    assert.equal(isQuotaRedeemCodeValid(state.code), false);

    state = setQuotaRedeemCode(state, 'gift-99');
    assert.equal(state.code, 'GIFT-99');
    assert.equal(projectQuotaBlockingView(state).canSubmit, true);
  });

  it('successful redeem unlocks continue creation in place', () => {
    let state = showQuotaBlocking(createQuotaBlockingState());
    state = setQuotaRedeemCode(state, 'UNLOCK1');
    state = beginQuotaRedeem(state);
    assert.equal(state.status, 'pending');

    state = completeQuotaRedeem(state, { ok: true });
    const view = projectQuotaBlockingView(state);
    assert.equal(state.blocked, false);
    assert.equal(state.unlocked, true);
    assert.equal(view.canContinueCreation, true);
    assert.equal(view.status, 'success');
    assert.match(view.successMessage ?? '', /兑换成功/);
    assert.equal(view.code, '');
  });

  it('failed redeem keeps blocked and surfaces error', () => {
    let state = showQuotaBlocking(createQuotaBlockingState());
    state = setQuotaRedeemCode(state, 'BADCODE');
    state = beginQuotaRedeem(state);
    state = completeQuotaRedeem(state, {
      ok: false,
      message: '兑换码无效',
    });
    const view = projectQuotaBlockingView(state);
    assert.equal(view.canContinueCreation, false);
    assert.equal(view.unlocked, false);
    assert.equal(state.blocked, true);
    assert.equal(view.errorMessage, '兑换码无效');
  });

  it('buildQuotaRedeemCommand matches RedemptionCard CAS shape', () => {
    const command = buildQuotaRedeemCommand('  demo-code  ');
    assert.deepEqual(command, {
      action: 'redeem',
      payload: { code: 'DEMO-CODE' },
    });
  });
});

describe('W05 图文双桶预检 (P0-5)', () => {
  it('mirrors the server: an image-text note debits copy AND image', () => {
    assert.deepEqual(
      composerQuotaRequirements({
        lensId: 'image_text',
        deliverableKind: 'note',
        quantity: 1,
        notePageBound: 6,
      }),
      [
        { resource: 'copy', cost: 1 },
        { resource: 'image', cost: 6 },
      ]
    );
  });

  it('treats an image_text_package the same way as a note', () => {
    assert.deepEqual(
      composerQuotaRequirements({
        lensId: 'image_text',
        deliverableKind: 'image_text_package',
        quantity: 2,
        notePageBound: null,
      }),
      [
        { resource: 'copy', cost: 1 },
        { resource: 'image', cost: 2 },
      ]
    );
  });

  it('keeps single-bucket shapes single', () => {
    assert.deepEqual(
      composerQuotaRequirements({
        lensId: 'image_text',
        deliverableKind: 'image_set',
        quantity: 3,
      }),
      [{ resource: 'image', cost: 3 }]
    );
    assert.deepEqual(
      composerQuotaRequirements({
        lensId: 'copy',
        deliverableKind: 'copy_document',
        quantity: 2,
      }),
      [{ resource: 'copy', cost: 2 }]
    );
    assert.deepEqual(
      composerQuotaRequirements({
        lensId: 'video',
        deliverableKind: 'video_package',
        quantity: 1,
      }),
      [{ resource: 'video', cost: 1 }]
    );
    assert.deepEqual(
      composerQuotaRequirements({
        lensId: null,
        deliverableKind: null,
        quantity: 1,
      }),
      []
    );
  });

  it('counts an image_set by the recipe, so 4 pages is not pre-checked as 1', () => {
    // The fork the signed quantity resolves (S3 P0-1): recipe declares 4, the
    // untouched draft still says 1. Billing follows the recipe, so the quote
    // the merchant confirms has to be priced off the recipe's count.
    assert.deepEqual(
      composerQuotaRequirements({
        lensId: 'image_text',
        deliverableKind: 'image_set',
        quantity: 4,
      }),
      [{ resource: 'image', cost: 4 }]
    );
  });
});

describe('D-172 retirement: the bucket-metering half is gone', () => {
  it('exports no bucket-metering helper, so no surface can rebuild the sentence', () => {
    // RETIRED-METERING: 「本次用 1 条文案额度 · 还剩 5 条」 had exactly one
    // balance source — the retired projection (#336 AC3). Deleting the read without
    // deleting the sentence would leave a helper that formats a balance nobody
    // can supply, which is how the wording comes back.
    for (const retired of [
      'QUOTA_BLOCK_TITLE',
      'QUOTA_BLOCK_DESCRIPTION',
      'QUOTA_RESOURCE_LABELS',
      'composerQuotaAvailability',
      'projectQuotaPassiveView',
      'quotaShortNotice',
      'quotaSpendLabel',
    ]) {
      assert.equal(
        retired in quotaBlocking,
        false,
        `quota-blocking still exports ${retired}`
      );
    }
  });

  it('reads no legacy usage bucket', () => {
    const source = readFileSync(
      new URL('./quota-blocking.ts', import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(source, /usage\./u);
    assert.doesNotMatch(source, /AccountUsageProjection/u);
  });

  it('blocks and unblocks on the credit shortfall alone', () => {
    // The card is now driven by `projectWorkbenchCreditShortfall`, so the only
    // question this model answers is「挡住了吗」and「兑换后放行了吗」.
    let state = showQuotaBlocking(createQuotaBlockingState());
    assert.equal(projectQuotaBlockingView(state).visible, true);
    assert.equal(projectQuotaBlockingView(state).canContinueCreation, false);

    state = setQuotaRedeemCode(state, 'TOPUP-1');
    state = beginQuotaRedeem(state);
    state = completeQuotaRedeem(state, { ok: true });
    assert.equal(projectQuotaBlockingView(state).canContinueCreation, true);
  });
});
