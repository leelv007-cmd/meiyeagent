import { z } from 'zod';
import { nonEmptyTrimmedStringSchema } from './identifiers.js';

export const IMAGE_INTENT_OPERATIONS = [
  'image.generate',
  'image.edit',
  'image.reference_transform',
] as const;

export const IMAGE_INTENT_SLOT_KINDS = [
  'subject_person',
  'work_case',
  'store_scene',
  'product',
  'brand_element',
  'style_ref',
  'composition_ref',
] as const;

export const imageIntentOperationSchema = z.enum(IMAGE_INTENT_OPERATIONS);
export const imageIntentSlotKindSchema = z.enum(IMAGE_INTENT_SLOT_KINDS);

const imageIntentProtectedAttributeSchema = z.enum([
  'work_case_surface',
  'hair_shape',
  'skin_condition',
  'person_identity',
  'brand_identity',
  'layout',
]);

const imageIntentReferenceSchema = z
  .object({
    assetId: nonEmptyTrimmedStringSchema,
    assetRevision: nonEmptyTrimmedStringSchema,
    slot: imageIntentSlotKindSchema,
    mimeType: z.string().trim().regex(/^[\w.+-]+\/[\w.+-]+$/u),
    sizeBytes: z.number().int().positive(),
    factRefs: z.array(nonEmptyTrimmedStringSchema),
    rightsRefs: z.array(nonEmptyTrimmedStringSchema),
  })
  .strict()
  .superRefine((reference, context) => {
    if (
      reference.slot === 'subject_person' &&
      reference.rightsRefs.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A person reference requires frozen rights references.',
        path: ['rightsRefs'],
      });
    }
    if (reference.slot === 'work_case' && reference.factRefs.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A work-case reference requires frozen truth references.',
        path: ['factRefs'],
      });
    }
  });

const imageIntentChangeSchema = z
  .object({
    target: imageIntentProtectedAttributeSchema,
    instruction: nonEmptyTrimmedStringSchema,
  })
  .strict();

const imageIntentInvariantSchema = z
  .object({
    target: imageIntentProtectedAttributeSchema,
    requirement: nonEmptyTrimmedStringSchema,
  })
  .strict();

export const imageExactTextSchema = z
  .object({
    text: nonEmptyTrimmedStringSchema,
    treatment: z.enum(['exact', 'creative']),
  })
  .strict();

export const imageOutputPlanSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('single'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set'),
      count: z.number().int().min(2),
      pages: z
        .array(
          z
            .object({
              order: z.number().int().positive(),
              role: nonEmptyTrimmedStringSchema,
            })
            .strict(),
        )
        .min(2),
      consistencyRequirements: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict()
    .superRefine((plan, context) => {
      if (plan.pages.length !== plan.count) {
        context.addIssue({
          code: 'custom',
          message: 'A set output plan requires one page role per image.',
          path: ['pages'],
        });
      }
      const orders = plan.pages.map(({ order }) => order);
      if (
        new Set(orders).size !== plan.count ||
        orders.some((order, index) => order !== index + 1)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A set output plan requires a complete ordered page sequence.',
          path: ['pages'],
        });
      }
    }),
]);

export const imageIntentSchema = z
  .object({
    operation: imageIntentOperationSchema,
    purpose: nonEmptyTrimmedStringSchema,
    subject: nonEmptyTrimmedStringSchema,
    scene: nonEmptyTrimmedStringSchema,
    composition: nonEmptyTrimmedStringSchema,
    references: z.array(imageIntentReferenceSchema),
    exactText: z.array(imageExactTextSchema),
    changes: z.array(imageIntentChangeSchema),
    invariants: z.array(imageIntentInvariantSchema),
    factRefs: z.array(nonEmptyTrimmedStringSchema),
    rightsRefs: z.array(nonEmptyTrimmedStringSchema),
    outputPlan: imageOutputPlanSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    const protectedTargets = new Set(
      intent.invariants.map((invariant) => invariant.target),
    );
    for (const [index, change] of intent.changes.entries()) {
      if (protectedTargets.has(change.target)) {
        context.addIssue({
          code: 'custom',
          message: 'An image edit cannot change a protected invariant.',
          path: ['changes', index, 'target'],
        });
      }
    }
    if (
      intent.operation === 'image.edit' &&
      (intent.references.length === 0 ||
        intent.changes.length === 0 ||
        intent.invariants.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Image editing requires source references, explicit changes, and protected invariants.',
        path: ['operation'],
      });
    }
    if (
      intent.operation === 'image.reference_transform' &&
      intent.references.length < 2
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Reference transformation requires at least two references.',
        path: ['references'],
      });
    }
  });

