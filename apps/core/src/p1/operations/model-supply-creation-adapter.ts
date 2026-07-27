import { createHash } from 'node:crypto';
import type { P1Context } from '../foundation/domain.js';
import type { ModelSupplyControlPlaneService } from '../model-supply/foundation-module.js';
import type {
  DurableMediaGenerationJobView,
  ModelSupplyResult,
  ReferenceAssetResolverPort,
} from '../model-supply/index.js';
import { OperationsError } from './application-service.js';
import { nativeSupplyOperation } from '../harness/image-intent-compiler.js';
import type {
  AcceptedProductQuoteInspectionAuthority,
  CreationExecutionResult,
  CreationExecutorPort,
  CreativeBrief,
  CreativeExecutionContract,
  CreativeGroundingSnapshot,
  CreativeInheritanceContext,
  CreativeInheritanceFact,
} from './types.js';

const CONTENT_MODULE_LABELS = {
  before_after: 'Before / After',
  package_explainer: '套餐说明',
  price_card: '价格卡',
  review_card: '好评卡',
  shooting_checklist: '拍摄清单',
  social_cover: '社交媒体封面',
  store_intro: '门店介绍',
} as const;
const CREATIVE_PROMPT_REVISION = 'creative-brief-grounding-v3';
const CREATIVE_EXAMPLE_SET_REVISION = 'none';

const SOURCE_KIND_LABELS = {
  asset: 'Asset',
  template: 'Template',
  work: 'Work',
} as const;

function safeCount(value: unknown) {
  return Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= 10_000
    ? Number(value)
    : undefined;
}

function countLabel(value: unknown, label: string) {
  const count = safeCount(value);
  return count === undefined ? undefined : `${count} ${label}`;
}

function formatInheritanceFact(fact: CreativeInheritanceFact) {
  switch (fact.field) {
    case 'content_structure': {
      const modules = (fact.contentModules ?? [])
        .map((moduleId) => CONTENT_MODULE_LABELS[moduleId])
        .filter(Boolean);
      const parts = [
        modules.length ? `成套模块 ${modules.join('、')}` : undefined,
        countLabel(fact.pageCount, '页'),
        ['text', 'image', 'video'].includes(fact.assetKind ?? '')
          ? `来源类型 ${fact.assetKind}`
          : undefined,
      ].filter((value): value is string => Boolean(value));
      return `内容结构：${parts.join('；') || '无可安全迁移的结构化事实'}`;
    }
    case 'layout_slots': {
      const parts = [
        countLabel(fact.pageCount, '页'),
        countLabel(fact.moduleSlotCount, '个模块槽'),
        countLabel(fact.textSlotCount, '个文字槽'),
        countLabel(fact.mediaSlotCount, '个媒体槽'),
      ].filter((value): value is string => Boolean(value));
      return `版式槽位：${parts.join('；') || '无可安全迁移的槽位事实'}`;
    }
    case 'copy_skeleton': {
      const modules = (fact.contentModuleOrder ?? [])
        .map((moduleId) => CONTENT_MODULE_LABELS[moduleId])
        .filter(Boolean);
      const parts = [
        modules.length ? `模块顺序 ${modules.join('、')}` : undefined,
        countLabel(fact.textSlotCount, '个文字槽'),
        countLabel(fact.emphasisLevelCount, '级文字强调层次'),
        fact.hasConversionHook === true ? '包含转化动作槽' : undefined,
      ].filter((value): value is string => Boolean(value));
      return `文案骨架：${parts.join('；') || '无可安全迁移的文案结构事实'}`;
    }
    case 'output_specification': {
      const operations = new Set([
        'copy.generate',
        'image.generate',
        'image.edit',
        'video.generate',
      ]);
      const aspectRatios = new Set(['1:1', '3:4', '9:16']);
      const width = safeCount(fact.width);
      const height = safeCount(fact.height);
      const parts = [
        operations.has(fact.operation ?? '') ? fact.operation : undefined,
        aspectRatios.has(fact.aspectRatio ?? '') ? fact.aspectRatio : undefined,
        width && height ? `${width} × ${height}` : undefined,
        countLabel(fact.pageCount, '页'),
        countLabel(fact.outputCount, '个输出'),
        countLabel(fact.durationSeconds, '秒'),
        ['text', 'image', 'video'].includes(fact.assetKind ?? '')
          ? `输出类型 ${fact.assetKind}`
          : undefined,
      ].filter((value): value is string => Boolean(value));
      return `输出规格：${parts.join('；') || '无可安全迁移的输出规格事实'}`;
    }
    case 'visual_style': {
      const colors = Array.isArray(fact.colors)
        ? fact.colors
            .filter(
              (value) =>
                typeof value === 'string' &&
                /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
            )
            .slice(0, 8)
        : [];
      const fontFamilies = Array.isArray(fact.fontFamilies)
        ? fact.fontFamilies
            .filter(
              (value) =>
                typeof value === 'string' &&
                value.length <= 40 &&
                /^[\p{L}\p{N} ._-]+$/u.test(value)
            )
            .slice(0, 8)
        : [];
      const parts = [
        colors.length ? `色板 ${colors.join('、')}` : undefined,
        fontFamilies.length ? `字体 ${fontFamilies.join('、')}` : undefined,
      ].filter((value): value is string => Boolean(value));
      return `视觉风格：${parts.join('；') || '无可安全迁移的样式令牌'}`;
    }
  }
}

