import {
  DEFAULT_NOTE_STYLES,
  NOTE_PLAN_CONSISTENCY_DIMENSIONS,
  imageTextNoteVersionSchema,
  notePageRegeneratedEventSchema,
  notePlanConsistencyEvaluationSchema,
  notePlanSchema,
  noteStyleCandidatesSchemaFor,
  noteStyleConfigSchema,
  type ContentPackage,
  type ImageTextNoteVersion,
  type NotePlan,
  type NotePlanConsistencyEvaluation,
  type NoteStyleConfig,
} from '@meiye/contracts';
import { ZodError } from 'zod';
import { StructuredNodeRunError } from '../model-supply/structured-node-runner.js';
import { check } from './check.js';

// 这份默认集合已搬进契约（后台风格编辑器也要用同一份），此处保留导出口不动。
export { DEFAULT_NOTE_STYLES };

export interface NotePlanStructuredPort {
  plan(input: {
    intent: string;
    factRefs: string[];
    rightsRefs: string[];
    styleAnalysisBlock?: string;
    styleAnalysisOutlinePrompt?: string;
    consistencyRequirements?: string[];
  }): Promise<NotePlan>;
  draftPage(input: {
    page: NotePlan['pages'][number];
    previousTextBlock?: NotePlan['pages'][number]['textBlock'];
    style: {
      id: string;
      name: string;
      writingGuide: string;
      structureTemplate?: string;
    };
    themeAnchor: string;
    consistencyFailure?: string;
  }): Promise<NotePlan['pages'][number]['textBlock']>;
  evaluate?(input: {
    plan: NotePlan;
    attempt: 'initial' | 'after_regeneration';
  }): Promise<NotePlanConsistencyEvaluation>;
}

export type NotePlanEnhancementJudgeState =
  | { status: 'configured' }
  | {
      status: 'unconfigured';
      reason: 'self_correction_judge_unconfigured';
    };

export const CONFIGURED_NOTE_PLAN_ENHANCEMENT_JUDGE = {
  status: 'configured',
} as const satisfies NotePlanEnhancementJudgeState;

export interface NotePlanImagePort {
  generate(input: {
    page: NotePlan['pages'][number];
    reason: 'initial' | 'consistency_conflict' | 'merchant_request';
    evaluationReason?: string;
  }): Promise<{
    asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
    childRun: ContentPackage['generated']['childRuns'][number];
  }>;
}

const TEXT_SIDE_CONSISTENCY_DIMENSIONS = new Set([
  'theme_continuity',
  'non_repetition',
  'role_coverage',
]);

export function notePageRegenerationPlan(
  evaluation: NotePlanConsistencyEvaluation,
  pageId: string,
): {
  reason: string;
  side: 'text' | 'image' | 'both';
  textReason?: string;
  imageReason?: string;
} {
  const failing = evaluation.dimensions.filter(
    (dimension) =>
      !dimension.passed &&
      (dimension.pageIds.length === 0 || dimension.pageIds.includes(pageId)),
  );
  const reason =
    failing.map(({ reason: text }) => text).join('；') ||
    '整篇一致性仍需调整。';
  const textFailures = failing.filter(({ dimension }) =>
    TEXT_SIDE_CONSISTENCY_DIMENSIONS.has(dimension),
  );
  const imageFailures = failing.filter(
    ({ dimension }) => !TEXT_SIDE_CONSISTENCY_DIMENSIONS.has(dimension),
  );
  const joinReasons = (
    dimensions: NotePlanConsistencyEvaluation['dimensions'],
  ) =>
    dimensions.length > 0
      ? dimensions.map(({ reason: text }) => text).join('；')
      : undefined;
  return {
    reason,
    side:
      textFailures.length > 0 && imageFailures.length === 0
        ? 'text'
        : textFailures.length > 0
          ? 'both'
          : 'image',
    ...(joinReasons(textFailures)
      ? { textReason: joinReasons(textFailures) }
      : {}),
    ...(joinReasons(imageFailures)
      ? { imageReason: joinReasons(imageFailures) }
      : {}),
  };
}

export interface NotePlanPartialDelivery {
  unresolvedPageIds: string[];
  reason: 'consistency_remained_incomplete' | 'second_evaluation_failed';
}

export interface NotePlanCompilerAuditSignal {
  eventType:
    | 'note_consistency_evaluated'
    | 'note_page_regenerated'
    | 'note_style_selected';
  payload: Record<string, unknown>;
}

export interface NotePlanSettings {
  styles: NoteStyleConfig;
}

export interface NotePlanSettingsSource {
  read(): Promise<NotePlanSettings>;
}

