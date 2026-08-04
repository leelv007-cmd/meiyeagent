import {
  assetDraftSchema,
  assetDraftViewSchema,
  assetIntakeExperienceSchema,
  assetIntakeGuidanceConfigSchema,
  ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
  assetParseTaskDraftsSchema,
  parseOwnedAssetSchema,
  parsedDocumentSchema,
  parseSourceAssetInputSchema,
  parseTaskSchema,
  prepareManualAssetDraftCommandSchema,
  type AssetDraft,
  type AssetIntakeGuidanceConfig,
  type AssetParseTaskDrafts,
  type ParseAssetBatchInput,
  type ParsedDocument,
  type ParseOwnedAsset,
  type ParseSingleAssetCommand,
  type ParseSourceAssetInput,
  type ParseTask,
  type PrepareManualAssetDraftCommand,
  type StoreFactCandidateDraft,
} from '@meiye/contracts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  merchantAssetRightsSoftPrompt,
  merchantParseDisclosure,
  merchantParseFallback,
  merchantParseProgress,
  merchantParseTaskFailed,
  merchantSensitiveDocumentFallback,
} from '../harness/merchant-delivery-language.js';
import type {
  TracerExternalEffect,
  TracerExternalRequest,
  TracerJobApplicationService,
} from '../job-runtime/tracer-worker.js';

export const PARSE_BATCH_JOB_KIND = 'asset.parse-batch';

export type ParseFailureReason = 'failed' | 'timeout' | 'rate_limited';
type DraftFallbackReason = ParseFailureReason | 'sensitive_policy';

export class ParseProviderError extends Error {
  constructor(
    readonly reason: ParseFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ParseProviderError';
  }
}

export type ParseServiceErrorCode =
  | 'ASSET_NOT_AUTHORIZED'
  | 'DRAFT_CONFLICT'
  | 'DRAFT_NOT_FOUND'
  | 'GUIDANCE_NOT_FOUND'
  | 'SOURCE_CONFLICT'
  | 'SOURCE_NOT_FOUND'
  | 'TASK_CONFLICT'
  | 'TASK_NOT_FOUND';

export class ParseServiceError extends Error {
  constructor(
    readonly code: ParseServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ParseServiceError';
  }
}

export interface ParseRepository {
  recordSource(source: ParseOwnedAsset): Promise<ParseOwnedAsset>;
  getSource(
    workspaceId: string,
    assetId: string,
  ): Promise<ParseOwnedAsset | null>;
  recordDocument(document: ParsedDocument): Promise<ParsedDocument>;
  getDocument(
    workspaceId: string,
    parsedDocumentId: string,
  ): Promise<ParsedDocument | null>;
  appendDraft(draft: AssetDraft): Promise<AssetDraft>;
  getDraft(
    workspaceId: string,
    draftId: string,
    revision?: number,
  ): Promise<AssetDraft | null>;
  latestDraftForSource(
    workspaceId: string,
    sourceAssetId: string,
  ): Promise<AssetDraft | null>;
  recordTask(task: ParseTask): Promise<ParseTask>;
  updateTask(task: ParseTask): Promise<ParseTask>;
  getTask(workspaceId: string, taskId: string): Promise<ParseTask | null>;
}

const TERMINAL_PARSE_TASK_STATUSES = new Set<ParseTask['status']>([
  'completed',
  'completed_with_fallback',
  'failed',
]);

export function selectMonotonicParseTaskUpdate(
  current: ParseTask,
  next: ParseTask,
) {
  if (
    current.mode !== next.mode ||
    !isDeepStrictEqual(current.sourceAssetIds, next.sourceAssetIds) ||
    current.createdAt !== next.createdAt ||
    current.disclosure !== next.disclosure
  ) {
    throw new ParseServiceError(
      'TASK_CONFLICT',
      `Parse task ${next.taskId} identity fields cannot change.`,
    );
  }
  const currentAttempt = current.carrierAttempt ?? 0;
  const nextAttempt = next.carrierAttempt ?? 0;
  if (
    nextAttempt < currentAttempt ||
    TERMINAL_PARSE_TASK_STATUSES.has(current.status) ||
    (nextAttempt === currentAttempt &&
      (next.progress.completed < current.progress.completed ||
        (current.status === 'running' && next.status === 'queued')))
  ) {
    return current;
  }
  if (
    nextAttempt > currentAttempt &&
    (current.status !== 'queued' ||
      next.status !== 'queued' ||
      next.progress.completed !== current.progress.completed)
  ) {
    throw new ParseServiceError(
      'TASK_CONFLICT',
      `Parse task ${next.taskId} carrier attempt cannot replace active progress.`,
    );
  }
  return next;
}