function structuredInheritanceContext(
  inheritanceContext: CreativeInheritanceContext | undefined
) {
  if (!inheritanceContext?.sources.length) return undefined;
  const sources = inheritanceContext.sources.flatMap((source, index) => {
    const kind = SOURCE_KIND_LABELS[source.kind];
    if (!kind || !Array.isArray(source.facts)) return [];
    return [
      `来源 ${index + 1}（${kind}，仅以下已选结构事实）：\n${source.facts
        .map((fact) => `- ${formatInheritanceFact(fact)}`)
        .join('\n')}`,
    ];
  });
  return sources.length
    ? `继承执行上下文（不得补写来源正文、业务事实、媒体地址或内部字段）：\n${sources.join('\n')}`
    : undefined;
}

function structuredCreativeIntent(
  intent: string,
  contract: CreativeExecutionContract,
  inheritanceContext?: CreativeInheritanceContext,
  briefSnapshot?: CreativeBrief,
  groundingSnapshot?: CreativeGroundingSnapshot
) {
  const modules = contract.contentModules ?? ['social_cover'];
  const inheritance = structuredInheritanceContext(inheritanceContext);
  const briefLabels = {
    audience: '受众',
    intent: '目标',
    scene: '场景',
    tone: '语气',
  } as const;
  const brief = briefSnapshot
    ? `已确认 Creative Brief（只执行 current 值）：\n${(
        ['intent', 'scene', 'tone', 'audience'] as const
      )
        .flatMap((field) => {
          const value = briefSnapshot.fields[field];
          return value
            ? [`- ${briefLabels[field]}：${value.current}（${value.owner}）`]
            : [];
        })
        .join('\n')}`
    : undefined;
  const grounding = groundingSnapshot
    ? [
        '已确认 Product grounding（不得使用此快照外的商家事实；不得编造价格、折扣或授权）：',
        `- 门店：${groundingSnapshot.store.name}｜${groundingSnapshot.store.city}${groundingSnapshot.store.district}｜${groundingSnapshot.store.address}`,
        `- 预约：${groundingSnapshot.store.booking}`,
        `- 品牌语气：${groundingSnapshot.store.brandVoice}`,
        `- 禁止表达：${groundingSnapshot.store.prohibitions.join('、') || '无'}`,
        ...groundingSnapshot.store.projects.map(
          (project) =>
            `- 已确认项目：${project.name}（ID ${project.id}，价格 ${project.price}，时长 ${project.durationMinutes} 分钟）`
        ),
        ...(groundingSnapshot.qualification
          ? [
              `- 已确认资质：admitted=${groundingSnapshot.qualification.admitted}，treatmentScope=${groundingSnapshot.qualification.treatmentScope ?? '未提供'}`,
            ]
          : []),
        ...groundingSnapshot.assets.map(
          (asset) =>
            `- 真实授权素材：${asset.id}（范围 ${asset.consentScope}，标签 ${asset.tags.join('、') || '无'}）`
        ),
      ].join('\n')
    : undefined;
  return [
    briefSnapshot?.fields.intent?.current ?? intent,
    brief,
    grounding,
    `本次成套内容结构（按顺序全部覆盖）：${modules
      .map((moduleId) => CONTENT_MODULE_LABELS[moduleId])
      .join('、')}。`,
    inheritance,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
}

export class ModelSupplyCreationExecutor implements CreationExecutorPort {
  constructor(
    private readonly controlPlane: ModelSupplyControlPlaneService,
    private readonly referenceAssets?: ReferenceAssetResolverPort
  ) {}

  async inspect(
    workspaceId: string,
    contract: CreativeExecutionContract,
    authority?: AcceptedProductQuoteInspectionAuthority,
  ) {
    const catalog = await this.controlPlane.getCatalog(
      workspaceId,
      nativeSupplyOperation(contract.operation)
    );
    if (catalog.revisionId !== contract.catalogRevision) {
      throw new OperationsError(
        'CREATIVE_CATALOG_CHANGED',
        'The model catalog changed. Review and accept the current contract.',
        409
      );
    }
    const model = catalog.models.find(
      (candidate) => candidate.id === contract.catalogModelId
    );
    const executable =
      model?.available === true ||
      (model?.availability === 'available' &&
        model.activationEvidence.status === 'live_verified');
    if (
      !model ||
      !executable
    ) {
      throw new OperationsError(
        'MODEL_NOT_LIVE_VERIFIED',
        'Only active and live-verified deployments can submit.',
        409
      );
    }
    if (authority) {
      if (
        authority.quoteRevision !== contract.quoteRevision ||
        authority.catalogModelId !== contract.catalogModelId ||
        authority.catalogModelRevision !== contract.catalogRevision ||
        authority.confirmedAmount !== contract.estimatedAmount ||
        authority.currency !== contract.currency ||
        authority.outputCount !== contract.outputCount ||
        authority.outputLabel !== contract.outputLabel
      ) {
        throw new OperationsError(
          'CREATIVE_QUOTE_CHANGED',
          'The accepted Product quote no longer matches the execution contract.',
          409,
        );
      }
      return;
    }
    const unitPrice = model.unitPrice;
    const outputCount = contract.operation.startsWith('copy.') ? 3 : 1;
    const expected = {
      currency: unitPrice?.currency,
      estimatedAmount: unitPrice
        ? (unitPrice.amountMicros * outputCount) / 1_000_000
        : undefined,
      outputCount,
      outputLabel:
        contract.operation === 'copy.generate'
          ? '3 条内容候选'
          : contract.operation === 'copy.adapt'
            ? '三平台版本'
          : contract.operation === 'video.generate'
            ? '1 段竖屏视频'
            : `1 张 ${contract.aspectRatio} 图片`,
      quoteRevision: unitPrice
        ? `${catalog.revisionId}:${unitPrice.revision}:${model.id}:${contract.operation}:${
            contract.operation.startsWith('copy.')
              ? 'text'
              : contract.aspectRatio
          }`
        : undefined,
    };
    if (
      !unitPrice ||
      contract.currency !== expected.currency ||
      contract.estimatedAmount !== expected.estimatedAmount ||
      contract.outputCount !== expected.outputCount ||
      contract.outputLabel !== expected.outputLabel ||
      contract.quoteRevision !== expected.quoteRevision
    ) {
      throw new OperationsError(
        'CREATIVE_QUOTE_CHANGED',
        'The execution quote changed. Review and accept the current contract.',
        409
      );
    }
  }

  async submit(input: Parameters<CreationExecutorPort['submit']>[0]) {
    const context: P1Context = {
      actor: input.context.actor,
      correlationId: input.context.correlationId,
      userId: input.context.userId,
      workspaceId: input.context.workspaceId,
    };
    // Seedream (Tu-zi) enforces 3_686_400 ≤ pixels ≤ 16_777_216.
    // Use documented common sizes that meet the floor (not 1024² = 1MP).
    // docs/_private/tuzi-api/images-generations.openapi.yaml
    const dimensions =
      input.contract.aspectRatio === '1:1'
        ? { height: 2048, width: 2048 }
        : input.contract.aspectRatio === '3:4'
          ? { height: 2048, width: 1536 }
          : input.contract.aspectRatio === '9:16'
            ? { height: 2048, width: 1152 }
            : {};
    const referenceAssetIds = input.groundingSnapshot?.assets.map(
      (asset) => asset.id
    ) ?? [];
    if (
      !input.contract.operation.startsWith('copy.') &&
      referenceAssetIds.length > 0
    ) {
      if (!this.referenceAssets) {
        throw new OperationsError(
          'REFERENCE_ASSET_RESOLVER_UNAVAILABLE',
          'Reference asset validation is unavailable.',
          503
        );
      }
      const inspection = await this.referenceAssets.inspect(
        input.context.workspaceId,
        referenceAssetIds
      );
      const failures = inspection.filter(
        (result) => result.kind === 'failure'
      );
      if (failures.length > 0) {
        throw Object.assign(
          new OperationsError(
            'REFERENCE_ASSET_UNRESOLVED',
            'Reference assets need attention.',
            409
          ),
          {
            details: {
              referenceFailures: failures.map((failure) => ({
                assetId: failure.assetId,
                reasonCode: failure.reason,
              })),
            },
          }
        );
      }
    }
    const result = await this.controlPlane.submitGeneration(
      context,
      {
        ...(input.billingTaskId && input.billingQuoteRevision
          ? {
              billingQuoteRevision: input.billingQuoteRevision,
              billingTaskId: input.billingTaskId,
            }
          : {}),
        dataClass: input.contract.dataClass,
        input: {
          ...dimensions,
          ...(referenceAssetIds.length
            ? {
                referenceAssetIds,
              }
            : {}),
          ...(input.contract.durationSeconds
            ? { durationSeconds: input.contract.durationSeconds }
            : {}),
        },
        operation: nativeSupplyOperation(input.contract.operation),
        prompt: structuredCreativeIntent(
          input.intent,
          input.contract,
          input.inheritanceContext,
          input.briefSnapshot,
          input.groundingSnapshot
        ),
        promptRevision: CREATIVE_PROMPT_REVISION,
        exampleSetRevision: CREATIVE_EXAMPLE_SET_REVISION,
        productUsageQuantity: input.productUsageQuantity,
        selection: {
          catalogModelId: input.contract.catalogModelId,
          mode: 'fixed',
        },
      },
      input.idempotencyKey
    );
    if (!input.contract.operation.startsWith('copy.')) {
      const job = (await this.controlPlane.getJob(
        input.context.workspaceId,
        result.jobId
      )) as DurableMediaGenerationJobView;
      return this.executionResult(job.result, job.status);
    }
    return this.executionResult(result);
  }

  async verify(input: Parameters<CreationExecutorPort['verify']>[0]) {
    const job = await this.controlPlane.getJob(
      input.context.workspaceId,
      input.providerJobId
    );
    return this.executionResult(
      'result' in job ? job.result : job,
      'result' in job ? job.status : undefined
    );
  }

  async cancel(input: Parameters<NonNullable<CreationExecutorPort['cancel']>>[0]) {
    const cancelled = await this.controlPlane.cancelGeneration(
      {
        actor: input.context.actor,
        correlationId: input.context.correlationId,
        userId: input.context.userId,
        workspaceId: input.context.workspaceId,
      },
      input.providerJobId,
    );
    return this.executionResult(cancelled.result, cancelled.status);
  }

  async recordReroll(
    input: Parameters<NonNullable<CreationExecutorPort['recordReroll']>>[0]
  ) {
    await this.controlPlane.recordQuality(input.context.workspaceId, {
      catalogModelId: input.contract.catalogModelId,
      exampleSetRevision: CREATIVE_EXAMPLE_SET_REVISION,
      id: `creative-reroll-${createHash('sha256')
        .update(
          `${input.context.workspaceId}:${input.targetJobId}:${input.rerollKind}`
        )
        .digest('hex')
        .slice(0, 24)}`,
      outcome: 'rerolled',
      promptRevision: CREATIVE_PROMPT_REVISION,
      scenario: `creative_copy_${input.rerollKind}_reroll`,
    });
  }

  private executionResult(
    result: ModelSupplyResult,
    lifecycleStatus?: DurableMediaGenerationJobView['status']
  ): CreationExecutionResult {
    if (result.asset?.contentType === 'application/zip') {
      throw new Error('Creative generation cannot return an export archive.');
    }
    const selectedCandidate = result.snapshot.allowedCandidates?.find(
      (candidate) =>
        candidate.catalogModelId === result.snapshot.actualCatalogModelId
    );
    const providerModel =
      result.snapshot.providerModel ??
      selectedCandidate?.providerModel ??
      selectedCandidate?.stableModelName ??
      undefined;
    const status: CreationExecutionResult['status'] =
      lifecycleStatus === 'queued' ||
      lifecycleStatus === 'running' ||
      lifecycleStatus === 'cancel_requested'
        ? 'running'
        : lifecycleStatus === 'cancelled'
          ? 'failed'
          : result.status === 'completed'
        ? 'completed'
        : result.status === 'unknown'
          ? 'unknown'
          : 'failed';
    return {
      ...(result.asset
        ? {
            asset: {
              contentType: result.asset.contentType,
              id: result.asset.id,
              objectKey: result.asset.objectKey,
              sha256: result.asset.sha256,
              sizeBytes: result.asset.sizeBytes,
            },
          }
        : {}),
      ...(result.copyCandidates
        ? {
            copyCandidates: result.copyCandidates.map((candidate) => ({
              body: candidate.body,
              conversionHook: candidate.conversionHook,
              title: candidate.title,
            })),
          }
        : {}),
      ...(result.platformVariants
        ? { platformVariants: structuredClone(result.platformVariants) }
        : {}),
      productUsage: {
        quantity: result.usage.quantity,
        status: result.usage.status,
      },
      providerCost: {
        amount: result.providerCost.amount,
        currency: result.providerCost.currency,
        status: result.providerCost.status,
      },
      ...(result.status === 'failed' || lifecycleStatus === 'cancelled'
        ? {
            failureCode:
              lifecycleStatus === 'cancelled'
                ? 'PROVIDER_CANCELLED'
                : result.failureCode ??
                  (result.attempt.acceptance === 'rejected_before_accept'
                    ? 'PROVIDER_REJECTED_BEFORE_ACCEPT'
                    : 'PROVIDER_TERMINAL_FAILURE'),
          }
        : {}),
      providerJobId: result.jobId,
      executionProvenance: {
        actualCatalogModelId: result.snapshot.actualCatalogModelId,
        ...(selectedCandidate?.activationStatus
          ? { activationStatus: selectedCandidate.activationStatus }
          : {}),
        ...(result.snapshot.apiCounterparty
          ? { apiCounterparty: result.snapshot.apiCounterparty }
          : {}),
        ...(selectedCandidate?.modelDisplayName
          ? { modelDisplayName: selectedCandidate.modelDisplayName }
          : {}),
        ...(providerModel ? { providerModel } : {}),
      },
      retryable: result.attempt.acceptance === 'rejected_before_accept',
      routeSnapshotId: result.snapshot.id,
      status,
    };
  }
}
