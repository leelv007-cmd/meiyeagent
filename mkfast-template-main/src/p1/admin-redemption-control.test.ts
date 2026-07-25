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

    assert.equal(
      zh.admin_redemption_create_description,
      '录入运营已发放的一次性条数额度；工作区负责人可在账户设置中兑换。'
    );
    assert.equal(
      zh.settings_redemption_description,
      '工作区负责人可兑换一次性的文案、图片、视频或音频条数额度。'
    );
    assert.equal(
      en.admin_redemption_create_description,
      'Record one-time allowances issued by operations. The person responsible for the workspace can redeem them from account settings.'
    );
    assert.equal(
      en.settings_redemption_description,
      'The person responsible for this workspace can redeem one-time copy, image, video, or audio allowances.'
    );
    assert.doesNotMatch(
      [
        zh.admin_redemption_create_description,
        zh.settings_redemption_description,
        en.admin_redemption_create_description,
        en.settings_redemption_description,
      ].join('\n'),
      /Owner|administrator|管理员（Owner）|role/iu
    );
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