function identity(workspaceId: string, id: string) {
  return JSON.stringify([workspaceId, id]);
}

export class MemoryParseRepository implements ParseRepository {
  private readonly sources = new Map<string, ParseOwnedAsset>();
  private readonly documents = new Map<string, ParsedDocument>();
  private readonly drafts = new Map<string, AssetDraft[]>();
  private readonly sourceDrafts = new Map<string, string>();
  private readonly tasks = new Map<string, ParseTask>();

  async recordSource(value: ParseOwnedAsset) {
    const source = parseOwnedAssetSchema.parse(value);
    const key = identity(source.workspaceId, source.assetId);
    const current = this.sources.get(key);
    if (current && !isDeepStrictEqual(current, source)) {
      throw new ParseServiceError(
        'SOURCE_CONFLICT',
        `Source asset ${source.assetId} already has another receipt.`,
      );
    }
    if (!current) this.sources.set(key, structuredClone(source));
    return structuredClone(current ?? source);
  }

  async getSource(workspaceId: string, assetId: string) {
    const source = this.sources.get(identity(workspaceId, assetId));
    return source ? structuredClone(source) : null;
  }

  async recordDocument(value: ParsedDocument) {
    const document = parsedDocumentSchema.parse(value);
    const key = identity(document.workspaceId, document.parsedDocumentId);
    const current = this.documents.get(key);
    if (current && !isDeepStrictEqual(current, document)) {
      throw new ParseServiceError(
        'SOURCE_CONFLICT',
        `Parsed document ${document.parsedDocumentId} already has another payload.`,
      );
    }
    if (!current) this.documents.set(key, structuredClone(document));
    return structuredClone(current ?? document);
  }

  async getDocument(workspaceId: string, parsedDocumentId: string) {
    const document = this.documents.get(
      identity(workspaceId, parsedDocumentId),
    );
    return document ? structuredClone(document) : null;
  }

  async appendDraft(value: AssetDraft) {
    const draft = assetDraftSchema.parse(value);
    const key = identity(draft.workspaceId, draft.draftId);
    const sourceKey = identity(draft.workspaceId, draft.sourceAssetId);
    const sourceDraftId = this.sourceDrafts.get(sourceKey);
    if (sourceDraftId && sourceDraftId !== draft.draftId) {
      throw new ParseServiceError(
        'DRAFT_CONFLICT',
        `Source asset ${draft.sourceAssetId} is already bound to another draft.`,
      );
    }
    const history = this.drafts.get(key) ?? [];
    const current = history.at(-1);
    if (current?.revision === draft.revision) {
      if (!isDeepStrictEqual(current, draft)) {
        throw new ParseServiceError(
          'DRAFT_CONFLICT',
          `Draft ${draft.draftId} revision ${draft.revision} already has another payload.`,
        );
      }
      return structuredClone(current);
    }
    if (draft.revision !== (current?.revision ?? 0) + 1) {
      throw new ParseServiceError(
        'DRAFT_CONFLICT',
        `Draft ${draft.draftId} revision is not append-only.`,
      );
    }
    this.drafts.set(key, [...history, structuredClone(draft)]);
    this.sourceDrafts.set(sourceKey, draft.draftId);
    return structuredClone(draft);
  }

  async getDraft(workspaceId: string, draftId: string, revision?: number) {
    const history = this.drafts.get(identity(workspaceId, draftId)) ?? [];
    const draft =
      revision === undefined
        ? history.at(-1)
        : history.find((candidate) => candidate.revision === revision);
    return draft ? structuredClone(draft) : null;
  }

  async latestDraftForSource(workspaceId: string, sourceAssetId: string) {
    const draftId = this.sourceDrafts.get(
      identity(workspaceId, sourceAssetId),
    );
    return draftId ? this.getDraft(workspaceId, draftId) : null;
  }

  async recordTask(value: ParseTask) {
    const task = parseTaskSchema.parse(value);
    const key = identity(task.workspaceId, task.taskId);
    const current = this.tasks.get(key);
    if (current && !isDeepStrictEqual(current, task)) {
      throw new ParseServiceError(
        'TASK_CONFLICT',
        `Parse task ${task.taskId} already has another payload.`,
      );
    }
    if (!current) this.tasks.set(key, structuredClone(task));
    return structuredClone(current ?? task);
  }

