import { emitTelemetry } from '@/lib/product-telemetry';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

export function getContext() {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onError: () =>
        emitTelemetry('query_error', {
          action: 'mutation',
          errorCode: 'mutation_failed',
          module: 'tanstack-query',
        }),
    }),
    queryCache: new QueryCache({
      onError: () =>
        emitTelemetry('query_error', {
          action: 'query',
          errorCode: 'query_failed',
          module: 'tanstack-query',
        }),
    }),
  });
  return {
    queryClient,
  };
}

export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
