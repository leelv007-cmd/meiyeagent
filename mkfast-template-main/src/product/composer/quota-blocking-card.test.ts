/**
 * GL-23 quota blocking card pure model — redeem unlocks continue creation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  beginQuotaRedeem,
  buildQuotaRedeemCommand,
  completeQuotaRedeem,
  createQuotaBlockingState,
  isQuotaRedeemCodeValid,
  projectQuotaBlockingView,
  projectQuotaPassiveView,
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

describe('D-043 quota 被动展示', () => {
  it('states the run and the balance where both count the same thing', () => {
    const view = projectQuotaPassiveView({
      resource: 'copy',
      available: 5,
      cost: 1,
    });
    assert.equal(view.visible, true);
    assert.equal(view.short, false);
    assert.equal(view.notice, '本次用 1 条文案额度 · 还剩 5 条');
    assert.equal(view.shortNotice, null);
  });

  it('flags a short balance without gating anything', () => {
    const view = projectQuotaPassiveView({
      resource: 'image',
      available: 1,
      cost: 3,
    });
    assert.equal(view.short, true);
    assert.equal(view.notice, '本次用 3 张图片额度 · 还剩 1 张');
    assert.equal(view.shortNotice, '图片额度不够这次生成了，可以补充后再来');
  });

  it('says nothing about video: the balance is seconds, the cost is clips', () => {
    // INC-t26-mixed-denomination one layer up. The ledger settles video as
    // `{ resource: 'video', quantity: ceil(billableSeconds) }` while the
    // composer's cost is a deliverable count, so 「本次用 1 条 · 还剩 30 条」
    // would put a wrong number in front of the merchant. Withhold instead.
    const view = projectQuotaPassiveView({
      resource: 'video',
      available: 30,
      cost: 1,
    });
    assert.equal(view.visible, false);
    assert.equal(view.notice, '');
    assert.equal(view.short, false);
  });

  it('says nothing before the balance has loaded', () => {
    for (const available of [null, undefined]) {
      const view = projectQuotaPassiveView({
        resource: 'copy',
        available,
        cost: 1,
      });
      assert.equal(view.visible, false);
    }
  });
});