  async updateTask(value: ParseTask) {
    const task = parseTaskSchema.parse(value);
    const key = identity(task.workspaceId, task.taskId);
    const current = this.tasks.get(key);
    if (!current) {
      throw new ParseServiceError(
        'TASK_NOT_FOUND',
        `Parse task ${task.taskId} was not found.`,
      );
    }
    const selected = selectMonotonicParseTaskUpdate(current, task);
    this.tasks.set(key, structuredClone(selected));
    return structuredClone(selected);
  }

  async getTask(workspaceId: string, taskId: string) {
    const task = this.tasks.get(identity(workspaceId, taskId));
    return task ? structuredClone(task) : null;
  }
}

export interface ParseSourceAssetAuthorizer {
  isAuthorized(
    workspaceId: string,
    source: ParseSourceAssetInput,
  ): Promise<boolean>;
}

export class StoredParseSourceAssetAuthorizer
  implements ParseSourceAssetAuthorizer
{
  constructor(
    private readonly storage: {
      read(objectKey: string): Promise<{ bytes: Uint8Array }>;
    },
  ) {}

  async isAuthorized(workspaceId: string, source: ParseSourceAssetInput) {
    if (!source.objectKey.startsWith(`${workspaceId}/`)) return false;
    try {
      const stored = await this.storage.read(source.objectKey);
      return (
        stored.bytes.byteLength === source.sizeBytes &&
        createHash('sha256').update(stored.bytes).digest('hex') === source.sha256
      );
    } catch {
      return false;
    }
  }
}

export interface DocumentParseProvider {
  parse(input: {
    workspaceId: string;
    taskId: string;
    source: ParseOwnedAsset;
    effectIdempotencyKey: string;
  }): Promise<{
    parserKind: 'mineru_official' | 'fixture';
    parserVersion: string;
    providerTaskRef: string;
    markdown: string;
    structured: ParsedDocument['structured'];
    extractedPages: number;
    totalPages: number;
  }>;
}

export interface AssetDraftCompiler {
  compile(input: {
    source: ParseOwnedAsset;
    document: ParsedDocument;
  }): Promise<{
    fields: AssetDraft['fields'];
    factCandidates: StoreFactCandidateDraft[];
  }>;
}

export interface VisualAssetClassifier {
  classify(input: {
    workspaceId: string;
    taskId: string;
    source: ParseOwnedAsset;
  }): Promise<{
    slot: 'work_case' | 'store_scene' | 'product' | 'subject_person';
    description: string;
  }>;
}

export interface AssetIntakeGuidanceSource {
  get(input: {
    industry: string;
    assetType: string;
  }): Promise<{
    config: AssetIntakeGuidanceConfig;
    revision: number;
  }>;
}

export interface AssetIntakeGuidanceConfigReader {
  get(
    scope: 'global',
    workspaceId: '__global__',
    key: string,
  ): Promise<{ value: unknown; revision: number } | null>;
}

