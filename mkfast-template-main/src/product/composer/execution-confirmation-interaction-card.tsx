import type {
  ExecutionConfirmationAnswer,
  ExecutionConfirmationRequest,
} from '@meiye/contracts';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import {
  rendererAckNeedsRefetch,
  rendererAckRetryDelay,
} from '@/product/composer/interaction-renderer-retry';

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

  /**
   * Compact confirmation strip expansion (V31-11): when debitPreview carries
   * media units we surface a held-credits hint. Refund dual-state / rights /
   * facts are projected by the host when available via outline title lines —
   * the card stays read-only with only reject / confirm.
   */
  const heldUnits = request.frozen.debitPreview.reduce(
    (sum, unit) => sum + unit.quantity,
    0
  );

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
      {heldUnits > 0 ? (
        <p
          className="text-foreground mt-3 text-sm"
          data-testid="execution-confirmation-held"
        >
          已预留额度（等待确认）
        </p>
      ) : null}
      {request.frozen.outline ? (
        <div
          className="mt-4 space-y-2"
          data-testid="execution-confirmation-outline"
        >
          <p className="text-foreground text-sm font-medium">
            大纲摘要（共 {request.frozen.outline.pageCount} 页）
          </p>
          <ol className="space-y-1">
            {request.frozen.outline.pages.map((page) => (
              <li
                className="text-muted flex gap-2 text-sm"
                data-testid="execution-confirmation-outline-row"
                key={page.order}
              >
                <span className="text-foreground shrink-0">
                  第 {page.order} 页
                </span>
                <span className="text-foreground truncate">{page.title}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
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
