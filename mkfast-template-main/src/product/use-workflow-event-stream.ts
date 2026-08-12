import {
  contentPackageRevisionDeliverySchema,
  harnessExperienceBasisSchema,
  workflowProgressFrameSchema,
  workflowStateFrameSchema,
  workflowTokenFrameSchema,
  type ContentPackageRevisionDelivery,
  type HarnessExperienceBasis,
  type MerchantReport,
  type WorkflowProgressEnvelope,
  type WorkflowProgressFrame,
  type WorkflowStateEnvelope,
  type WorkflowStateFrame,
  type WorkflowTokenEnvelope,
  type WorkflowTokenFrame,
} from '@meiye/contracts';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { VideoWorkflowEnvelope } from '@/product/video-workflow-model';

type WorkflowEventFrame =
  | WorkflowProgressFrame
  | WorkflowTokenFrame
  | WorkflowStateFrame;

export interface WorkflowCopyTokenDraft {
  candidateId: string;
  title: string;
  body: string;
  conversionHook: string;
}

export interface WorkflowEventCursor {
  sequence?: number;
  sourceRevision?: number;
}

export function parseWorkflowEventFrame(
  event: WorkflowEventFrame['event'],
  rawData: string
): WorkflowEventFrame {
  const raw = { data: JSON.parse(rawData), event };
  if (event === 'workflow.progress') {
    return workflowProgressFrameSchema.parse(raw);
  }
  if (event === 'workflow.token') {
    return workflowTokenFrameSchema.parse(raw);
  }
  return workflowStateFrameSchema.parse(raw);
}

/**
 * V31-28: a merchant-confirmed prepared attempt runs under
 * `${taskId}:plan-r${planRevision}` (composerPreparedAttemptId,
 * apps/core/src/p1/execution-spine/submission-coordinator.ts) while the
 * browser keeps the bare task id its 202 handed back. Server-side reads
 * resolve that split (postgres-store workflowRuntimeId, since 631ca906);
 * this is the client-side counterpart for the SSE gate — without it every
 * progress/token frame of a paid attempt is stamped with the suffixed id
 * and dropped on arrival, so the merchant sees no stage lines and no
 * streaming draft. Exact shapes only: the revision segment must be a bare
 * integer >= 1, so `task-1` never adopts `task-12:plan-r1` frames and
 * foreign tasks stay rejected.
 */
function isPreparedAttemptWorkflowId(
  frameWorkflowId: string,
  workflowId: string
) {
  const marker = `${workflowId}:plan-r`;
  if (!frameWorkflowId.startsWith(marker)) return false;
  return /^[1-9]\d*$/.test(frameWorkflowId.slice(marker.length));
}

export function workflowEventFrameBelongsTo(
  frame: WorkflowEventFrame,
  workflowId: string
) {
  return (
    frame.data.workflowId === workflowId ||
    isPreparedAttemptWorkflowId(frame.data.workflowId, workflowId)
  );
}

export function advanceWorkflowEventCursorForWorkflow(
  current: WorkflowEventCursor | undefined,
  workflowId: string,
  frame: WorkflowEventFrame
) {
  if (!workflowEventFrameBelongsTo(frame, workflowId)) {
    return { accepted: false, cursor: current ?? {} };
  }
  return advanceWorkflowEventCursor(current, frame);
}

export function advanceWorkflowEventCursor(
  current: WorkflowEventCursor | undefined,
  frame: WorkflowEventFrame
) {
  if (frame.event === 'workflow.progress' || frame.event === 'workflow.token') {
    const accepted = frame.data.sequence > (current?.sequence ?? -1);
    return {
      accepted,
      cursor: accepted
        ? { ...current, sequence: frame.data.sequence }
        : (current ?? {}),
    };
  }
  const accepted = frame.data.sourceRevision > (current?.sourceRevision ?? -1);
  return {
    accepted,
    cursor: accepted
      ? { ...current, sourceRevision: frame.data.sourceRevision }
      : (current ?? {}),
  };
}

