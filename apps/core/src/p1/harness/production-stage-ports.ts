import { createHash } from 'node:crypto';

import type {
  AssetRevision,
  ContentPackageRevisionDelivery,
  CreativeRecommendationDecisionTrace,
  MarketingPackageEvidence,
  ReuseTaskSeed,
} from '@meiye/contracts';

import type {
  ContentPackageRevisionWriteInput,
  ContentPackageRevisionWritePort,
} from '../execution-spine/content-package-revision-port.js';
import {
  SourceContentPackageUnavailableError,
  type ExecutionSourceContentPackageResolverPort,
  type ResolvedSourceContentPackage,
} from '../execution-spine/source-content-package-resolver.js';

import {
  executeCopySelection,
  StructuredCandidateScorer,
} from './execution-selection.js';
import { createHarnessCandidateValidator } from './policy-gates.js';
import {
  compileExecutionBrief,
  InMemoryStructuredNodeMetrics,
  nameHarnessIntent,
  type StructuredNodeRunner,
  type StructuredNodeRunnerRequest,
  type StructuredNodeRunnerResult,
} from './structured-nodes.js';
import type {
  HarnessContextSnapshot,
  HarnessStagePorts,
} from './workflow-core.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { projectMarketingPackageEvidence } from './marketing-scene-policy.js';

export interface ProductionHarnessContextPort {
  compileAndFreeze(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: Parameters<HarnessStagePorts['injectContext']>[0]['declaration'];
  }): Promise<HarnessContextSnapshot>;
  fence(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: Parameters<HarnessStagePorts['fenceContext']>[0]['declaration'];
    context: HarnessContextSnapshot;
  }): Promise<HarnessContextSnapshot>;
}

export interface HarnessCopyDeliveryPort {
  deliverCopyRevision(input: {
    workflowId: string;
    workspaceId: string;
    packageId: string;
    expectedRevision: number;
    platform: 'xiaohongshu' | 'douyin' | 'video_account';
    occurredAt: string;
    workflowRevision: number;
    winner: {
      candidateId: string;
      title: string;
      body: string;
      conversionHook: string;
    };
    candidates: Array<{
      candidateId: string;
      title: string;
      body: string;
      conversionHook: string;
      score: number;
    }>;
    recommendation: Omit<CreativeRecommendationDecisionTrace, 'deliverables'>;
    assetIds: string[];
    marketing: MarketingPackageEvidence;
    reuseSeed?: ReuseTaskSeed;
  }): Promise<ContentPackageRevisionDelivery>;
}

export interface HarnessStructuredNodeRunnerFactory {
  create(input: { workspaceId: string; actorId: string }): StructuredNodeRunner;
}

export class HarnessCopyScopeError extends Error {
  readonly code = 'HARNESS_COPY_ONLY';
  readonly status = 409;

  constructor() {
    super('The first production tracer supports only the copy delivery layer.');
    this.name = 'HarnessCopyScopeError';
  }
}

export class HarnessIdentityPreflightError extends Error {
  readonly code = 'HARNESS_IDENTITY_INVALID';
  readonly status = 409;

  constructor(readonly invalidIdentityRefs: string[]) {
    super('The copy brief references an unregistered or withdrawn identity.');
    this.name = 'HarnessIdentityPreflightError';
  }
}

export class HarnessSnapshotIdentityBindingError extends Error {
  readonly code = 'HARNESS_IDENTITY_SNAPSHOT_MISMATCH';
  readonly status = 409;

  constructor(
    readonly expectedIdentityRef: string,
    readonly actualIdentityRefs: string[],
  ) {
    super('The copy brief and frozen context must bind exactly to the execution snapshot identity.');
    this.name = 'HarnessSnapshotIdentityBindingError';
  }
}

export class HarnessSnapshotAssetReferenceError extends Error {
  readonly code = 'HARNESS_ASSET_SNAPSHOT_MISMATCH';
  readonly status = 409;

  constructor(readonly assetIds: string[]) {
    super('The copy brief references assets outside the frozen execution snapshot.');
    this.name = 'HarnessSnapshotAssetReferenceError';
  }
}

class SourceContentPackageGuardedRunner implements StructuredNodeRunner {
  constructor(
    private readonly runner: StructuredNodeRunner,
    private readonly verify: () => Promise<void>,
  ) {}

