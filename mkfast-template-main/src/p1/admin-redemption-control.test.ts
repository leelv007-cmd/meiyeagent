import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { canRecordRedemptionCode } from './admin-redemption-control';

const validAmounts = {
  copy: '20',
  image: '0',
  video: '0',
  audio: '0',
};

describe('admin redemption form contract', () => {
  it('uses merchant-friendly workspace responsibility copy in both locales', () => {
    const zh = JSON.parse(
      readFileSync(
        new URL('../../project.inlang/messages/zh.json', import.meta.url),
        'utf8'
      )
    ) as Record<string, string>;
    const en = JSON.parse(
      readFileSync(
        new URL('../../project.inlang/messages/en.json', import.meta.url),
        'utf8'
      )
    ) as Record<string, string>;

    /*
     * This used to pin all four strings verbatim, and two of them read
     *「工作区负责人」/「the person responsible for the workspace」— the exact RBAC
     * hat D-102 keeps off merchant surfaces. The negative regex below it only
     * looked for Owner/administrator/role, so the Chinese hat walked straight
     * through the hole and the test went green on the defect it was named for.
     *
     * Pin the contract instead of the wording: merchant-facing copy carries no
     * hat and speaks to the merchant directly. Admin mode is a separate surface
     * (PRODUCT.md:「平台管理员在独立的管理模式中，绝不与商家界面混用」), so the
     * admin string is exempt from the hat ban and asserted separately.
     */
    const rbacHat =
      /工作区负责人|工作区管理员|Owner|Operator|Reviewer|administrator|person responsible for (?:this |the )?workspace|\brole\b/iu;

    for (const merchantCopy of [
      zh.settings_redemption_description,
      en.settings_redemption_description,
    ]) {
      assert.ok(merchantCopy, 'settings_redemption_description must exist');
      assert.doesNotMatch(
        merchantCopy,
        rbacHat,
        `商家面文案不得出现权限帽子（D-102）: ${merchantCopy}`
      );
    }
    assert.match(
      zh.settings_redemption_description,
      /^你/u,
      '商家面直接称呼商家本人，不经由角色转述'
    );
    assert.match(en.settings_redemption_description, /^You\b/u);

    // The admin surface may name who redeems; it must still stay inside admin
    // mode, so it is asserted here only to keep it from drifting into the
    // merchant vocabulary check above by accident.
    assert.ok(zh.admin_redemption_create_description);
    assert.ok(en.admin_redemption_create_description);
  });

  it('rejects partial grants when any amount is not a non-negative integer', () => {
    assert.equal(
      canRecordRedemptionCode({
        amounts: { ...validAmounts, copy: '1.5', image: '1' },
        code: 'WELCOME20',
        expiresAt: '',
      }),
      false
    );
    assert.equal(
      canRecordRedemptionCode({
        amounts: { ...validAmounts, copy: '-1', image: '1' },
        code: 'WELCOME20',
        expiresAt: '',
      }),
      false
    );
  });

  it('requires one manually supplied code', () => {
    assert.equal(
      canRecordRedemptionCode({
        amounts: validAmounts,
        code: 'WELCOME20',
        expiresAt: '2026-08-01T00:00',
      }),
      true
    );
    assert.equal(
      canRecordRedemptionCode({
        amounts: validAmounts,
        code: '',
        expiresAt: '',
      }),
      false
    );
  });
});
