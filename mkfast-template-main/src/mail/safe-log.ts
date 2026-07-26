import { safeErrorFields } from '@/auth/safe-log';

type RequiredMailField = 'from' | 'html' | 'subject' | 'to';

export function requiredMailFieldNames(input: {
  from?: string;
  html?: string;
  subject?: string;
  to?: string;
}): RequiredMailField[] {
  return (['from', 'to', 'subject', 'html'] as const).filter(
    (field) => !input[field]
  );
}

export function logMissingMailFields(
  provider: string,
  input: {
    from?: string;
    html?: string;
    subject?: string;
    to?: string;
  }
) {
  console.warn('[mail] Required fields missing', {
    event: 'MAIL_REQUIRED_FIELDS_MISSING',
    missingFields: requiredMailFieldNames(input),
    provider,
  });
}

export function logMailError(provider: string, event: string, error: unknown) {
  console.error('[mail] Operation failed', {
    event,
    provider,
    ...safeErrorFields(error),
  });
}
