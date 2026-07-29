import { z } from 'zod';

const primitiveTextSchema = z.string().trim().min(1);
const primitiveJsonSchema = z.json();

export const AGENT_PRIMITIVE_IDS = Object.freeze([
  'read_context',
  'generate',
  'revise',
  'record',
  'check',
  'ask_merchant',
] as const);

export type AgentPrimitiveId = (typeof AGENT_PRIMITIVE_IDS)[number];

export const readContextPrimitiveQuerySchema = z
  .object({
    text: primitiveTextSchema.optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export const readContextPrimitiveInputSchema = z
  .object({
    scope: primitiveTextSchema,
    query: readContextPrimitiveQuerySchema.optional(),
  })
  .strict();

export const generatePrimitiveInputSchema = z
  .object({
    kind: primitiveTextSchema,
    brief: primitiveJsonSchema,
  })
  .strict();

export const revisePrimitiveInputSchema = z
  .object({
    target_ref: primitiveTextSchema,
    instruction: primitiveTextSchema,
  })
  .strict();

export const recordPrimitiveInputSchema = z
  .object({
    kind: primitiveTextSchema,
    payload: primitiveJsonSchema,
    provenance: primitiveJsonSchema,
  })
  .strict();

export const checkPrimitiveInputSchema = z
  .object({
    target_ref: primitiveTextSchema,
    rulesets: z.array(primitiveTextSchema).optional(),
  })
  .strict();

export const askMerchantPrimitiveOptionSchema = z
  .object({
    label: primitiveTextSchema,
    description: primitiveTextSchema.optional(),
  })
  .strict();

const askMerchantQuestionOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const askMerchantQuestionSchema = z
  .object({
    itemId: primitiveTextSchema,
    question: primitiveTextSchema,
    options: z
      .array(askMerchantQuestionOptionSchema)
      .min(1)
      .max(12)
      .optional(),
    fallback: z.object({ kind: z.literal('deferred') }).strict(),
  })
  .strict();

export const askMerchantQuestionRequestSchema = z
  .object({
    requestId: primitiveTextSchema,
    runId: primitiveTextSchema,
    step: primitiveTextSchema,
    revision: z.number().int().nonnegative(),
    kind: z.literal('ask_merchant'),
    questions: z.array(askMerchantQuestionSchema).min(1).max(12),
    groupSkip: z.literal(true),
    presentation: z
      .object({
        carriers: z
          .array(z.enum(['conversation', 'store_page', 'task_card']))
          .min(1)
          .max(3),
        blocking: z.literal('none'),
        notification: z.literal('none'),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    const itemIds = new Set<string>();
    for (const [index, question] of request.questions.entries()) {
      if (itemIds.has(question.itemId)) {
        context.addIssue({
          code: 'custom',
          message: 'Merchant question item identifiers must be unique.',
          path: ['questions', index, 'itemId'],
        });
      }
      itemIds.add(question.itemId);
      const labels = new Set<string>();
      for (const [optionIndex, option] of (question.options ?? []).entries()) {
        if (labels.has(option.label)) {
          context.addIssue({
            code: 'custom',
            message: 'Merchant question option labels must be unique.',
            path: ['questions', index, 'options', optionIndex, 'label'],
          });
        }
        labels.add(option.label);
      }
    }
  });

const askMerchantItemResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('answer'),
      value: primitiveTextSchema,
    })
    .strict(),
  z.object({ kind: z.literal('deferred') }).strict(),
]);

export const askMerchantAnswerSchema = z
  .object({
    requestId: primitiveTextSchema,
    revision: z.number().int().nonnegative(),
    idempotencyKey: primitiveTextSchema,
    resume: z
      .object({
        runId: primitiveTextSchema,
        step: primitiveTextSchema,
      })
      .strict(),
    response: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('answer'),
          items: z
            .array(
              z
                .object({
                  itemId: primitiveTextSchema,
                  result: askMerchantItemResultSchema,
                })
                .strict(),
            )
            .min(1)
            .max(12),
        })
        .strict(),
      z.object({ kind: z.literal('skipped') }).strict(),
    ]),
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.response.kind !== 'answer') return;
    const itemIds = new Set<string>();
    for (const [index, item] of answer.response.items.entries()) {
      if (itemIds.has(item.itemId)) {
        context.addIssue({
          code: 'custom',
          message: 'Merchant answer item identifiers must be unique.',
          path: ['response', 'items', index, 'itemId'],
        });
      }
      itemIds.add(item.itemId);
    }
  });

export const askMerchantPrimitiveInputSchema = z
  .object({
    question: primitiveTextSchema,
    options: z.array(askMerchantPrimitiveOptionSchema).optional(),
  })
  .strict();

export const agentPrimitiveInputSchemas = Object.freeze({
  read_context: readContextPrimitiveInputSchema,
  generate: generatePrimitiveInputSchema,
  revise: revisePrimitiveInputSchema,
  record: recordPrimitiveInputSchema,
  check: checkPrimitiveInputSchema,
  ask_merchant: askMerchantPrimitiveInputSchema,
} as const satisfies Record<AgentPrimitiveId, z.ZodType<unknown>>);

export type AgentPrimitiveInputById = {
  [PrimitiveId in AgentPrimitiveId]: z.infer<
    (typeof agentPrimitiveInputSchemas)[PrimitiveId]
  >;
};

export type AskMerchantQuestionRequest = z.infer<
  typeof askMerchantQuestionRequestSchema
>;
export type AskMerchantAnswer = z.infer<typeof askMerchantAnswerSchema>;
