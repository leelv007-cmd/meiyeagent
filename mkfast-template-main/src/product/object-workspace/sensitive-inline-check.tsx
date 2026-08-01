import {
  SENSITIVE_SCAN_LIMITS,
  sensitiveScanResultSchema,
  type SensitiveScanResult,
  type SensitiveWordHit,
} from '@meiye/contracts';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { boundedQueryP1 } from '@/p1/client';

import { canApplySensitiveScan } from './sensitive-inline-check-model';

export const SENSITIVE_INLINE_DEBOUNCE_MS = 300;
export const SENSITIVE_INLINE_TIMEOUT_MS = 10_000;

export type SensitiveInlineSnapshot = {
  requestText: string;
  scan: SensitiveScanResult;
};

export type SensitiveInlineReplacementRequest = {
  requestText: string;
  hit: SensitiveWordHit;
  replacement: string;
};

export type SensitiveInlineCheckProps = {
  text: string;
  onSnapshotChange: (snapshot: SensitiveInlineSnapshot | null) => void;
  onReplace: (request: SensitiveInlineReplacementRequest) => boolean;
};

type ViewState =
  | { kind: 'checking' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; snapshot: SensitiveInlineSnapshot };

const FAILED_MESSAGE = '违禁词检查未完成，已清除标记。请重试。';

export function SensitiveInlineCheck(props: SensitiveInlineCheckProps) {
  const currentTextRef = useRef(props.text);
  const onSnapshotChangeRef = useRef(props.onSnapshotChange);
  const onReplaceRef = useRef(props.onReplace);
  const [retryRevision, setRetryRevision] = useState(0);
  const [state, setState] = useState<ViewState>({ kind: 'checking' });

  currentTextRef.current = props.text;
  onSnapshotChangeRef.current = props.onSnapshotChange;
  onReplaceRef.current = props.onReplace;

  useEffect(() => {
    const requestText = props.text;
    const controller = new AbortController();
    onSnapshotChangeRef.current(null);

    if (requestText.length > SENSITIVE_SCAN_LIMITS.maxTextLength) {
      setState({
        kind: 'failed',
        message: `正文最多 ${SENSITIVE_SCAN_LIMITS.maxTextLength.toLocaleString('en-US')} 个字符，请缩短后重试。`,
      });
      return () => controller.abort();
    }

    setState({ kind: 'checking' });
    const timer = setTimeout(() => {
      void boundedQueryP1<unknown>(
        'sensitive-words',
        { action: 'scan', payload: { text: requestText } },
        { signal: controller.signal, timeoutMs: SENSITIVE_INLINE_TIMEOUT_MS }
      )
        .then((response) => {
          if (controller.signal.aborted) return;
          const scan = sensitiveScanResultSchema.parse(response);
          if (
            !canApplySensitiveScan({
              currentText: currentTextRef.current,
              requestText,
              scan,
            })
          ) {
            throw new Error('Sensitive scan no longer matches its source.');
          }
          const snapshot = { requestText, scan };
          setState({ kind: 'ready', snapshot });
          onSnapshotChangeRef.current(snapshot);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          onSnapshotChangeRef.current(null);
          setState({ kind: 'failed', message: FAILED_MESSAGE });
        });
    }, SENSITIVE_INLINE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [props.text, retryRevision]);

  const retry = () => {
    onSnapshotChangeRef.current(null);
    setState({ kind: 'checking' });
    setRetryRevision((revision) => revision + 1);
  };

  return (
    <section
      className="space-y-2 rounded-md border p-3"
      data-testid="sensitive-inline-check"
      aria-label="违禁词检查"
    >
      {state.kind === 'checking' ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="sensitive-inline-status"
          aria-live="polite"
        >
          正在检查违禁词…
        </p>
      ) : state.kind === 'failed' ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{state.message}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="sensitive-inline-retry"
            onClick={retry}
          >
            重新检查
          </Button>
        </div>
      ) : state.snapshot.scan.hitCount === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="sensitive-inline-status"
          aria-live="polite"
        >
          未检出违禁词
        </p>
      ) : (
        <div className="space-y-2">
          <p
            className="text-sm text-destructive"
            data-testid="sensitive-inline-status"
            aria-live="polite"
          >
            检出 {state.snapshot.scan.hitCount} 处违禁词
          </p>
          <ul className="space-y-2">
            {state.snapshot.scan.hits.map((hit) => (
              <li
                key={`${hit.wordId}:${hit.index}`}
                className="space-y-1 rounded-md bg-muted p-2 text-sm"
              >
                <p>“{hit.word}”</p>
                {hit.replacements.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {hit.replacements.map((replacement) => (
                      <Button
                        key={replacement}
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`将“${hit.word}”替换为“${replacement}”`}
                        onClick={() => {
                          const applied = onReplaceRef.current({
                            requestText: state.snapshot.requestText,
                            hit,
                            replacement,
                          });
                          onSnapshotChangeRef.current(null);
                          if (applied) {
                            setState({ kind: 'checking' });
                          } else {
                            setState({
                              kind: 'failed',
                              message: FAILED_MESSAGE,
                            });
                          }
                        }}
                      >
                        替换为“{replacement}”
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
