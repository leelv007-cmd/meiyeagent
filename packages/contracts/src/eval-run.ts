import { z } from 'zod';

const evalIdSchema = z.string().trim().min(1);
const evalRevisionSchema = z.string().trim().min(1);

export const evalMemoryChangeSchema = z
  .object({
    path: z.string().trim().min(1),
    before: z.json().nullable(),
    after: z.json().nullable(),
  })
  .strict();

export const evalMemoryDiffSchema = z
  .object({
    before: z.json(),
    after: z.json(),
    changes: z.array(evalMemoryChangeSchema),
  })
  .strict();

export const evalCaseResultSchema = z
  .object({
    caseId: evalIdSchema,
    gateId: evalIdSchema.nullable(),
    promptRevision: evalRevisionSchema,
    skillRevisionRef: evalRevisionSchema.optional(),
    scorerRevision: evalRevisionSchema,
    passed: z.boolean(),
    reason: z.string().trim().min(1),
    memoryDiff: evalMemoryDiffSchema.nullable(),
  })
  .strict();

export const evalRunSchema = z
  .object({
    schemaVersion: z.literal('eval-run/v1'),
    runId: evalIdSchema,
    suiteId: evalIdSchema,
    suiteRevision: evalRevisionSchema,
    mode: z.enum(['recorded_fixture', 'live_red_team']),
    createdAt: z.iso.datetime(),
    passed: z.boolean(),
    results: z.array(evalCaseResultSchema).min(1),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.passed !== run.results.every((result) => result.passed)) {
      context.addIssue({
        code: 'custom',
        message: 'EvalRun passed must equal the outcome of all case results.',
        path: ['passed'],
      });
    }
  });

export type EvalMemoryChange = z.infer<typeof evalMemoryChangeSchema>;
export type EvalMemoryDiff = z.infer<typeof evalMemoryDiffSchema>;
export type EvalCaseResult = z.infer<typeof evalCaseResultSchema>;
export type EvalRun = z.infer<typeof evalRunSchema>;
