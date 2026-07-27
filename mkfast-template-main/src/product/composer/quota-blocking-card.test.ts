/**
 * GL-23 quota blocking card pure model — redeem unlocks continue creation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  beginQuotaRedeem,
  buildQuotaRedeemCommand,
  completeQuotaRedeem,
  composerQuotaRequirements,
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

  it('blocks the copy-short image-rich 图文 run the server would reject', () => {
    const view = projectQuotaPassiveView({
      requirements: composerQuotaRequirements({
        lensId: 'image_text',
        deliverableKind: 'note',
        quantity: 1,
        notePageBound: 4,
      }),
      available: { copy: 0, image: 40, video: 3 },
    });
    assert.equal(view.short, true);
    assert.deepEqual(view.shortResources, ['copy']);
    assert.equal(
      view.notice,
      '本次用 1 条文案额度和 4 张图片额度 · 文案还剩 0 条、图片还剩 40 张'
    );
    assert.equal(view.shortNotice, '文案额度不够这次生成了，可以补充后再来');
  });

  it('counts an image_set by the recipe, so 4 pages is not pre-checked as 1', () => {
    // The fork the signed quantity resolves (S3 P0-1): recipe declares 4, the
    // untouched draft still says 1. Billing follows the recipe, so the merchant
    // with 3 images left must be stopped here rather than by the server.
    const requirements = composerQuotaRequirements({
      lensId: 'image_text',
      deliverableKind: 'image_set',
      quantity: 4,
    });
    assert.deepEqual(requirements, [{ resource: 'image', cost: 4 }]);
    const view = projectQuotaPassiveView({
      requirements,
      available: { copy: 5, image: 3, video: 1 },
    });
    assert.equal(view.short, true);
    assert.deepEqual(view.shortResources, ['image']);
    // Counting the draft's 1 instead would leave 3 images looking like plenty.
    assert.equal(
      projectQuotaPassiveView({
        requirements: composerQuotaRequirements({
          lensId: 'image_text',
          deliverableKind: 'image_set',
          quantity: 1,
        }),
        available: { copy: 5, image: 3, video: 1 },
      }).short,
      false
    );
  });

  it('names both buckets when both fall short', () => {
    const view = projectQuotaPassiveView({
      requirements: composerQuotaRequirements({
        lensId: 'image_text',
        deliverableKind: 'note',
        quantity: 1,
        notePageBound: 4,
      }),
      available: { copy: 0, image: 1 },
    });
    assert.deepEqual(view.shortResources, ['copy', 'image']);
    assert.equal(
      view.shortNotice,
      '文案额度和图片额度不够这次生成了，可以补充后再来'
    );
  });
});

describe('D-043 quota 被动展示', () => {
  it('states the run and the balance where both count the same thing', () => {
    const view = projectQuotaPassiveView({
      requirements: [{ resource: 'copy', cost: 1 }],
      available: { copy: 5 },
    });
    assert.equal(view.visible, true);
    assert.equal(view.short, false);
    assert.equal(view.notice, '本次用 1 条文案额度 · 还剩 5 条');
    assert.equal(view.shortNotice, null);
    assert.deepEqual(view.shortResources, []);
  });

  it('flags a short balance without gating anything', () => {
    const view = projectQuotaPassiveView({
      requirements: [{ resource: 'image', cost: 3 }],
      available: { image: 1 },
    });
    assert.equal(view.short, true);
    assert.equal(view.notice, '本次用 3 张图片额度 · 还剩 1 张');
    assert.equal(view.shortNotice, '图片额度不够这次生成了，可以补充后再来');
  });

  it('states video in 条 now that the ledger reserves it by clip', () => {
    // T21/G-11 moved video settlement onto whole clips
    // (`server-quote-authority.ts` debitUnitsFor → `{ video, quantity }`), so
    // the seconds-vs-clips split that forced silence here is gone (W05 ③).
    const view = projectQuotaPassiveView({
      requirements: [{ resource: 'video', cost: 1 }],
      available: { video: 3 },
    });
    assert.equal(view.visible, true);
    assert.equal(view.notice, '本次用 1 条视频额度 · 还剩 3 条');
    assert.equal(view.short, false);
  });

  it('says nothing before every touched balance has loaded', () => {
    for (const available of [null, undefined]) {
      assert.equal(
        projectQuotaPassiveView({
          requirements: [{ resource: 'copy', cost: 1 }],
          available: { copy: available },
        }).visible,
        false
      );
      // A 图文 run must wait for BOTH buckets — half a sentence reads as whole.
      assert.equal(
        projectQuotaPassiveView({
          requirements: [
            { resource: 'copy', cost: 1 },
            { resource: 'image', cost: 4 },
          ],
          available: { copy: 5, image: available },
        }).visible,
        false
      );
    }
  });
});
