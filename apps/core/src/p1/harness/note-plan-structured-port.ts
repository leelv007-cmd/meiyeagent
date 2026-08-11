import {
	type BeautyVoiceRole,
	notePlanConsistencyEvaluationSchema,
	notePlanSchema,
	notePlanTextBlockSchema,
	resolveBeautyVoiceInjection,
} from "@meiye/contracts";
import type { HarnessFrozenPrompt } from "./langfuse-prompts.js";
import {
	CONFIGURED_NOTE_PLAN_ENHANCEMENT_JUDGE,
	type NotePlanEnhancementJudgeState,
	type NotePlanStructuredPort,
} from "./note-plan-compiler.js";
import type { StructuredNodeRunner } from "./structured-nodes.js";
import {
	applyViralImageVisionToNotePlan,
	notePlanInstructionsForViralAdapt,
	type ViralAdaptPlanContext,
} from "./viral-adapt.js";
import type { HarnessEffectRunner } from "./workflow-core.js";

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
				status: "unconfigured",
				reason: "self_correction_judge_unconfigured",
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
			/** #324 viral adapt paste-track rewrite (harness/xhs-viral-rewrite). */
			xhsViralRewrite?: HarnessFrozenPrompt;
		},
		private readonly generationParams?: {
			beautyVoiceRole?: BeautyVoiceRole;
			marketingIdentityContext?: string;
			topic: string;
		},
		private readonly viralContext?: ViralAdaptPlanContext,
	) {}

	private runEffect<Output>(
		effectIdempotencyKey: string,
		operation: () => Promise<Output>,
	) {
		return this.runStep
			? this.runStep(effectIdempotencyKey, operation)
			: operation();
	}

	async plan(input: Parameters<NotePlanStructuredPort["plan"]>[0]) {
		// Resolve pins before the runner call so absence cannot look like a model
		// failure if a surrounding port later wraps this step in a fallback catch.
		const baseInstructions = requireNotePromptContent(
			"notePlan",
			this.prompts?.notePlan,
		);
		const prompt = JSON.stringify(input);
		const { instructions } = notePlanInstructionsForViralAdapt({
			baseInstructions,
			viralRewritePrompt: this.prompts?.xhsViralRewrite?.content,
			viralContext: this.viralContext,
		});
		const result = await this.runEffect(`wf:${this.workflowId}:note:plan`, () =>
			this.runner.run({
				effectIdempotencyKey: `wf:${this.workflowId}:note:plan`,
				schemaName: "harness_note_plan_v1",
				schemaRevision: "note-plan-v1",
				instructions,
				prompt,
				schema: notePlanSchema,
			}),
		);
		const plan = notePlanSchema.parse(result.output);
		return notePlanSchema.parse(
			this.viralContext?.imageVision
				? applyViralImageVisionToNotePlan(plan, this.viralContext.imageVision)
				: plan,
		);
	}

	async draftPage(input: Parameters<NotePlanStructuredPort["draftPage"]>[0]) {
		const effectIdempotencyKey =
			`wf:${this.workflowId}:note:text:${input.style.id}:${input.page.id}` +
			(input.consistencyFailure ? `:rewrite:r${input.page.revision}` : "");
		const instructions = this.noteTextInstructions();
		const result = await this.runEffect(effectIdempotencyKey, () =>
			this.runner.run({
				effectIdempotencyKey,
				promptKey: this.generationParams ? "xhsNoteGen" : "noteTextBlock",
				schemaName: "harness_note_text_block_v1",
				schemaRevision: "note-text-block-v1",
				instructions,
				prompt: JSON.stringify(input),
				schema: notePlanTextBlockSchema,
			}),
		);
		return notePlanTextBlockSchema.parse(result.output);
	}

	async evaluate(
		input: Parameters<NonNullable<NotePlanStructuredPort["evaluate"]>>[0],
	) {
		const effectIdempotencyKey = `wf:${this.workflowId}:note:evaluate:${input.attempt}`;
		const instructions = requireNotePromptContent(
			"noteConsistency",
			this.prompts?.noteConsistency,
		);
		const result = await this.runEffect(effectIdempotencyKey, () =>
			this.runner.run({
				effectIdempotencyKey,
				schemaName: "harness_note_consistency_v1",
				schemaRevision: "note-consistency-v1",
				instructions,
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
		const noteTextBlock = requireNotePromptContent(
			"noteTextBlock",
			this.prompts?.noteTextBlock,
		);
		if (!this.generationParams) return noteTextBlock;

		const voice = this.generationParams.beautyVoiceRole
			? resolveBeautyVoiceInjection(this.generationParams.beautyVoiceRole)
			: undefined;
		const tone = voice?.tone ?? "遵循冻结的门店 MarketingIdentity 默认表达";
		const roleBlock =
			voice?.roleBlock ??
			(this.generationParams.marketingIdentityContext
				? `默认门店表达身份（MarketingIdentity）：${this.generationParams.marketingIdentityContext}`
				: "创作角色：门店官方中性口吻，不虚构个人身份或资质");
		const xhsNoteGen = requireNotePromptContent(
			"xhsNoteGen",
			this.prompts?.xhsNoteGen,
		);
		const compiled = replacePromptVariables(xhsNoteGen, {
			topic: this.generationParams.topic,
			tone,
			roleBlock,
		});
		return [
			compiled,
			[
				"本次冻结的生成参数：",
				`内容主题：${this.generationParams.topic}`,
				`语气风格：${tone}`,
				roleBlock,
			].join("\n"),
			noteTextBlock,
			"执行边界：XHS 模板在这里只提供主题、口吻和平台约束；当前节点仍只返回 NotePlan 单页结构。",
		].join("\n\n");
	}
}

function replacePromptVariables(
	prompt: string,
	variables: Record<"roleBlock" | "tone" | "topic", string>,
) {
	return Object.entries(variables).reduce(
		(compiled, [key, value]) => compiled.split(`{${key}}`).join(value),
		prompt,
	);
}

/**
 * A missing pin fails closed. Substituting the hardcoded builtin was
 * indistinguishable from a correct pin at runtime, which breaks rollback and
 * eval attribution. note-pack keys are frozen by task-admission for every
 * image_text_note lens, so an absent pin means the freeze is wrong.
 */
function requireNotePromptContent(
	promptKey: "notePlan" | "noteConsistency" | "noteTextBlock" | "xhsNoteGen",
	prompt: HarnessFrozenPrompt | undefined,
): string {
	const content = prompt?.content;
	if (!content?.trim()) {
		throw new Error(
			`Note plan requires the frozen prompt pin ${promptKey}; refusing to substitute a builtin prompt.`,
		);
	}
	return content;
}
