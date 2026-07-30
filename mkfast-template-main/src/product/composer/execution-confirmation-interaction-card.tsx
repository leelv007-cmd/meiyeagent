import type {
  ExecutionConfirmationAnswer,
  ExecutionConfirmationRequest,
} from '@meiye/contracts';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import {
  rendererAckNeedsRefetch,
  rendererAckRetryDelay,
} from './interaction-renderer-retry';

export function ExecutionConfirmationInteractionCard({
  onRendererReady,
  onRendererRejected,
  onSubmit,
  pending = false,
  request,
}: {
  onRendererReady: (request: ExecutionConfirmationRequest) => Promise<void>;
  onRendererRejected?: (request: ExecutionConfirmationRequest) => Promise<void>;
  onSubmit: (
    response: ExecutionConfirmationAnswer['response']
  ) => Promise<void>;
  pending?: boolean;
  request: ExecutionConfirmationRequest;
}) {
  useEffect(() => {
    let cancelled = false;
    let retryId: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const acknowledge = () => {
      attempts += 1;
      void onRendererReady(request).catch((error: unknown) => {
        if (cancelled) return;
        const retryDelay = rendererAckRetryDelay(error, attempts);
        if (retryDelay !== null) {
          retryId = setTimeout(acknowledge, retryDelay);
        } else if (rendererAckNeedsRefetch(error)) {
          void onRendererRejected?.(request);
        }
      });
    };
    acknowledge();
    return () => {
      cancelled = true;
      if (retryId) clearTimeout(retryId);
    };
  }, [
    onRendererReady,
    onRendererRejected,
    request.requestId,
    request.revision,
  ]);

  return (
    <section
      className="meiye-porcelain rounded-2xl p-4"
      data-request-id={request.requestId}
      data-testid="execution-confirmation-interaction-card"
    >
      <h3 className="text-foreground text-sm font-medium">确认本次执行方案</h3>
      <dl className="mt-3 space-y-2">
        {request.frozen.params.map((param) => (
          <div className="flex justify-between gap-4 text-sm" key={param.key}>
            <dt className="text-muted">{param.label}</dt>
            <dd className="text-foreground text-right">{param.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() => void onSubmit({ kind: 'approved' })}
          type="button"
        >
          确认执行
        </Button>
        <Button
          disabled={pending}
          onClick={() => void onSubmit({ kind: 'rejected' })}
          type="button"
          variant="secondary"
        >
          暂不执行
        </Button>
      </div>
    </section>
  );
}
