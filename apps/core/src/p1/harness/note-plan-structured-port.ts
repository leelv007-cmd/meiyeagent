import {
  notePlanConsistencyEvaluationSchema,
  notePlanSchema,
  notePlanTextBlockSchema,
} from '@meiye/contracts';

import type { StructuredNodeRunner } from './structured-nodes.js';
import type { NotePlanStructuredPort } from './note-plan-compiler.js';

export class ModelSupplyNotePlanStructuredPort
  implements NotePlanStructuredPort
{
  constructor(
    private readonly runner: StructuredNodeRunner,
    private readonly workflowId: string,
    private readonly now: () => string,
  ) {}

  async plan(input: Parameters<NotePlanStructuredPort['plan']>[0]) {
    const result = await this.runner.run({
      effectIdempotencyKey: `wf:${this.workflowId}:note:plan`,
      schemaName: 'harness_note_plan_v1',
      schemaRevision: 'note-plan-v1',
      instructions:
        'Create a semantic NotePlan before any page generation. Page count and roles must follow the merchant intent, not a fixed template. Include one single ImageIntent, one text block, and dependency edges per page.',
      prompt: JSON.stringify(input),
      schema: notePlanSchema,
    });
    return notePlanSchema.parse(result.output);
  }

  async draftPage(
    input: Parameters<NotePlanStructuredPort['draftPage']>[0],
  ) {
		const result = await this.runner.run({
			effectIdempotencyKey:
				`wf:${this.workflowId}:note:text:${input.style.id}:${input.page.id}` +
				(input.consistencyFailure
					? `:rewrite:r${input.page.revision}`
					: ""),
      schemaName: 'harness_note_text_block_v1',
      schemaRevision: 'note-text-block-v1',
		instructions:
			'Finalize this page text in the configured style. Preserve the theme and prior-page dependency. If consistencyFailure is present, rewrite only the text-side issue described there. Return title, body and exactText only.',
      prompt: JSON.stringify(input),
      schema: notePlanTextBlockSchema,
    });
    return notePlanTextBlockSchema.parse(result.output);
  }

  async evaluate(
    input: Parameters<NotePlanStructuredPort['evaluate']>[0],
  ) {
    const result = await this.runner.run({
      effectIdempotencyKey:
        `wf:${this.workflowId}:note:evaluate:${input.attempt}`,
      schemaName: 'harness_note_consistency_v1',
      schemaRevision: 'note-consistency-v1',
      instructions:
        'Evaluate theme continuity, visual consistency, non-repetition, role coverage, and image-text cross-reference. Return every dimension exactly once and only page ids that require regeneration.',
      prompt: JSON.stringify({
        ...input,
        evaluatedAt: this.now(),
      }),
      schema: notePlanConsistencyEvaluationSchema,
    });
    return notePlanConsistencyEvaluationSchema.parse(result.output);
  }
}
