/**
 * Production host for Agent Workstream (V31-05 Thread-root).
 *
 * Restore policy (V3.1 §4–§5.1 / §27.6):
 * 1. explicit threadId (URL) wins
 * 2. else WorkbenchSessionProjection decides Idle vs resume active/recent
 * 3. explicit taskId is preserved independently (Work deep link)
 * Work inline projection stays available via processSlot.
 */

import { useEffect, useRef } from 'react';

import { queryP1 } from '@/p1/client';

import type { OutcomeSelfReportChipSignal } from '@meiye/contracts';

import {
  reconnectAgentWorkbench,
  type AgentReplayLoader,
} from './agent-event-client';
import {
  getAgentWorkbenchHostStore,
  useAgentWorkbenchDispatch,
  useAgentWorkbenchState,
} from './agent-event-store';
import { AgentWorkstream } from './agent-workstream';
import type { WorkstreamMobilePane } from './mobile-workstream-switch';
import type { PublishHandoffPanelView } from './publish-handoff';
import {
  workbenchRootMode,
  type WorkbenchSessionResolveResponse,
} from './thread-session';

export type AgentWorkbenchSessionLoader = (input: {
  explicitThreadId: string | null;
}) => Promise<WorkbenchSessionResolveResponse>;

export type AgentWorkbenchHostProps = {
  /** §4: URL / route threadId takes priority over auto-resume. */
  explicitThreadId?: string | null;
  /** §27.6: URL / route taskId takes priority over recent-task recovery. */
  explicitTaskId?: string | null;
  /**
   * When true (default), host resolves WorkbenchSessionProjection on mount /
   * threadId change. Tests can inject `loadSession` or set false.
   */
  enableSessionRestore?: boolean;
  loadSession?: AgentWorkbenchSessionLoader;
  /** Optional semantic replay package loader (snapshot+events). */
  loadReplay?: AgentReplayLoader;
  viewport?: 'mobile' | 'desktop';
  worksSlot?: React.ReactNode;
  /** Work inline projection / legacy conversation stream. */
  processSlot?: React.ReactNode;
  /** V31-17 Delivered publish handoff materials (production path). */
  publishHandoffView?: PublishHandoffPanelView | null;
  selfReportPrompt?: string | null;
  selfReportChips?: readonly OutcomeSelfReportChipSignal[];
  onPublishHandoffCopy?: (role: string, value: string) => void;
  onPublishHandoffDownloadZip?: (fileName: string) => void | Promise<void>;
  onPublishHandoffRecordPublished?: (input: {
    contentPackageId: string;
    contentPackageRevision: number;
    platformUrl?: string;
    note?: string;
  }) => void | Promise<void>;
  onSelfReportChip?: (
    signal: OutcomeSelfReportChipSignal,
  ) => void | Promise<void>;
  onSelfReportIgnore?: () => void | Promise<void>;
  className?: string;
};

const defaultLoadSession: AgentWorkbenchSessionLoader = async ({
  explicitThreadId,
}) =>
  queryP1<WorkbenchSessionResolveResponse>('agent-session', {
    action: 'get_workbench_session',
    payload: explicitThreadId ? { threadId: explicitThreadId } : {},
  });