export function reduceWorkflowCopyTokens(
  current: WorkflowCopyTokenDraft[],
  token: WorkflowTokenEnvelope
) {
  const field = {
    'copy.body': 'body',
    'copy.cta': 'conversionHook',
    'copy.title': 'title',
  }[token.channel] as 'body' | 'conversionHook' | 'title';
  const existing = current.find(
    ({ candidateId }) => candidateId === token.candidateId
  );
  const candidate = existing ?? {
    body: '',
    candidateId: token.candidateId,
    conversionHook: '',
    title: '',
  };
  const updated = { ...candidate, [field]: candidate[field] + token.delta };
  return existing
    ? current.map((item) =>
        item.candidateId === updated.candidateId ? updated : item
      )
    : [...current, updated].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId)
      );
}

export function videoWorkflowEnvelopeFromState(
  state: WorkflowStateEnvelope
): VideoWorkflowEnvelope | undefined {
  const snapshot = state.snapshot;
  const workflow = snapshot.workflow;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return undefined;
  }
  const candidate = workflow as Record<string, unknown>;
  if (
    candidate.id !== state.workflowId ||
    candidate.revision !== state.sourceRevision ||
    typeof candidate.status !== 'string' ||
    typeof candidate.updatedAt !== 'string' ||
    !('job' in snapshot) ||
    (snapshot.job !== null && typeof snapshot.job !== 'object')
  ) {
    return undefined;
  }
  return snapshot as unknown as VideoWorkflowEnvelope;
}

/**
 * 成品版本 — the third outbound seam message (D-032 / ADR-0013), read off the
 * terminal `workflow.state` frame rather than a second fetch: the harness
 * workflow returns `{ delivery, deliveryLayer, recommendation, trace }` and the
 * event reader publishes that whole result as the state snapshot
 * (apps/core/src/p1/harness/dbos-workflow-events.ts readState).
 *
 * Returns undefined for any other producer (the video source publishes a
 * `{ workflow, job }` snapshot) and for a snapshot whose delivery does not
 * parse — a delivery card must never be bound to a revision we cannot verify.
 */
export function harnessDeliveryFromState(
  state: WorkflowStateEnvelope
): ContentPackageRevisionDelivery | undefined {
  if (state.status !== 'success') return undefined;
  const parsed = contentPackageRevisionDeliverySchema.safeParse(
    state.snapshot.delivery
  );
  return parsed.success ? parsed.data : undefined;
}

export function harnessExperienceBasisFromProgress(
  progress: WorkflowProgressEnvelope,
  workflowId: string
): HarnessExperienceBasis | undefined {
  if (
    progress.workflowId !== workflowId ||
    progress.stage !== 'context_injection' ||
    progress.state !== 'success'
  ) {
    return undefined;
  }
  const parsed = harnessExperienceBasisSchema.safeParse(
    progress.experienceBasis
  );
  return parsed.success && parsed.data.taskId === workflowId
    ? parsed.data
    : undefined;
}

export function harnessExperienceBasisFromState(
  state: WorkflowStateEnvelope,
  workflowId: string
): HarnessExperienceBasis | undefined {
  if (state.workflowId !== workflowId || state.status !== 'success') {
    return undefined;
  }
  const parsed = harnessExperienceBasisSchema.safeParse(
    state.snapshot.experienceBasis
  );
  return parsed.success && parsed.data.taskId === workflowId
    ? parsed.data
    : undefined;
}

export type HarnessCancellationOutcome =
  | {
      merchantMessage: string;
      outcome: 'cancelled';
      resolutionSource: 'core_hold_expired';
    }
  | {
      // V31-63: the run ended because a reprice successor replaced it. Not a
      // delivery and not a cancellation card — the session stays alive so the
      // successor's confirmation card (projected into this same thread by the
      // server) can be answered.
      merchantMessage: string;
      outcome: 'superseded_by_reprice';
    };

