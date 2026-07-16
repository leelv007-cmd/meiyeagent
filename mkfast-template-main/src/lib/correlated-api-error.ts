import { common_correlation_id } from '@/locale/paraglide/messages';

export function correlatedApiErrorMessage(
  message: string,
  correlationId?: string
) {
  const normalizedCorrelationId = correlationId?.trim();
  return normalizedCorrelationId
    ? `${message}\n${common_correlation_id({ id: normalizedCorrelationId })}`
    : message;
}

const CORRELATION_ID_PATTERN =
  /(?:^|\n)(?:关联 ID：|Correlation ID:\s*)([^\s]+)/;

export function friendlyProductError(error: unknown, description: string) {
  const rawMessage = error instanceof Error ? error.message : '';
  const correlationId = rawMessage.match(CORRELATION_ID_PATTERN)?.[1]?.trim();
  return {
    description,
    ...(correlationId ? { correlationId } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseApiErrorEnvelope(value: unknown, fallback: string) {
  const envelope = record(value);
  const error = envelope?.error;
  const structuredError = record(error);
  const details = record(structuredError?.details);
  const meta = record(envelope?.meta);
  const correlationId =
    typeof meta?.correlationId === 'string' ? meta.correlationId : undefined;
  const code =
    typeof structuredError?.code === 'string'
      ? structuredError.code
      : undefined;
  const message =
    typeof error === 'string'
      ? error
      : typeof structuredError?.message === 'string'
        ? structuredError.message
        : fallback;
  return {
    ...(code ? { code } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(details ? { details } : {}),
    message,
  };
}
