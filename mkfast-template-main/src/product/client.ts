import {
  apiEnvelopeSchema,
  type CommandResult,
  type ProductCommand,
  type ProductState,
} from '@meiye/contracts';
import { z } from 'zod';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  correlatedApiErrorMessage,
  parseApiErrorEnvelope,
} from '@/lib/correlated-api-error';
import { emitTelemetry, telemetryFetch } from '@/lib/product-telemetry';
import {
  product_client_command_failed,
  product_client_conflict,
  product_client_forbidden,
  product_client_not_found,
  product_client_rate_limited,
  product_client_request_failed,
  product_client_state_failed,
  product_client_unauthorized,
  product_client_unavailable,
} from '@/locale/paraglide/messages';
import { P1RequestError } from '@/p1/client';

function productFailureMessage(status: number) {
  if (status === 401) return product_client_unauthorized();
  if (status === 403) return product_client_forbidden();
  if (status === 404) return product_client_not_found();
  if (status === 409) return product_client_conflict();
  if (status === 429) return product_client_rate_limited();
  if (status >= 500) return product_client_unavailable();
  return product_client_request_failed();
}

export async function readProductEnvelope<T>(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(productFailureMessage(response.status));
  }
  const parsed = apiEnvelopeSchema(z.unknown()).safeParse(body);
  if (!parsed.success) {
    throw new Error(productFailureMessage(response.status));
  }
  const payload = parsed.data;
  if (!response.ok || 'error' in payload) {
    const failure = parseApiErrorEnvelope(
      payload,
      productFailureMessage(response.status)
    );
    throw new P1RequestError(
      correlatedApiErrorMessage(
        productFailureMessage(response.status),
        failure.correlationId
      ),
      failure.code,
      failure.details,
      response.status
    );
  }
  return payload.data as T;
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
  const snapshotRef = useRef<ProductState | undefined>(undefined);
  const correlationId = useRef<string | undefined>(undefined);
  if (!correlationId.current && typeof window !== 'undefined') {
    correlationId.current =
      sessionStorage.getItem('meiye-correlation-id') ??
      `corr-${crypto.randomUUID()}`;
    sessionStorage.setItem('meiye-correlation-id', correlationId.current);
  }

  const refresh = useCallback(async (): Promise<ProductState | undefined> => {
    // Background refresh must not look like a first load; keep the last
    // ready snapshot on screen while the request is in flight.
    if (!snapshotRef.current) {
      setLoading(true);
    }
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
      const next = await readProductEnvelope<ProductState>(response);
      snapshotRef.current = next;
      setState(next);
      return next;
    } catch {
      setError(product_client_state_failed());
      return undefined;
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
        snapshotRef.current = result.state;
        setState(result.state);
        return result;
      } catch (error) {
        if (error instanceof P1RequestError) {
          setError(error.message);
          throw error;
        }
        const failure = new Error(product_client_command_failed());
        setError(failure.message);
        throw failure;
      } finally {
        setPending(false);
      }
    },
    []
  );

  return { state, error, loading, pending, refresh, execute };
}
