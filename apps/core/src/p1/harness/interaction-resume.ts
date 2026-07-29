import {
  harnessInteractionAnswerSchema,
  type HarnessInteractionAnswer,
} from '@meiye/contracts';
import { z } from 'zod';

import { fingerprintValue } from '../job-runtime/job-contracts.js';

const interactionResolutionSourceSchema = z.enum([
  'decision',
  'system_default',
]);

export const harnessInteractionResolutionEventPayloadSchema = z
  .object({
    kind: z.literal('harness_interaction_resolution'),
    schemaVersion: z.literal('v1'),
    interactionKind: z.enum([
      'ask_merchant',
      'execution_confirmation',
    ]),
    answer: harnessInteractionAnswerSchema,
    resumeData: z.unknown(),
    resolutionSource: interactionResolutionSourceSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (
      interactionKind(event.answer) !== event.interactionKind ||
      fingerprintValue(event.answer.response) !==
        fingerprintValue(event.resumeData)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Interaction resume data does not match its typed answer.',
      });
    }
  });

export const harnessInteractionResumeSignalSchema = z
  .object({
    kind: z.literal('harness_interaction_resume'),
    schemaVersion: z.literal('v1'),
    idempotencyKey: z.string().trim().min(1),
    interactionKind: z.enum([
      'ask_merchant',
      'execution_confirmation',
    ]),
    requestId: z.string().trim().min(1),
    revision: z.number().int().nonnegative(),
    runId: z.string().trim().min(1),
    step: z.string().trim().min(1),
    resumeData: z.unknown(),
    resolutionSource: interactionResolutionSourceSchema,
  })
  .strict();

export type HarnessInteractionResumeSignal = z.infer<
  typeof harnessInteractionResumeSignalSchema
>;

export function interactionKind(
  answer: HarnessInteractionAnswer,
): HarnessInteractionResumeSignal['interactionKind'] {
  return answer.response.kind === 'answer' ||
    answer.response.kind === 'skipped'
    ? 'ask_merchant'
    : 'execution_confirmation';
}

export function interactionResumeSignalFromEvent(input: {
  idempotencyKey: string;
  payload: unknown;
  questionId: string;
  resolutionSource: string;
  runId: string;
  workflowRevision: number;
}) {
  const event = harnessInteractionResolutionEventPayloadSchema.parse(
    input.payload,
  );
  if (
    event.answer.idempotencyKey !== input.idempotencyKey ||
    event.answer.requestId !== input.questionId ||
    event.answer.revision !== input.workflowRevision ||
    event.answer.resume.runId !== input.runId ||
    event.resolutionSource !== input.resolutionSource
  ) {
    throw new Error(
      'Persisted interaction resume authority does not match its event row.',
    );
  }
  return harnessInteractionResumeSignalSchema.parse({
    kind: 'harness_interaction_resume',
    schemaVersion: event.schemaVersion,
    idempotencyKey: input.idempotencyKey,
    interactionKind: event.interactionKind,
    requestId: event.answer.requestId,
    revision: event.answer.revision,
    runId: event.answer.resume.runId,
    step: event.answer.resume.step,
    resumeData: event.resumeData,
    resolutionSource: event.resolutionSource,
  });
}
