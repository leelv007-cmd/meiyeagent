import {
  type BeautyVoiceRole,
  notePlanConsistencyEvaluationSchema,
  notePlanSchema,
  notePlanTextBlockSchema,
  resolveBeautyVoiceInjection,
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
      xhsNoteGen?: HarnessFrozenPrompt;
    },
    private readonly generationParams?: {
      beautyVoiceRole?: BeautyVoiceRole;
      marketingIdentityContext?: string;
      topic: string;
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
        promptKey: this.generationParams ? 'xhsNoteGen' : 'noteTextBlock',
        schemaName: 'harness_note_text_block_v1',
        schemaRevision: 'note-text-block-v1',
        instructions: this.noteTextInstructions(),
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

  private noteTextInstructions() {
    const noteTextBlock =
      this.prompts?.noteTextBlock?.content ??
      HARNESS_BUILTIN_PROMPTS.noteTextBlock;
    if (!this.generationParams) return noteTextBlock;

    const voice = this.generationParams.beautyVoiceRole
      ? resolveBeautyVoiceInjection(this.generationParams.beautyVoiceRole)
      : undefined;
    const tone =
      voice?.tone ?? '遵循冻结的门店 MarketingIdentity 默认表达';
    const roleBlock =
      voice?.roleBlock ??
      (this.generationParams.marketingIdentityContext
        ? `默认门店表达身份（MarketingIdentity）：${this.generationParams.marketingIdentityContext}`
        : '创作角色：门店官方中性口吻，不虚构个人身份或资质');
    const xhsNoteGen =
      this.prompts?.xhsNoteGen?.content ?? HARNESS_BUILTIN_PROMPTS.xhsNoteGen;
    const compiled = replacePromptVariables(xhsNoteGen, {
      topic: this.generationParams.topic,
      tone,
      roleBlock,
    });
    return [
      compiled,
      [
        '本次冻结的生成参数：',
        `内容主题：${this.generationParams.topic}`,
        `语气风格：${tone}`,
        roleBlock,
      ].join('\n'),
      noteTextBlock,
      '执行边界：XHS 模板在这里只提供主题、口吻和平台约束；当前节点仍只返回 NotePlan 单页结构。',
    ].join('\n\n');
  }
}

function replacePromptVariables(
  prompt: string,
  variables: Record<'roleBlock' | 'tone' | 'topic', string>,
) {
  return Object.entries(variables).reduce(
    (compiled, [key, value]) => compiled.split(`{${key}}`).join(value),
    prompt,
  );
}
