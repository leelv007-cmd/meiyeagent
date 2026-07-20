import { z } from 'zod';

export * from './product.js';
export * from './product-schema.js';
export * from './p1.js';
export * from './content-package.js';
export * from './editing-context.js';
export * from './harness.js';
export * from './context-bundle.js';
export * from './asset-intake.js';
export * from './reuse-memory.js';
export * from './approval-receipt.js';
export * from './pending-action.js';
export * from './marketing-package.js';
export * from './uiux.js';
export * from './capability-permission.js';
export * from './capability-registry.js';
export * from './capability-inventory.js';
export * from './supply-registry.js';
export * from './eval-run.js';
export * from './creation-experience.js';
export * from './product-quote.js';
export * from './result-center.js';
export * from './video-workflow.js';

export interface ApiMeta {
  correlationId: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export const diagnosticContentSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  hook: z.string().min(1),
});

export type DiagnosticContent = z.infer<typeof diagnosticContentSchema>;

export const diagnosticRunSchema = z.object({
  id: z.string().min(1),
  correlationId: z.string().min(1),
  status: z.enum(['waiting_for_user', 'completed', 'failed']),
  events: z.array(z.string().min(1)),
  result: diagnosticContentSchema.optional(),
  evidence: z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1),
      durationMs: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
      committedSteps: z.array(z.string().min(1)),
      failureCode: z.string().min(1).optional(),
    })
    .optional(),
});

export type DiagnosticRun = z.infer<typeof diagnosticRunSchema>;