  async run<Output>(
    request: StructuredNodeRunnerRequest<Output>,
  ): Promise<StructuredNodeRunnerResult<Output>> {
    const beforeProviderAttempt = async () => {
      await this.verify();
      await request.beforeProviderAttempt?.();
    };
    await beforeProviderAttempt();
    return this.runner.run({ ...request, beforeProviderAttempt });
  }
}

export class ProductionHarnessStagePorts implements HarnessStagePorts {
  constructor(
    private readonly runners: HarnessStructuredNodeRunnerFactory,
    private readonly context: ProductionHarnessContextPort,
    private readonly delivery: HarnessCopyDeliveryPort,
    private readonly now: () => string,
    private readonly reuseTasks?: {
      verifyReuseTaskSeed(
        workspaceId: string,
        seed: ReuseTaskSeed,
      ): Promise<AssetRevision>;
    },
    private readonly executionDelivery?: ContentPackageRevisionWritePort,
    private readonly sourceContentPackages?: ExecutionSourceContentPackageResolverPort,
  ) {}

  async nameIntent(input: Parameters<HarnessStagePorts['nameIntent']>[0]) {
    await this.resolveLiveSourceContentPackage(input.request);
    const runner = this.runnerWithSourceFence(input.request);
    const metrics = new InMemoryStructuredNodeMetrics();
    const result = await nameHarnessIntent(
      {
        workflowId: input.workflowId,
        workflowRevision: input.request.workflowRevision,
        intent: input.request.intent,
        prompt: input.request.prompts?.intentNaming,
      },
      runner,
      metrics,
    );
    const measured = { ...result, metrics: metrics.snapshot() };
    if (result.declaration.deliveryLayer !== 'copy') {
      throw new HarnessCopyScopeError();
    }
    if (result.blockingQuestion) {
      const snapshot = await this.context.compileAndFreeze({
        workflowId: input.workflowId,
        request: input.request,
        declaration: result.declaration,
      });
      const factKey = result.blockingQuestion.questionId.split(':s1:')[1];
      const activeFactReferences =
        snapshot.activeFactReferences ??
        Object.entries(snapshot.bundle.dimensions.store_facts_assets).map(
          ([key, item]) => ({ key, sourceRef: item.sourceRef }),
        );
      const matchingFacts = factKey
        ? activeFactReferences.filter(
            ({ key, sourceRef }) =>
              factKeysMatch(key, factKey) &&
              sourceRef.startsWith('store_fact:'),
          )
        : [];
      if (matchingFacts.length === 1) {
        return { ...measured, blockingQuestion: null };
      }
    }
    return measured;
  }

  async injectContext(input: Parameters<HarnessStagePorts['injectContext']>[0]) {
    return this.context.compileAndFreeze(input);
  }

  fenceContext(input: Parameters<HarnessStagePorts['fenceContext']>[0]) {
    return this.context.fence(input);
  }

  async compileBrief(input: Parameters<HarnessStagePorts['compileBrief']>[0]) {
    const snapshot = input.request.executionSnapshot;
    if (snapshot && snapshot.lens !== 'copy') {
      throw new HarnessCopyScopeError();
    }
    const sourceContentPackage = await this.resolveLiveSourceContentPackage(
      input.request,
    );
    const runner = this.runnerWithSourceFence(input.request);
    const metrics = new InMemoryStructuredNodeMetrics();
    const brief = await compileExecutionBrief(
      {
        workflowId: input.workflowId,
        unitId: copyUnit(input.context.bundle.revision),
        unitKind: 'copy',
        declaration: input.declaration,
        bundle: input.context.bundle,
        ...(snapshot
          ? { executionSnapshot: snapshot }
          : {}),
        prompt: input.request.prompts?.briefCompilation,
      },
      runner,
      metrics,
    );
    if (brief.kind !== 'copy') {
      throw new Error('The first production tracer accepts only copy briefs.');
    }
    const boundBrief = snapshot
      ? bindComposerSnapshotBrief(brief, snapshot, sourceContentPackage?.assets)
      : brief;
    return {
      brief: boundBrief,
      metrics: metrics.snapshot(),
    };
  }