export function AgentWorkbenchHost({
  explicitThreadId = null,
  explicitTaskId = null,
  enableSessionRestore = true,
  loadSession = defaultLoadSession,
  loadReplay,
  viewport = 'desktop',
  worksSlot,
  processSlot,
  publishHandoffView = null,
  selfReportPrompt = null,
  selfReportChips,
  onPublishHandoffCopy,
  onPublishHandoffDownloadZip,
  onPublishHandoffRecordPublished,
  onSelfReportChip,
  onSelfReportIgnore,
  className,
}: AgentWorkbenchHostProps) {
  const store = getAgentWorkbenchHostStore();
  const state = useAgentWorkbenchState(store);
  const dispatch = useAgentWorkbenchDispatch(store);
  // Dedupes in-flight / completed restores across Strict Mode remounts.
  const restoreEpochRef = useRef(0);
  const lastRestoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const next = explicitTaskId ?? null;
    if (store.getState().explicitTaskId !== next) {
      store.dispatch({ type: 'set_explicit_task_id', taskId: next });
    }
  }, [explicitTaskId, store]);

  useEffect(() => {
    const next = explicitThreadId ?? null;
    if (store.getState().explicitThreadId !== next) {
      store.dispatch({ type: 'set_explicit_thread_id', threadId: next });
    }
  }, [explicitThreadId, store]);

  useEffect(() => {
    if (!enableSessionRestore) return;

    const restoreKey = `thread:${explicitThreadId ?? ''}`;
    if (lastRestoredKeyRef.current === restoreKey) return;

    const epoch = ++restoreEpochRef.current;
    store.dispatch({ type: 'set_connection', connection: 'connecting' });

    void (async () => {
      try {
        const resolved = await loadSession({
          explicitThreadId: explicitThreadId ?? null,
        });
        if (epoch !== restoreEpochRef.current) return;

        store.dispatch({
          type: 'set_resolve_source',
          resolveSource: resolved.resolveSource,
        });

        if (!resolved.session) {
          store.dispatch({ type: 'set_session', session: null });
          store.dispatch({ type: 'set_connection', connection: 'live' });
          lastRestoredKeyRef.current = restoreKey;
          return;
        }

        if (loadReplay) {
          await reconnectAgentWorkbench({
            store,
            loadReplay,
            resourceId: resolved.session.resourceId,
            threadId: resolved.session.threadId,
          });
          if (epoch !== restoreEpochRef.current) return;
          store.dispatch({
            type: 'set_resolve_source',
            resolveSource: resolved.resolveSource,
          });
          lastRestoredKeyRef.current = restoreKey;
          return;
        }

        // No replay loader yet (semantic stream host lands progressively):
        // still anchor the host on the resolved Thread.
        store.dispatch({ type: 'set_session', session: resolved.session });
        store.dispatch({ type: 'set_connection', connection: 'live' });
        lastRestoredKeyRef.current = restoreKey;
      } catch {
        if (epoch !== restoreEpochRef.current) return;
        // Explicit miss or transport error: stay offline so the host can retry.
        store.dispatch({ type: 'set_connection', connection: 'offline' });
      }
    })();
  }, [enableSessionRestore, explicitThreadId, loadReplay, loadSession, store]);

  const rootMode = workbenchRootMode({
    session: state.session,
    resolveSource: state.resolveSource,
  });

  return (
    <div
      data-resolve-source={state.resolveSource ?? 'unset'}
      data-testid="agent-workbench-host"
      data-thread-id={state.session?.threadId ?? ''}
      data-workbench-root={rootMode}
    >
      <AgentWorkstream
        className={className}
        onArtifactViewRevision={(artifactId, revision) =>
          dispatch({
            type: 'set_artifact_viewing_revision',
            artifactId,
            revision,
          })
        }
        onMobilePaneChange={(pane: WorkstreamMobilePane) =>
          dispatch({ type: 'set_mobile_pane', pane })
        }
        onPublishHandoffCopy={onPublishHandoffCopy}
        onPublishHandoffDownloadZip={onPublishHandoffDownloadZip}
        onPublishHandoffRecordPublished={onPublishHandoffRecordPublished}
        onSelfReportChip={onSelfReportChip}
        onSelfReportIgnore={onSelfReportIgnore}
        onToggleActivity={(activityId) =>
          dispatch({ type: 'toggle_activity_collapsed', activityId })
        }
        processSlot={processSlot}
        publishHandoffView={publishHandoffView}
        selfReportChips={selfReportChips}
        selfReportPrompt={selfReportPrompt}
        state={state}
        viewport={viewport}
        worksSlot={worksSlot}
      />
    </div>
  );
}