export const freeImageIntentSchema = imageIntentSchema.superRefine(
  (intent, context) => {
    if (intent.outputPlan.kind !== 'single') {
      context.addIssue({
        code: 'custom',
        message: 'Free creation v1 only exposes a single-image output plan.',
        path: ['outputPlan'],
      });
    }
  },
);

const imageSlotRecipeRuleSchema = z
  .object({
    slot: imageIntentSlotKindSchema,
    minItems: z.number().int().nonnegative(),
    maxItems: z.number().int().nonnegative(),
    allowedMimeTypes: z
      .array(z.string().trim().regex(/^[\w.+-]+\/[\w.+-]+$/u))
      .min(1),
    maxBytesPerItem: z.number().int().positive(),
    incompatibleWith: z.array(imageIntentSlotKindSchema),
    nativeField: nonEmptyTrimmedStringSchema,
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.maxItems < rule.minItems) {
      context.addIssue({
        code: 'custom',
        message: 'A slot maximum cannot be lower than its minimum.',
        path: ['maxItems'],
      });
    }
    if (rule.incompatibleWith.includes(rule.slot)) {
      context.addIssue({
        code: 'custom',
        message: 'A slot cannot be incompatible with itself.',
        path: ['incompatibleWith'],
      });
    }
  });

export const imageModelRecipeProfileSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    revision: nonEmptyTrimmedStringSchema,
    operationMappings: z
      .object({
        'image.generate': z.enum(['image.generate', 'image.edit']),
        'image.edit': z.enum(['image.generate', 'image.edit']),
        'image.reference_transform': z.enum([
          'image.generate',
          'image.edit',
        ]),
      })
      .strict(),
    slotRules: z.array(imageSlotRecipeRuleSchema).length(
      IMAGE_INTENT_SLOT_KINDS.length,
    ),
  })
  .strict()
  .superRefine((profile, context) => {
    const slots = profile.slotRules.map(({ slot }) => slot);
    if (
      new Set(slots).size !== IMAGE_INTENT_SLOT_KINDS.length ||
      IMAGE_INTENT_SLOT_KINDS.some((slot) => !slots.includes(slot))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An image model profile requires exactly one rule per slot.',
        path: ['slotRules'],
      });
    }
  });

export function imageIntentSchemaForProfile(
  profileInput: z.input<typeof imageModelRecipeProfileSchema>,
) {
  const profile = imageModelRecipeProfileSchema.parse(profileInput);
  return imageIntentSchema.superRefine((intent, context) => {
    const populatedSlots = new Set(
      intent.references.map((reference) => reference.slot),
    );
    for (const rule of profile.slotRules) {
      const references = intent.references.filter(
        (reference) => reference.slot === rule.slot,
      );
      if (
        references.length < rule.minItems ||
        references.length > rule.maxItems
      ) {
        context.addIssue({
          code: 'custom',
          message: `Slot ${rule.slot} requires ${rule.minItems}-${rule.maxItems} references.`,
          path: ['references'],
        });
      }
      for (const reference of references) {
        if (!rule.allowedMimeTypes.includes(reference.mimeType)) {
          context.addIssue({
            code: 'custom',
            message: `Slot ${rule.slot} does not accept ${reference.mimeType}.`,
            path: ['references'],
          });
        }
        if (reference.sizeBytes > rule.maxBytesPerItem) {
          context.addIssue({
            code: 'custom',
            message: `Slot ${rule.slot} exceeds its per-item size limit.`,
            path: ['references'],
          });
        }
      }
      const incompatible = rule.incompatibleWith.find((slot) =>
        populatedSlots.has(slot),
      );
      if (references.length > 0 && incompatible) {
        context.addIssue({
          code: 'custom',
          message: `Slot ${rule.slot} cannot be combined with ${incompatible}.`,
          path: ['references'],
        });
      }
    }
  });
}

export type ImageIntent = z.infer<typeof imageIntentSchema>;
export type ImageModelRecipeProfile = z.infer<
  typeof imageModelRecipeProfileSchema
>;
export type ImageOutputPlan = z.infer<typeof imageOutputPlanSchema>;
