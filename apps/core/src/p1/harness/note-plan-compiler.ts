import {
  NOTE_PLAN_CONSISTENCY_DIMENSIONS,
  imageTextNoteVersionSchema,
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

export const DEFAULT_NOTE_STYLES: NoteStyleConfig = {
  styles: [
    {
      id: 'practical_guide',
      name: '干货科普版',
      writingGuide: '用清楚、可信、便于收藏的方式解释项目与选择依据。',
      structureTemplate: '结论先行，再解释场景、方案、事实与行动建议。',
      platforms: ['xiaohongshu', 'douyin', 'video_account'],
    },
    {
      id: 'story_recommendation',
      name: '种草叙事版',
      writingGuide: '从顾客场景切入，以真实体验路径承接预约行动。',
      structureTemplate: '场景共鸣、需求展开、方案呈现、行动建议。',
      platforms: ['xiaohongshu', 'douyin', 'video_account'],
    },
  ],
};

export interface NotePlanStructuredPort {
  plan(input: {
    intent: string;
    factRefs: string[];
    rightsRefs: string[];
  }): Promise<NotePlan>;
  draftPage(input: {
    page: NotePlan['pages'][number];
    previousTextBlock?: NotePlan['pages'][number]['textBlock'];
    /**
     * Structural on purpose: a rewrite only knows the style the plan carries
     * (id / name / positioning), not the full configured entry.
     */
    style: {
      id: string;
      name: string;
      writingGuide: string;
      structureTemplate?: string;
    };
    themeAnchor: string;
    /** Why the previous text failed the consistency check (D-122 回炉). */
    consistencyFailure?: string;
  }): Promise<NotePlan['pages'][number]['textBlock']>;
  evaluate(input: {
    plan: NotePlan;
    attempt: 'initial' | 'after_regeneration';
  }): Promise<NotePlanConsistencyEvaluation>;
}

export interface NotePlanImagePort {
  generate(input: {
    page: NotePlan['pages'][number];
    reason: 'initial' | 'consistency_conflict' | 'merchant_request';
    /**
     * What the evaluator actually objected to. Without it a 回炉 is the same
     * prompt run twice, which cannot fix anything it did not know was wrong.
     */
    evaluationReason?: string;
  }): Promise<{
    asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
    childRun: ContentPackage['generated']['childRuns'][number];
  }>;
}

/**
 * Dimensions a *text* rewrite can fix. The other two (visual consistency,
 * image-text cross reference) are about the picture, so they stay on the image
 * branch — regenerating an image for a repetition problem is the 回炉 that
 * cannot converge (D-122).
 */
const TEXT_SIDE_CONSISTENCY_DIMENSIONS = new Set([
  'theme_continuity',
  'non_repetition',
  'role_coverage',
]);

export function notePageRegenerationPlan(
  evaluation: NotePlanConsistencyEvaluation,
  pageId: string,
): { reason: string; side: 'text' | 'image' } {
  const failing = evaluation.dimensions.filter(
    (dimension) => !dimension.passed && dimension.pageIds.includes(pageId),
  );
  const reason =
    failing.map(({ reason: text }) => text).join('；') ||
    '整篇一致性仍需调整。';
  const textOnly =
    failing.length > 0 &&
    failing.every(({ dimension }) =>
      TEXT_SIDE_CONSISTENCY_DIMENSIONS.has(dimension),
    );
  return { reason, side: textOnly ? 'text' : 'image' };
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
  ) {}

  async compileDrafts(input: {
    intent: string;
    factRefs: string[];
    rightsRefs: string[];
    styles?: NoteStyleConfig;
    notePageBound: number;
  }) {
    const styles = noteStyleConfigSchema.parse(
      input.styles ?? DEFAULT_NOTE_STYLES,
    );
    const basePlan = notePlanSchema.parse(
      await this.structured.plan({
        intent: input.intent,
        factRefs: input.factRefs,
        rightsRefs: input.rightsRefs,
      }),
    );
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
    const initialEvaluation = notePlanConsistencyEvaluationSchema.parse(
      await this.structured.evaluate({ plan, attempt: 'initial' }),
    );
    auditSignals.push({
      eventType: 'note_consistency_evaluated',
      payload: {
        attempt: 'initial',
        dimensions: initialEvaluation.dimensions,
        regenerationPageIds: initialEvaluation.regenerationPageIds,
      },
    });

    const regenerationReceipts: ImageTextNoteVersion['regenerationReceipts'] =
      [];
    const regenerated = [];
    const rewriteStyle = {
      id: selected.plan.style.id,
      name: selected.plan.style.name,
      writingGuide: selected.plan.style.positioning,
    };
    let textRewrites = 0;
    for (const pageId of initialEvaluation.regenerationPageIds) {
      const page = plan.pages.find(({ id }) => id === pageId);
      if (!page) {
        throw new Error('Consistency evaluation referenced an unknown page.');
      }
      const regeneration = notePageRegenerationPlan(initialEvaluation, pageId);
      if (regeneration.side === 'text') {
        const index = plan.pages.findIndex(({ id }) => id === pageId);
        const previousTextBlock = plan.pages[index - 1]?.textBlock;
        const rewritten = await this.structured.draftPage({
          page,
          ...(previousTextBlock ? { previousTextBlock } : {}),
          style: rewriteStyle,
          themeAnchor: plan.themeAnchor,
          consistencyFailure: regeneration.reason,
        });
        plan = notePlanSchema.parse({
          ...plan,
          pages: plan.pages.map((candidate) =>
            candidate.id === page.id
              ? {
                  ...candidate,
                  revision: candidate.revision + 1,
                  // The picture already passed; keeping its exact text keeps the
                  // image the rewrite is supposed to match still matching.
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
        auditSignals.push({
          eventType: 'note_page_regenerated',
          payload: {
            auditRef: `note-page-rewrite:${page.id}:r${page.revision + 1}`,
            imagePoints: 0,
            pageId: page.id,
            side: 'text',
          },
        });
        continue;
      }
      const generation = await this.images.generate({
        page,
        reason: 'consistency_conflict',
        evaluationReason: regeneration.reason,
      });
      regenerated.push(generation);
      const auditRef = `note-page-regeneration:${page.id}:r${page.revision + 1}`;
      regenerationReceipts.push({
        pageId: page.id,
        fromRevision: page.revision,
        toRevision: page.revision + 1,
        imagePoints: 1,
        reason: 'consistency_conflict',
        auditRef,
      });
      plan = notePlanSchema.parse({
        ...plan,
        pages: plan.pages.map((candidate) =>
          candidate.id === page.id
            ? {
                ...candidate,
                revision: candidate.revision + 1,
                imageAssetId: generation.asset.id,
              }
            : candidate,
        ),
      });
      assertNotePlanWithinBound(plan, input.notePageBound);
      auditSignals.push({
        eventType: 'note_page_regenerated',
        payload: { auditRef, imagePoints: 1, pageId: page.id },
      });
    }
    const regeneratedAnything =
      regenerationReceipts.length > 0 || textRewrites > 0;
    const evaluation = !regeneratedAnything
      ? initialEvaluation
      : notePlanConsistencyEvaluationSchema.parse(
          await this.structured.evaluate({
            plan,
            attempt: 'after_regeneration',
          }),
        );
    if (regeneratedAnything) {
      auditSignals.push({
        eventType: 'note_consistency_evaluated',
        payload: {
          attempt: 'after_regeneration',
          dimensions: evaluation.dimensions,
          regenerationPageIds: evaluation.regenerationPageIds,
        },
      });
    }
    // D-122 诚实交付: one bounded regeneration is the contract, and pages that
    // still disagree after it do not void the whole run. The merchant gets the
    // set that did come out right, plus a 申报 naming the pages that did not —
    // failing the task outright would throw away work they can already use.
    const unresolvedPageIds = evaluation.regenerationPageIds;

    return {
      auditSignals,
      childRuns: [...initial, ...regenerated].map(({ childRun }) => childRun),
      ownedAssets: [...initial, ...regenerated].map(({ asset }) => asset),
      selectedStyleId: selected.styleId,
      ...(unresolvedPageIds.length > 0
        ? { partial: { unresolvedPageIds: [...unresolvedPageIds] } }
        : {}),
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
