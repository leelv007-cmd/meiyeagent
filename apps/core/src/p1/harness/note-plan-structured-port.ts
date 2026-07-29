import {
  notePlanConsistencyEvaluationSchema,
  notePlanSchema,
  notePlanTextBlockSchema,
} from '@meiye/contracts';

import type { StructuredNodeRunner } from './structured-nodes.js';
import {
  CONFIGURED_NOTE_PLAN_ENHANCEMENT_JUDGE,
  type NotePlanEnhancementJudgeState,
  type NotePlanStructuredPort,
} from './note-plan-compiler.js';
import type { HarnessEffectRunner } from './workflow-core.js';
import {
  HARNESS_BUILTIN_PROMPTS,
  type HarnessFrozenPrompt,
} from './langfuse-prompts.js';

export interface NotePlanEnhancementJudgeResolver {
  resolve(input: {
    workflowId: string;
    workspaceId: string;
  }): Promise<NotePlanEnhancementJudgeState>;
}

export const configuredNotePlanEnhancementJudgeResolver: NotePlanEnhancementJudgeResolver =
  {
    async resolve() {
      return CONFIGURED_NOTE_PLAN_ENHANCEMENT_JUDGE;
    },
  };

export const unconfiguredNotePlanEnhancementJudgeResolver: NotePlanEnhancementJudgeResolver =
  {
    async resolve() {
      return {
        status: 'unconfigured',
        reason: 'self_correction_judge_unconfigured',
      };
    },
  };

export class ModelSupplyNotePlanStructuredPort
  implements NotePlanStructuredPort
{
  constructor(
    private readonly runner: StructuredNodeRunner,
    private readonly workflowId: string,
    private readonly now: () => string,
    private readonly runStep?: HarnessEffectRunner,
    private readonly prompts?: {
      notePlan?: HarnessFrozenPrompt;
      noteTextBlock?: HarnessFrozenPrompt;
      noteConsistency?: HarnessFrozenPrompt;
    },
  ) {}

  private runEffect<Output>(
    effectIdempotencyKey: string,
    operation: () => Promise<Output>,
  ) {
    return this.runStep
      ? this.runStep(effectIdempotencyKey, operation)
      : operation();
  }

  async plan(input: Parameters<NotePlanStructuredPort['plan']>[0]) {
    const result = await this.runEffect(
      `wf:${this.workflowId}:note:plan`,
      () =>
        this.runner.run({
          effectIdempotencyKey: `wf:${this.workflowId}:note:plan`,
          schemaName: 'harness_note_plan_v1',
          schemaRevision: 'note-plan-v1',
          instructions:
            this.prompts?.notePlan?.content ??
            HARNESS_BUILTIN_PROMPTS.notePlan,
          prompt: JSON.stringify(input),
          schema: notePlanSchema,
        }),
    );
    return notePlanSchema.parse(result.output);
  }

  async draftPage(
    input: Parameters<NotePlanStructuredPort['draftPage']>[0],
  ) {
    const effectIdempotencyKey =
      `wf:${this.workflowId}:note:text:${input.style.id}:${input.page.id}` +
      (input.consistencyFailure
        ? `:rewrite:r${input.page.revision}`
        : '');
    const result = await this.runEffect(effectIdempotencyKey, () =>
      this.runner.run({
        effectIdempotencyKey,
        schemaName: 'harness_note_text_block_v1',
        schemaRevision: 'note-text-block-v1',
        instructions:
          this.prompts?.noteTextBlock?.content ??
          HARNESS_BUILTIN_PROMPTS.noteTextBlock,
        prompt: JSON.stringify(input),
        schema: notePlanTextBlockSchema,
      }),
    );
    return notePlanTextBlockSchema.parse(result.output);
  }

  async evaluate(
    input: Parameters<NonNullable<NotePlanStructuredPort['evaluate']>>[0],
  ) {
    const effectIdempotencyKey =
      `wf:${this.workflowId}:note:evaluate:${input.attempt}`;
    const result = await this.runEffect(effectIdempotencyKey, () =>
      this.runner.run({
        effectIdempotencyKey,
        schemaName: 'harness_note_consistency_v1',
        schemaRevision: 'note-consistency-v1',
        instructions:
          this.prompts?.noteConsistency?.content ??
          HARNESS_BUILTIN_PROMPTS.noteConsistency,
        prompt: JSON.stringify({
          ...input,
          evaluatedAt: this.now(),
        }),
        schema: notePlanConsistencyEvaluationSchema,
      }),
    );
    return notePlanConsistencyEvaluationSchema.parse(result.output);
  }
}
