export const PENDING_INTERRUPT_SUBMIT_HINT =
  '请先处理上方待确认事项，再开始新的创作。';

/** Composer's own clarification is answered through the intent input. */
export function isComposerClarificationInterrupt(input: {
  interruptType: string;
  interruptId?: string;
}): boolean {
  // In-run ask_merchant (图文方向) is also `answer_question`. Only the
  // Living Plan clarification (`composer-question:…`) is typed into the box.
  return (
    input.interruptType === 'answer_question' &&
    (input.interruptId?.startsWith('composer-question:') ?? false)
  );
}

export function composerPendingInterruptGate(count: number): {
  blocked: boolean;
  hint: string | null;
} {
  return count > 0
    ? { blocked: true, hint: PENDING_INTERRUPT_SUBMIT_HINT }
    : { blocked: false, hint: null };
}

/**
 * V31-28: a pending plan clarification turns the send button into the answer
 * button (`submitPlanCommand` intercepts the press). The submission gates —
 * missing lens, frozen lens state, settled quote, uploads — govern a *new*
 * run, and after a submission they are all engaged, which used to leave the
 * clarification's own instruction (「请在下方输入框补充信息后发送」) pointing at
 * a button that could never be pressed. Busy/interrupt blocks still apply:
 * they mean the answer itself cannot be accepted right now.
 */
export function composerSubmitDisabledGate(input: {
  answeringClarification: boolean;
  busyBlocked: boolean;
  submissionBlocked: boolean;
}): boolean {
  return (
    input.busyBlocked ||
    (!input.answeringClarification && input.submissionBlocked)
  );
}
