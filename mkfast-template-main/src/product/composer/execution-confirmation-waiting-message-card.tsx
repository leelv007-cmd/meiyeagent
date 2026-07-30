import type { ExecutionConfirmationRequest } from '@meiye/contracts';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ExecutionConfirmationWaitingMessageCard({
  onSubmit,
  pending = false,
  request,
}: {
  onSubmit: (
    request: ExecutionConfirmationRequest,
    message: string
  ) => Promise<void>;
  pending?: boolean;
  request: ExecutionConfirmationRequest;
}) {
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMessage('');
  }, [request.requestId, request.revision]);

  const normalizedMessage = message.trim();

  return (
    <section
      className="meiye-porcelain rounded-2xl p-4"
      data-request-id={request.requestId}
      data-testid="execution-confirmation-waiting-message-card"
    >
      <h3 className="text-foreground text-sm font-medium">这次任务已暂停</h3>
      <p className="text-muted mt-1 text-sm">
        补充调整说明后，我会按你的新要求继续。
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          aria-label="补充你的调整说明"
          disabled={pending}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="例如：换成更稳妥的方案"
          value={message}
        />
        <Button
          disabled={pending || !normalizedMessage}
          onClick={() => void onSubmit(request, normalizedMessage)}
          type="button"
        >
          继续调整
        </Button>
      </div>
    </section>
  );
}
