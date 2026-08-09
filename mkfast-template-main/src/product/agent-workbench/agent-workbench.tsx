/**
 * Production host for Agent Workstream (V31-05 Thread-root).
 *
 * Restore policy (V3.1 §4–§5.1 / §27.6):
 * 1. explicit threadId (URL) wins
 * 2. else WorkbenchSessionProjection decides Idle vs resume active/recent
 * 3. explicit taskId is preserved independently (Work deep link)
 * Work inline projection stays available via processSlot.
 * Living Plan (V31-10) mounts inside Workstream when plan.* events land.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { queryP1 } from '@/p1/client';

import type { OutcomeSelfReportChipSignal } from '@meiye/contracts';
import type {
  InterruptPayload,
  ResumeInterruptCommand,
} from '@meiye/contracts';

import { MemoryInjectionReceiptPanel } from '@/product/memory-injection-receipt';

import {
  applyLiveSemanticEvent,
  reconnectAgentWorkbench,
  type AgentReplayLoader,
} from './agent-event-client';
import type { AgentLiveSubscriber } from './agent-event-transport';
import {
  getAgentWorkbenchHostStore,
  useAgentWorkbenchDispatch,
  useAgentWorkbenchState,
} from './agent-event-store';
import { AgentWorkstream } from './agent-workstream';
import {
  IdleGoalProactivePanel,
  type IdleGoalProactiveLoader,
} from './idle-goal-proactive';
import type { WorkstreamMobilePane } from './mobile-workstream-switch';
import type { CommitStripAction, CommitStripView } from './plan';
import { registerPlanSurfaces } from './plan/register-plan-surfaces';
import type { PublishHandoffPanelView } from './publish-handoff';
import {
  listPendingInterrupts,
  resumePendingInterrupt,
} from './typed-interrupt-client';
import {
  workbenchRootMode,
  type WorkbenchSessionResolveResponse,
} from './thread-session';

// Production bootstrap: plan surfaces must be registered before any stream
// resolveControlledSurface call (V31-10 acceptance: real Workstream path).
registerPlanSurfaces();

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
  /** Authenticated live semantic subscriber, resumed from replay cursors. */
  subscribeLive?: AgentLiveSubscriber;
  /**
   * V31-24: Idle first-screen Goal + proactive suggestions loader.
   * Only used when WorkbenchSessionProjection is Idle.
   */
  loadIdleGoalProactive?: IdleGoalProactiveLoader;
  /** When false, skip Idle goal/proactive panel (tests). Default true. */
  enableIdleGoalProactive?: boolean;
  onAcceptProactiveSuggestion?: (input: {
    candidateId: string;
    threadId: string;
    runId: string;
  }) => void;
  viewport?: 'mobile' | 'desktop';
  worksSlot?: React.ReactNode;
  /** Work inline projection / legacy conversation stream. */
  processSlot?: React.ReactNode;
  /** Compact Plan mode (Brief/quote/confirm unified strip). */
  livingPlanCompact?: boolean;
  livingPlanCommitStrip?: CommitStripView;
  onLivingPlanCommitAction?: (action: CommitStripAction) => void;
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
    signal: OutcomeSelfReportChipSignal
  ) => void | Promise<void>;
  onSelfReportIgnore?: () => void | Promise<void>;
  className?: string;
  loadPendingInterrupts?: (input: {
    threadId?: string;
    signal?: AbortSignal;
  }) => Promise<InterruptPayload[]>;
  resumeInterrupt?: (input: {
    interrupt: InterruptPayload;
    type: ResumeInterruptCommand['type'];
  }) => Promise<unknown>;
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
  subscribeLive,
  loadIdleGoalProactive,
  enableIdleGoalProactive = true,
  onAcceptProactiveSuggestion,
  viewport = 'desktop',
  worksSlot,
  processSlot,
  livingPlanCompact = false,
  livingPlanCommitStrip,
  onLivingPlanCommitAction,
  publishHandoffView = null,
  selfReportPrompt = null,
  selfReportChips,
  onPublishHandoffCopy,
  onPublishHandoffDownloadZip,
  onPublishHandoffRecordPublished,
  onSelfReportChip,
  onSelfReportIgnore,
  className,
  loadPendingInterrupts = listPendingInterrupts,
  resumeInterrupt = resumePendingInterrupt,
}: AgentWorkbenchHostProps) {
  const store = getAgentWorkbenchHostStore();
  const state = useAgentWorkbenchState(store);
  const dispatch = useAgentWorkbenchDispatch(store);
  const [interruptError, setInterruptError] = useState<string | null>(null);
  const [resumingInterruptId, setResumingInterruptId] = useState<string | null>(
    null
  );
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

  const refreshPendingInterrupts = useCallback(
    async (signal?: AbortSignal) => {
      const pending = await loadPendingInterrupts({
        ...(explicitThreadId ? { threadId: explicitThreadId } : {}),
        ...(signal ? { signal } : {}),
      });
      store.dispatch({
        type: 'set_pending_interrupts',
        interrupts: pending.map((interrupt) => ({
          interruptId: interrupt.interruptId,
          interruptType: interrupt.action,
          description: interrupt.description,
          revision: interrupt.revision,
          schemaVersion: interrupt.schemaVersion,
          allowAccept: interrupt.config.allowAccept,
          allowReject: interrupt.config.allowReject,
          streamOffset: '0',
        })),
      });
      return pending;
    },
    [explicitThreadId, loadPendingInterrupts, store]
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshPendingInterrupts(controller.signal).catch((error) => {
      if (!controller.signal.aborted) {
        setInterruptError(
          error instanceof Error ? error.message : '待处理确认加载失败'
        );
      }
    });
    return () => controller.abort();
  }, [refreshPendingInterrupts]);

  const handleInterruptResume = useCallback(
    async (
      projection: import('./agent-event-reducer').InterruptProjection,
      type: ResumeInterruptCommand['type']
    ) => {
      setInterruptError(null);
      setResumingInterruptId(projection.interruptId);
      try {
        const pending = await loadPendingInterrupts({
          ...(explicitThreadId ? { threadId: explicitThreadId } : {}),
        });
        const exact = pending.find(
          (candidate) =>
            candidate.interruptId === projection.interruptId &&
            candidate.revision === projection.revision
        );
        if (!exact) {
          throw new Error('待处理确认已变化，请刷新后重试。');
        }
        await resumeInterrupt({ interrupt: exact, type });
        await refreshPendingInterrupts();
      } catch (error) {
        setInterruptError(
          error instanceof Error ? error.message : '确认恢复失败'
        );
      } finally {
        setResumingInterruptId(null);
      }
    },
    [
      explicitThreadId,
      loadPendingInterrupts,
      refreshPendingInterrupts,
      resumeInterrupt,
    ]
  );

  useEffect(() => {
    const threadId = state.session?.threadId;
    if (
      !subscribeLive ||
      !loadReplay ||
      !threadId ||
      state.connection !== 'live'
    ) {
      return;
    }
    const controller = new AbortController();
    const cursor = store.getState();
    void subscribeLive({
      threadId,
      lastEventId: cursor.lastEventId,
      lastStreamOffset: cursor.lastStreamOffset,
      signal: controller.signal,
      onEvent: async (event) => {
        const applied = applyLiveSemanticEvent(store, event);
        if (applied.ok || controller.signal.aborted) return;
        await reconnectAgentWorkbench({
          store,
          loadReplay,
          resourceId: store.getState().session?.resourceId,
          threadId,
        });
      },
    }).catch(() => {
      if (!controller.signal.aborted) {
        store.dispatch({ type: 'set_connection', connection: 'offline' });
      }
    });
    return () => controller.abort();
  }, [
    loadReplay,
    state.connection,
    state.session?.threadId,
    store,
    subscribeLive,
  ]);

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
      {rootMode === 'idle' && enableIdleGoalProactive ? (
        <IdleGoalProactivePanel
          loadProjection={loadIdleGoalProactive}
          onAccept={onAcceptProactiveSuggestion}
        />
      ) : null}
      {/* V31-18: injection receipt visibility on the task-detail surface.
       * explicitTaskId is the only task-scoped identity the host owns; the
       * panel no-ops when the task has no receipt yet. */}
      {explicitTaskId ? (
        <MemoryInjectionReceiptPanel taskId={explicitTaskId} />
      ) : null}
      <AgentWorkstream
        className={className}
        livingPlanCommitStrip={livingPlanCommitStrip}
        livingPlanCompact={livingPlanCompact}
        onArtifactViewRevision={(artifactId, revision) =>
          dispatch({
            type: 'set_artifact_viewing_revision',
            artifactId,
            revision,
          })
        }
        onLivingPlanCommitAction={onLivingPlanCommitAction}
        interruptError={interruptError}
        onInterruptResume={handleInterruptResume}
        resumingInterruptId={resumingInterruptId}
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