  executeAndSelect(
    input: Parameters<HarnessStagePorts['executeAndSelect']>[0],
  ) {
    const registeredIdentityRefs = new Set(
      input.context.policyReferences.identityRefs
        .filter((reference) => reference.status === 'registered')
        .map((reference) => reference.id),
    );
    const snapshot = input.request.executionSnapshot;
    if (snapshot) {
      assertComposerSnapshotIdentityBinding(
        snapshot,
        registeredIdentityRefs,
        input.brief.identityRefs,
      );
      if (!snapshot.sources.contentPackage) {
        assertComposerSnapshotAssetBinding(snapshot, input.brief.assetRefs);
      }
    }
    const invalidIdentityRefs = input.brief.identityRefs.filter(
      (reference) => !registeredIdentityRefs.has(reference),
    );
    if (invalidIdentityRefs.length > 0) {
      throw new HarnessIdentityPreflightError(invalidIdentityRefs);
    }
    return this.executeAndSelectLive(input);
  }

  private async executeAndSelectLive(
    input: Parameters<HarnessStagePorts['executeAndSelect']>[0],
  ) {
    const sourceContentPackage = await this.resolveLiveSourceContentPackage(
      input.request,
    );
    const snapshot = input.request.executionSnapshot;
    if (snapshot) {
      assertComposerSnapshotAssetBinding(
        snapshot,
        input.brief.assetRefs,
        sourceContentPackage?.assets,
      );
    }
    const marketing = projectMarketingPackageEvidence({
      declaration: inferDeclarationFromBundle(input.context),
      request: input.request,
      context: input.context,
      at: this.now(),
    });
    const runner = this.runnerWithSourceFence(input.request);
    const canonicalValidator = createHarnessCandidateValidator({
      phase: 'execution',
      bundle: {
        workspaceId: input.request.workspaceId,
        revision: input.context.bundle.revision,
      },
      brief: { ...input.brief },
      ...input.context.policyReferences,
    });
    const validator = {
      validate(candidate: Parameters<typeof canonicalValidator.validate>[0]) {
        const canonical = canonicalValidator.validate(candidate);
        if (
          marketing.promotionOffer?.status === 'unpriced' &&
          containsConcreteOfferCopy(candidate)
        ) {
          canonical.failures.push({
            gateId: 'critical_fact_source',
            reason: '没有已核验价格或权益时，候选不得出现具体优惠数字。',
            alternativePath: ['改用无价格介绍', '先补充并确认当期优惠事实'],
          });
          canonical.passed = false;
        }
        return canonical;
      },
    };
    return executeCopySelection(
      {
        workflowId: input.workflowId,
        unitId: copyUnit(input.context.bundle.revision),
        brief: input.brief,
        workspaceId: input.request.workspaceId,
        intendedUse: 'public_content',
        generationContext: { bundle: input.context.bundle, marketing },
        onToken: input.onToken,
      },
      {
        runner,
        scorer: new StructuredCandidateScorer(runner),
        validator,
      },
    );
  }

  async assembleAndDeliver(
    input: Parameters<HarnessStagePorts['assembleAndDeliver']>[0],
  ) {
    if (input.request.reuseSeed) {
      if (!this.reuseTasks) {
        throw new Error('Reuse Task verification is unavailable.');
      }
      await this.reuseTasks.verifyReuseTaskSeed(
        input.request.workspaceId,
        input.request.reuseSeed,
      );
    }
    const occurredAt = this.now();
    if (input.request.executionSnapshot) {
      if (input.request.executionSnapshot.lens !== 'copy') {
        throw new HarnessCopyScopeError();
      }
      if (!this.executionDelivery) {
        throw new Error('Composer ContentPackage delivery is unavailable.');
      }
      const sourceContentPackage = await this.resolveLiveSourceContentPackage(
        input.request,
      );
      assertComposerSnapshotAssetBinding(
        input.request.executionSnapshot,
        input.brief.assetRefs,
        sourceContentPackage?.assets,
      );
      return this.executionDelivery.write(
        copyContentPackageRevisionWriteInput(
          input,
          occurredAt,
          sourceContentPackage?.assets,
        ),
      );
    }
    const marketing = projectMarketingPackageEvidence({
      declaration: input.declaration,
      request: input.request,
      context: input.context,
      at: occurredAt,
    });
    const platform = approvalPlatform(input.brief.platform);
    return this.delivery.deliverCopyRevision({
      workflowId: input.workflowId,
      workspaceId: input.request.workspaceId,
      packageId: input.request.packageId,
      expectedRevision: input.request.expectedRevision,
      platform,
      occurredAt,
      workflowRevision: input.request.workflowRevision,
      winner: input.selection.winner,
      candidates: input.selection.candidates,
      assetIds: [...input.brief.assetRefs],
      marketing,
      ...(input.request.reuseSeed
        ? { reuseSeed: input.request.reuseSeed }
        : {}),
      recommendation: {
        whyPost: input.declaration.taskType,
        expressionIdentity:
          input.brief.identityRefs.join(',') ||
          'no_expression_identity_reference',
        factReferences: [...input.brief.factRefs],
        platforms: [input.brief.platform],
        customerAction: input.brief.cta,
        complianceStatus: 'seven_gates_passed',
      },
    });
  }

