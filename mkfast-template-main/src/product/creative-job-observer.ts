import type { CreativeJob } from '@meiye/contracts';
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { productStatusView } from '@/lib/uiux/status';
import { operationsCommand, operationsQuery, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { ComposedVideoTaskEnvelope } from './async-task-center-model';
import { videoWorkflowShouldPoll } from './video-workflow-model';

export type ProviderJobStatus =
  | 'queued'
  | 'running'
  | 'unknown'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed';

interface ProviderJobView {
  jobId: string;
  status: ProviderJobStatus;
}

export interface MediaJobObservation {
  creativeJobId?: string;
  operation: 'image.generate' | 'video.generate';
  providerJobId: string;
  status: string;
}

export interface CanvasImageJobObservation {
  jobId: string;
  status: string;
}

const ACTIVE_PROVIDER_STATUSES = new Set<ProviderJobStatus>([
  'queued',
  'running',
  'unknown',
  'cancel_requested',
]);
const TERMINAL_PROVIDER_STATUSES = new Set<ProviderJobStatus>([
  'cancelled',
  'completed',
  'failed',
]);
const completedTerminalRecoveries = new Set<string>();
const inFlightTerminalRecoveries = new Map<string, Promise<void>>();
const failedTerminalRecoveries = new Map<string, unknown>();
export const videoWorkflowListQueryKey = p1QueryKeys.request(
  'model-supply',
  'video_workflows'
);

export function runTerminalRecoveryOnce(
  terminalKey: string,
  recover: () => Promise<void>,
  options: { retryFailed?: boolean } = {}
) {
  if (options.retryFailed) failedTerminalRecoveries.delete(terminalKey);
  if (completedTerminalRecoveries.has(terminalKey)) return Promise.resolve();
  const inFlight = inFlightTerminalRecoveries.get(terminalKey);
  if (inFlight) return inFlight;
  if (failedTerminalRecoveries.has(terminalKey)) {
    return Promise.reject(failedTerminalRecoveries.get(terminalKey));
  }

  const recovery = Promise.resolve()
    .then(recover)
    .then(() => {
      completedTerminalRecoveries.add(terminalKey);
      failedTerminalRecoveries.delete(terminalKey);
    })
    .catch((cause) => {
      failedTerminalRecoveries.set(terminalKey, cause);
      throw cause;
    })
    .finally(() => {
      if (inFlightTerminalRecoveries.get(terminalKey) === recovery) {
        inFlightTerminalRecoveries.delete(terminalKey);
      }
    });
  inFlightTerminalRecoveries.set(terminalKey, recovery);
  return recovery;
}

export function creativeJobObservation(
  job?: CreativeJob
): MediaJobObservation | undefined {
  if (
    !job?.providerJobId ||
    (job.contract.operation !== 'image.generate' &&
      job.contract.operation !== 'video.generate') ||
    (job.status !== 'running' && job.status !== 'unknown')
  ) {
    return undefined;
  }
  return {
    creativeJobId: job.id,
    operation: job.contract.operation,
    providerJobId: job.providerJobId,
    status: job.status,
  };
}

export function providerTerminalResumeKey(
  creativeJobId: string,
  status: ProviderJobStatus
) {
  return TERMINAL_PROVIDER_STATUSES.has(status)
    ? `resume-observed-${creativeJobId}-${status}`
    : undefined;
}

export function isActiveProviderStatus(status: string) {
  return ACTIVE_PROVIDER_STATUSES.has(status as ProviderJobStatus);
}

export function shouldPollVideoWorkflowList(
  envelopes: ComposedVideoTaskEnvelope[] | undefined
) {
  return envelopes === undefined || envelopes.some(videoWorkflowShouldPoll);
}

export function mergeVideoWorkflowList(
  current: ComposedVideoTaskEnvelope[] | undefined,
  incoming: ComposedVideoTaskEnvelope
) {
  return [
    ...(current ?? []).filter(
      (item) => item.workflow.id !== incoming.workflow.id
    ),
    incoming,
  ].sort((left, right) =>
    right.workflow.updatedAt.localeCompare(left.workflow.updatedAt)
  );
}

export async function refreshCreativeJobCanonicalState(
  queryClient: QueryClient
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    }),
    queryClient.invalidateQueries({
      queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    }),
    queryClient.invalidateQueries({
      queryKey: p1QueryKeys.request('operations', 'content_packages'),
    }),
  ]);
}

interface VideoWorkflowStatusObservation {
  workflow: {
    id: string;
    status: string;
  };
}

export async function refreshCreativeJobCanonicalStateOnVideoWorkflowChange(
  queryClient: QueryClient,
  previous: readonly VideoWorkflowStatusObservation[] | undefined,
  current: readonly VideoWorkflowStatusObservation[] | undefined
) {
  if (!previous || !current) return;
  const previousStatuses = new Map(
    previous.map((envelope) => [envelope.workflow.id, envelope.workflow.status])
  );
  const statusChanged = current.some((envelope) => {
    const previousStatus = previousStatuses.get(envelope.workflow.id);
    return (
      previousStatus !== undefined &&
      previousStatus !== envelope.workflow.status
    );
  });
  if (!statusChanged) return;
  await refreshCreativeJobCanonicalState(queryClient);
}

