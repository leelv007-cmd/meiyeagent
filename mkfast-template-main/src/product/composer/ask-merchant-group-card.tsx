import type {
  AskMerchantAnswer,
  AskMerchantQuestionRequest,
} from '@meiye/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  rendererAckNeedsRefetch,
  rendererAckRetryDelay,
} from '@/product/composer/interaction-renderer-retry';

type ItemResult = Extract<
  AskMerchantAnswer['response'],
  { kind: 'answer' }
>['items'][number]['result'];

export function AskMerchantResolutionNotice() {
  return (
    <section className="meiye-porcelain rounded-2xl p-4">
      <p className="text-muted text-sm" data-testid="composer-question-settled">
        系统已按通用模式继续，你仍可回答并生成精修版本。
      </p>
    </section>
  );
}

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
  const semanticDefault =
    request.timeoutPolicy?.kind === 'semantic_default'
      ? request.timeoutPolicy
      : null;
  const autoContinue = semanticDefault !== null;
  const [remainingSeconds, setRemainingSeconds] = useState(
    semanticDefault?.timeoutSeconds ?? 0
  );
  const editingSessionIdRef = useRef<string | null>(null);
  const editingSignalRef = useRef({ onEditingChange, request });
  editingSignalRef.current = { onEditingChange, request };

  useEffect(() => {
    setResults({});
    setEditing(false);
    setRemainingSeconds(semanticDefault?.timeoutSeconds ?? 0);
    editingSessionIdRef.current = null;
  }, [request.requestId, request.revision, semanticDefault?.timeoutSeconds]);
  useEffect(() => {
    if (!autoContinue || editing || remainingSeconds <= 0) return;
    const timer = setTimeout(
      () => setRemainingSeconds((current) => Math.max(0, current - 1)),
      1_000
    );
    return () => clearTimeout(timer);
  }, [autoContinue, editing, remainingSeconds]);
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
      const editingSessionId = editingSessionIdRef.current;
      if (!editingSessionId) return;
      void signal
        .onEditingChange(signal.request, true, editingSessionId)
        .catch(() => undefined);
    }, 15_000);
    return () => clearInterval(leaseRenewal);
  }, [editing, request.requestId, request.revision]);

  const complete = useMemo(
    () =>
      request.questions.every(
        (question) => results[question.itemId] !== undefined
      ),
    [request.questions, results]
  );
  const requiresExplicitResourceAction =
    request.questions.length === 1 &&
    request.questions[0]?.itemId === 'bounded_execution_continuation';
  const submitsOptionImmediately =
    request.questions.length === 1 &&
    request.questions[0]?.itemId === 'note_style' &&
    request.questions[0].freeText?.enabled === false;

  return (
    <section
      className="meiye-porcelain rounded-2xl p-4"
      data-auto-continue={autoContinue ? 'true' : 'false'}
      data-request-id={request.requestId}
      data-testid="ask-merchant-group-card"
    >
      {semanticDefault ? (
        <div className="mb-3 space-y-1 text-muted text-xs">
          <p data-testid="ask-merchant-default">默认：暂未确定</p>
          <p aria-live="polite" data-testid="ask-merchant-countdown">
            {remainingSeconds} 秒后按默认继续
          </p>
        </div>
      ) : null}
      <div className="space-y-4">
        {request.questions.map((question) => {
          const selected = results[question.itemId];
          const comparesStyleOptions =
            question.itemId === 'note_style' &&
            (question.options?.length ?? 0) > 0;
          const chooseOption = (label: string) => {
            const result = { kind: 'answer' as const, value: label };
            setResults((current) => ({
              ...current,
              [question.itemId]: result,
            }));
            if (submitsOptionImmediately) {
              void onSubmit({
                kind: 'answer',
                items: [{ itemId: question.itemId, result }],
              });
            }
          };
          return (
            <fieldset className="space-y-2" key={question.itemId}>
              <legend className="text-foreground text-sm">
                {question.question}
              </legend>
              {question.options ? (
                comparesStyleOptions ? (
                  <div
                    className="grid gap-3 sm:grid-cols-2"
                    data-option-count={question.options.length}
                    data-testid="ask-merchant-option-comparison"
                  >
                    {question.options.map((option) => {
                      const isSelected =
                        selected?.kind === 'answer' &&
                        selected.value === option.label;
                      return (
                        <button
                          aria-pressed={isSelected}
                          className={cn(
                            'flex flex-col gap-2 rounded-2xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
                            isSelected
                              ? 'border-primary/40 bg-primary/10 text-foreground'
                              : 'border-border/60 bg-transparent hover:bg-muted/40'
                          )}
                          data-option-label={option.label}
                          data-testid="ask-merchant-option-card"
                          disabled={pending}
                          key={option.label}
                          onClick={() => chooseOption(option.label)}
                          type="button"
                        >
                          <span
                            className="font-medium text-sm"
                            data-testid="ask-merchant-option-label"
                          >
                            {option.label}
                          </span>
                          {option.description ? (
                            <span
                              className="whitespace-pre-line text-sm text-foreground"
                              data-testid="ask-merchant-option-positioning"
                            >
                              {option.description}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {question.options.map((option) => (
                      <Button
                        aria-pressed={
                          selected?.kind === 'answer' &&
                          selected.value === option.label
                        }
                        disabled={pending}
                        key={option.label}
                        onClick={() => chooseOption(option.label)}
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
                )
              ) : null}
              {!question.options || question.freeText?.enabled ? (
                <Input
                  aria-label={question.question}
                  disabled={pending}
                  onBlur={() => {
                    const editingSessionId = editingSessionIdRef.current;
                    editingSessionIdRef.current = null;
                    setEditing(false);
                    if (editingSessionId) {
                      void onEditingChange(
                        request,
                        false,
                        editingSessionId
                      ).catch(() => undefined);
                    }
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
                    const editingSessionId = globalThis.crypto.randomUUID();
                    editingSessionIdRef.current = editingSessionId;
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
              {requiresExplicitResourceAction ? null : (
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
              )}
            </fieldset>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {submitsOptionImmediately ? null : (
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
        )}
        {requiresExplicitResourceAction ? null : (
          <Button
            disabled={pending}
            onClick={() => void onSubmit({ kind: 'skipped' })}
            type="button"
            variant="secondary"
          >
            整组暂不确定
          </Button>
        )}
      </div>
    </section>
  );
}
