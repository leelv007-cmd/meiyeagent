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
  WRITE_OWNERSHIP_MISSING: 409,
};

/**
 * V31-55 residual: fence / stale codes are merchant-visible and must not fall
 * through to a generic 500 or be remapped as IDEMPOTENCY_CONFLICT.
 */
export const ADMISSION_HTTP_STATUSES = {
  CONTEXT_FENCE_MISMATCH: 409,
  SNAPSHOT_STALE: 409,
  RIGHTS_FENCE_MISMATCH: 409,
  IDEMPOTENCY_CONFLICT: 409,
} as const;

export type AdmissionHttpCode = keyof typeof ADMISSION_HTTP_STATUSES;

/**
 * Merchant-facing copy for fence/stale codes (no internal jargon).
 * IDEMPOTENCY_CONFLICT keeps its domain message when present.
 */
export const ADMISSION_MERCHANT_MESSAGES = {
  CONTEXT_FENCE_MISMATCH:
    '当前方案所依据的资料或上下文已变化，请重新确认后再执行。',
  SNAPSHOT_STALE: '当前确认方案已过期，请按最新方案重新确认后再执行。',
  RIGHTS_FENCE_MISMATCH: '素材授权已变更或撤销，无法按原确认方案继续执行。',
} as const satisfies Record<
  Exclude<AdmissionHttpCode, 'IDEMPOTENCY_CONFLICT'>,
  string
>;

export function isAdmissionHttpCode(code: string): code is AdmissionHttpCode {
  return Object.prototype.hasOwnProperty.call(ADMISSION_HTTP_STATUSES, code);
}

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

  // V31-55: preserve admission fence/stale codes through the HTTP boundary.
  // Must run before the generic shaped path so merchant copy is applied, and
  // before the unknown fallback so codes without status still map to 409.
  const admission = asAdmissionHttpError(error);
  if (admission) {
    return admission;
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

function asAdmissionHttpError(error: unknown): HttpError | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  if (typeof code !== 'string' || !isAdmissionHttpCode(code)) {
    return undefined;
  }
  const merchant =
    code in ADMISSION_MERCHANT_MESSAGES
      ? ADMISSION_MERCHANT_MESSAGES[
          code as keyof typeof ADMISSION_MERCHANT_MESSAGES
        ]
      : undefined;
  return {
    code,
    details: errorDetails(error as { details?: unknown }),
    message:
      merchant ??
      (error instanceof Error
        ? error.message
        : '该执行请求与已有记录冲突，请刷新后重试。'),
    status: ADMISSION_HTTP_STATUSES[code],
  };
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
