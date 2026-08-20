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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { queryP1 } from '@/p1/client';

import { boundWorkbenchTaskId } from './agent-event-reducer';

import type { OutcomeSelfReportChipSignal } from '@meiye/contracts';
import type {
  InterruptPayload,
  ResumeInterruptCommand,
} from '@meiye/contracts';

import {
  reconnectAgentWorkbench,
  startWorkbenchReplayPoll,
  type AgentReplayLoader,
} from './agent-event-client';
import type { AgentLiveSubscriber } from './agent-event-transport';
import { runAgentLiveReconnectLoop } from './agent-live-reconnect';
import {
  createAgentWorkbenchIdentity,
  isSameAgentWorkbenchIdentity,
} from './agent-workbench-identity';
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
import type { PublishHandoffPanelView } from './publish-handoff';
import {
  listPendingInterrupts,
  resumePendingInterrupt,
} from './typed-interrupt-client';
import {
  workbenchRootMode,
  type WorkbenchSessionResolveResponse,
} from './thread-session';

export type AgentWorkbenchSessionLoader = (input: {
  explicitThreadId: string | null;
}) => Promise<WorkbenchSessionResolveResponse>;

export type AgentWorkbenchHostProps = {
  /** Better Auth account boundary for the active tab projection. */
  accountId?: string | null;
  /** Authenticated product workspace boundary for the active tab projection. */
  workspaceId?: string | null;
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
  excludeNarrativeTexts?: readonly string[];
  /** Compact Plan mode (Brief/quote/confirm unified strip). */
  livingPlanCompact?: boolean;
  livingPlanCommitStrip?: CommitStripView;
  onLivingPlanCommitAction?: (action: CommitStripAction) => void;
  confirmationRequestId?: string | null;
  requiresMerchantConfirmation?: boolean;
  /** Composer session phase delivered — Workstream `data-delivered` source. */
  sessionDelivered?: boolean;
  /** V31-17 Delivered publish handoff materials (production path). */
  publishHandoffError?: string | null;
  publishHandoffView?: PublishHandoffPanelView | null;
  selfReportPrompt?: string | null;
  selfReportChips?: readonly OutcomeSelfReportChipSignal[];
  onPublishHandoffCopy?: (
    role: string,
    value: string
  ) => boolean | Promise<boolean>;
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
  accountId = null,
  workspaceId = null,
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
  excludeNarrativeTexts,
  livingPlanCompact = false,
  livingPlanCommitStrip,
  onLivingPlanCommitAction,
  confirmationRequestId = null,
  requiresMerchantConfirmation = false,
  sessionDelivered = false,
  publishHandoffError = null,
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
  const previousExplicitThreadIdRef = useRef<string | null>(
    explicitThreadId ?? null
  );
  const normalizedBoundary = useMemo(
    () => createAgentWorkbenchIdentity({ accountId, workspaceId }),
    [accountId, workspaceId]
  );
  const explicitTargetChanged =
    previousExplicitThreadIdRef.current !== (explicitThreadId ?? null);
  const canReuseResolvedThread =
    !explicitTargetChanged &&
    store.getState().identity.accountId === normalizedBoundary.accountId &&
    store.getState().identity.workspaceId === normalizedBoundary.workspaceId;
  const identity = useMemo(
    () =>
      createAgentWorkbenchIdentity({
        accountId: normalizedBoundary.accountId,
        workspaceId: normalizedBoundary.workspaceId,
        threadId:
          explicitThreadId ??
          (canReuseResolvedThread ? store.getState().identity.threadId : null),
      }),
    [
      canReuseResolvedThread,
      explicitThreadId,
      normalizedBoundary.accountId,
      normalizedBoundary.workspaceId,
      store,
      state.identity.threadId,
    ]
  );

  // Identity replacement is a store-owner invariant, not a logout UI patch.
  // Layout timing ensures the old projection cannot survive a painted frame.
  useLayoutEffect(() => {
    previousExplicitThreadIdRef.current = explicitThreadId ?? null;
    if (isSameAgentWorkbenchIdentity(store.getState().identity, identity)) {
      return;
    }
    // Invalidate an earlier account/Thread request before its promise can
    // hydrate into the newly-bound empty store.
    restoreEpochRef.current += 1;
    lastRestoredKeyRef.current = null;
    store.dispatch({ type: 'bind_identity', identity });
    setInterruptError(null);
    setResumingInterruptId(null);
  }, [explicitThreadId, identity, store]);

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

    const restoreKeyForThread = (threadId: string | null) =>
      [
        `account:${identity.accountId ?? ''}`,
        `workspace:${identity.workspaceId ?? ''}`,
        `thread:${threadId ?? ''}`,
      ].join('|');
    const restoreKey = restoreKeyForThread(identity.threadId);
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
          lastRestoredKeyRef.current = restoreKeyForThread(null);
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
          lastRestoredKeyRef.current = restoreKeyForThread(
            resolved.session.threadId
          );
          return;
        }

        // No replay loader yet (semantic stream host lands progressively):
        // still anchor the host on the resolved Thread.
        store.dispatch({ type: 'set_session', session: resolved.session });
        store.dispatch({ type: 'set_connection', connection: 'live' });
        lastRestoredKeyRef.current = restoreKeyForThread(
          resolved.session.threadId
        );
      } catch {
        if (epoch !== restoreEpochRef.current) return;
        // Explicit miss or transport error: stay offline so the host can retry.
        store.dispatch({ type: 'set_connection', connection: 'offline' });
      }
    })();
  }, [
    enableSessionRestore,
    explicitThreadId,
    identity.accountId,
    identity.threadId,
    identity.workspaceId,
    loadReplay,
    loadSession,
    store,
  ]);

  const refreshPendingInterrupts = useCallback(
    async (signal?: AbortSignal) => {
      const pendingThreadId = explicitThreadId ?? identity.threadId;
      const pending = await loadPendingInterrupts({
        ...(pendingThreadId ? { threadId: pendingThreadId } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!isSameAgentWorkbenchIdentity(store.getState().identity, identity)) {
        return [];
      }
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
    [
      explicitThreadId,
      identity.accountId,
      identity.threadId,
      identity.workspaceId,
      loadPendingInterrupts,
      store,
    ]
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
    if (!subscribeLive || !loadReplay || !threadId) return;
    const controller = new AbortController();
    void runAgentLiveReconnectLoop({
      store,
      loadReplay,
      subscribeLive,
      threadId,
      signal: controller.signal,
      resourceId: state.session?.resourceId,
      onlineTarget: window,
    });
    return () => controller.abort();
  }, [
    loadReplay,
    state.session?.resourceId,
    state.session?.threadId,
    store,
    subscribeLive,
  ]);

  useEffect(() => {
    if (subscribeLive || !loadReplay) return;
    const threadId = state.session?.threadId;
    if (!threadId) return;
    return startWorkbenchReplayPoll({
      loadReplay,
      resourceId: state.session?.resourceId,
      store,
      threadId,
    });
  }, [
    loadReplay,
    state.session?.resourceId,
    state.session?.threadId,
    store,
    subscribeLive,
  ]);

  const rootMode = workbenchRootMode({
    session: state.session,
    resolveSource: state.resolveSource,
  });
  const receiptTaskId = boundWorkbenchTaskId(state);

  return (
    <div
      data-resolve-source={state.resolveSource ?? 'unset'}
      data-task-id={receiptTaskId ?? ''}
      data-testid="agent-workbench-host"
      data-thread-id={state.session?.threadId ?? ''}
      data-workbench-root={rootMode}
    >
      {rootMode === 'idle' && enableIdleGoalProactive ? (
        <IdleGoalProactivePanel
          loadProjection={loadIdleGoalProactive}
          onAccept={onAcceptProactiveSuggestion}
        />
      ) : rootMode === 'idle' ? (
        <section data-state="off" data-testid="idle-goal-proactive" hidden />
      ) : null}
      <AgentWorkstream
        className={className}
        confirmationRequestId={confirmationRequestId}
        livingPlanCommitStrip={livingPlanCommitStrip}
        livingPlanCompact={livingPlanCompact}
        requiresMerchantConfirmation={requiresMerchantConfirmation}
        sessionDelivered={sessionDelivered}
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
        excludeNarrativeTexts={excludeNarrativeTexts}
        processSlot={processSlot}
        publishHandoffError={publishHandoffError}
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