export class NotePlanCompiler {
  constructor(
    private readonly structured: NotePlanStructuredPort,
    private readonly images: NotePlanImagePort,
    private readonly enhancementJudge: NotePlanEnhancementJudgeState =
      CONFIGURED_NOTE_PLAN_ENHANCEMENT_JUDGE,
  ) {}

  async compileDrafts(input: {
    intent: string;
    factRefs: string[];
    rightsRefs: string[];
    styles?: NoteStyleConfig;
    notePageBound: number;
    styleAnalysisBlock?: string;
    styleAnalysisOutlinePrompt?: string;
    consistencyRequirements?: string[];
  }) {
    const styles = noteStyleConfigSchema.parse(
      input.styles ?? DEFAULT_NOTE_STYLES,
    );
    const basePlan = notePlanSchema.parse(
      await this.structured.plan({
        intent: input.intent,
        factRefs: input.factRefs,
        rightsRefs: input.rightsRefs,
        ...(input.styleAnalysisBlock
          ? { styleAnalysisBlock: input.styleAnalysisBlock }
          : {}),
        ...(input.styleAnalysisOutlinePrompt
          ? { styleAnalysisOutlinePrompt: input.styleAnalysisOutlinePrompt }
          : {}),
        ...(input.consistencyRequirements?.length
          ? { consistencyRequirements: input.consistencyRequirements }
          : {}),
      }),
    );
    assertNotePlanFactReferences(basePlan, input.factRefs);
    assertNotePlanWithinBound(basePlan, input.notePageBound);
    const candidates = [];
    for (const style of styles.styles) {
      const pages: NotePlan['pages'] = [];
      for (const page of basePlan.pages) {
        const textBlock = await this.structured.draftPage({
          page,
          previousTextBlock: pages.at(-1)?.textBlock,
          style,
          themeAnchor: basePlan.themeAnchor,
        });
        pages.push({
          ...structuredClone(page),
          textBlock,
          imageIntent: {
            ...structuredClone(page.imageIntent),
            exactText: textBlock.exactText.map((text) => ({
              text,
              treatment: 'exact' as const,
            })),
          },
        });
      }
      const plan = notePlanSchema.parse({
        ...basePlan,
        style: {
          id: style.id,
          name: style.name,
          positioning: style.writingGuide,
        },
        pages,
      });
      candidates.push({
        styleId: style.id,
        styleName: style.name,
        positioning: style.writingGuide,
        plan,
      });
    }
    return noteStyleCandidatesSchemaFor(styles.styles.length).parse({
      candidates,
    });
  }

