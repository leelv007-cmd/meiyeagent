import { z } from 'zod';

import { imageIntentSchema } from './image-intent.js';

export const NOTE_PLAN_SCHEMA = 'note-plan/v1' as const;
export const NOTE_STYLE_CONFIG_KEY = 'harness.note.styles';
export const NOTE_CONFIRMATION_TIMEOUT_CONFIG_KEY =
  'harness.note.confirmation.timeout_seconds';
export const MIN_NOTE_PLAN_PAGE_COUNT = 2;
export const MAX_NOTE_PLAN_PAGE_COUNT = 12;

export const NOTE_PLAN_PAGE_ROLES = [
  'cover',
  'pain_scene',
  'solution_show',
  'work_case',
  'price_offer',
  'cta_guide',
] as const;

export const NOTE_PLAN_PAGE_PURPOSES = [
  'capture_attention',
  'name_customer_pain',
  'explain_solution',
  'prove_with_case',
  'present_offer',
  'drive_action',
] as const;

export const NOTE_PLAN_CONSISTENCY_DIMENSIONS = [
  'theme_continuity',
  'visual_consistency',
  'non_repetition',
  'role_coverage',
  'image_text_cross_reference',
] as const;

export const notePlanPageRoleSchema = z.enum(NOTE_PLAN_PAGE_ROLES);
export const notePlanPagePurposeSchema = z.enum(NOTE_PLAN_PAGE_PURPOSES);
export const notePlanConsistencyDimensionSchema = z.enum(
  NOTE_PLAN_CONSISTENCY_DIMENSIONS,
);

export const notePlanTextBlockSchema = z
  .object({
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    exactText: z.array(z.string().trim().min(1)),
  })
  .strict();

export const notePlanPageSchema = z
  .object({
    id: z.string().trim().min(1),
    order: z.number().int().positive(),
    revision: z.number().int().positive(),
    pageRole: notePlanPageRoleSchema,
    pagePurpose: notePlanPagePurposeSchema,
    imageIntent: imageIntentSchema,
    textBlock: notePlanTextBlockSchema,
    dependencies: z.array(
      z
        .object({
          pageId: z.string().trim().min(1),
          kind: z.enum(['text_sequence', 'visual_reference']),
        })
        .strict(),
    ),
    imageAssetId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.imageIntent.outputPlan.kind !== 'single') {
      context.addIssue({
        code: 'custom',
        message: 'A NotePlan page owns exactly one ImageIntent output.',
        path: ['imageIntent', 'outputPlan'],
      });
    }
    const expected = [...page.textBlock.exactText].sort();
    const actual = page.imageIntent.exactText
      .filter(({ treatment }) => treatment === 'exact')
      .map(({ text }) => text)
      .sort();
    if (
      expected.length !== actual.length ||
      expected.some((text, index) => text !== actual[index])
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'NotePlan textBlock.exactText must match the page ImageIntent exact text.',
        path: ['textBlock', 'exactText'],
      });
    }
  });

export const notePlanSchema = z
  .object({
    schema: z.literal(NOTE_PLAN_SCHEMA),
    themeAnchor: z.string().trim().min(1),
    style: z
      .object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        positioning: z.string().trim().min(1),
      })
      .strict(),
    pages: z
      .array(notePlanPageSchema)
      .min(MIN_NOTE_PLAN_PAGE_COUNT)
      .max(MAX_NOTE_PLAN_PAGE_COUNT),
  })
  .strict()
  .superRefine((plan, context) => {
    const ids = plan.pages.map(({ id }) => id);
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'NotePlan page ids must be unique.',
        path: ['pages'],
      });
    }
    if (plan.pages.some(({ order }, index) => order !== index + 1)) {
      context.addIssue({
        code: 'custom',
        message: 'NotePlan pages must have one complete ordered sequence.',
        path: ['pages'],
      });
    }
    for (const [pageIndex, page] of plan.pages.entries()) {
      for (const [dependencyIndex, dependency] of page.dependencies.entries()) {
        const dependencyPage = plan.pages.find(
          ({ id }) => id === dependency.pageId,
        );
        if (!dependencyPage || dependencyPage.id === page.id) {
          context.addIssue({
            code: 'custom',
            message: 'A NotePlan dependency must reference another page.',
            path: ['pages', pageIndex, 'dependencies', dependencyIndex, 'pageId'],
          });
          continue;
        }
        if (
          dependency.kind === 'text_sequence' &&
          dependencyPage.order >= page.order
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'Text dependencies must point to an earlier page for serial execution.',
            path: ['pages', pageIndex, 'dependencies', dependencyIndex, 'pageId'],
          });
        }
      }
    }
  });