  private runner(request: HarnessWorkflowInput) {
    return this.runners.create({
      workspaceId: request.workspaceId,
      actorId: request.actorId,
    });
  }

  private runnerWithSourceFence(request: HarnessWorkflowInput) {
    const runner = this.runner(request);
    return request.executionSnapshot?.sources.contentPackage
      ? new SourceContentPackageGuardedRunner(runner, async () => {
          await this.resolveLiveSourceContentPackage(request);
        })
      : runner;
  }

  private async resolveLiveSourceContentPackage(
    request: HarnessWorkflowInput,
  ): Promise<ResolvedSourceContentPackage | undefined> {
    const source = request.executionSnapshot?.sources.contentPackage;
    if (!source) return;
    if (!this.sourceContentPackages) {
      throw new SourceContentPackageUnavailableError(source);
    }
    return this.sourceContentPackages.resolve({
      workspaceId: request.workspaceId,
      source,
    });
  }
}

export function copyContentPackageRevisionWriteInput(
  input: Parameters<HarnessStagePorts['assembleAndDeliver']>[0],
  occurredAt: string,
  sourceAssets: ReadonlyArray<{ id: string; role: 'source' | 'selected' }> = [],
): ContentPackageRevisionWriteInput {
  const snapshot = input.request.executionSnapshot;
  if (!snapshot) {
    throw new Error('Composer delivery requires an execution snapshot.');
  }
  assertComposerSnapshotAssetBinding(snapshot, input.brief.assetRefs, sourceAssets);
  const marketing = projectMarketingPackageEvidence({
    declaration: input.declaration,
    request: input.request,
    context: input.context,
    at: occurredAt,
  });
  const versions = input.selection.candidates.map((candidate) => ({
    id: copyRevisionVersionId(input.workflowId, input.request.packageId, candidate),
    title: candidate.title,
    body: candidate.body,
    conversionHook: candidate.conversionHook,
    harnessCandidateId: candidate.candidateId,
    harnessScore: candidate.score,
    orderedAssetIds: [...new Set(input.brief.assetRefs)],
    topics: [],
    createdAt: occurredAt,
    createdBy: `harness-${input.workflowId}`,
    source: 'ai_generated' as const,
  }));
  const winner = versions.find(
    (candidate) => candidate.harnessCandidateId === input.selection.winner.candidateId,
  );
  if (!winner) {
    throw new Error('The Harness winner must be a delivered candidate.');
  }
  return {
    additionalVersions: versions.filter((candidate) => candidate.id !== winner.id),
    expectedRevision: input.request.expectedRevision,
    generated: { assetIds: [], childRuns: [] },
    harnessSelection: {
      recommendedCandidateId: input.selection.winner.candidateId,
    },
    idempotencyKey: `harness-copy:${input.workflowId}`,
    kind: 'image_text',
    marketing,
    occurredAt,
    packageId: input.request.packageId,
    platform: snapshot.platform.id,
    snapshotId: snapshot.id,
    snapshot: {
      id: snapshot.id,
      revision: snapshot.revision,
      schemaVersion: snapshot.schemaVersion,
    },
    ...(snapshot.sources.contentPackage
      ? { sourceContentPackage: snapshot.sources.contentPackage }
      : {}),
    taskId: snapshot.task.id,
    version: winner,
    workId: snapshot.work.id,
    workflowId: input.workflowId,
    workflowRevision: input.request.workflowRevision,
    workspaceId: input.request.workspaceId,
  };
}

function copyRevisionVersionId(
  workflowId: string,
  packageId: string,
  candidate: { candidateId: string; title: string; body: string },
) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        workflowId,
        candidateId: candidate.candidateId,
        title: candidate.title,
        body: candidate.body,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return `${packageId}-harness-${digest}`;
}

function approvalPlatform(platform: string) {
  if (
    platform === 'xiaohongshu' ||
    platform === 'douyin' ||
    platform === 'video_account'
  ) {
    return platform;
  }
  throw new Error(`Platform ${platform} does not support delivery approval.`);
}