  async selectAndGenerate(input: {
    candidates: Awaited<ReturnType<NotePlanCompiler['compileDrafts']>>;
    selectedStyleId: string;
    notePageBound: number;
  }) {
    const selected = input.candidates.candidates.find(
      ({ styleId }) => styleId === input.selectedStyleId,
    );
    if (!selected) {
      throw new Error('The selected NotePlan style is not available.');
    }
    assertNotePlanWithinBound(selected.plan, input.notePageBound);
    const auditSignals: NotePlanCompilerAuditSignal[] = [
      {
        eventType: 'note_style_selected',
        payload: { styleId: selected.styleId },
      },
    ];
    const initial = await Promise.all(
      selected.plan.pages.map((page) =>
        this.images.generate({ page, reason: 'initial' }),
      ),
    );
    let plan = notePlanSchema.parse({
      ...selected.plan,
      pages: selected.plan.pages.map((page, index) => ({
        ...page,
        imageAssetId: initial[index]?.asset.id,
      })),
    });
    assertNotePlanWithinBound(plan, input.notePageBound);
    if (this.enhancementJudge.status === 'unconfigured') {
      auditSignals.push({
        eventType: 'note_consistency_evaluated',
        payload: {
          attempt: 'initial',
          evaluationUnavailable: true,
          reason: this.enhancementJudge.reason,
          selfCorrectionDisabled: true,
        },
      });
      return {
        auditSignals,
        childRuns: initial.map(({ childRun }) => childRun),
        ownedAssets: initial.map(({ asset }) => asset),
        selectedStyleId: selected.styleId,
        version: imageTextNoteVersionSchema.parse({
          schema: 'image-text-note-version/v1',
          plan,
          regenerationReceipts: [],
        }),
      };
    }
    const evaluate = this.structured.evaluate?.bind(this.structured);
    if (!evaluate) {
      throw new Error(
        'Configured NotePlan enhancement judge requires an evaluation port.',
      );
    }
    const initialEvaluation = notePlanConsistencyEvaluationSchema.parse(
      await evaluate({ plan, attempt: 'initial' }),
    );
    const regenerationReceipts: ImageTextNoteVersion['regenerationReceipts'] =
      [];
    const regenerated: Array<
      Awaited<ReturnType<NotePlanImagePort['generate']>>
    > = [];
    let textRewrites = 0;
    const regenerateViolations = async (
      evaluation: NotePlanConsistencyEvaluation,
    ) => {
      for (const pageId of evaluation.regenerationPageIds) {
        const page = plan.pages.find(({ id }) => id === pageId);
        if (!page) {
          throw new Error(
            'Consistency evaluation referenced an unknown page.',
          );
        }
        const regeneration = notePageRegenerationPlan(evaluation, pageId);
        if (regeneration.side !== 'image') {
          const index = plan.pages.findIndex(({ id }) => id === pageId);
          const previousTextBlock = plan.pages[index - 1]?.textBlock;
          const rewritten = await this.structured.draftPage({
            page,
            ...(previousTextBlock ? { previousTextBlock } : {}),
            style: {
              id: selected.plan.style.id,
              name: selected.plan.style.name,
              writingGuide: selected.plan.style.positioning,
            },
            themeAnchor: plan.themeAnchor,
            consistencyFailure: regeneration.textReason ?? regeneration.reason,
          });
          plan = notePlanSchema.parse({
            ...plan,
            pages: plan.pages.map((candidate) =>
              candidate.id === page.id
                ? {
                    ...candidate,
                    revision: candidate.revision + 1,
                    textBlock: {
                      ...rewritten,
                      exactText: candidate.textBlock.exactText,
                    },
                  }
                : candidate,
            ),
          });
          assertNotePlanWithinBound(plan, input.notePageBound);
          textRewrites += 1;
          auditSignals.push(
            notePageRegeneratedEventSchema.parse({
              eventType: 'note_page_regenerated',
              payload: {
                auditRef: `note-page-rewrite:${page.id}:r${page.revision + 1}`,
                imagePoints: 0,
                pageId: page.id,
                reason: regeneration.textReason ?? regeneration.reason,
                side: 'text',
                trigger: 'check_violation',
              },
            }),
          );
          if (regeneration.side === 'text') continue;
        }
        const target = plan.pages.find(({ id }) => id === pageId) ?? page;
        const generation = await this.images.generate({
          page: target,
          reason: 'consistency_conflict',
          evaluationReason: regeneration.imageReason ?? regeneration.reason,
        });
        regenerated.push(generation);
        const auditRef = `note-page-regeneration:${target.id}:r${target.revision + 1}`;
        regenerationReceipts.push({
          pageId: target.id,
          fromRevision: target.revision,
          toRevision: target.revision + 1,
          imagePoints: 1,
          reason: 'consistency_conflict',
          auditRef,
        });
        plan = notePlanSchema.parse({
          ...plan,
          pages: plan.pages.map((candidate) =>
            candidate.id === target.id
              ? {
                  ...candidate,
                  revision: candidate.revision + 1,
                  imageAssetId: generation.asset.id,
                }
              : candidate,
          ),
        });
        assertNotePlanWithinBound(plan, input.notePageBound);
        auditSignals.push(
          notePageRegeneratedEventSchema.parse({
            eventType: 'note_page_regenerated',
            payload: {
              auditRef,
              imagePoints: 1,
              pageId: page.id,
              trigger: 'check_violation',
            },
          }),
        );
      }
    };
    const initialCheck = await check({
      target: initialEvaluation,
      strategy: 'warn',
      evaluate: (evaluation) =>
        evaluation.regenerationPageIds.length > 0 ? [evaluation] : [],
      async onViolation(evaluation, { strategy }) {
        auditSignals.push({
          eventType: 'note_consistency_evaluated',
          payload: {
            attempt: 'initial',
            checkId: 'note-plan-consistency',
            dimensions: evaluation.dimensions,
            regenerationPageIds: evaluation.regenerationPageIds,
            status: 'warned',
            strategy,
          },
        });
        await regenerateViolations(evaluation);
      },
    });
    if (initialCheck.status === 'passed') {
      auditSignals.push({
        eventType: 'note_consistency_evaluated',
        payload: {
          attempt: 'initial',
          checkId: 'note-plan-consistency',
          dimensions: initialEvaluation.dimensions,
          regenerationPageIds: initialEvaluation.regenerationPageIds,
          status: initialCheck.status,
          strategy: initialCheck.strategy,
        },
      });
    }
    const regeneratedAnything =
      regenerationReceipts.length > 0 || textRewrites > 0;
    let evaluation = initialEvaluation;
    let secondEvaluationFailed = false;
    if (regeneratedAnything) {
      try {
        evaluation = notePlanConsistencyEvaluationSchema.parse(
          await evaluate({
            plan,
            attempt: 'after_regeneration',
          }),
        );
      } catch (error) {
        if (
          !(error instanceof StructuredNodeRunError) &&
          !(error instanceof ZodError)
        ) {
          throw error;
        }
        secondEvaluationFailed = true;
      }
      const finalCheck = await check({
        target: { evaluation, secondEvaluationFailed },
        strategy: 'warn',
        evaluate: (target) =>
          target.secondEvaluationFailed ||
          target.evaluation.regenerationPageIds.length > 0
            ? [target]
            : [],
        onViolation(target, { strategy }) {
          auditSignals.push({
            eventType: 'note_consistency_evaluated',
            payload: {
              attempt: 'after_regeneration',
              checkId: 'note-plan-consistency',
              dimensions: target.evaluation.dimensions,
              regenerationPageIds: target.evaluation.regenerationPageIds,
              status: 'warned',
              strategy,
              ...(target.secondEvaluationFailed
                ? {
                    evaluationUnavailable: true,
                    reason: 'second_evaluation_failed',
                  }
                : {}),
            },
          });
        },
      });
      if (finalCheck.status === 'passed') {
        auditSignals.push({
          eventType: 'note_consistency_evaluated',
          payload: {
            attempt: 'after_regeneration',
            checkId: 'note-plan-consistency',
            dimensions: evaluation.dimensions,
            regenerationPageIds: evaluation.regenerationPageIds,
            status: finalCheck.status,
            strategy: finalCheck.strategy,
          },
        });
      }
    }
    const unresolvedPageIds = evaluation.regenerationPageIds;
    const partial: NotePlanPartialDelivery | undefined =
      unresolvedPageIds.length > 0 || secondEvaluationFailed
        ? {
            unresolvedPageIds: [...unresolvedPageIds],
            reason: secondEvaluationFailed
              ? 'second_evaluation_failed'
              : 'consistency_remained_incomplete',
          }
        : undefined;

    return {
      auditSignals,
      childRuns: [...initial, ...regenerated].map(({ childRun }) => childRun),
      ownedAssets: [...initial, ...regenerated].map(({ asset }) => asset),
      selectedStyleId: selected.styleId,
      ...(partial ? { partial } : {}),
      version: imageTextNoteVersionSchema.parse({
        schema: 'image-text-note-version/v1',
        plan,
        evaluation,
        regenerationReceipts,
      }),
    };
  }
}

