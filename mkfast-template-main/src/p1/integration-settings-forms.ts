import { z } from 'zod';

import {
  integration_form_json_object_required,
  integration_form_json_required,
  integration_form_scopes_required,
  integration_form_secret_required,
  integration_form_secret_too_long,
  integration_form_subject_too_long,
} from '@/locale/paraglide/messages';

const nonEmptySecret = z
  .string()
  .trim()
  .min(1, integration_form_secret_required())
  .max(65_536, integration_form_secret_too_long());

const scopeList = z
  .string()
  .trim()
  .min(1, integration_form_scopes_required())
  .refine(
    (value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean).length > 0,
    integration_form_scopes_required()
  );

function isJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return (
      Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

export const createIntegrationConnectionSchema = z.object({
  capabilities: z.array(z.string().trim().min(1)),
  provider: z.enum(['model', 'feishu']),
  scopes: scopeList,
  secret: nonEmptySecret,
  subject: z.string().trim().max(256, integration_form_subject_too_long()),
});

export const rotateIntegrationCredentialSchema = z.object({
  secret: nonEmptySecret,
});

export const feishuArgumentsFormSchema = z.object({
  rawArguments: z
    .string()
    .trim()
    .min(1, integration_form_json_required())
    .refine(isJsonObject, integration_form_json_object_required()),
});

export type CreateIntegrationConnectionInput = z.infer<
  typeof createIntegrationConnectionSchema
>;
export type RotateIntegrationCredentialInput = z.infer<
  typeof rotateIntegrationCredentialSchema
>;
export type FeishuArgumentsFormInput = z.infer<
  typeof feishuArgumentsFormSchema
>;

export function integrationScopes(value: string) {
  return scopeList
    .parse(value)
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function feishuArguments(value: string) {
  const parsed = feishuArgumentsFormSchema.parse({ rawArguments: value });
  return JSON.parse(parsed.rawArguments) as Record<string, unknown>;
}
export interface ConnectionCreationAttempt {
  connectionId: string;
  idempotencyKey: string;
  submissionFingerprint: string;
}

export async function runConnectionCreationAttempt(input: {
  attempt?: ConnectionCreationAttempt;
  createConnectionId: () => string;
  createIdempotencyKey: () => string;
  submissionFingerprint: string;
  submit: (attempt: ConnectionCreationAttempt) => Promise<boolean>;
}) {
  const attempt =
    input.attempt?.submissionFingerprint === input.submissionFingerprint
      ? input.attempt
      : {
          connectionId: input.createConnectionId(),
          idempotencyKey: input.createIdempotencyKey(),
          submissionFingerprint: input.submissionFingerprint,
        };
  const succeeded = await input.submit(attempt);
  return {
    attempt: succeeded ? undefined : attempt,
    succeeded,
  };
}

export interface CredentialRotationAttempt {
  idempotencyKey: string;
  secret: string;
}

export async function runCredentialRotationAttempt(input: {
  attempt?: CredentialRotationAttempt;
  createIdempotencyKey: () => string;
  secret: string;
  submit: (idempotencyKey: string) => Promise<boolean>;
}) {
  const attempt =
    input.attempt?.secret === input.secret
      ? input.attempt
      : {
          idempotencyKey: input.createIdempotencyKey(),
          secret: input.secret,
        };
  const succeeded = await input.submit(attempt.idempotencyKey);
  return {
    attempt: succeeded ? undefined : attempt,
    succeeded,
  };
}
