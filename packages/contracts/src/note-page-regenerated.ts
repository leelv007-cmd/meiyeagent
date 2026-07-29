import { z } from 'zod';

export const notePageRegeneratedTriggerSchema = z.enum([
  'user_selection',
  'check_violation',
]);

const notePageRegeneratedBaseShape = {
  auditRef: z.string().trim().min(1),
  pageId: z.string().trim().min(1),
  trigger: notePageRegeneratedTriggerSchema,
};

export const notePageRegeneratedPayloadSchema = z.discriminatedUnion('imagePoints', [
  z
    .object({
      ...notePageRegeneratedBaseShape,
      imagePoints: z.literal(0),
      reason: z.string().trim().min(1),
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
