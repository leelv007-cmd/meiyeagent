import assert from 'node:assert/strict';
import test from 'node:test';

import { projectComposerHandoffNotice } from './handoff-notice';

test('D-C1: a prefill says what was written and offers the way back', () => {
  const view = projectComposerHandoffNotice({
    handoff: {
      intent: '帮我做一篇小红书图文笔记。',
      outputHint: 'image_text',
      recipeChipId: 'xhs_image_text',
    },
    text: 'prefilled',
  });

  assert.match(view.message, /小红书图文/u);
  assert.match(view.message, /写好/u);
  assert.equal(view.undoLabel, '撤销');
});

test('D-C1: a kept sentence is named as kept, not as a silent attach', () => {
  const view = projectComposerHandoffNotice({
    handoff: {
      intent: '帮我复刻一条爆款笔记。',
      outputHint: 'image_text',
      recipeChipId: 'viral_adapt',
    },
    text: 'kept_user_text',
  });

  assert.match(view.message, /爆款复刻/u);
  assert.match(view.message, /没动/u);
});

test('a recommendation without a chip or hint still says something true', () => {
  const view = projectComposerHandoffNotice({
    handoff: { intent: '周末到店预约' },
    text: 'kept_user_text',
  });

  assert.match(view.message, /没动/u);
  assert.doesNotMatch(view.message, /「」/u);
});
