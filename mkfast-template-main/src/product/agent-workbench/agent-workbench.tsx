/**
 * Production host for Agent Workstream (V31-04 + V31-10 Living Plan).
 * Wires host store + reconnect preference (explicit taskId) into the dashboard
 * create axis. Living Plan mounts inside Workstream when plan.* events land.
 */

import { useEffect } from 'react';

import {
  getAgentWorkbenchHostStore,
  useAgentWorkbenchDispatch,
  useAgentWorkbenchState,
} from './agent-event-store';
import { AgentWorkstream } from './agent-workstream';
import type { WorkstreamMobilePane } from './mobile-workstream-switch';
import type { CommitStripAction, CommitStripView } from './plan';
import { registerPlanSurfaces } from './plan/register-plan-surfaces';

// Production bootstrap: plan surfaces must be registered before any stream
// resolveControlledSurface call (V31-10 acceptance: real Workstream path).
registerPlanSurfaces();

export type AgentWorkbenchHostProps = {
  /** §27.6: URL / route taskId takes priority over recent-task recovery. */
  explicitTaskId?: string | null;
  viewport?: 'mobile' | 'desktop';
  worksSlot?: React.ReactNode;
  processSlot?: React.ReactNode;
  /** Compact Plan mode (Brief/quote/confirm unified strip). */
  livingPlanCompact?: boolean;
  livingPlanCommitStrip?: CommitStripView;
  onLivingPlanCommitAction?: (action: CommitStripAction) => void;
  className?: string;
};

export function AgentWorkbenchHost({
  explicitTaskId = null,
  viewport = 'desktop',
  worksSlot,
  processSlot,
  livingPlanCompact = false,
  livingPlanCommitStrip,
  onLivingPlanCommitAction,
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
      livingPlanCommitStrip={livingPlanCommitStrip}
      livingPlanCompact={livingPlanCompact}
      onLivingPlanCommitAction={onLivingPlanCommitAction}
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
