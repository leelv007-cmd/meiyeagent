import { emitTelemetry } from '@/lib/product-telemetry';
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

function isChunkFailure(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return /chunk|dynamically imported module|loading css/i.test(message);
}

export function TelemetryReporter() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    emitTelemetry('route_loaded', {
      durationMs: navigation?.duration ?? 0,
      route: pathname,
    });
  }, [pathname]);

  useEffect(() => {
    emitTelemetry('version_observed');
    const onError = (event: ErrorEvent) => {
      emitTelemetry(
        isChunkFailure(event.error ?? event.message)
          ? 'chunk_error'
          : 'page_error',
        {
          errorCode: isChunkFailure(event.error ?? event.message)
            ? 'chunk_load_failed'
            : 'runtime_error',
          route: window.location.pathname,
        }
      );
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      emitTelemetry(
        isChunkFailure(event.reason) ? 'chunk_error' : 'page_error',
        {
          errorCode: isChunkFailure(event.reason)
            ? 'chunk_load_failed'
            : 'promise_rejection',
          route: window.location.pathname,
        }
      );
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