export function harnessCancellationFromState(
  state: WorkflowStateEnvelope
): HarnessCancellationOutcome | undefined {
  if (state.status !== 'success') return undefined;
  const { merchantMessage, outcome, resolutionSource } = state.snapshot;
  if (typeof merchantMessage !== 'string' || !merchantMessage.trim()) {
    return undefined;
  }
  if (outcome === 'superseded_by_reprice') {
    return { merchantMessage, outcome };
  }
  if (outcome !== 'cancelled' || resolutionSource !== 'core_hold_expired') {
    return undefined;
  }
  return { merchantMessage, outcome, resolutionSource };
}

export type WorkflowEventTransportStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'degraded'
  | 'closed';

/** Pause between reconnect attempts after the stream was refused (V31-28). */
const WORKFLOW_EVENT_RECONNECT_MS = 3_000;

export function useWorkflowEventStream(input: {
  enabled: boolean;
  latestQueryKey?: QueryKey;
  workflowId: string;
  workflowQueryKey: QueryKey;
}) {
  const queryClient = useQueryClient();
  const latestQueryKeyHash = JSON.stringify(input.latestQueryKey ?? null);
  const workflowQueryKeyHash = JSON.stringify(input.workflowQueryKey);
  const cursor = useRef<WorkflowEventCursor | undefined>(undefined);
  const [latestProgress, setLatestProgress] = useState<
    WorkflowProgressEnvelope | undefined
  >(undefined);
  const [copyCandidates, setCopyCandidates] = useState<
    WorkflowCopyTokenDraft[]
  >([]);
  const [workflowState, setWorkflowState] = useState<
    WorkflowStateEnvelope['status'] | undefined
  >();
  const [harnessDelivery, setHarnessDelivery] = useState<
    ContentPackageRevisionDelivery | undefined
  >();
  const [harnessExperienceBasis, setHarnessExperienceBasis] = useState<
    HarnessExperienceBasis | undefined
  >();
  const [harnessCancellation, setHarnessCancellation] = useState<
    HarnessCancellationOutcome | undefined
  >();
  const [merchantReport, setMerchantReport] = useState<
    MerchantReport | undefined
  >();
  const [transportStatus, setTransportStatus] =
    useState<WorkflowEventTransportStatus>('idle');
  const [activeWorkflowId, setActiveWorkflowId] = useState('');
  // V31-28: a plan-phase question parks the run before its Make exists, so the
  // stream opened at submit time is refused (404) — and a refused EventSource
  // never reconnects on its own. Counting reconnect attempts re-runs the
  // subscription effect until the Make is announced or the run settles.
  const [connectAttempt, setConnectAttempt] = useState(0);

  useEffect(() => {
    cursor.current = undefined;
    setLatestProgress(undefined);
    setCopyCandidates([]);
    setWorkflowState(undefined);
    setHarnessDelivery(undefined);
    setHarnessExperienceBasis(undefined);
    setHarnessCancellation(undefined);
    setMerchantReport(undefined);
    if (!input.enabled || !input.workflowId) {
      setActiveWorkflowId('');
      setTransportStatus('idle');
      return;
    }
    setActiveWorkflowId(input.workflowId);
    if (typeof EventSource === 'undefined') {
      setTransportStatus('degraded');
      return;
    }

    setTransportStatus('connecting');
    const source = new EventSource(
      `/api/core/p1/workflows/${encodeURIComponent(input.workflowId)}/events`
    );
    const connectionTimeout = setTimeout(
      () => setTransportStatus('degraded'),
      8_000
    );
    const handleFrame = (event: MessageEvent<string>) => {
      try {
        const frame = parseWorkflowEventFrame(
          event.type as WorkflowEventFrame['event'],
          event.data
        );
        const next = advanceWorkflowEventCursorForWorkflow(
          cursor.current,
          input.workflowId,
          frame
        );
        if (!next.accepted) return;
        cursor.current = next.cursor;
        if (frame.event === 'workflow.progress') {
          setLatestProgress(frame.data);
          const experienceBasis = harnessExperienceBasisFromProgress(
            frame.data,
            input.workflowId
          );
          if (experienceBasis) setHarnessExperienceBasis(experienceBasis);
          return;
        }
        if (frame.event === 'workflow.token') {
          setCopyCandidates((current) =>
            reduceWorkflowCopyTokens(current, frame.data)
          );
          return;
        }
        setWorkflowState(frame.data.status);
        // 失败/partial 申报 rides the same terminal frame as the status, so the
        // conversation can state what happened without a second fetch (P0-2).
        if (frame.data.merchantReport) {
          setMerchantReport(frame.data.merchantReport);
        }
        const delivery = harnessDeliveryFromState(frame.data);
        if (delivery) setHarnessDelivery(delivery);
        setHarnessExperienceBasis(
          harnessExperienceBasisFromState(frame.data, input.workflowId)
        );
        const cancellation = harnessCancellationFromState(frame.data);
        if (cancellation) setHarnessCancellation(cancellation);
        const envelope = videoWorkflowEnvelopeFromState(frame.data);
        if (envelope) {
          queryClient.setQueryData(input.workflowQueryKey, envelope);
          if (input.latestQueryKey) {
            queryClient.setQueryData(input.latestQueryKey, envelope);
          }
        }
        if (frame.data.status === 'success' || frame.data.status === 'failed') {
          void queryClient.invalidateQueries({
            queryKey: input.workflowQueryKey,
          });
          if (input.latestQueryKey) {
            void queryClient.invalidateQueries({
              queryKey: input.latestQueryKey,
            });
          }
          source.close();
          setTransportStatus('closed');
        }
      } catch {
        setTransportStatus('degraded');
      }
    };
    source.addEventListener('workflow.progress', handleFrame);
    source.addEventListener('workflow.token', handleFrame);
    source.addEventListener('workflow.state', handleFrame);
    source.onopen = () => {
      clearTimeout(connectionTimeout);
      setTransportStatus('open');
    };
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    source.onerror = () => {
      setTransportStatus('degraded');
      // A non-200 answer (the parked-run 404 above) closes the EventSource
      // permanently; native retries only cover streams that once opened. Ask
      // for a fresh subscription — the terminal frame handler has already
      // closed the source on success/failed, so a settled run never loops.
      if (
        source.readyState === EventSource.CLOSED &&
        retryTimer === undefined
      ) {
        retryTimer = setTimeout(
          () => setConnectAttempt((attempt) => attempt + 1),
          WORKFLOW_EVENT_RECONNECT_MS
        );
      }
    };

    return () => {
      clearTimeout(connectionTimeout);
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      source.removeEventListener('workflow.progress', handleFrame);
      source.removeEventListener('workflow.token', handleFrame);
      source.removeEventListener('workflow.state', handleFrame);
      source.close();
    };
  }, [
    connectAttempt,
    input.enabled,
    input.workflowId,
    latestQueryKeyHash,
    queryClient,
    workflowQueryKeyHash,
  ]);

  const matchesInput =
    input.enabled &&
    Boolean(input.workflowId) &&
    activeWorkflowId === input.workflowId;
  return {
    activeWorkflowId: matchesInput ? activeWorkflowId : '',
    copyCandidates: matchesInput ? copyCandidates : [],
    harnessCancellation: matchesInput ? harnessCancellation : undefined,
    harnessDelivery: matchesInput ? harnessDelivery : undefined,
    harnessExperienceBasis: matchesInput ? harnessExperienceBasis : undefined,
    latestProgress: matchesInput ? latestProgress : undefined,
    // Gated like every other field: a 申报 belongs to the run it came from, and
    // handing it to a surface now watching a different workflow would state one
    // run's failure over another's (H01).
    merchantReport: matchesInput ? merchantReport : undefined,
    transportStatus: matchesInput ? transportStatus : 'idle',
    workflowState: matchesInput ? workflowState : undefined,
  };
}
