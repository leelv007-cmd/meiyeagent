import type {
  AskMerchantAnswer,
  AskMerchantQuestionRequest,
} from '@meiye/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  rendererAckNeedsRefetch,
  rendererAckRetryDelay,
} from './interaction-renderer-retry';

type ItemResult = Extract<
  AskMerchantAnswer['response'],
  { kind: 'answer' }
>['items'][number]['result'];

export function AskMerchantGroupCard({
  onEditingChange,
  onRendererReady,
  onRendererRejected,
  onSubmit,
  pending = false,
  request,
}: {
  onEditingChange: (
    request: AskMerchantQuestionRequest,
    editing: boolean,
    editingSessionId: string
  ) => Promise<void>;
  onRendererReady: (request: AskMerchantQuestionRequest) => Promise<void>;
  onRendererRejected?: (request: AskMerchantQuestionRequest) => Promise<void>;
  onSubmit: (response: AskMerchantAnswer['response']) => Promise<void>;
  pending?: boolean;
  request: AskMerchantQuestionRequest;
}) {
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  const [editing, setEditing] = useState(false);
  const editingSessionId = useMemo(
    () => globalThis.crypto.randomUUID(),
    [request.requestId, request.revision]
  );
  const editingSignalRef = useRef({ onEditingChange, request });
  editingSignalRef.current = { onEditingChange, request };

  useEffect(() => {
    setResults({});
    setEditing(false);
  }, [request.requestId, request.revision]);
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
  useEffect(() => {
    if (!editing) return;
    const leaseRenewal = setInterval(() => {
      const signal = editingSignalRef.current;
      void signal
        .onEditingChange(signal.request, true, editingSessionId)
        .catch(() => undefined);
    }, 15_000);
    return () => clearInterval(leaseRenewal);
  }, [editing, editingSessionId, request.requestId, request.revision]);

  const complete = useMemo(
    () =>
      request.questions.every(
        (question) => results[question.itemId] !== undefined
      ),
    [request.questions, results]
  );

  return (
    <section
      className="meiye-porcelain rounded-2xl p-4"
      data-request-id={request.requestId}
      data-testid="ask-merchant-group-card"
    >
      <div className="space-y-4">
        {request.questions.map((question) => {
          const selected = results[question.itemId];
          return (
            <fieldset className="space-y-2" key={question.itemId}>
              <legend className="text-foreground text-sm">
                {question.question}
              </legend>
              {question.options ? (
                <div className="flex flex-wrap gap-2">
                  {question.options.map((option) => (
                    <Button
                      aria-pressed={
                        selected?.kind === 'answer' &&
                        selected.value === option.label
                      }
                      disabled={pending}
                      key={option.label}
                      onClick={() =>
                        setResults((current) => ({
                          ...current,
                          [question.itemId]: {
                            kind: 'answer',
                            value: option.label,
                          },
                        }))
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {option.label}
                      {option.description ? (
                        <span className="text-muted ml-1 text-xs">
                          {option.description}
                        </span>
                      ) : null}
                    </Button>
                  ))}
                </div>
              ) : null}
              {!question.options || question.freeText?.enabled ? (
                <Input
                  aria-label={question.question}
                  disabled={pending}
                  onBlur={() => {
                    setEditing(false);
                    void onEditingChange(
                      request,
                      false,
                      editingSessionId
                    ).catch(() => undefined);
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setResults((current) => ({
                      ...current,
                      [question.itemId]: value.trim()
                        ? { kind: 'answer', value }
                        : { kind: 'deferred' },
                    }));
                  }}
                  onFocus={() => {
                    setEditing(true);
                    void onEditingChange(request, true, editingSessionId).catch(
                      () => undefined
                    );
                  }}
                  placeholder={
                    question.freeText?.placeholder ?? '也可以直接告诉我'
                  }
                  value={selected?.kind === 'answer' ? selected.value : ''}
                />
              ) : null}
              <Button
                aria-pressed={selected?.kind === 'deferred'}
                disabled={pending}
                onClick={() =>
                  setResults((current) => ({
                    ...current,
                    [question.itemId]: { kind: 'deferred' },
                  }))
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                暂未确定
              </Button>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={pending || !complete}
          onClick={() =>
            void onSubmit({
              kind: 'answer',
              items: request.questions.map((question) => ({
                itemId: question.itemId,
                result: results[question.itemId]!,
              })),
            })
          }
          type="button"
        >
          提交回答
        </Button>
        <Button
          disabled={pending}
          onClick={() => void onSubmit({ kind: 'skipped' })}
          type="button"
          variant="secondary"
        >
          整组暂不确定
        </Button>
      </div>
    </section>
  );
}