export const noteStyleDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    writingGuide: z.string().trim().min(1),
    structureTemplate: z.string().trim().min(1),
    platforms: z
      .array(z.enum(['xiaohongshu', 'douyin', 'video_account']))
      .min(1),
  })
  .strict();

export const noteStyleConfigSchema = z
  .object({
    styles: z.array(noteStyleDefinitionSchema).min(1).max(6),
  })
  .strict()
  .superRefine((config, context) => {
    const ids = config.styles.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'Note style ids must be unique.',
        path: ['styles'],
      });
    }
  });

export const noteConfirmationTimeoutSchema = z.number().int().min(5).max(300);

const noteStyleCandidateSchema = z
  .object({
    styleId: z.string().trim().min(1),
    styleName: z.string().trim().min(1),
    positioning: z.string().trim().min(1),
    plan: notePlanSchema,
  })
  .strict();

export function noteStyleCandidatesSchemaFor(count: number) {
  return z
    .object({
      candidates: z.array(noteStyleCandidateSchema).length(count),
    })
    .strict();
}

export const DEFAULT_NOTE_STYLE_COUNT = 2;
export const noteStyleCandidatesSchema = noteStyleCandidatesSchemaFor(
  DEFAULT_NOTE_STYLE_COUNT,
);

export const notePlanConsistencyEvaluationSchema = z
  .object({
    evaluatedAt: z.iso.datetime(),
    dimensions: z
      .array(
        z
          .object({
            dimension: notePlanConsistencyDimensionSchema,
            passed: z.boolean(),
            reason: z.string().trim().min(1),
            pageIds: z.array(z.string().trim().min(1)),
          })
          .strict(),
      )
      .length(NOTE_PLAN_CONSISTENCY_DIMENSIONS.length),
    regenerationPageIds: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((evaluation, context) => {
    const dimensions = evaluation.dimensions.map(({ dimension }) => dimension);
    if (
      new Set(dimensions).size !== NOTE_PLAN_CONSISTENCY_DIMENSIONS.length ||
      NOTE_PLAN_CONSISTENCY_DIMENSIONS.some(
        (dimension) => !dimensions.includes(dimension),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A NotePlan evaluation requires each consistency dimension exactly once.',
        path: ['dimensions'],
      });
    }
  });

export const imageTextNoteVersionSchema = z
  .object({
    schema: z.literal('image-text-note-version/v1'),
    plan: notePlanSchema,
    evaluation: notePlanConsistencyEvaluationSchema.optional(),
    regenerationReceipts: z.array(
      z
        .object({
          pageId: z.string().trim().min(1),
          fromRevision: z.number().int().positive(),
          toRevision: z.number().int().positive(),
          imagePoints: z.literal(1),
          reason: z.enum(['merchant_request', 'consistency_conflict']),
          auditRef: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type NotePlan = z.infer<typeof notePlanSchema>;
export type NoteStyleConfig = z.infer<typeof noteStyleConfigSchema>;
export type NoteStyleCandidates = z.infer<typeof noteStyleCandidatesSchema>;
export type NotePlanConsistencyEvaluation = z.infer<
  typeof notePlanConsistencyEvaluationSchema
>;
export type ImageTextNoteVersion = z.infer<typeof imageTextNoteVersionSchema>;
