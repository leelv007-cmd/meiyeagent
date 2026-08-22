/**
 * V31-82 / W03: terminal work unlocks the Composer except a failed run whose
 * 申报卡 offers 再生成一次 — that retry needs the frozen sentence. A 申报 with no
 * retry (有界超时) and 改一下要求 both thaw.
 */
import type { MerchantReport } from '@meiye/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ComposerPromptBar } from './composer-conversation';
import {
  applyComposerWorkflowState,
  bindComposerTask,
  cancelComposerSession,
  composerFailureLocksIntent,
  createComposerSession,
  failComposerSession,
  openComposerTurn,
  rebindComposerSession,
  type ComposerSession,
} from './composer-session';
import { isWorkbenchEngaged } from './workbench-state';

afterEach(cleanup);

const TASK = { taskId: 'task-1', workId: 'work-1', packageId: 'package-1' };

const FAILURE_REPORT = {
  kind: 'failure' as const,
  category: 'content_source' as const,
  message: '这次的说法在门店资料里找不到依据，所以没有交付。',
  nextStep: '改一下要求后再来一次。',
  actions: ['adjust_intent' as const, 'retry' as const],
  quotaRefunded: true,
};

/**
 * V31-82 有界超时. Core maps WORK_EXECUTION_STALLED to a 申报 with no 再生成一次
 * (apps/core/src/p1/harness/merchant-delivery-language.ts), so nothing here
 * needs the sentence held still — the merchant's only way forward is to edit it.
 */
const STALLED_REPORT = {
  kind: 'failure' as const,
  category: 'unknown' as const,
  message: '这次创作超时没有完成，积分已经退回。',
  nextStep: '请返回工作台重新发起本次创作。',
  actions: ['adjust_intent' as const],
  quotaRefunded: true,
};

function runningSession() {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-1'), '做一组美甲套图'),
    TASK
  );
}

function failedReportSession(report: MerchantReport = FAILURE_REPORT) {
  return applyComposerWorkflowState(
    runningSession(),
    'failed',
    undefined,
    undefined,
    report
  );
}

function promptBar(session: ComposerSession) {
  return (
    <ComposerPromptBar
      ariaLabel="描述这次想创作的内容"
      destination={null}
      destinationCapability={null}
      disabled={composerFailureLocksIntent(session)}
      onDestinationChange={() => {}}
      onReuseChip={() => {}}
      onSubmit={() => {}}
      onValueChange={() => {}}
      placeholder="说说想发什么"
      reuseChips={[]}
      running={isWorkbenchEngaged(session.phase)}
      signedPreview={null}
      submitDisabled={false}
      submitLabel="开始创作"
      value="做一组美甲套图"
    />
  );
}

describe('terminal work unlocks Composer', () => {
  it('locks the intent box while the work is running', () => {
    const session = runningSession();
    render(promptBar(session));
    expect(screen.getByTestId('composer-intent-input')).toBeDisabled();
  });

  it('keeps the intent box locked after a 申报卡 that offers 再生成一次', () => {
    // The retry action is what buys the freeze: 再生成一次 resubmits this exact
    // sentence, so an editable box would send something the card never named.
    expect(FAILURE_REPORT.actions).toContain('retry');
    const failed = failedReportSession();
    expect(composerFailureLocksIntent(failed)).toBe(true);
    render(promptBar(failed));
    expect(screen.getByTestId('composer-intent-input')).toBeDisabled();
  });

  it('unlocks after a 申报卡 whose only way forward is 改一下要求', () => {
    // V31-82: the bounded timeout refunds and sends the merchant back to edit.
    // Freezing here would leave a sentence that can be neither changed nor
    // resent — the failure would read as terminal for the whole composer.
    expect(STALLED_REPORT.actions).not.toContain('retry');
    const stalled = failedReportSession(STALLED_REPORT);
    expect(
      stalled.turns.some((turn) => turn.kind === 'report'),
      '超时同样落了一张申报卡，解锁不能靠「没有申报」来实现'
    ).toBe(true);
    expect(composerFailureLocksIntent(stalled)).toBe(false);
    render(promptBar(stalled));
    expect(screen.getByTestId('composer-intent-input')).not.toBeDisabled();
  });

  it('改一下要求 (rebind) hands the composer back', () => {
    const rebound = rebindComposerSession(failedReportSession(), 'session-2');
    expect(composerFailureLocksIntent(rebound)).toBe(false);
    render(promptBar(rebound));
    expect(screen.getByTestId('composer-intent-input')).not.toBeDisabled();
  });

  it('unlocks after cancel, and after a rejected send with no 申报', () => {
    expect(
      composerFailureLocksIntent(failComposerSession(runningSession()))
    ).toBe(false);
    const cancelled = cancelComposerSession(runningSession());
    expect(isWorkbenchEngaged(cancelled.phase)).toBe(false);
    expect(composerFailureLocksIntent(cancelled)).toBe(false);
    render(promptBar(cancelled));
    expect(screen.getByTestId('composer-intent-input')).not.toBeDisabled();
  });
});
