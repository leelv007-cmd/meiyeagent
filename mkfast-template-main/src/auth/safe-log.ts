interface SafeErrorFields {
  errorCode?: string;
  errorName: string;
  errorStatus?: string;
}

const SAFE_IDENTIFIER = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value)
    ? value
    : undefined;
}

export function safeErrorFields(error: unknown): SafeErrorFields {
  const errorRecord = record(error);
  const body = record(errorRecord?.body);
  const name = errorRecord?.name;
  return {
    ...(safeIdentifier(body?.code ?? errorRecord?.code)
      ? { errorCode: safeIdentifier(body?.code ?? errorRecord?.code) }
      : {}),
    errorName:
      typeof name === 'string' && SAFE_ERROR_NAME.test(name)
        ? name
        : 'UnknownError',
    ...(safeIdentifier(errorRecord?.status)
      ? { errorStatus: safeIdentifier(errorRecord?.status) }
      : {}),
  };
}
