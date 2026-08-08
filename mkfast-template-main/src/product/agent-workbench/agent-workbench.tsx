/**
 * Production host for Agent Workstream (V31-04).
 * Wires host store + reconnect preference (explicit taskId) into the dashboard
 * create axis. V31-05 will expand Thread-root session restore around this host.
 */

import { useEffect } from 'react';

import {
  getAgentWorkbenchHostStore,
  useAgentWorkbenchDispatch,
  useAgentWorkbenchState,
} from './agent-event-store';
import { AgentWorkstream } from './agent-workstream';
import type { WorkstreamMobilePane } from './mobile-workstream-switch';

export type AgentWorkbenchHostProps = {
  /** §27.6: URL / route taskId takes priority over recent-task recovery. */
  explicitTaskId?: string | null;
  viewport?: 'mobile' | 'desktop';
  worksSlot?: React.ReactNode;
  processSlot?: React.ReactNode;
  className?: string;
};

export function AgentWorkbenchHost({
  explicitTaskId = null,
  viewport = 'desktop',
  worksSlot,
  processSlot,
  className,
}: AgentWorkbenchHostProps) {
  const store = getAgentWorkbenchHostStore();
  const state = useAgentWorkbenchState(store);
  const dispatch = useAgentWorkbenchDispatch(store);

  useEffect(() => {
    if (explicitTaskId === undefined) return;
    const next = explicitTaskId ?? null;
    if (store.getState().explicitTaskId !== next) {
      dispatch({ type: 'set_explicit_task_id', taskId: next });
    }
  }, [dispatch, explicitTaskId, store]);

  return (
    <AgentWorkstream
      className={className}
      onMobilePaneChange={(pane: WorkstreamMobilePane) =>
        dispatch({ type: 'set_mobile_pane', pane })
      }
      onToggleActivity={(activityId) =>
        dispatch({ type: 'toggle_activity_collapsed', activityId })
      }
      processSlot={processSlot}
      state={state}
      viewport={viewport}
      worksSlot={worksSlot}
    />
  );
}
