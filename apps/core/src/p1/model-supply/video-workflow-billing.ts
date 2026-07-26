import type { DurableVideoWorkflow } from './video-workflow-contract.js';

export interface VideoWorkflowTerminalObserver {
  settle(workflow: DurableVideoWorkflow): Promise<unknown> | unknown;
}

/** Runs independent terminal observers in order so replay preserves settlement ordering. */
export function composeVideoTerminalObservers(
  ...observers: VideoWorkflowTerminalObserver[]
): VideoWorkflowTerminalObserver {
  return {
    async settle(workflow) {
      const results = [];
      for (const observer of observers) {
        results.push(await observer.settle(workflow));
      }
      return results;
    },
  };
}