function assertNotePlanWithinBound(plan: NotePlan, notePageBound: number) {
  if (!Number.isSafeInteger(notePageBound) || notePageBound < 1) {
    throw new Error('图文笔记页数上界无效，请重新选择配方后再试。');
  }
  if (plan.pages.length > notePageBound) {
    throw new Error(
      `本次图文笔记计划为 ${plan.pages.length} 页，超过配方声明的 ${notePageBound} 页上界，请调整需求后重试。`,
    );
  }
}

function assertNotePlanFactReferences(
  plan: NotePlan,
  allowedFactRefs: readonly string[],
) {
  const allowed = new Set(allowedFactRefs);
  const unexpected = plan.pages
    .flatMap(({ imageIntent }) => imageIntent.factRefs)
    .filter((reference) => !allowed.has(reference));
  if (unexpected.length > 0) {
    throw new Error(
      'The NotePlan referenced a fact outside the authorized satisfaction result.',
    );
  }
}

export function regenerateNotePlanPage(input: {
  version: ImageTextNoteVersion;
  pageId: string;
  imageAssetId: string;
  auditRef: string;
}) {
  const current = imageTextNoteVersionSchema.parse(input.version);
  const target = current.plan.pages.find(({ id }) => id === input.pageId);
  if (!target) {
    throw new Error('The requested NotePlan page does not exist.');
  }
  return imageTextNoteVersionSchema.parse({
    ...current,
    plan: {
      ...current.plan,
      pages: current.plan.pages.map((page) =>
        page.id === input.pageId
          ? {
              ...page,
              revision: page.revision + 1,
              imageAssetId: input.imageAssetId,
            }
          : page,
      ),
    },
    regenerationReceipts: [
      ...current.regenerationReceipts,
      {
        pageId: target.id,
        fromRevision: target.revision,
        toRevision: target.revision + 1,
        imagePoints: 1,
        reason: 'merchant_request',
        auditRef: input.auditRef,
      },
    ],
  });
}

export function passingNoteEvaluation(
  evaluatedAt: string,
): NotePlanConsistencyEvaluation {
  return notePlanConsistencyEvaluationSchema.parse({
    evaluatedAt,
    dimensions: NOTE_PLAN_CONSISTENCY_DIMENSIONS.map((dimension) => ({
      dimension,
      passed: true,
      reason: `${dimension} passed`,
      pageIds: [],
    })),
    regenerationPageIds: [],
  });
}