export class FixtureDocumentParseProvider implements DocumentParseProvider {
  async parse(input: {
    source: ParseOwnedAsset;
    effectIdempotencyKey: string;
  }) {
    let fixtureMarkdown: string | null = null;
    if (
      input.source.sourceUrl?.includes('providerSignature=') &&
      input.source.target === 'brand_reference'
    ) {
      const response = await fetch(input.source.sourceUrl);
      if (!response.ok) {
        throw new Error('Fixture reference image could not be read.');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const marker = bytes
        .toString('latin1')
        .match(/MEIYE_FIXTURE_TEXT_BASE64=([A-Za-z0-9+/=]+)/u)?.[1];
      if (marker) {
        fixtureMarkdown = Buffer.from(marker, 'base64').toString('utf8').trim();
      }
    }
    return {
      parserKind: 'fixture' as const,
      parserVersion: 'fixture-v1',
      providerTaskRef: `fixture:${input.effectIdempotencyKey}`,
      markdown:
        fixtureMarkdown ??
        (input.source.target === 'group_buy'
          ? '头皮护理团购套餐，现价 239 元'
          : input.source.target === 'price_list'
            ? '头皮护理 239 元'
            : '暖棕色门店，主营头皮护理'),
      structured: {
        fixture: true,
        target: input.source.target,
      },
      extractedPages: 1,
      totalPages: 1,
    };
  }
}

export class FixtureAssetDraftCompiler implements AssetDraftCompiler {
  async compile(input: {
    source: ParseOwnedAsset;
    document: ParsedDocument;
  }) {
    const capturedAt = input.document.createdAt;
    if (
      input.source.target === 'price_list' ||
      input.source.target === 'group_buy'
    ) {
      const amount = firstCnyAmount(input.document.markdown);
      const key =
        input.source.target === 'group_buy' ? 'offer.group_buy' : 'offer.price';
      const value = { amount, currency: 'CNY' };
      return {
        fields: [
          {
            key,
            value,
            provenance: 'photo_extract' as const,
            status: 'unconfirmed' as const,
          },
        ],
        factCandidates: [
          {
            kind:
              input.source.target === 'group_buy'
                ? ('group_buy' as const)
                : ('price' as const),
            key,
            value,
            scope: { storeId: input.source.workspaceId },
            source: {
              kind: 'screenshot_extraction' as const,
              referenceId: input.source.assetId,
              capturedAt,
            },
            effectiveFrom: capturedAt,
            expiresAt: null,
          },
        ],
      };
    }
    return {
      fields: [
        {
          key: `${input.source.target}.summary`,
          value: input.document.markdown.trim(),
          provenance: 'photo_extract' as const,
          status: 'unconfirmed' as const,
        },
      ],
      factCandidates: [
        {
          kind: 'other' as const,
          key: `${input.source.target}.summary`,
          value: { text: input.document.markdown.trim() },
          scope: { storeId: input.source.workspaceId },
          source: {
            kind: 'screenshot_extraction' as const,
            referenceId: input.source.assetId,
            capturedAt,
          },
          effectiveFrom: capturedAt,
          expiresAt: null,
        },
      ],
    };
  }
}

export class FixtureVisualAssetClassifier implements VisualAssetClassifier {
  async classify(input: { source: ParseOwnedAsset }) {
    const value = input.source.assetId.toLowerCase();
    const slot = value.includes('work-case')
      ? ('work_case' as const)
      : value.includes('store-scene')
        ? ('store_scene' as const)
        : value.includes('product')
          ? ('product' as const)
          : ('subject_person' as const);
    return {
      slot,
      description: {
        work_case: '顾客护理案例照片',
        store_scene: '门店环境照片',
        product: '护理产品照片',
        subject_person: '人物形象照片',
      }[slot],
    };
  }
}

export const DEFAULT_ASSET_INTAKE_GUIDANCE =
  assetIntakeGuidanceConfigSchema.parse({
    entries: [
      ['hair_care', '护发'],
      ['skin_management', '皮肤管理'],
      ['hair_growth', '生发'],
    ].flatMap(([industry, industryLabel]) =>
      [
        ['price_list', '项目价目表'],
        ['group_buy', '团购套餐'],
        ['store_profile', '门店档案'],
        ['brand_reference', '品牌参考'],
        ['visual_asset', '作品与环境素材'],
      ].map(([assetType, assetLabel]) =>
        fixtureGuidance(
          industry!,
          assetType!,
          `${industryLabel}${assetLabel}`,
        ),
      ),
    ),
  });

export class FixtureAssetIntakeGuidanceSource
  implements AssetIntakeGuidanceSource
{
  async get() {
    return { config: DEFAULT_ASSET_INTAKE_GUIDANCE, revision: 0 };
  }
}

export class AdminConfigAssetIntakeGuidanceSource
  implements AssetIntakeGuidanceSource
{
  constructor(private readonly repository: AssetIntakeGuidanceConfigReader) {}

  async get() {
    const revision = await this.repository.get(
      'global',
      '__global__',
      ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
    );
    return revision
      ? {
          config: assetIntakeGuidanceConfigSchema.parse(revision.value),
          revision: revision.revision,
        }
      : { config: DEFAULT_ASSET_INTAKE_GUIDANCE, revision: 0 };
  }
}

export class ParseService {
  constructor(
    private readonly repository: ParseRepository,
    private readonly provider: DocumentParseProvider,
    private readonly compiler: AssetDraftCompiler,
    private readonly visuals: VisualAssetClassifier,
    private readonly assets: ParseSourceAssetAuthorizer,
    private readonly guidance: AssetIntakeGuidanceSource =
      new FixtureAssetIntakeGuidanceSource(),
    private readonly jobs?: Pick<TracerJobApplicationService, 'submit'>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async parseSingle(
    context: { workspaceId: string },
    command: ParseSingleAssetCommand,
  ) {
    const source = await this.recordSource(context.workspaceId, command.source);
    const task = await this.startTask({
      workspaceId: context.workspaceId,
      taskId: command.taskId,
      mode: 'single_sync',
      sourceAssetIds: [source.assetId],
      status: 'running',
    });
    if (
      task.status === 'completed' ||
      task.status === 'completed_with_fallback'
    ) {
      const draft = await this.repository.latestDraftForSource(
        context.workspaceId,
        source.assetId,
      );
      if (!draft) {
        throw new ParseServiceError(
          'DRAFT_NOT_FOUND',
          `Completed parse task ${task.taskId} has no draft.`,
        );
      }
      return { task, draft };
    }
    const result = await this.processSource(task, source);
    const completed = await this.repository.updateTask({
      ...task,
      status: result.fallback ? 'completed_with_fallback' : 'completed',
      progress: {
        completed: 1,
        total: 1,
        message: merchantParseProgress({ completed: 1, total: 1 }),
      },
      updatedAt: this.now(),
    });
    return { task: completed, draft: result.draft };
  }

  async startBatch(
    context: { workspaceId: string },
    command: ParseAssetBatchInput,
  ) {
    if (!this.jobs) {
      throw new ParseServiceError(
        'TASK_CONFLICT',
        'The durable parse job runtime is unavailable.',
      );
    }
    const sources = await Promise.all(
      command.sources.map((source) =>
        this.recordSource(context.workspaceId, source),
      ),
    );
    const task = await this.startTask({
      workspaceId: context.workspaceId,
      taskId: command.taskId,
      mode: 'batch_async',
      sourceAssetIds: sources.map((source) => source.assetId),
      status: 'queued',
    });
    if (task.status !== 'queued') return task;
    const carrierAttempt = (task.carrierAttempt ?? 0) + 1;
    const queued = await this.repository.updateTask({
      ...task,
      carrierAttempt,
      updatedAt: this.now(),
    });
    await this.jobs.submit({
      workspaceId: context.workspaceId,
      jobId: `${command.taskId}:carrier:${carrierAttempt}`,
      kind: PARSE_BATCH_JOB_KIND,
      payload: { taskId: command.taskId, carrierAttempt },
    });
    return queued;
  }

  async runBatchTask(
    workspaceId: string,
    taskId: string,
    carrierAttempt?: number,
  ) {
    const task = await this.requireTask(workspaceId, taskId);
    if (task.mode !== 'batch_async') {
      throw new ParseServiceError(
        'TASK_CONFLICT',
        `Parse task ${taskId} is not a batch task.`,
      );
    }
    if (
      task.carrierAttempt !== undefined &&
      carrierAttempt !== task.carrierAttempt
    ) {
      return task;
    }
    if (
      task.status === 'completed' ||
      task.status === 'completed_with_fallback'
    ) {
      return task;
    }
    let current = await this.repository.updateTask({
      ...task,
      status: 'running',
      updatedAt: this.now(),
    });
    let fallback = false;
    for (const sourceAssetId of current.sourceAssetIds.slice(
      0,
      current.progress.completed,
    )) {
      fallback ||=
        (
          await this.repository.latestDraftForSource(
            workspaceId,
            sourceAssetId,
          )
        )?.origin === 'fallback';
    }
    for (const [index, sourceAssetId] of current.sourceAssetIds.entries()) {
      if (index < current.progress.completed) continue;
      const source = await this.requireSource(workspaceId, sourceAssetId);
      const result = await this.processSource(current, source);
      fallback ||= result.fallback;
      current = await this.repository.updateTask({
        ...current,
        status: 'running',
        progress: {
          completed: index + 1,
          total: current.sourceAssetIds.length,
          message: merchantParseProgress({
            completed: index + 1,
            total: current.sourceAssetIds.length,
          }),
        },
        updatedAt: this.now(),
      });
    }
    return this.repository.updateTask({
      ...current,
      status: fallback ? 'completed_with_fallback' : 'completed',
      updatedAt: this.now(),
    });
  }

  async failBatchTask(workspaceId: string, taskId: string) {
    const task = await this.requireTask(workspaceId, taskId);
    if (
      task.status === 'completed' ||
      task.status === 'completed_with_fallback' ||
      task.status === 'failed'
    ) {
      return task;
    }
    return this.repository.updateTask({
      ...task,
      status: 'failed',
      progress: {
        ...task.progress,
        message: merchantParseTaskFailed(),
      },
      updatedAt: this.now(),
    });
  }

  async prepareManualDraft(
    context: { workspaceId: string },
    value: PrepareManualAssetDraftCommand,
  ) {
    const command = prepareManualAssetDraftCommandSchema.parse(value);
    const source = await this.recordSource(context.workspaceId, command.source);
    const current = await this.repository.latestDraftForSource(
      context.workspaceId,
      source.assetId,
    );
    const normalizedFields = command.fields.map((field) => ({
      ...field,
      provenance: 'user' as const,
      status: 'unconfirmed' as const,
    }));
    const normalizedFacts = command.factCandidates.map((fact) => ({
      ...fact,
      source: {
        ...fact.source,
        kind: 'user_confirmation' as const,
        referenceId: source.assetId,
      },
    }));
    if (
      current?.origin === 'manual' &&
      current.taskId === command.taskId &&
      isDeepStrictEqual(current.fields, normalizedFields) &&
      isDeepStrictEqual(current.factCandidates, normalizedFacts)
    ) {
      return current;
    }
    const createdAt = this.now();
    return this.repository.appendDraft({
      draftId: current?.draftId ?? draftId(source.assetId),
      revision: (current?.revision ?? 0) + 1,
      workspaceId: context.workspaceId,
      taskId: command.taskId,
      sourceAssetId: source.assetId,
      parsedDocumentId: null,
      target: source.target,
      origin: 'manual',
      fields: normalizedFields,
      factCandidates: normalizedFacts,
      visualClassification: null,
      createdAt,
    });
  }

  task(workspaceId: string, taskId: string) {
    return this.requireTask(workspaceId, taskId);
  }

  async draft(workspaceId: string, draftIdValue: string, revision?: number) {
    const draft = await this.repository.getDraft(
      workspaceId,
      draftIdValue,
      revision,
    );
    if (!draft) {
      throw new ParseServiceError(
        'DRAFT_NOT_FOUND',
        `Asset draft ${draftIdValue} was not found.`,
      );
    }
    return draft;
  }

  async draftView(
    workspaceId: string,
    draftIdValue: string,
    revision?: number,
  ) {
    const draft = await this.draft(workspaceId, draftIdValue, revision);
    const document = draft.parsedDocumentId
      ? await this.repository.getDocument(workspaceId, draft.parsedDocumentId)
      : null;
    return assetDraftViewSchema.parse({
      ...draft,
      parser: document ? { kind: document.parser.kind } : null,
    });
  }

  /**
   * Enumerate the latest draft for each source of a parse task, in
   * task.sourceAssetIds order. Missing drafts stay null so the merchant
   * can tell ready items from still-in-flight ones.
   */
  async draftsForTask(
    workspaceId: string,
    taskId: string,
  ): Promise<AssetParseTaskDrafts> {
    const task = await this.requireTask(workspaceId, taskId);
    const items = await Promise.all(
      task.sourceAssetIds.map(async (sourceAssetId) => {
        const draft = await this.repository.latestDraftForSource(
          workspaceId,
          sourceAssetId,
        );
        if (!draft) {
          return { sourceAssetId, draft: null };
        }
        const document = draft.parsedDocumentId
          ? await this.repository.getDocument(
              workspaceId,
              draft.parsedDocumentId,
            )
          : null;
        return {
          sourceAssetId,
          draft: assetDraftViewSchema.parse({
            ...draft,
            parser: document ? { kind: document.parser.kind } : null,
          }),
        };
      }),
    );
    return assetParseTaskDraftsSchema.parse({
      taskId: task.taskId,
      items,
    });
  }

  async experience(input: { industry: string; assetType: string }) {
    const { config, revision } = await this.guidance.get(input);
    const entry = config.entries.find(
      (candidate) =>
        candidate.industry === input.industry &&
        candidate.assetType === input.assetType,
    );
    if (!entry) {
      throw new ParseServiceError(
        'GUIDANCE_NOT_FOUND',
        'No intake guidance is configured for this industry and asset type.',
      );
    }
    return assetIntakeExperienceSchema.parse({
      industry: input.industry,
      assetType: input.assetType,
      configRevision: revision,
      steps: [
        { id: 'see_examples', optional: true },
        { id: 'choose_recommendations', optional: true },
        { id: 'say_or_upload', optional: true },
        { id: 'ai_arrange', optional: true },
        { id: 'confirm_each', optional: false },
      ],
      examples: entry.examples,
      recommendations: entry.recommendations,
      disclosure: merchantParseDisclosure(),
    });
  }

  private async recordSource(
    workspaceId: string,
    value: ParseSourceAssetInput,
  ) {
    const input = parseSourceAssetInputSchema.parse(value);
    const existing = await this.repository.getSource(workspaceId, input.assetId);
    if (
      !existing &&
      !(await this.assets.isAuthorized(workspaceId, input))
    ) {
      throw new ParseServiceError(
        'ASSET_NOT_AUTHORIZED',
        'The parse source must be a verified workspace-owned asset.',
      );
    }
    return this.repository.recordSource(
      parseOwnedAssetSchema.parse({
        ...input,
        workspaceId,
        createdAt: existing?.createdAt ?? this.now(),
      }),
    );
  }

  private async startTask(input: {
    workspaceId: string;
    taskId: string;
    mode: ParseTask['mode'];
    sourceAssetIds: string[];
    status: 'queued' | 'running';
  }) {
    const existing = await this.repository.getTask(
      input.workspaceId,
      input.taskId,
    );
    if (existing) return existing;
    const createdAt = this.now();
    return this.repository.recordTask({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      mode: input.mode,
      status: input.status,
      sourceAssetIds: input.sourceAssetIds,
      progress: {
        completed: 0,
        total: input.sourceAssetIds.length,
        message: merchantParseProgress({
          completed: 0,
          total: input.sourceAssetIds.length,
        }),
      },
      disclosure: merchantParseDisclosure(),
      createdAt,
      updatedAt: createdAt,
    });
  }

  private async processSource(task: ParseTask, source: ParseOwnedAsset) {
    if (source.inputKind === 'visual_asset') {
      return {
        fallback: false,
        draft: await this.visualDraft(task, source),
      };
    }
    if (source.inputKind === 'sensitive_document') {
      return {
        fallback: true,
        draft: await this.fallbackDraft(task, source, 'sensitive_policy'),
      };
    }
    let current = await this.repository.latestDraftForSource(
      source.workspaceId,
      source.assetId,
    );
    if (current?.origin === 'manual') {
      return { fallback: false, draft: current };
    }
    try {
      const parsedDocumentId = documentId(task.taskId, source.assetId);
      let document = await this.repository.getDocument(
        source.workspaceId,
        parsedDocumentId,
      );
      if (!document) {
        const parsed = await this.provider.parse({
          workspaceId: source.workspaceId,
          taskId: task.taskId,
          source,
          effectIdempotencyKey: `${task.taskId}:${source.assetId}:parse`,
        });
        document = await this.repository.recordDocument({
          parsedDocumentId,
          workspaceId: source.workspaceId,
          taskId: task.taskId,
          sourceAssetId: source.assetId,
          parser: {
            kind: parsed.parserKind,
            version: parsed.parserVersion,
            providerTaskRef: parsed.providerTaskRef,
          },
          markdown: parsed.markdown,
          structured: parsed.structured,
          extractedPages: parsed.extractedPages,
          totalPages: parsed.totalPages,
          createdAt: this.now(),
        });
      }
      current = await this.repository.latestDraftForSource(
        source.workspaceId,
        source.assetId,
      );
      if (current?.origin === 'manual') {
        return { fallback: false, draft: current };
      }
      if (current?.parsedDocumentId === document.parsedDocumentId) {
        return { fallback: false, draft: current };
      }
      const compiled = await this.compiler.compile({ source, document });
      return {
        fallback: false,
        draft: await this.repository.appendDraft({
          draftId: current?.draftId ?? draftId(source.assetId),
          revision: (current?.revision ?? 0) + 1,
          workspaceId: source.workspaceId,
          taskId: task.taskId,
          sourceAssetId: source.assetId,
          parsedDocumentId: document.parsedDocumentId,
          target: source.target,
          origin: 'parsed',
          fields: compiled.fields,
          factCandidates: compiled.factCandidates,
          visualClassification: null,
          createdAt: this.now(),
        }),
      };
    } catch (error) {
      const reason =
        error instanceof ParseProviderError ? error.reason : 'failed';
      return {
        fallback: true,
        draft: await this.fallbackDraft(task, source, reason),
      };
    }
  }

  private async visualDraft(task: ParseTask, source: ParseOwnedAsset) {
    const current = await this.repository.latestDraftForSource(
      source.workspaceId,
      source.assetId,
    );
    if (current) return current;
    const classification = await this.visuals.classify({
      workspaceId: source.workspaceId,
      taskId: task.taskId,
      source,
    });
    return this.repository.appendDraft({
      draftId: draftId(source.assetId),
      revision: 1,
      workspaceId: source.workspaceId,
      taskId: task.taskId,
      sourceAssetId: source.assetId,
      parsedDocumentId: null,
      target: 'visual_asset',
      origin: 'ai_suggestion',
      fields: [
        {
          key: 'asset.slot',
          value: classification.slot,
          provenance: 'ai_suggestion',
          status: 'unconfirmed',
        },
        {
          key: 'asset.description',
          value: classification.description,
          provenance: 'ai_suggestion',
          status: 'unconfirmed',
        },
      ],
      factCandidates: [],
      visualClassification: {
        ...classification,
        rightsPrompt: {
          message: merchantAssetRightsSoftPrompt(),
          skippable: true,
          blocking: false,
        },
      },
      createdAt: this.now(),
    });
  }

  private async fallbackDraft(
    task: ParseTask,
    source: ParseOwnedAsset,
    reason: DraftFallbackReason,
  ) {
    const current = await this.repository.latestDraftForSource(
      source.workspaceId,
      source.assetId,
    );
    if (current) return current;
    return this.repository.appendDraft({
      draftId: draftId(source.assetId),
      revision: 1,
      workspaceId: source.workspaceId,
      taskId: task.taskId,
      sourceAssetId: source.assetId,
      parsedDocumentId: null,
      target: source.target,
      origin: 'fallback',
      fields: [
        {
          key: fallbackFieldKey(source.target),
          value: null,
          provenance: 'ai_suggestion',
          status: 'unconfirmed',
        },
        {
          key: 'fallback.message',
          value:
            reason === 'sensitive_policy'
              ? merchantSensitiveDocumentFallback()
              : merchantParseFallback(reason),
          provenance: 'ai_suggestion',
          status: 'unconfirmed',
        },
      ],
      factCandidates: [],
      visualClassification: null,
      createdAt: this.now(),
    });
  }

  private async requireSource(workspaceId: string, assetId: string) {
    const source = await this.repository.getSource(workspaceId, assetId);
    if (!source) {
      throw new ParseServiceError(
        'SOURCE_NOT_FOUND',
        `Parse source ${assetId} was not found.`,
      );
    }
    return source;
  }

  private async requireTask(workspaceId: string, taskId: string) {
    const task = await this.repository.getTask(workspaceId, taskId);
    if (!task) {
      throw new ParseServiceError(
        'TASK_NOT_FOUND',
        `Parse task ${taskId} was not found.`,
      );
    }
    return task;
  }
}

export class ParseBatchJobEffect implements TracerExternalEffect {
  constructor(private readonly service: ParseService) {}