function bindComposerSnapshotBrief(
  brief: Extract<Awaited<ReturnType<typeof compileExecutionBrief>>, { kind: 'copy' }>,
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
  sourceAssets: ReadonlyArray<{ id: string; role: 'source' | 'selected' }> = [],
) {
  const expectedIdentityRef = snapshotIdentityReference(snapshot);
  const foreignIdentityRefs = brief.identityRefs.filter(
    (identityRef) => identityRef !== expectedIdentityRef,
  );
  if (foreignIdentityRefs.length > 0) {
    throw new HarnessSnapshotIdentityBindingError(
      expectedIdentityRef,
      brief.identityRefs,
    );
  }
  assertComposerSnapshotAssetBinding(snapshot, brief.assetRefs, sourceAssets);
  return {
    ...brief,
    identityRefs: [expectedIdentityRef],
    platform: snapshot.platform.id,
  };
}

function assertComposerSnapshotIdentityBinding(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
  registeredIdentityRefs: Set<string>,
  briefIdentityRefs: string[],
) {
  const expectedIdentityRef = snapshotIdentityReference(snapshot);
  if (
    registeredIdentityRefs.size !== 1 ||
    !registeredIdentityRefs.has(expectedIdentityRef) ||
    briefIdentityRefs.length !== 1 ||
    briefIdentityRefs[0] !== expectedIdentityRef
  ) {
    throw new HarnessSnapshotIdentityBindingError(
      expectedIdentityRef,
      briefIdentityRefs,
    );
  }
}

function assertComposerSnapshotAssetBinding(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
  briefAssetRefs: string[],
  sourceAssets: ReadonlyArray<{ id: string; role: 'source' | 'selected' }> = [],
) {
  const snapshotAssetIds = new Set(
    snapshot.sources.assets.map((asset) => asset.id),
  );
  for (const asset of sourceAssets) {
    if (asset.role === 'selected') snapshotAssetIds.add(asset.id);
  }
  const foreignAssetIds = [...new Set(briefAssetRefs)].filter(
    (assetId) => !snapshotAssetIds.has(assetId),
  );
  if (foreignAssetIds.length > 0) {
    throw new HarnessSnapshotAssetReferenceError(foreignAssetIds);
  }
}

function snapshotIdentityReference(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
) {
  return `marketing_identity:${snapshot.identity.id}:${snapshot.identity.revision}`;
}

function inferDeclarationFromBundle(
  context: HarnessContextSnapshot,
): Parameters<typeof projectMarketingPackageEvidence>[0]['declaration'] {
  const taskType = context.bundle.dimensions.promotion_task.task_type?.value;
  if (
    taskType !== 'daily_service_exposure' &&
    taskType !== 'traffic_opportunity' &&
    taskType !== 'brand_personal_ip' &&
    taskType !== 'promotion_groupbuy_conversion' &&
    taskType !== 'routine_marketing_materials'
  ) {
    throw new Error('Frozen context is missing a supported marketing scene.');
  }
  return { taskType, deliveryLayer: 'copy', implicitConstraints: [] };
}

function containsConcreteOfferCopy(candidate: unknown) {
  const record = candidate as Record<string, unknown>;
  return USER_VISIBLE_COPY_FIELDS.some((field) => {
    const value = record[field];
    return typeof value === 'string' && containsConcreteOfferText(value);
  });
}

const USER_VISIBLE_COPY_FIELDS = ['title', 'body', 'conversionHook'] as const;
const FULL_WIDTH_DIGIT_PATTERN = /[０-９]/u;
const CHINESE_OFFER_NUMBER = String.raw`[〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+`;
const OFFER_NUMBER = String.raw`(?:\d+(?:\.\d+)?|${CHINESE_OFFER_NUMBER})`;
const PROMOTION_CONTEXT = String.raw`(?:优惠|仅|只要|限时|立减|直减|减免|券|特价|特惠|折|现价|到手价|团购价|优惠价|售价|低至|省)`;
const CURRENCY_SYMBOL = String.raw`\p{Sc}`;
const CURRENCY_LABEL =
  '(?:RMB|CNY|USD|EUR|GBP|JPY|HKD|TWD|AUD|CAD|SGD|KRW|yuan|人民币|人民幣|美元|美金|港元|港币|港幣|日元|日圆|日圓|欧元|歐元|英镑|英鎊|韩元|韓元)';
