/**
 * ARCH-07A thread/session/submit controller.
 *
 * Public seam: overlay a local ComposerSession from AgentEventStore (accept /
 * interrupt), and submit the 202 run. The adapter is read-only — this module
 * never writes the overlay back through setSession.
 */

import type { AgentWorkbenchClientState } from '@/product/agent-workbench/agent-event-reducer';

import {
  composerPendingInterruptGate,
  isComposerClarificationInterrupt,
} from './composer-pending-interrupt-gate';
import type { ComposerSession } from './composer-session';
import {
  projectComposerSessionFromThread,
  projectComposerThread,
} from './composer-thread-adapter';
import { useComposerRun, type UseComposerRunOptions } from './use-composer-run';

export type ComposerThreadSessionView = {
  pendingClarification:
    | AgentWorkbenchClientState['pendingInterrupts'][number]
    | null;
  pendingInterruptGate: ReturnType<typeof composerPendingInterruptGate>;
  session: ComposerSession;
  thread: ReturnType<typeof projectComposerThread>;
};

export function readComposerThreadSession(
  localSession: ComposerSession,
  workbench: AgentWorkbenchClientState
): ComposerThreadSessionView {
  return {
    pendingClarification:
      workbench.pendingInterrupts.find(isComposerClarificationInterrupt) ??
      null,
    pendingInterruptGate: composerPendingInterruptGate(
      workbench.pendingInterrupts.filter(
        (interrupt) => !isComposerClarificationInterrupt(interrupt)
      ).length
    ),
    session: projectComposerSessionFromThread(localSession, workbench),
    thread: projectComposerThread(workbench),
  };
}

export function useComposerThreadController(options: UseComposerRunOptions) {
  return useComposerRun(options);
}