export function useVideoWorkflowListObserver() {
  const queryClient = useQueryClient();
  const previousVideoWorkflows = useRef<
    ComposedVideoTaskEnvelope[] | undefined
  >(undefined);
  const query = useQuery({
    queryKey: videoWorkflowListQueryKey,
    queryFn: ({ signal }) =>
      queryP1<ComposedVideoTaskEnvelope[]>(
        'model-supply',
        { action: 'video_workflows', payload: {} },
        signal
      ),
    refetchInterval: (current) =>
      shouldPollVideoWorkflowList(current.state.data) ? 5_000 : false,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  useEffect(() => {
    const previous = previousVideoWorkflows.current;
    const current = query.data;
    previousVideoWorkflows.current = current;
    if (!previous || !current) return;
    void refreshCreativeJobCanonicalStateOnVideoWorkflowChange(
      queryClient,
      previous,
      current
    );
  }, [query.data, queryClient]);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (
          key[0] !== 'p1' ||
          key[1] !== 'model-supply' ||
          (key[2] !== 'video_workflow' && key[2] !== 'video_workflow_latest') ||
          !isComposedVideoTaskEnvelope(event.query.state.data)
        ) {
          return;
        }
        queryClient.setQueryData<ComposedVideoTaskEnvelope[]>(
          videoWorkflowListQueryKey,
          (current) => mergeVideoWorkflowList(current, event.query.state.data)
        );
      }),
    [queryClient]
  );

  return query;
}

function isComposedVideoTaskEnvelope(
  value: unknown
): value is ComposedVideoTaskEnvelope {
  if (!value || typeof value !== 'object' || !('workflow' in value)) {
    return false;
  }
  const workflow = value.workflow;
  if (
    !workflow ||
    typeof workflow !== 'object' ||
    !('id' in workflow) ||
    typeof workflow.id !== 'string' ||
    !('createdAt' in workflow) ||
    typeof workflow.createdAt !== 'string' ||
    !('updatedAt' in workflow) ||
    typeof workflow.updatedAt !== 'string'
  ) {
    return false;
  }
  if (!('job' in value)) return false;
  if (value.job === null) return true;
  return Boolean(
    value.job &&
      typeof value.job === 'object' &&
      'jobId' in value.job &&
      typeof value.job.jobId === 'string' &&
      'status' in value.job &&
      typeof value.job.status === 'string' &&
      'createdAt' in value.job &&
      typeof value.job.createdAt === 'string' &&
      'updatedAt' in value.job &&
      typeof value.job.updatedAt === 'string'
  );
}

export function useCreativeJobObserver(
  observation: MediaJobObservation | undefined
) {
  const queryClient = useQueryClient();
  const [recoveryError, setRecoveryError] = useState<Error>();
  const providerJobId = observation?.providerJobId ?? '';
  const creativeJobId = observation?.creativeJobId;
  const observationStatus = observation?.status;
  const enabled = Boolean(observation);
  const query = useQuery({
    enabled,
    queryKey: p1QueryKeys.request('model-supply', 'job', {
      jobId: providerJobId,
    }),
    queryFn: ({ signal }) =>
      queryP1<ProviderJobView>(
        'model-supply',
        { action: 'job', payload: { jobId: providerJobId } },
        signal
      ),
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      return !status || isActiveProviderStatus(status) ? 5_000 : false;
    },
    refetchOnWindowFocus: true,
    retry: 2,
  });
  const observedStatus = query.data?.status;

  const refreshCanonicalState = useCallback(
    () => refreshCreativeJobCanonicalState(queryClient),
    [queryClient]
  );

  const recoverTerminal = useCallback(
    async (retryFailed = false) => {
      if (!providerJobId || !observedStatus) return;
      const terminalKey = creativeJobId
        ? providerTerminalResumeKey(creativeJobId, observedStatus)
        : TERMINAL_PROVIDER_STATUSES.has(observedStatus)
          ? `observed-${providerJobId}-${observedStatus}`
          : undefined;
      if (!terminalKey) return;
      setRecoveryError(undefined);
      try {
        await runTerminalRecoveryOnce(
          terminalKey,
          async () => {
            if (creativeJobId) {
              await operationsCommand(
                'resume_creative_job',
                { jobId: creativeJobId },
                terminalKey
              );
            }
            await refreshCanonicalState();
          },
          { retryFailed }
        );
      } catch (cause) {
        setRecoveryError(
          cause instanceof Error
            ? cause
            : new Error('TERMINAL_RECOVERY_UNAVAILABLE')
        );
      }
    },
    [creativeJobId, observedStatus, providerJobId, refreshCanonicalState]
  );

  useEffect(() => {
    void recoverTerminal();
  }, [recoverTerminal]);

  useEffect(() => {
    if (
      observedStatus &&
      observationStatus &&
      observedStatus !== observationStatus &&
      isActiveProviderStatus(observedStatus)
    ) {
      void refreshCanonicalState();
    }
  }, [observationStatus, observedStatus, refreshCanonicalState]);

  const retryRecovery = useCallback(async () => {
    await recoverTerminal(true);
  }, [recoverTerminal]);

  return {
    enabled,
    error: query.error ?? recoveryError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    retryRecovery,
    status: observedStatus ?? observationStatus,
    statusView: productStatusView(observedStatus ?? observationStatus ?? ''),
  };
}

export function useCanvasImageJobObserver(
  observation: CanvasImageJobObservation | undefined
) {
  const queryClient = useQueryClient();
  const jobId = observation?.jobId ?? '';
  const query = useQuery({
    enabled: Boolean(observation),
    queryKey: p1QueryKeys.request('operations', 'canvas_image_job', { jobId }),
    queryFn: ({ signal }) =>
      operationsQuery<{ id: string; status: ProviderJobStatus }>(
        'canvas_image_job',
        { jobId },
        signal
      ),
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      return !status || isActiveProviderStatus(status) ? 5_000 : false;
    },
    refetchOnWindowFocus: true,
    retry: 2,
  });

  useEffect(() => {
    if (!query.data?.status || query.data.status === observation?.status)
      return;
    void queryClient.invalidateQueries({
      queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    });
  }, [observation?.status, query.data?.status, queryClient]);

  return query;
}
