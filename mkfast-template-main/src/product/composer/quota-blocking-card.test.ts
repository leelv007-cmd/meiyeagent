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
