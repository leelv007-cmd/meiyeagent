import type {
  AskMerchantAnswer,
  AskMerchantQuestionRequest,
} from '@meiye/contracts';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ItemResult = Extract<
  AskMerchantAnswer['response'],
  { kind: 'answer' }
>['items'][number]['result'];

export function AskMerchantGroupCard({
  onEditingChange,
  onRendererReady,
  onSubmit,
  pending = false,
  request,
}: {
  onEditingChange: (editing: boolean) => Promise<void>;
  onRendererReady: () => Promise<void>;
  onSubmit: (response: AskMerchantAnswer['response']) => Promise<void>;
  pending?: boolean;
  request: AskMerchantQuestionRequest;
}) {
  const [results, setResults] = useState<Record<string, ItemResult>>({});

  useEffect(() => setResults({}), [request.requestId, request.revision]);
  useEffect(() => {
    void onRendererReady();
  }, [onRendererReady, request.requestId, request.revision]);

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
              ) : (
                <Input
                  aria-label={question.question}
                  disabled={pending}
                  onBlur={() => void onEditingChange(false)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setResults((current) => ({
                      ...current,
                      [question.itemId]: value.trim()
                        ? { kind: 'answer', value }
                        : { kind: 'deferred' },
                    }));
                  }}
                  onFocus={() => void onEditingChange(true)}
                  placeholder="也可以直接告诉我"
                  value={selected?.kind === 'answer' ? selected.value : ''}
                />
              )}
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
