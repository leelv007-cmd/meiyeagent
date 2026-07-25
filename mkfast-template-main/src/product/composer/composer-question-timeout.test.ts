import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardLanguageIssues } from './card-language';
import {
  COMPOSER_QUESTION_DEFAULT_LABEL,
  COMPOSER_QUESTION_FAILURE_NOTICE,
  COMPOSER_QUESTION_TIMEOUT_SECONDS,
  composerQuestionHold,
  projectComposerQuestionCard,
} from './composer-question-timeout';

test('the operating parameter has one exit at the D-116 reference baseline', () => {
  // D-116: 秒数＝运营参数, 绘文实测 30s 为参考基线. The value moving to the
  // registered admin-config key must stay a one-line change.
  assert.equal(COMPOSER_QUESTION_TIMEOUT_SECONDS, 30);
});

test('an open card counts down and says so in merchant language', () => {
  const view = projectComposerQuestionCard({
    editing: false,
    hold: null,
    remainingSeconds: 12,
    settlement: null,
  });
  assert.equal(view.autoContinueEnabled, true);
  assert.match(view.countdownNotice ?? '', /12 秒后按默认继续/u);
  assert.equal(view.holdNotice, null);
  assert.equal(view.settledNotice, null);
  assert.equal(view.defaultLabel, COMPOSER_QUESTION_DEFAULT_LABEL);
});

test('editing pauses the release — D-116 safety edge ①', () => {
  const view = projectComposerQuestionCard({
    editing: true,
    hold: null,
    remainingSeconds: 3,
    settlement: null,
  });
  // 防「调整未完成被自动继续」: a merchant mid-sentence is never released past.
  assert.equal(view.autoContinueEnabled, false);
  assert.equal(view.countdownNotice, null);
});

test('quota and external effects withhold the release — D-116 safety edge ②', () => {
  assert.equal(
    composerQuestionHold({ externalEffect: false, quotaBlocked: true }),
    'quota'
  );
  assert.equal(
    composerQuestionHold({ externalEffect: true, quotaBlocked: false }),
    'external_effect'
  );
  assert.equal(
    composerQuestionHold({ externalEffect: false, quotaBlocked: false }),
    null
  );

  const view = projectComposerQuestionCard({
    editing: false,
    hold: 'quota',
    remainingSeconds: 30,
    settlement: null,
  });
  assert.equal(view.autoContinueEnabled, false);
  assert.equal(view.countdownNotice, null);
  assert.match(view.holdNotice ?? '', /额度/u);
});

test('a settled card stops counting and states which decision landed', () => {
  const answered = projectComposerQuestionCard({
    editing: false,
    hold: null,
    remainingSeconds: 1,
    settlement: 'answered',
  });
  assert.equal(answered.autoContinueEnabled, false);
  assert.equal(answered.settledNotice, '已按你的回答继续');

  const timedOut = projectComposerQuestionCard({
    editing: false,
    hold: null,
    remainingSeconds: 0,
    settlement: 'timed_out',
  });
  assert.match(timedOut.settledNotice ?? '', /按通用模式继续/u);
});

test('a failed submit is reported as failed, not as a settlement', () => {
  const view = projectComposerQuestionCard({
    editing: false,
    failed: true,
    hold: null,
    remainingSeconds: 30,
    settlement: null,
  });
  assert.equal(view.failureNotice, COMPOSER_QUESTION_FAILURE_NOTICE);
  assert.equal(view.settledNotice, null);
  // Still releasable: a failed attempt must not turn guidance into a block.
  assert.equal(view.autoContinueEnabled, true);
  assert.deepEqual(cardLanguageIssues(view.failureNotice ?? ''), []);
});

test('every sentence this card can show passes the merchant language gate', () => {
  const settlements = ['answered', 'skipped', 'timed_out'] as const;
  const holds = [null, 'quota', 'external_effect'] as const;
  const copy: string[] = [COMPOSER_QUESTION_DEFAULT_LABEL];
  for (const settlement of settlements) {
    for (const hold of holds) {
      const view = projectComposerQuestionCard({
        editing: false,
        hold,
        remainingSeconds: 30,
        settlement,
      });
      copy.push(
        view.countdownNotice ?? '',
        view.holdNotice ?? '',
        view.settledNotice ?? ''
      );
    }
  }
  const open = projectComposerQuestionCard({
    editing: false,
    hold: null,
    remainingSeconds: 30,
    settlement: null,
  });
  copy.push(open.countdownNotice ?? '');

  for (const sentence of copy.filter(Boolean)) {
    assert.deepEqual(
      cardLanguageIssues(sentence),
      [],
      `card copy leaked engineering language: ${sentence}`
    );
  }
});
