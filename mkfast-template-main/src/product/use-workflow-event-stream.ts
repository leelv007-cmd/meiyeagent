import {
  contentPackageRevisionDeliverySchema,
  workflowProgressFrameSchema,
  workflowStateFrameSchema,
  workflowTokenFrameSchema,
  type ContentPackageRevisionDelivery,
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

export function workflowEventFrameBelongsTo(
  frame: WorkflowEventFrame,
  workflowId: string
) {
  return frame.data.workflowId === workflowId;
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

export type HarnessCancellationOutcome = {
  merchantMessage: string;
  outcome: 'cancelled';
  resolutionSource: 'core_hold_expired';
};

export function harnessCancellationFromState(
  state: WorkflowStateEnvelope
): HarnessCancellationOutcome | undefined {
  if (state.status !== 'success') return undefined;
  const { merchantMessage, outcome, resolutionSource } = state.snapshot;
  if (
    outcome !== 'cancelled' ||
    resolutionSource !== 'core_hold_expired' ||
    typeof merchantMessage !== 'string' ||
    !merchantMessage.trim()
  ) {
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
  const [harnessCancellation, setHarnessCancellation] = useState<
    HarnessCancellationOutcome | undefined
  >();
  const [merchantReport, setMerchantReport] = useState<
    MerchantReport | undefined
  >();
  const [transportStatus, setTransportStatus] =
    useState<WorkflowEventTransportStatus>('idle');
  const [activeWorkflowId, setActiveWorkflowId] = useState('');

  useEffect(() => {
    cursor.current = undefined;
    setLatestProgress(undefined);
    setCopyCandidates([]);
    setWorkflowState(undefined);
    setHarnessDelivery(undefined);
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
    source.onerror = () => setTransportStatus('degraded');

    return () => {
      clearTimeout(connectionTimeout);
      source.removeEventListener('workflow.progress', handleFrame);
      source.removeEventListener('workflow.token', handleFrame);
      source.removeEventListener('workflow.state', handleFrame);
      source.close();
    };
  }, [
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
    latestProgress: matchesInput ? latestProgress : undefined,
    // Gated like every other field: a 申报 belongs to the run it came from, and
    // handing it to a surface now watching a different workflow would state one
    // run's failure over another's (H01).
    merchantReport: matchesInput ? merchantReport : undefined,
    transportStatus: matchesInput ? transportStatus : 'idle',
    workflowState: matchesInput ? workflowState : undefined,
  };
}
