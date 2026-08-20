/**
 * V31-82 / W03: terminal work unlocks the Composer except a failed run that
 * still shows a 申报卡. Retry needs that frozen sentence; 改一下要求 thaws.
 */
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

function runningSession() {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-1'), '做一组美甲套图'),
    TASK
  );
}

function failedReportSession() {
  return applyComposerWorkflowState(
    runningSession(),
    'failed',
    undefined,
    undefined,
    FAILURE_REPORT
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

  it('keeps the intent box locked after a failed run with a 申报卡', () => {
    const failed = failedReportSession();
    expect(composerFailureLocksIntent(failed)).toBe(true);
    render(promptBar(failed));
    expect(screen.getByTestId('composer-intent-input')).toBeDisabled();
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
