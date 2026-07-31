import type {
  AskMerchantAnswer,
  AskMerchantQuestionRequest,
} from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

import {
  AskMerchantGroupCard,
  AskMerchantResolutionNotice,
} from '@/product/composer/ask-merchant-group-card';
import { readHarnessInteractionSnapshot } from '@/product/harness-client';

type InteractionSnapshot = Awaited<
  ReturnType<typeof readHarnessInteractionSnapshot>
>;

export function AskMerchantInteractionSlot({
  delivered,
  fallback = null,
  onEditingChange,
  onRendererReady,
  onRendererRejected,
  onSubmit,
  pending,
  pendingRequest,
  readSnapshot = readHarnessInteractionSnapshot,
  taskId,
}: {
  delivered: boolean;
  fallback?: ReactNode;
  onEditingChange: (
    request: AskMerchantQuestionRequest,
    editing: boolean,
    editingSessionId: string
  ) => Promise<void>;
  onRendererReady: (request: AskMerchantQuestionRequest) => Promise<void>;
  onRendererRejected?: (request: AskMerchantQuestionRequest) => Promise<void>;
  onSubmit: (response: AskMerchantAnswer['response']) => Promise<void>;
  pending: boolean;
  pendingRequest: AskMerchantQuestionRequest | null;
  readSnapshot?: (
    taskId: string,
    signal?: AbortSignal
  ) => Promise<InteractionSnapshot>;
  taskId: string;
}) {
  const snapshotQuery = useQuery({
    enabled: Boolean(taskId),
    queryKey: ['harness', 'interaction-snapshot', taskId] as const,
    queryFn: ({ signal }) => readSnapshot(taskId, signal),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'resolved') return false;
      if (!delivered) return 2_000;
      return status === 'pending' ? 2_000 : false;
    },
  });

  useEffect(() => {
    if (!delivered) return;
    void snapshotQuery.refetch();
  }, [delivered, snapshotQuery.refetch]);

  const snapshotRequest =
    snapshotQuery.data?.request?.kind === 'ask_merchant'
      ? snapshotQuery.data.request
      : null;
  if (
    snapshotQuery.data?.status === 'resolved' &&
    snapshotQuery.data.resolutionSource === 'system_default' &&
    snapshotRequest
  ) {
    return <AskMerchantResolutionNotice />;
  }

  const request = pendingRequest ?? snapshotRequest;
  if (!request || snapshotQuery.data?.status === 'resolved') return fallback;
  return (
    <AskMerchantGroupCard
      onEditingChange={onEditingChange}
      onRendererReady={onRendererReady}
      onRendererRejected={onRendererRejected}
      onSubmit={onSubmit}
      pending={pending}
      request={request}
    />
  );
}
