import { z } from 'zod';
import { nonEmptyTrimmedStringSchema } from './identifiers.js';

export const notePageRegeneratedTriggerSchema = z.enum([
  'user_selection',
  'check_violation',
]);

const notePageRegeneratedBaseShape = {
  auditRef: nonEmptyTrimmedStringSchema,
  pageId: nonEmptyTrimmedStringSchema,
  trigger: notePageRegeneratedTriggerSchema,
};

export const notePageRegeneratedPayloadSchema = z.discriminatedUnion('imagePoints', [
  z
    .object({
      ...notePageRegeneratedBaseShape,
      imagePoints: z.literal(0),
      reason: nonEmptyTrimmedStringSchema,
      side: z.literal('text'),
    })
    .strict(),
  z
    .object({
      ...notePageRegeneratedBaseShape,
      imagePoints: z.literal(1),
    })
    .strict(),
]);

export const notePageRegeneratedEventSchema = z
  .object({
    eventType: z.literal('note_page_regenerated'),
    payload: notePageRegeneratedPayloadSchema,
  })
  .strict();

export type NotePageRegeneratedEvent = z.infer<
  typeof notePageRegeneratedEventSchema
>;

export type NotePageRegeneratedTrigger = z.infer<
  typeof notePageRegeneratedTriggerSchema
>;
