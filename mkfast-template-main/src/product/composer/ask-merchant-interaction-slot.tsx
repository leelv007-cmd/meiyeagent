import type {
  AskMerchantAnswer,
  AskMerchantQuestionRequest,
} from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';

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
  // The answer must name the request the merchant actually saw: this slot
  // renders from whichever read leg (pending poll or snapshot poll) delivered
  // first, so a submit callback that re-reads its own poll state can miss a
  // request the card is already showing and silently drop the click (V31-28).
  onSubmit: (
    request: AskMerchantQuestionRequest,
    response: AskMerchantAnswer['response']
  ) => Promise<void>;
  pending: boolean;
  pendingRequest: AskMerchantQuestionRequest | null;
  readSnapshot?: (
    taskId: string,
    signal?: AbortSignal
  ) => Promise<InteractionSnapshot>;
  taskId: string;
}) {
  /** The request this browser answered, as `${requestId}:r${revision}`. */
  const answeredRef = useRef<string | null>(null);
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
  const answered = request
    ? answeredRef.current === `${request.requestId}:r${request.revision}`
    : false;
  // Both read legs keep reporting a question for a few seconds after the
  // workflow consumed its answer, and either one re-mounts the card with a
  // fresh (empty) selection — the merchant is asked again, blank, while the run
  // her answer started is already generating. This browser knows it answered;
  // that is the fact to render from until the reads catch up.
  if (!request || answered || snapshotQuery.data?.status === 'resolved') {
    return fallback;
  }
  return (
    <AskMerchantGroupCard
      onEditingChange={onEditingChange}
      onRendererReady={onRendererReady}
      onRendererRejected={onRendererRejected}
      onSubmit={async (response) => {
        const key = `${request.requestId}:r${request.revision}`;
        answeredRef.current = key;
        try {
          await onSubmit(request, response);
        } catch {
          // The answer never reached Core, so the question is still hers.
          // Not rethrown: the card discards this promise, so a rejection here
          // only surfaces as an unhandled one, and the submit path has already
          // told the merchant it failed.
          if (answeredRef.current === key) answeredRef.current = null;
        }
      }}
      pending={pending}
      request={request}
    />
  );
}
