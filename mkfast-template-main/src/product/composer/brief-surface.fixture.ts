import type {
  BriefBoundRevisions,
  BriefEvidenceEntry,
  BriefSummaryFields,
  BriefTriggerConditionCode,
  BriefTriggerProjection,
  CreationLensId,
} from '@meiye/contracts';

export function fixtureBriefProjection(input: {
  requiresBrief: boolean;
  triggerCodes?: BriefTriggerConditionCode[];
  evidenceDrawer?: BriefEvidenceEntry[];
  summary?: BriefSummaryFields;
  bindRevisions?: Partial<BriefBoundRevisions>;
  confirmationInvalid?: boolean;
  confirmationValid?: boolean;
  lensId?: CreationLensId | null;
}): BriefTriggerProjection {
  const codes = input.triggerCodes ?? [];
  const reasons: Record<BriefTriggerConditionCode, string> = {
    any_video: '本次包含视频生成，需确认成品、时长与费用',
    multi_deliverable_or_cross_platform: '多交付物或跨平台组合，需确认范围',
    images_over_four: '图片数量超过 4 张，需确认套图与费用',
    restricted_assets: '使用了顾客案例、前后对比或评价等受限素材，需确认权利',
    high_risk_fact_missing_or_conflict:
      '价格、期限、效果或资质等关键事实缺失或冲突',
    quote_policy_threshold: '预计费用达到额外确认门槛',
    confirmation_invalid: '草稿、模板、模型、报价或来源已变化，需重新确认',
  };

  const draftRevisionId =
    input.bindRevisions?.draftRevisionId ?? 'draft-rev-fixture';

  return {
    requiresBrief: input.requiresBrief,
    triggers: codes.map((code) => ({ code, reason: reasons[code] })),
    bindRevisions: {
      draftRevisionId,
      recipeRevisionId: input.bindRevisions?.recipeRevisionId ?? null,
      modelRevisionId: input.bindRevisions?.modelRevisionId ?? null,
      quoteRevisionId: input.bindRevisions?.quoteRevisionId ?? null,
      sourceRevisionId: input.bindRevisions?.sourceRevisionId ?? null,
      surfaceRevisionId: input.bindRevisions?.surfaceRevisionId ?? null,
      lensId: input.bindRevisions?.lensId ?? input.lensId ?? null,
    },
    confirmationInvalid: input.confirmationInvalid ?? false,
    confirmationValid: input.confirmationValid ?? false,
    evidenceDrawer: input.evidenceDrawer ?? [],
    summary: input.summary ?? {
      targetDeliverable: input.requiresBrief ? '测试成品' : null,
      platforms: input.requiresBrief ? ['小红书'] : undefined,
      sourceRightsSummary: input.requiresBrief ? '本店素材·已授权' : null,
      keyFacts: input.requiresBrief ? ['活动价 99'] : undefined,
      modelAndSettings: input.requiresBrief ? '默认模型' : null,
      impactScope: input.requiresBrief ? '仅本次' : null,
      estimatedCost: input.requiresBrief ? '3 条' : null,
      estimatedDuration: input.requiresBrief ? '约 30 秒' : null,
      pendingItems: input.requiresBrief ? ['确认费用'] : undefined,
    },
  };
}
