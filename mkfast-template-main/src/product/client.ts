import type {
  ApiEnvelope,
  CommandResult,
  ProductCommand,
  ProductState,
} from '@meiye/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  correlatedApiErrorMessage,
  parseApiErrorEnvelope,
} from '@/lib/correlated-api-error';
import { emitTelemetry, telemetryFetch } from '@/lib/product-telemetry';
import { m } from '@/locale/paraglide/messages';

function productFailureMessage(status: number) {
  if (status === 401) return m.product_client_unauthorized();
  if (status === 403) return m.product_client_forbidden();
  if (status === 404) return m.product_client_not_found();
  if (status === 409) return m.product_client_conflict();
  if (status === 429) return m.product_client_rate_limited();
  if (status >= 500) return m.product_client_unavailable();
  return m.product_client_request_failed();
}

export async function readProductEnvelope<T>(response: Response) {
  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(productFailureMessage(response.status));
  }
  if (!response.ok || 'error' in payload) {
    const failure = parseApiErrorEnvelope(
      payload,
      productFailureMessage(response.status)
    );
    throw new Error(
      correlatedApiErrorMessage(
        productFailureMessage(response.status),
        failure.correlationId
      )
    );
  }
  return payload.data;
}

export async function executeProductCommand(
  command: ProductCommand,
  idempotencyKey: string
) {
  const correlationId =
    typeof window === 'undefined'
      ? `corr-${crypto.randomUUID()}`
      : (sessionStorage.getItem('meiye-correlation-id') ??
        `corr-${crypto.randomUUID()}`);
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('meiye-correlation-id', correlationId);
  }
  const response = await telemetryFetch('/api/core/product/commands', {
    body: JSON.stringify(command),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'x-correlation-id': correlationId,
    },
    method: 'POST',
  });
  if (response.status === 403) {
    emitTelemetry('permission_denied', {
      capability: 'content.write',
      surface: `product.${command.type}`,
    });
  }
  return readProductEnvelope<CommandResult>(response);
}

export function useProductState() {
  const [state, setState] = useState<ProductState>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const correlationId = useRef<string | undefined>(undefined);
  if (!correlationId.current && typeof window !== 'undefined') {
    correlationId.current =
      sessionStorage.getItem('meiye-correlation-id') ??
      `corr-${crypto.randomUUID()}`;
    sessionStorage.setItem('meiye-correlation-id', correlationId.current);
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await telemetryFetch('/api/core/product/state', {
        credentials: 'same-origin',
      });
      if (response.status === 403) {
        emitTelemetry('permission_denied', {
          capability: 'workspace.read',
          surface: 'product.state',
        });
      }
      setState(await readProductEnvelope<ProductState>(response));
    } catch {
      setError(m.product_client_state_failed());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const execute = useCallback(
    async (command: ProductCommand, idempotencyKey?: string) => {
      setPending(true);
      setError(undefined);
      try {
        const response = await telemetryFetch('/api/core/product/commands', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey ?? crypto.randomUUID(),
            'x-correlation-id':
              correlationId.current ?? `corr-${crypto.randomUUID()}`,
          },
          body: JSON.stringify(command),
        });
        if (response.status === 403) {
          emitTelemetry('permission_denied', {
            capability: 'content.write',
            surface: `product.${command.type}`,
          });
        }
        const result = await readProductEnvelope<CommandResult>(response);
        setState(result.state);
        return result;
      } catch {
        const error = new Error(m.product_client_command_failed());
        setError(error.message);
        throw error;
      } finally {
        setPending(false);
      }
    },
    []
  );

  return { state, error, loading, pending, refresh, execute };
}
