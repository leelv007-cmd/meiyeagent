import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  QUICK_EDIT_EXPORT_USE_ACTIONS,
  buildQuickEditIntent,
  quickEditActionForSelectionRewrite,
} from './quick-edit-model';

const contentPackage = {
  marketing: {
    factRefs: ['fact-b', 'fact-a'],
    identityRefs: [],
    rightsRefs: ['rights-a'],
  },
} as unknown as Parameters<typeof buildQuickEditIntent>[0]['contentPackage'];

describe('quick edit producer', () => {
  it('maps the two promotion chips onto their contract actions', () => {
    assert.equal(
      quickEditActionForSelectionRewrite('weaker_promo'),
      'promotion_weaker'
    );
    assert.equal(
      quickEditActionForSelectionRewrite('stronger_cta'),
      'promotion_stronger'
    );
  });

  it('carries an open-ended chip as natural language', () => {
    for (const action of [
      'rewrite',
      'shorten',
      'expand',
      'tone_shift',
    ] as const) {
      assert.equal(
        quickEditActionForSelectionRewrite(action),
        'natural_language'
      );
    }
  });

  it('builds a package-version intent that preserves frozen refs verbatim', () => {
    const intent = buildQuickEditIntent({
      action: 'promotion_weaker',
      baseVersionId: 'pkg-a-v1',
      contentPackage,
      instruction: '弱促销：「限时抢购」',
    });
    assert.equal(intent.target, 'package_version');
    assert.equal(intent.scope, 'current_task');
    assert.equal(intent.exportUse, undefined);
    // Order matters: core compares the two sets and refuses on any drift.
    assert.deepEqual(intent.preservedFactRefs, ['fact-b', 'fact-a']);
    assert.deepEqual(intent.preservedRightsRefs, ['rights-a']);
  });

  it('routes every first-batch export action to its export use', () => {
    const byAction = QUICK_EDIT_EXPORT_USE_ACTIONS.map((action) =>
      buildQuickEditIntent({
        action,
        baseVersionId: 'pkg-a-v1',
        contentPackage,
        instruction: '做成海报',
      })
    );
    assert.deepEqual(
      byAction.map((intent) => [intent.target, intent.exportUse]),
      [
        ['export_use', 'poster'],
        ['export_use', 'image_set'],
        ['export_use', 'spoken_script'],
        ['export_use', 'appointment_card'],
      ]
    );
  });

  it('refuses an intent whose base version is empty', () => {
    assert.throws(() =>
      buildQuickEditIntent({
        action: 'poster',
        baseVersionId: '',
        contentPackage,
        instruction: '做成海报',
      })
    );
  });
});
