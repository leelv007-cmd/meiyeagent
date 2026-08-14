import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerPendingInterruptGate,
  composerSubmitDisabledGate,
  isComposerClarificationInterrupt,
} from './composer-pending-interrupt-gate';

test('V31-28: a pending plan clarification bypasses the submission gates so the answer stays pressable', () => {
  // After a submission every submission gate is engaged (frozen lens, settled
  // quote) — exactly the state the clarification is answered from.
  assert.equal(
    composerSubmitDisabledGate({
      answeringClarification: true,
      busyBlocked: false,
      submissionBlocked: true,
    }),
    false
  );
  // A reloaded tab has no lens chosen either; the answer must not require one.
  assert.equal(
    composerSubmitDisabledGate({
      answeringClarification: true,
      busyBlocked: false,
      submissionBlocked: false,
    }),
    false
  );
});

test('V31-28: busy blocks still hold while answering; submissions keep every gate', () => {
  assert.equal(
    composerSubmitDisabledGate({
      answeringClarification: true,
      busyBlocked: true,
      submissionBlocked: false,
    }),
    true
  );
  assert.equal(
    composerSubmitDisabledGate({
      answeringClarification: false,
      busyBlocked: false,
      submissionBlocked: true,
    }),
    true
  );
  assert.equal(
    composerSubmitDisabledGate({
      answeringClarification: false,
      busyBlocked: false,
      submissionBlocked: false,
    }),
    false
  );
});

test('the composer clarification is the only interrupt answered through the intent input', () => {
  assert.equal(
    isComposerClarificationInterrupt({
      interruptType: 'answer_question',
      interruptId: 'composer-question:abc',
    }),
    true
  );
  assert.equal(
    isComposerClarificationInterrupt({
      interruptType: 'answer_question',
      interruptId: 'workflow-1:note-style',
    }),
    false
  );
  assert.equal(
    isComposerClarificationInterrupt({ interruptType: 'answer_question' }),
    false
  );
  assert.equal(
    isComposerClarificationInterrupt({ interruptType: 'approval_required' }),
    false
  );
  assert.deepEqual(composerPendingInterruptGate(0), {
    blocked: false,
    hint: null,
  });
  assert.equal(composerPendingInterruptGate(2).blocked, true);
});