  execute(request: TracerExternalRequest) {
    return this.run(request);
  }

  reconcile(request: TracerExternalRequest) {
    return this.run(request);
  }

  private async run(request: TracerExternalRequest) {
    const taskId =
      typeof request.payload.taskId === 'string'
        ? request.payload.taskId
        : request.jobId;
    const carrierAttempt =
      typeof request.payload.carrierAttempt === 'number' &&
      Number.isInteger(request.payload.carrierAttempt)
        ? request.payload.carrierAttempt
        : undefined;
    let task: ParseTask;
    try {
      task = await this.service.runBatchTask(
        request.workspaceId,
        taskId,
        carrierAttempt,
      );
    } catch (error) {
      await this.service.failBatchTask(request.workspaceId, taskId);
      throw error;
    }
    return {
      acceptance: 'accepted' as const,
      delivery: 'completed' as const,
      taskRef: taskId,
      output: {
        taskId: task.taskId,
        status: task.status,
        completed: task.progress.completed,
        total: task.progress.total,
      },
    };
  }
}

function documentId(taskId: string, assetId: string) {
  return `parsed:${taskId}:${assetId}`;
}

function draftId(assetId: string) {
  return `draft:${assetId}`;
}

function fallbackFieldKey(target: ParseOwnedAsset['target']) {
  return {
    price_list: 'offer.price',
    group_buy: 'offer.group_buy',
    store_profile: 'store_profile.summary',
    brand_reference: 'brand_reference.summary',
    visual_asset: 'asset.description',
  }[target];
}

function firstCnyAmount(text: string) {
  const match = text.match(/(?:[¥￥]\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*元)/u);
  const amount = Number(match?.[1] ?? match?.[2]);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ParseProviderError(
      'failed',
      'Fixture document does not contain one recognizable CNY amount.',
    );
  }
  return amount;
}

function fixtureGuidance(industry: string, assetType: string, title: string) {
  return {
    industry,
    assetType,
    examples: [
      {
        exampleId: `${industry}-${assetType}-example`,
        title,
        summary: '上传现有图片后，系统先整理成待确认草案。',
        sourceRef: `platform-sample:${industry}:${assetType}`,
      },
    ],
    recommendations: [
      {
        recommendationId: `${industry}-${assetType}-recommended`,
        label: '项目名称、日常价、活动价',
      },
    ],
  };
}
