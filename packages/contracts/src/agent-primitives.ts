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
