import type {
  ComposerQuoteReadiness,
  ComposerQuoteRetryTarget,
} from './quote-readiness';

/**
 * The one line under the prompt bar that says where the quote stands (#240).
 *
 * It renders what `resolveComposerQuoteReadiness` decided and nothing else: no
 * state is inferred here, and a retry only appears when the state machine says
 * retrying can change the outcome.
 */
export function ComposerQuoteStatusLine({
  onRetry,
  readiness,
}: {
  onRetry: (target: Exclude<ComposerQuoteRetryTarget, null>) => void;
  readiness: ComposerQuoteReadiness;
}) {
  if (!readiness.message) return null;
  const retry = readiness.retry;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-muted text-xs"
      data-quote-state={readiness.state}
      data-testid="composer-quote-status"
    >
      <output>{readiness.message}</output>
      {retry ? (
        <button
          className="font-medium underline underline-offset-4"
          data-testid="composer-quote-retry"
          onClick={() => onRetry(retry)}
          type="button"
        >
          重新读取
        </button>
      ) : null}
    </div>
  );
}
