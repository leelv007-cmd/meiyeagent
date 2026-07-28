import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardLanguageIssues } from './card-language';
import {
  COMPOSER_QUESTION_DEFAULT_LABEL,
  COMPOSER_QUESTION_FAILURE_NOTICE,
  composerQuestionHold,
  projectComposerQuestionCard,
} from './composer-question-timeout';

test('continue displays the Core-owned timeout without creating a browser truth', () => {
  const view = projectComposerQuestionCard({
    hold: null,
    remainingSeconds: 12,
    resolutionSource: null,
    settlement: null,
    timeoutSeconds: 30,
    unattended: 'continue',
  });
  assert.equal(view.autoContinueEnabled, true);
  assert.match(view.countdownNotice ?? '', /12 秒后按默认继续/u);
  assert.equal(view.defaultLabel, COMPOSER_QUESTION_DEFAULT_LABEL);
});

test('hold never displays or enables a local countdown', () => {
  const view = projectComposerQuestionCard({
    hold: null,
    remainingSeconds: 30,
    reservationReleased: false,
    resolutionSource: null,
    settlement: null,
    timeoutSeconds: null,
    unattended: 'hold',
  });
  assert.equal(view.autoContinueEnabled, false);
  assert.equal(view.countdownNotice, null);
  assert.match(view.holdNotice ?? '', /不会自动放行/u);
});

test('released reservation changes the pending hold promise before an answer', () => {
  const view = projectComposerQuestionCard({
    hold: 'quota',
    remainingSeconds: 0,
    reservationReleased: true,
    resolutionSource: null,
    settlement: null,
    timeoutSeconds: null,
    unattended: 'hold',
  });

  assert.match(view.holdNotice ?? '', /额度已经放回/u);
  assert.match(view.holdNotice ?? '', /重新排队占用/u);

  const failedSuccessor = projectComposerQuestionCard({
    hold: 'quota',
    remainingSeconds: 0,
    reservationReleased: true,
    resolutionSource: 'late_answer',
    settlement: null,
    timeoutSeconds: null,
    unattended: 'hold',
  });
  assert.match(failedSuccessor.settledNotice ?? '', /额度已经放回/u);
  assert.match(failedSuccessor.settledNotice ?? '', /再次提交/u);
});

test('quota and external effects withhold the displayed release', () => {
  assert.equal(
    composerQuestionHold({ externalEffect: false, quotaBlocked: true }),
    'quota'
  );
  assert.equal(
    composerQuestionHold({ externalEffect: true, quotaBlocked: false }),
    'external_effect'
  );
  const view = projectComposerQuestionCard({
    hold: 'quota',
    remainingSeconds: 30,
    resolutionSource: null,
    settlement: null,
    timeoutSeconds: 30,
    unattended: 'continue',
  });
  assert.equal(view.autoContinueEnabled, false);
  assert.match(view.holdNotice ?? '', /额度/u);
});

test('Core timeout and hold expiry stay visible and keep late answers available', () => {
  const continued = projectComposerQuestionCard({
    hold: null,
    remainingSeconds: 0,
    resolutionSource: 'core_timeout',
    settlement: null,
    timeoutSeconds: 30,
    unattended: 'continue',
  });
  assert.match(continued.settledNotice ?? '', /仍可回答/u);

  const cancelled = projectComposerQuestionCard({
    hold: null,
    remainingSeconds: 0,
    resolutionSource: 'core_hold_expired',
    settlement: null,
    timeoutSeconds: null,
    unattended: 'hold',
  });
  assert.match(cancelled.settledNotice ?? '', /已取消/u);
  assert.match(cancelled.settledNotice ?? '', /额度已退回/u);
});

test('submit outcomes and failures are explicit merchant-visible states', () => {
  const successor = projectComposerQuestionCard({
    hold: null,
    remainingSeconds: 0,
    resolutionSource: 'core_timeout',
    settlement: 'late_answered',
    timeoutSeconds: 30,
    unattended: 'continue',
  });
  assert.match(successor.settledNotice ?? '', /精修版本/u);

  const raced = projectComposerQuestionCard({
    hold: null,
    remainingSeconds: 0,
    resolutionSource: null,
    settlement: 'continued_elsewhere',
    timeoutSeconds: 30,
    unattended: 'continue',
  });
  assert.match(raced.settledNotice ?? '', /同步最新状态/u);

  const failed = projectComposerQuestionCard({
    failed: true,
    hold: null,
    remainingSeconds: 30,
    resolutionSource: null,
    settlement: null,
    timeoutSeconds: 30,
    unattended: 'continue',
  });
  assert.equal(failed.failureNotice, COMPOSER_QUESTION_FAILURE_NOTICE);
});

test('every sentence this card owns passes the merchant-language gate', () => {
  const copy = [
    COMPOSER_QUESTION_DEFAULT_LABEL,
    COMPOSER_QUESTION_FAILURE_NOTICE,
    projectComposerQuestionCard({
      hold: null,
      remainingSeconds: 12,
      resolutionSource: null,
      settlement: null,
      timeoutSeconds: 30,
      unattended: 'continue',
    }).countdownNotice,
    projectComposerQuestionCard({
      hold: null,
      remainingSeconds: 12,
      resolutionSource: null,
      settlement: null,
      timeoutSeconds: null,
      unattended: 'hold',
    }).holdNotice,
    projectComposerQuestionCard({
      hold: null,
      remainingSeconds: 0,
      resolutionSource: 'core_timeout',
      settlement: null,
      timeoutSeconds: 30,
      unattended: 'continue',
    }).settledNotice,
    projectComposerQuestionCard({
      hold: null,
      remainingSeconds: 0,
      resolutionSource: 'core_hold_expired',
      settlement: null,
      timeoutSeconds: null,
      unattended: 'hold',
    }).settledNotice,
  ];
  for (const sentence of copy.filter((value): value is string =>
    Boolean(value)
  )) {
    assert.deepEqual(cardLanguageIssues(sentence), []);
  }
});
