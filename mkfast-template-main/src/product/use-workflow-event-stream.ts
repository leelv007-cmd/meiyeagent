import {
  workflowProgressFrameSchema,
  workflowStateFrameSchema,
  workflowTokenFrameSchema,
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
  const [transportStatus, setTransportStatus] =
    useState<WorkflowEventTransportStatus>('idle');

  useEffect(() => {
    cursor.current = undefined;
    setLatestProgress(undefined);
    setCopyCandidates([]);
    setWorkflowState(undefined);
    if (!input.enabled || !input.workflowId) {
      setTransportStatus('idle');
      return;
    }
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
        const next = advanceWorkflowEventCursor(cursor.current, frame);
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

  return { copyCandidates, latestProgress, transportStatus, workflowState };
}
