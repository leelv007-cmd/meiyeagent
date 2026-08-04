import { z } from 'zod';
import { nonEmptyTrimmedStringSchema } from './identifiers.js';

import { imageIntentSchema } from './image-intent.js';

export const NOTE_PLAN_SCHEMA = 'note-plan/v1' as const;
export const NOTE_STYLE_CONFIG_KEY = 'harness.note.styles';
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
    title: nonEmptyTrimmedStringSchema,
    body: nonEmptyTrimmedStringSchema,
    exactText: z.array(nonEmptyTrimmedStringSchema),
  })
  .strict();

export const notePlanPageSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    order: z.number().int().positive(),
    revision: z.number().int().positive(),
    pageRole: notePlanPageRoleSchema,
    pagePurpose: notePlanPagePurposeSchema,
    imageIntent: imageIntentSchema,
    textBlock: notePlanTextBlockSchema,
    dependencies: z.array(
      z
        .object({
          pageId: nonEmptyTrimmedStringSchema,
          kind: z.enum(['text_sequence', 'visual_reference']),
        })
        .strict(),
    ),
    imageAssetId: nonEmptyTrimmedStringSchema.optional(),
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
    themeAnchor: nonEmptyTrimmedStringSchema,
    style: z
      .object({
        id: nonEmptyTrimmedStringSchema,
        name: nonEmptyTrimmedStringSchema,
        positioning: nonEmptyTrimmedStringSchema,
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
    id: nonEmptyTrimmedStringSchema,
    name: nonEmptyTrimmedStringSchema,
    writingGuide: nonEmptyTrimmedStringSchema,
    structureTemplate: nonEmptyTrimmedStringSchema,
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


const noteStyleCandidateSchema = z
  .object({
    styleId: nonEmptyTrimmedStringSchema,
    styleName: nonEmptyTrimmedStringSchema,
    positioning: nonEmptyTrimmedStringSchema,
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
            reason: nonEmptyTrimmedStringSchema,
            pageIds: z.array(nonEmptyTrimmedStringSchema),
          })
          .strict(),
      )
      .length(NOTE_PLAN_CONSISTENCY_DIMENSIONS.length),
    regenerationPageIds: z.array(nonEmptyTrimmedStringSchema),
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
          pageId: nonEmptyTrimmedStringSchema,
          fromRevision: z.number().int().positive(),
          toRevision: z.number().int().positive(),
          imagePoints: z.literal(1),
          reason: z.enum(['merchant_request', 'consistency_conflict']),
          auditRef: nonEmptyTrimmedStringSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type NotePlan = z.infer<typeof notePlanSchema>;
export type NoteStyleConfig = z.infer<typeof noteStyleConfigSchema>;

/**
 * 运营没改过时，图文笔记编译器按这两种风格出候选。
 * 放在契约里是因为后台的风格编辑器也要拿它当起点——运营打开编辑器时
 * 看到的必须就是此刻真正在用的那份，而不是一张空表（U05 / D-107）。
 */
export const DEFAULT_NOTE_STYLES: NoteStyleConfig = {
  styles: [
    {
      id: 'practical_guide',
      name: '干货科普版',
      writingGuide: '用清楚、可信、便于收藏的方式解释项目与选择依据。',
      structureTemplate: '结论先行，再解释场景、方案、事实与行动建议。',
      platforms: ['xiaohongshu', 'douyin', 'video_account'],
    },
    {
      id: 'story_recommendation',
      name: '种草叙事版',
      writingGuide: '从顾客场景切入，以真实体验路径承接预约行动。',
      structureTemplate: '场景共鸣、需求展开、方案呈现、行动建议。',
      platforms: ['xiaohongshu', 'douyin', 'video_account'],
    },
  ],
};
export type NoteStyleCandidates = z.infer<typeof noteStyleCandidatesSchema>;
export type NotePlanConsistencyEvaluation = z.infer<
  typeof notePlanConsistencyEvaluationSchema
>;
export type ImageTextNoteVersion = z.infer<typeof imageTextNoteVersionSchema>;
