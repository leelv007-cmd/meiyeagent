import { z } from 'zod';

const editingContextIdSchema = z.string().trim().min(1);

export const editingContextSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('layout_work'),
      revisionId: editingContextIdSchema,
      workId: editingContextIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('advanced_canvas'),
      projectId: editingContextIdSchema,
      revisionId: editingContextIdSchema,
    })
    .strict(),
  z
    .object({
      assetId: editingContextIdSchema,
      kind: z.literal('asset'),
    })
    .strict(),
]);

export type EditingContext = z.infer<typeof editingContextSchema>;
export type AdvancedCanvasEditingContext = Extract<
  EditingContext,
  { kind: 'advanced_canvas' }
>;
