/**
 * V31-82: a terminal work (failed / cancelled / timeout) must unlock the
 * Composer textbox so the merchant can start the next run.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ComposerPromptBar } from './composer-conversation';
import {
  applyComposerWorkflowState,
  bindComposerTask,
  cancelComposerSession,
  createComposerSession,
  failComposerSession,
  openComposerTurn,
} from './composer-session';
import { isWorkbenchEngaged } from './workbench-state';

afterEach(cleanup);

const TASK = { taskId: 'task-1', workId: 'work-1', packageId: 'package-1' };

function runningSession() {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-1'), '做一组美甲套图'),
    TASK
  );
}

function promptBar(running: boolean) {
  return (
    <ComposerPromptBar
      ariaLabel="描述这次想创作的内容"
      destination={null}
      destinationCapability={null}
      disabled={false}
      onDestinationChange={() => {}}
      onReuseChip={() => {}}
      onSubmit={() => {}}
      onValueChange={() => {}}
      placeholder="说说想发什么"
      reuseChips={[]}
      running={running}
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
    render(promptBar(isWorkbenchEngaged(session.phase)));
    expect(screen.getByTestId('composer-intent-input')).toBeDisabled();
  });

  it('unlocks after a failed terminal (timeout included)', () => {
    const failed = applyComposerWorkflowState(runningSession(), 'failed');
    expect(isWorkbenchEngaged(failed.phase)).toBe(false);
    render(promptBar(isWorkbenchEngaged(failed.phase)));
    expect(screen.getByTestId('composer-intent-input')).not.toBeDisabled();
  });

  it('unlocks after failComposerSession and cancelComposerSession', () => {
    expect(
      isWorkbenchEngaged(failComposerSession(runningSession()).phase)
    ).toBe(false);
    const cancelled = cancelComposerSession(runningSession());
    expect(isWorkbenchEngaged(cancelled.phase)).toBe(false);
    render(promptBar(isWorkbenchEngaged(cancelled.phase)));
    expect(screen.getByTestId('composer-intent-input')).not.toBeDisabled();
  });
});
