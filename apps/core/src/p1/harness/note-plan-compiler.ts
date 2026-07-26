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
    style: NoteStyleConfig['styles'][number];
    themeAnchor: string;
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
  }): Promise<{
    asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
    childRun: ContentPackage['generated']['childRuns'][number];
  }>;
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
  confirmationTimeoutSeconds: number;
}

export interface NotePlanSettingsSource {
  read(): Promise<NotePlanSettings>;
}

const NOTE_PAGE_GENERATION_BATCH_SIZE = 2;

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
  }) {
    const selected = input.candidates.candidates.find(
      ({ styleId }) => styleId === input.selectedStyleId,
    );
    if (!selected) {
      throw new Error('The selected NotePlan style is not available.');
    }
    const auditSignals: NotePlanCompilerAuditSignal[] = [
      {
        eventType: 'note_style_selected',
        payload: { styleId: selected.styleId },
      },
    ];
    const initial: Array<
      Awaited<ReturnType<NotePlanImagePort['generate']>>
    > = [];
    for (
      let index = 0;
      index < selected.plan.pages.length;
      index += NOTE_PAGE_GENERATION_BATCH_SIZE
    ) {
      initial.push(
        ...(await Promise.all(
          selected.plan.pages
            .slice(index, index + NOTE_PAGE_GENERATION_BATCH_SIZE)
            .map((page) =>
              this.images.generate({ page, reason: 'initial' }),
            ),
        )),
      );
    }
    let plan = notePlanSchema.parse({
      ...selected.plan,
      pages: selected.plan.pages.map((page, index) => ({
        ...page,
        imageAssetId: initial[index]?.asset.id,
      })),
    });
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
    for (const pageId of initialEvaluation.regenerationPageIds) {
      const page = plan.pages.find(({ id }) => id === pageId);
      if (!page) {
        throw new Error('Consistency evaluation referenced an unknown page.');
      }
      const generation = await this.images.generate({
        page,
        reason: 'consistency_conflict',
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
      auditSignals.push({
        eventType: 'note_page_regenerated',
        payload: { auditRef, imagePoints: 1, pageId: page.id },
      });
    }
    const evaluation =
      regenerationReceipts.length === 0
        ? initialEvaluation
        : notePlanConsistencyEvaluationSchema.parse(
            await this.structured.evaluate({
              plan,
              attempt: 'after_regeneration',
            }),
          );
    if (regenerationReceipts.length > 0) {
      auditSignals.push({
        eventType: 'note_consistency_evaluated',
        payload: {
          attempt: 'after_regeneration',
          dimensions: evaluation.dimensions,
          regenerationPageIds: evaluation.regenerationPageIds,
        },
      });
    }
    if (evaluation.regenerationPageIds.length > 0) {
      throw new Error(
        'NotePlan consistency remained incomplete after one bounded regeneration.',
      );
    }

    return {
      auditSignals,
      childRuns: [...initial, ...regenerated].map(({ childRun }) => childRun),
      ownedAssets: [...initial, ...regenerated].map(({ asset }) => asset),
      selectedStyleId: selected.styleId,
      version: imageTextNoteVersionSchema.parse({
        schema: 'image-text-note-version/v1',
        plan,
        evaluation,
        regenerationReceipts,
      }),
    };
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

export function noteConfirmationPolicy(input: {
  timeoutSeconds: number;
  isEditing: boolean;
  exceedsAllowance: boolean;
  hasExternalSideEffect: boolean;
}) {
  if (!Number.isSafeInteger(input.timeoutSeconds) || input.timeoutSeconds <= 0) {
    throw new Error('Note confirmation timeout must be a positive integer.');
  }
  const blocker = input.exceedsAllowance
    ? 'quota_confirmation_required'
    : input.hasExternalSideEffect
      ? 'external_side_effect_confirmation_required'
      : input.isEditing
        ? 'editing_paused'
        : null;
  return {
    autoContinue: blocker === null,
    blocker,
    timeoutSeconds: input.timeoutSeconds,
  } as const;
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
