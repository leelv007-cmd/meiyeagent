import { z } from 'zod';

/** Seven categories transplanted from xhswork structure (spec §6.3); data is beauty-owned. */
export const SENSITIVE_WORD_CATEGORIES = [
  'extreme',
  'medical',
  'cosmetic',
  'finance',
  'legal',
  'vulgar',
  'other',
] as const;

export type SensitiveWordCategory = (typeof SENSITIVE_WORD_CATEGORIES)[number];

export const sensitiveWordCategorySchema = z.enum(SENSITIVE_WORD_CATEGORIES);

export const SENSITIVE_WORD_STATUSES = ['enabled', 'disabled'] as const;
export type SensitiveWordStatus = (typeof SENSITIVE_WORD_STATUSES)[number];
export const sensitiveWordStatusSchema = z.enum(SENSITIVE_WORD_STATUSES);

export const sensitiveWordRecordSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    word: z.string().trim().min(1).max(100),
    category: sensitiveWordCategorySchema,
    replacements: z.array(z.string().trim().min(1).max(100)).max(20),
    status: sensitiveWordStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type SensitiveWordRecord = z.infer<typeof sensitiveWordRecordSchema>;

export const sensitiveWordHitSchema = z
  .object({
    wordId: z.string().trim().min(1),
    word: z.string().trim().min(1),
    category: sensitiveWordCategorySchema,
    replacements: z.array(z.string().trim().min(1).max(100)),
    index: z.number().int().nonnegative(),
    length: z.number().int().positive(),
  })
  .strict();

export type SensitiveWordHit = z.infer<typeof sensitiveWordHitSchema>;

export const sensitiveScanResultSchema = z
  .object({
    schemaVersion: z.literal('sensitive-scan/v1'),
    textLength: z.number().int().nonnegative(),
    hitCount: z.number().int().nonnegative(),
    hits: z.array(sensitiveWordHitSchema),
  })
  .strict();

export type SensitiveScanResult = z.infer<typeof sensitiveScanResultSchema>;

/** Delivery / generation-chain check-bar projection (spec §4.6). */
export const sensitiveCheckBarItemSchema = z
  .object({
    wordId: z.string().trim().min(1),
    word: z.string().trim().min(1),
    category: sensitiveWordCategorySchema,
    snippet: z.string().trim().min(1).max(200),
    replacements: z.array(z.string().trim().min(1).max(100)),
  })
  .strict();

export type SensitiveCheckBarItem = z.infer<typeof sensitiveCheckBarItemSchema>;

export const sensitiveCheckBarSchema = z
  .object({
    schemaVersion: z.literal('sensitive-check-bar/v1'),
    status: z.enum(['clear', 'hits']),
    summary: z.string().trim().min(1).max(500),
    items: z.array(sensitiveCheckBarItemSchema),
  })
  .strict();

export type SensitiveCheckBar = z.infer<typeof sensitiveCheckBarSchema>;

export const createSensitiveWordCommandSchema = z
  .object({
    word: z.string().trim().min(1).max(100),
    category: sensitiveWordCategorySchema.default('other'),
    replacements: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    status: sensitiveWordStatusSchema.default('enabled'),
  })
  .strict();

export type CreateSensitiveWordCommand = z.infer<
  typeof createSensitiveWordCommandSchema
>;

export const updateSensitiveWordCommandSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    word: z.string().trim().min(1).max(100).optional(),
    category: sensitiveWordCategorySchema.optional(),
    replacements: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    status: sensitiveWordStatusSchema.optional(),
  })
  .strict();

export type UpdateSensitiveWordCommand = z.infer<
  typeof updateSensitiveWordCommandSchema
>;

export const deleteSensitiveWordCommandSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
  })
  .strict();

export type DeleteSensitiveWordCommand = z.infer<
  typeof deleteSensitiveWordCommandSchema
>;

export const listSensitiveWordsQuerySchema = z
  .object({
    category: sensitiveWordCategorySchema.optional(),
    status: sensitiveWordStatusSchema.optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

export type ListSensitiveWordsQuery = z.infer<
  typeof listSensitiveWordsQuerySchema
>;

export const scanSensitiveTextQuerySchema = z
  .object({
    text: z.string().max(50_000),
  })
  .strict();

export type ScanSensitiveTextQuery = z.infer<
  typeof scanSensitiveTextQuerySchema
>;