const OFFER_UNIT = '(?:元|圆|圓|[块塊](?:[钱錢])?|折|券)';
const CONCRETE_OFFER_PATTERNS = [
  new RegExp(
    String.raw`(?:${CURRENCY_SYMBOL}\s*${OFFER_NUMBER}|${OFFER_NUMBER}\s*${CURRENCY_SYMBOL}|${CURRENCY_LABEL}\s*${OFFER_NUMBER}|${OFFER_NUMBER}\s*${CURRENCY_LABEL}|${OFFER_NUMBER}\s*${OFFER_UNIT})`,
    'iu',
  ),
  new RegExp(
    String.raw`${CHINESE_OFFER_NUMBER}(?:点${CHINESE_OFFER_NUMBER})?折`,
    'u',
  ),
  new RegExp(
    String.raw`(?:价格|只要|仅需|现价|到手价|团购价|特价|特惠|优惠价|售价|低至|立减|直减|减免|省)[\s:：，,]*${OFFER_NUMBER}`,
    'u',
  ),
  new RegExp(String.raw`满\s*${OFFER_NUMBER}\s*减\s*${OFFER_NUMBER}`, 'u'),
  new RegExp(
    String.raw`${CHINESE_OFFER_NUMBER}\s*减\s*${CHINESE_OFFER_NUMBER}`,
    'u',
  ),
  new RegExp(
    String.raw`第\s*${OFFER_NUMBER}\s*(?:件|杯|份|位|单)\s*半价`,
    'u',
  ),
  new RegExp(String.raw`买\s*${OFFER_NUMBER}\s*送\s*${OFFER_NUMBER}`, 'u'),
];
const PROMOTION_CONTEXT_PATTERN = new RegExp(PROMOTION_CONTEXT, 'u');
const PROMOTIONAL_QUANTITY_PATTERN = new RegExp(
  String.raw`${OFFER_NUMBER}\s*(?:%|次)`,
  'u',
);
const CLAUSE_BOUNDARY_PATTERN = /[.。！？!?\n；;…]+/u;
const BENIGN_QUANTITY_PATTERNS = [
  new RegExp(String.raw`(?:好评率|满意度)\s*${OFFER_NUMBER}\s*%`, 'gu'),
  new RegExp(String.raw`第\s*${OFFER_NUMBER}\s*次`, 'gu'),
  new RegExp(String.raw`每(?:天|日|周|月|年)\s*${OFFER_NUMBER}\s*次`, 'gu'),
];

function containsConcreteOfferText(value: string) {
  // Full-width digits are treated as an adversarial obfuscation. Ordinary ASCII
  // dates, step ordinals and counts still need nearby offer language to fail.
  if (FULL_WIDTH_DIGIT_PATTERN.test(value)) return true;
  const normalized = value.normalize('NFKC');
  return (
    CONCRETE_OFFER_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    containsContextualOfferQuantity(normalized)
  );
}

function containsContextualOfferQuantity(value: string) {
  // A fixed character window creates an identical bypass at its next boundary.
  // Keep known service metrics, then fail closed on offer quantities in a clause.
  const withoutBenignQuantities = BENIGN_QUANTITY_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, ''),
    value,
  );
  return withoutBenignQuantities
    .split(CLAUSE_BOUNDARY_PATTERN)
    .some(
      (clause) =>
        PROMOTION_CONTEXT_PATTERN.test(clause) &&
        PROMOTIONAL_QUANTITY_PATTERN.test(clause),
    );
}

function copyUnit(revision: number) {
  return revision === 1 ? 'copy-primary' : `copy-primary-r${revision}`;
}

function normalizedFactKey(value: string) {
  return (
    value
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .match(/[\p{L}\p{N}]+/gu)
      ?.join('.') ?? ''
  );
}

const FACT_KEY_ALIASES = new Map<string, string>([
  ['amount', 'price'],
  ['cost', 'price'],
  ['fee', 'price'],
  ['price', 'price'],
  ['discount', 'discount'],
  ['groupbuy', 'group_buy'],
  ['qualification', 'qualification'],
  ['fulfillment', 'fulfillment'],
  ['experience', 'staff_experience'],
  ['case', 'customer_case'],
]);

function factKeysMatch(storedKey: string, requestedKey: string) {
  const stored = normalizedFactKey(storedKey);
  const requested = normalizedFactKey(requestedKey);
  if (stored === requested) return true;
  return factConcept(stored) === factConcept(requested);
}

function factConcept(normalizedKey: string) {
  const tokens = normalizedKey.split('.');
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const concept = FACT_KEY_ALIASES.get(tokens[index]!);
    if (concept) return concept;
  }
  return normalizedKey;
}
