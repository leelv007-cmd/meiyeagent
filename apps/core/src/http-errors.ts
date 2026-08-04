import type { ServerResponse } from 'node:http';
import type { ApiEnvelope } from '@meiye/contracts';
import { P1DomainError } from './p1/foundation/index.js';
import { OperationsError } from './p1/operations/application-service.js';
import { DomainError } from './product/product-service.js';

export interface HttpErrorFallback {
  code: string;
  message: string;
  status: number;
  p1DefaultStatus?: number;
  p1Statuses?: Partial<Record<P1DomainError['code'], number>>;
  shapedMessage?: 'error' | 'fallback';
  unknownMessage?: 'error' | 'fallback';
}

export interface HttpError {
  code: string;
  details?: Record<string, unknown>;
  message: string;
  status: number;
}

const P1_HTTP_STATUSES: Record<P1DomainError['code'], number> = {
  COMMANDS_FROZEN: 400,
  FORBIDDEN: 403,
  IDEMPOTENCY_CONFLICT: 409,
  INSUFFICIENT_ENTITLEMENT: 409,
  INVALID_STATE: 400,
  NOT_FOUND: 404,
  P1_WRITE_DISABLED: 400,
};

export function toHttpError(
  error: unknown,
  fallback: HttpErrorFallback
): HttpError {
  if (error instanceof DomainError || error instanceof OperationsError) {
    return {
      code: error.code,
      details: error.details,
      message: error.message,
      status: error.status,
    };
  }
  if (error instanceof P1DomainError) {
    return {
      code: error.code,
      message: error.message,
      status:
        fallback.p1Statuses?.[error.code] ??
        fallback.p1DefaultStatus ??
        P1_HTTP_STATUSES[error.code],
    };
  }
  if (isHttpErrorShaped(error)) {
    return {
      code: error.code,
      details: errorDetails(error),
      message:
        fallback.shapedMessage === 'fallback' || !(error instanceof Error)
          ? fallback.message
          : error.message,
      status: error.status,
    };
  }
  return {
    code: fallback.code,
    message:
      fallback.unknownMessage === 'error' && error instanceof Error
        ? error.message
        : fallback.message,
    status: fallback.status,
  };
}

export async function withErrorEnvelope(
  handler: () => Promise<void> | void,
  input: {
    fallback: HttpErrorFallback;
    includeDetails?: boolean;
    onHeadersSent?: (error: unknown) => Promise<void> | void;
    requestCorrelationId: string;
    response: ServerResponse;
  }
) {
  try {
    await handler();
  } catch (error) {
    if (input.response.headersSent) {
      await input.onHeadersSent?.(error);
      return;
    }
    const translated = toHttpError(error, input.fallback);
    const payload: ApiEnvelope<never> = {
      error: {
        code: translated.code,
        message: translated.message,
        ...(input.includeDetails && translated.details
          ? { details: translated.details }
          : {}),
      },
      meta: { correlationId: input.requestCorrelationId },
    };
    input.response.writeHead(translated.status, {
      'content-type': 'application/json; charset=utf-8',
    });
    input.response.end(JSON.stringify(payload));
  }
}

function isHttpErrorShaped(
  error: unknown
): error is { code: string; details?: unknown; status: number } {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      'status' in error &&
      typeof error.status === 'number'
  );
}

function errorDetails(error: { details?: unknown }) {
  return error.details &&
    typeof error.details === 'object' &&
    !Array.isArray(error.details)
    ? (error.details as Record<string, unknown>)
    : undefined;
}
