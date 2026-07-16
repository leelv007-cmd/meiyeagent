import { createHash } from 'node:crypto';
import {
  editingContextSchema,
  type AdvancedCanvasEditingContext,
} from '@meiye/contracts';
import {
  parseAudioSfxContract,
  parseAudioSpeechContract,
} from './audio-contracts.js';

export type CanvasGenerationOperation =
  | 'image.generate'
  | 'image.edit'
  | 'text.respond'
  | 'video.generate'
  | 'audio.speech'
  | 'audio.sfx';

export type CanvasUsageResource = 'copy' | 'image' | 'video' | 'audio';
export type CanvasMediaType = 'image' | 'video' | 'audio';

export interface CanvasGenerationContext {
  userId: string;
  workspaceId: string;
  correlationId: string;
}

export interface CanvasGenerationInput {
  projectId: string;
  revisionId: string;
  operation: CanvasGenerationOperation;
  prompt: string;
  parameters: Record<string, unknown>;
  inputAssetIds: string[];
  maskAssetId?: string;
  idempotencyKey: string;
}

export interface CanvasGenerationCatalogEntry {
  operation: CanvasGenerationOperation;
  modelId: string | null;
  activation: 'active' | 'inactive';
  activationEvidence?: {
    configurationRevision: string;
    evidenceId: string;
    probedAt: string;
    status: 'live_verified';
  };
  usageResource: CanvasUsageResource;
  usageAmount: number;
  estimatedDurationSeconds: [number, number];
  allowedParameters: string[];
  output: CanvasMediaType | 'text';
}

export function createInactiveAudioCatalogEntries(): CanvasGenerationCatalogEntry[] {
  return [
    {
      activation: 'inactive',
      allowedParameters: [
        'voice',
        'language',
        'speed',
        'tone',
        'format',
        'maxDurationSeconds',
      ],
      estimatedDurationSeconds: [5, 20],
      modelId: null,
      operation: 'audio.speech',
      output: 'audio',
      usageAmount: 0,
      usageResource: 'audio',
    },
    {
      activation: 'inactive',
      allowedParameters: ['durationSeconds', 'format'],
      estimatedDurationSeconds: [5, 20],
      modelId: null,
      operation: 'audio.sfx',
      output: 'audio',
      usageAmount: 0,
      usageResource: 'audio',
    },
  ];
}

export interface CanvasGenerationQuote {
  id: string;
  workspaceId: string;
  payloadHash: string;
  operation: CanvasGenerationOperation;
  modelId: string;
  usage: { resource: CanvasUsageResource; amount: number };
  estimatedDurationSeconds: [number, number];
  createdAt: string;
}

type LegacyCanvasGenerationOrigin = {
  kind: 'advanced_canvas';
  id: string;
  revisionId: string;
};

export interface CanvasGenerationJob {
  id: string;
  workspaceId: string;
  origin: AdvancedCanvasEditingContext;
  operation: CanvasGenerationOperation;
  modelId: string;
  prompt: string;
  parameters: Record<string, unknown>;
  inputAssetIds: string[];
  maskAssetId?: string;
  idempotencyKey: string;
  quoteId: string;
  status:
    | 'queued'
    | 'accepted'
    | 'delivery_pending'
    | 'completed'
    | 'failed'
    | 'cancel_requested'
    | 'cancelled'
    | 'unknown';
  providerTaskId?: string;
  outputAssetId?: string;
  textDeliverableId?: string;
  text?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

type PersistedCanvasGenerationJob = Omit<CanvasGenerationJob, 'origin'> & {
  origin: AdvancedCanvasEditingContext | LegacyCanvasGenerationOrigin;
};

export interface CanvasGeneratedAsset {
  id: string;
  workspaceId: string;
  mediaType: CanvasMediaType;
  mimeType: string;
  sizeBytes: number;
  custody: 'owned';
}

export interface CanvasMediaDeliveryInput {
  workspaceId: string;
  projectId: string;
  jobId: string;
  mediaType: CanvasMediaType;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

interface CanvasTextDeliverable {
  id: string;
  workspaceId: string;
  projectId: string;
  jobId: string;
  text: string;
  createdAt: string;
}

interface CanvasUsageReservation {
  id: string;
  workspaceId: string;
  jobId: string;
  resource: CanvasUsageResource;
  amount: number;
  status: 'reserved' | 'committed' | 'released';
  terminalAt?: string;
}

interface CanvasProviderAttempt {
  id: string;
  workspaceId: string;
  jobId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'failed';
  providerTaskId?: string;
  createdAt: string;
}

interface CanvasProviderCost {
  id: string;
  workspaceId: string;
  jobId: string;
  amountMicros: number;
  status: 'observed';
  createdAt: string;
}

interface CanvasGenerationOutboxItem {
  id: string;
  workspaceId: string;
  jobId: string;
  status: 'pending' | 'dispatched';
  createdAt: string;
}

interface CanvasGenerationReceipt {
  workspaceId: string;
  idempotencyKey: string;
  payloadHash: string;
  jobId: string;
}

export interface CanvasGenerationWorkspaceState {
  quotes: CanvasGenerationQuote[];
  jobs: PersistedCanvasGenerationJob[];
  reservations: CanvasUsageReservation[];
  attempts: CanvasProviderAttempt[];
  providerCosts: CanvasProviderCost[];
  outbox: CanvasGenerationOutboxItem[];
  assets: CanvasGeneratedAsset[];
  textDeliverables: CanvasTextDeliverable[];
  receipts: CanvasGenerationReceipt[];
}

export function createEmptyCanvasGenerationState(): CanvasGenerationWorkspaceState {
  return {
    quotes: [],
    jobs: [],
    reservations: [],
    attempts: [],
    providerCosts: [],
    outbox: [],
    assets: [],
    textDeliverables: [],
    receipts: [],
  };
}

export class CanvasGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CanvasGenerationRepository {
  read(workspaceId: string): Promise<CanvasGenerationWorkspaceState>;
  transact<T>(
    workspaceId: string,
    action: (state: CanvasGenerationWorkspaceState) => T,
  ): Promise<T>;
}

export class MemoryCanvasGenerationRepository
  implements CanvasGenerationRepository
{
  private readonly states = new Map<string, CanvasGenerationWorkspaceState>();

  async read(workspaceId: string) {
    return structuredClone(this.state(workspaceId));
  }

  async transact<T>(
    workspaceId: string,
    action: (state: CanvasGenerationWorkspaceState) => T,
  ) {
    const draft = structuredClone(this.state(workspaceId));
    const result = action(draft);
    this.states.set(workspaceId, draft);
    return structuredClone(result);
  }

  snapshot(workspaceId: string) {
    return structuredClone(this.state(workspaceId));
  }

  private state(workspaceId: string) {
    let state = this.states.get(workspaceId);
    if (!state) {
      state = createEmptyCanvasGenerationState();
      this.states.set(workspaceId, state);
    }
    return state;
  }
}

export interface CanvasGenerationCatalogPort {
  resolve(operation: CanvasGenerationOperation): Promise<CanvasGenerationCatalogEntry | null>;
}

export interface CanvasGenerationActivationRequest {
  activationEvidence: NonNullable<
    CanvasGenerationCatalogEntry['activationEvidence']
  >;
  modelId: string;
  operation: CanvasGenerationOperation;
  usageAmount: number;
}

export interface CanvasGenerationActivationAuthorizer {
  verify(input: CanvasGenerationActivationRequest): Promise<boolean>;
}

export class MemoryCanvasGenerationCatalog
  implements CanvasGenerationCatalogPort
{
  private readonly entries: CanvasGenerationCatalogEntry[];

  constructor(
    entries: CanvasGenerationCatalogEntry[],
    private readonly activationAuthorizer?: CanvasGenerationActivationAuthorizer,
  ) {
    this.entries = structuredClone(entries);
  }

  async resolve(operation: CanvasGenerationOperation) {
    const entry = this.entries.find((candidate) => candidate.operation === operation);
    return entry ? structuredClone(entry) : null;
  }

  async activate(
    operation: CanvasGenerationOperation,
    input: Omit<CanvasGenerationActivationRequest, 'operation'>,
  ) {
    const requested = structuredClone(input);
    const entry = this.entries.find((candidate) => candidate.operation === operation);
    if (!entry) {
      throw new CanvasGenerationError(
        'OPERATION_NOT_FOUND',
        'Generation operation was not found.',
      );
    }
    if (
      !requested.modelId.trim() ||
      !Number.isSafeInteger(requested.usageAmount) ||
      requested.usageAmount <= 0 ||
      requested.activationEvidence.status !== 'live_verified' ||
      !/^activation-probe-[a-f0-9]{24,64}$/u.test(
        requested.activationEvidence.evidenceId,
      ) ||
      !/^[a-f0-9]{64}$/u.test(
        requested.activationEvidence.configurationRevision,
      ) ||
      Number.isNaN(Date.parse(requested.activationEvidence.probedAt))
    ) {
      throw new CanvasGenerationError(
        'ACTIVATION_EVIDENCE_INVALID',
        'Audio activation requires current live activation evidence, model selection, and pricing.',
      );
    }
    if (!this.activationAuthorizer) {
      throw new CanvasGenerationError(
        'ACTIVATION_AUTHORIZER_UNAVAILABLE',
        'Catalog activation requires a persisted live-probe authorizer.',
      );
    }
    const authorized = await this.activationAuthorizer.verify({
      ...structuredClone(requested),
      operation,
    });
    if (!authorized) {
      throw new CanvasGenerationError(
        'ACTIVATION_EVIDENCE_INVALID',
        'Catalog activation evidence was not authorized.',
      );
    }
    entry.activation = 'active';
    entry.activationEvidence = requested.activationEvidence;
    entry.modelId = requested.modelId.trim();
    entry.usageAmount = requested.usageAmount;
  }
}

export interface CanvasGenerationProviderPort {
  submit(input: {
    jobId: string;
    operation: CanvasGenerationOperation;
    modelId: string;
    prompt: string;
    parameters: Record<string, unknown>;
    inputAssetIds: string[];
    maskAssetId?: string;
  }): Promise<
    | { status: 'accepted'; providerTaskId: string }
    | { status: 'rejected'; reason: string }
  >;
  cancel(input: { jobId: string; providerTaskId?: string }): Promise<{
    status: 'cancelled' | 'pending';
  }>;
}

export interface CanvasMediaPersistencePort {
  persist(input: CanvasMediaDeliveryInput): Promise<CanvasGeneratedAsset>;
  persistQuarantined(input: CanvasMediaDeliveryInput): Promise<CanvasGeneratedAsset>;
}

/** Active (non-terminal) generation jobs that occupy a workspace concurrency slot. */
export const CANVAS_GENERATION_ACTIVE_STATUSES = [
  'queued',
  'accepted',
  'delivery_pending',
  'cancel_requested',
  'unknown',
] as const satisfies ReadonlyArray<CanvasGenerationJob['status']>;

export const DEFAULT_CANVAS_GENERATION_CONCURRENCY_LIMIT = 3;

export class CanvasGenerationApplicationService {
  private readonly concurrencyLimit: number;

  constructor(
    private readonly repository: CanvasGenerationRepository,
    private readonly dependencies: {
      catalog: CanvasGenerationCatalogPort;
      provider: CanvasGenerationProviderPort;
      assets: CanvasMediaPersistencePort;
      projectAccess: {
        assertRevision(input: {
          workspaceId: string;
          projectId: string;
          revisionId: string;
        }): Promise<void>;
      };
      assetAccess: {
        assertOwned(input: {
          workspaceId: string;
          assetId: string;
          role?: 'input' | 'mask' | 'reference';
        }): Promise<void>;
      };
      entitlement: {
        assertCanGenerate(context: CanvasGenerationContext): Promise<void>;
      };
      /** Max concurrent non-terminal jobs per workspace. Defaults to 3. */
      concurrencyLimit?: number;
      clock?: () => Date;
    },
  ) {
    this.concurrencyLimit =
      dependencies.concurrencyLimit ?? DEFAULT_CANVAS_GENERATION_CONCURRENCY_LIMIT;
  }

  async quote(context: CanvasGenerationContext, input: CanvasGenerationInput) {
    const { entry, payloadHash } = await this.validateInput(context, input);
    const quote: CanvasGenerationQuote = {
      id: `canvas-quote-${digest(
        canonical({ workspaceId: context.workspaceId, payloadHash, modelId: entry.modelId }),
      ).slice(0, 24)}`,
      workspaceId: context.workspaceId,
      payloadHash,
      operation: input.operation,
      modelId: entry.modelId,
      usage: { resource: entry.usageResource, amount: entry.usageAmount },
      estimatedDurationSeconds: [...entry.estimatedDurationSeconds],
      createdAt: this.now().toISOString(),
    };
    await this.repository.transact(context.workspaceId, (state) => {
      if (!state.quotes.some((candidate) => candidate.id === quote.id)) {
        state.quotes.push(quote);
      }
    });
    return structuredClone(quote);
  }

  async submit(
    context: CanvasGenerationContext,
    input: CanvasGenerationInput & { quoteId: string },
  ) {
    const { payloadHash } = await this.validateInput(context, input);
    return this.repository.transact(context.workspaceId, (state) => {
      const existing = state.receipts.find(
        (candidate) => candidate.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new CanvasGenerationError(
            'IDEMPOTENCY_CONFLICT',
            'Generation key was reused with another request.',
          );
        }
        return generationJobProjection(state, requireJob(state, existing.jobId));
      }
      const quote = state.quotes.find((candidate) => candidate.id === input.quoteId);
      if (!quote || quote.payloadHash !== payloadHash) {
        throw new CanvasGenerationError(
          'QUOTE_MISMATCH',
          'Generation quote does not match the request.',
        );
      }
      const activeCount = state.jobs.filter((candidate) =>
        (CANVAS_GENERATION_ACTIVE_STATUSES as readonly string[]).includes(
          candidate.status,
        ),
      ).length;
      if (activeCount >= this.concurrencyLimit) {
        throw new CanvasGenerationError(
          'CONCURRENCY_LIMIT_EXCEEDED',
          `Workspace already has ${activeCount} active generation jobs (limit ${this.concurrencyLimit}).`,
        );
      }
      const createdAt = this.now().toISOString();
      const jobId = `canvas-generation-${digest(
        `${context.workspaceId}:${input.idempotencyKey}`,
      ).slice(0, 24)}`;
      const job: CanvasGenerationJob = {
        id: jobId,
        workspaceId: context.workspaceId,
        origin: {
          kind: 'advanced_canvas',
          projectId: input.projectId,
          revisionId: input.revisionId,
        },
        operation: input.operation,
        modelId: quote.modelId,
        prompt: input.prompt,
        parameters: structuredClone(input.parameters),
        inputAssetIds: [...input.inputAssetIds],
        ...(input.maskAssetId ? { maskAssetId: input.maskAssetId } : {}),
        idempotencyKey: input.idempotencyKey,
        quoteId: quote.id,
        status: 'queued',
        createdAt,
        updatedAt: createdAt,
      };
      state.jobs.push(job);
      state.reservations.push({
        id: `canvas-reservation-${jobId}`,
        workspaceId: context.workspaceId,
        jobId,
        resource: quote.usage.resource,
        amount: quote.usage.amount,
        status: 'reserved',
      });
      state.attempts.push({
        id: `canvas-attempt-${jobId}-1`,
        workspaceId: context.workspaceId,
        jobId,
        status: 'pending',
        createdAt,
      });
      state.outbox.push({
        id: `canvas-outbox-${jobId}`,
        workspaceId: context.workspaceId,
        jobId,
        status: 'pending',
        createdAt,
      });
      state.receipts.push({
        workspaceId: context.workspaceId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        jobId,
      });
      return generationJobProjection(state, job);
    });
  }

  async dispatch(context: CanvasGenerationContext, jobId: string) {
    const state = await this.repository.read(context.workspaceId);
    const job = requireJob(state, jobId);
    if (job.status !== 'queued') return generationJobProjection(state, job);
    const result = await this.dependencies.provider.submit({
      jobId: job.id,
      operation: job.operation,
      modelId: job.modelId,
      prompt: job.prompt,
      parameters: structuredClone(job.parameters),
      inputAssetIds: [...job.inputAssetIds],
      ...(job.maskAssetId ? { maskAssetId: job.maskAssetId } : {}),
    });
    return this.repository.transact(context.workspaceId, (current) => {
      const projection = requireJob(current, jobId);
      if (projection.status !== 'queued') {
        return generationJobProjection(current, projection);
      }
      const attempt = requireAttempt(current, jobId);
      const outbox = requireOutbox(current, jobId);
      outbox.status = 'dispatched';
      projection.updatedAt = this.now().toISOString();
      if (result.status === 'rejected') {
        projection.status = 'failed';
        projection.failureCode = 'PROVIDER_REJECTED';
        attempt.status = 'rejected';
        releaseReservation(current, jobId, this.now());
      } else {
        projection.status = 'accepted';
        projection.providerTaskId = result.providerTaskId;
        attempt.status = 'accepted';
        attempt.providerTaskId = result.providerTaskId;
      }
      return generationJobProjection(current, projection);
    });
  }

  async getJob(context: CanvasGenerationContext, jobId: string) {
    const state = await this.repository.read(context.workspaceId);
    return generationJobProjection(state, requireJob(state, jobId));
  }

  async listProjectGenerations(
    context: CanvasGenerationContext,
    projectId: string,
  ) {
    const state = await this.repository.read(context.workspaceId);
    return state.jobs
      .filter((job) => readCanvasGenerationOrigin(job.origin)?.projectId === projectId)
      .map((job) => generationJobProjection(state, job));
  }

  async deliverMedia(
    context: CanvasGenerationContext,
    jobId: string,
    input: Pick<CanvasMediaDeliveryInput, 'bytes' | 'mimeType' | 'fileName'>,
  ) {
    const state = await this.repository.read(context.workspaceId);
    const job = requireJob(state, jobId);
    const entry = await this.requireCatalog(job.operation);
    if (entry.output === 'text') {
      throw new CanvasGenerationError(
        'MEDIA_DELIVERY_FORBIDDEN',
        'Text jobs cannot deliver media assets.',
      );
    }
    const origin = requireCanvasGenerationOrigin(job.origin);
    const delivery: CanvasMediaDeliveryInput = {
      workspaceId: context.workspaceId,
      projectId: origin.projectId,
      jobId,
      mediaType: entry.output,
      bytes: input.bytes,
      mimeType: input.mimeType,
      fileName: input.fileName,
    };
    if (entry.output === 'audio') validateAudioDelivery(delivery);
    if (job.status === 'cancelled') {
      await this.dependencies.assets.persistQuarantined(delivery);
      return generationJobProjection(state, job);
    }
    if (job.status !== 'accepted' && job.status !== 'delivery_pending') {
      throw new CanvasGenerationError(
        'JOB_NOT_DELIVERABLE',
        'Generation job cannot accept a media delivery.',
      );
    }
    let asset: CanvasGeneratedAsset;
    try {
      asset = await this.dependencies.assets.persist(delivery);
    } catch {
      return this.repository.transact(context.workspaceId, (current) => {
        const projection = requireJob(current, jobId);
        projection.status = 'delivery_pending';
        projection.updatedAt = this.now().toISOString();
        return generationJobProjection(current, projection);
      });
    }
    const projection = await this.repository.transact(context.workspaceId, (current) => {
      const projection = requireJob(current, jobId);
      if (projection.status === 'cancelled') {
        return generationJobProjection(current, projection);
      }
      if (!current.assets.some((candidate) => candidate.id === asset.id)) {
        current.assets.push(structuredClone(asset));
      }
      projection.outputAssetId = asset.id;
      projection.status = 'completed';
      projection.updatedAt = this.now().toISOString();
      commitReservation(current, jobId, this.now());
      return generationJobProjection(current, projection);
    });
    if (projection.status === 'cancelled') {
      await this.dependencies.assets.persistQuarantined(delivery);
    }
    return projection;
  }

  async deliverText(
    context: CanvasGenerationContext,
    jobId: string,
    text: string,
  ) {
    requireText(text, 'text');
    const entry = await this.requireCatalog(
      (await this.getJob(context, jobId)).operation,
    );
    if (entry.output !== 'text') {
      throw new CanvasGenerationError(
        'TEXT_DELIVERY_FORBIDDEN',
        'Media jobs cannot deliver text.',
      );
    }
    return this.repository.transact(context.workspaceId, (state) => {
      const job = requireJob(state, jobId);
      if (job.status !== 'accepted') {
        throw new CanvasGenerationError(
          'JOB_NOT_DELIVERABLE',
          'Generation job cannot accept text delivery.',
        );
      }
      const deliverable: CanvasTextDeliverable = {
        id: `canvas-text-${job.id}`,
        workspaceId: context.workspaceId,
        projectId: requireCanvasGenerationOrigin(job.origin).projectId,
        jobId: job.id,
        text,
        createdAt: this.now().toISOString(),
      };
      if (!state.textDeliverables.some((candidate) => candidate.id === deliverable.id)) {
        state.textDeliverables.push(deliverable);
      }
      job.textDeliverableId = deliverable.id;
      job.status = 'completed';
      job.updatedAt = this.now().toISOString();
      commitReservation(state, jobId, this.now());
      return generationJobProjection(state, job);
    });
  }

  async fail(
    context: CanvasGenerationContext,
    jobId: string,
    input: { code: string; providerCostMicros?: number },
  ) {
    requireText(input.code, 'code');
    return this.repository.transact(context.workspaceId, (state) => {
      const job = requireJob(state, jobId);
      if (job.status === 'completed' || job.status === 'cancelled') {
        return generationJobProjection(state, job);
      }
      job.status = 'failed';
      job.failureCode = input.code;
      job.updatedAt = this.now().toISOString();
      requireAttempt(state, jobId).status = 'failed';
      releaseReservation(state, jobId, this.now());
      if (input.providerCostMicros !== undefined) {
        if (!Number.isSafeInteger(input.providerCostMicros) || input.providerCostMicros < 0) {
          throw new CanvasGenerationError(
            'PROVIDER_COST_INVALID',
            'Provider cost must be a non-negative integer.',
          );
        }
        state.providerCosts.push({
          id: `canvas-provider-cost-${jobId}`,
          workspaceId: context.workspaceId,
          jobId,
          amountMicros: input.providerCostMicros,
          status: 'observed',
          createdAt: this.now().toISOString(),
        });
      }
      return generationJobProjection(state, job);
    });
  }

  async requestCancel(context: CanvasGenerationContext, jobId: string) {
    return this.repository.transact(context.workspaceId, (state) => {
      const job = requireJob(state, jobId);
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return generationJobProjection(state, job);
      }
      job.status = 'cancel_requested';
      job.updatedAt = this.now().toISOString();
      return generationJobProjection(state, job);
    });
  }

  async confirmCancel(context: CanvasGenerationContext, jobId: string) {
    const job = await this.getJob(context, jobId);
    if (job.status !== 'cancel_requested') return job;
    const result = await this.dependencies.provider.cancel({
      jobId,
      ...(job.providerTaskId ? { providerTaskId: job.providerTaskId } : {}),
    });
    if (result.status === 'pending') return job;
    return this.repository.transact(context.workspaceId, (state) => {
      const projection = requireJob(state, jobId);
      if (projection.status !== 'cancel_requested') {
        return generationJobProjection(state, projection);
      }
      projection.status = 'cancelled';
      projection.updatedAt = this.now().toISOString();
      releaseReservation(state, jobId, this.now());
      return generationJobProjection(state, projection);
    });
  }

  async getUsageProjection(context: CanvasGenerationContext) {
    const state = await this.repository.read(context.workspaceId);
    const projection = {
      reserved: emptyUsage(),
      committed: emptyUsage(),
      released: emptyUsage(),
    };
    for (const reservation of state.reservations) {
      projection[reservation.status][reservation.resource] += reservation.amount;
    }
    return projection;
  }

  private async validateInput(
    context: CanvasGenerationContext,
    input: CanvasGenerationInput,
  ) {
    requireText(input.projectId, 'projectId');
    requireText(input.revisionId, 'revisionId');
    requireText(input.prompt, 'prompt');
    requireText(input.idempotencyKey, 'idempotencyKey');
    await this.dependencies.entitlement.assertCanGenerate(context);
    await this.dependencies.projectAccess.assertRevision({
      workspaceId: context.workspaceId,
      projectId: input.projectId,
      revisionId: input.revisionId,
    });
    const entry = await this.requireCatalog(input.operation);
    if (
      entry.activation !== 'active' ||
      !entry.modelId ||
      (input.operation.startsWith('audio.') &&
        entry.activationEvidence?.status !== 'live_verified')
    ) {
      throw new CanvasGenerationError(
        'OPERATION_NOT_ACTIVE',
        'Generation operation has not passed activation probe.',
      );
    }
    validateParameters(input.parameters, entry.allowedParameters);
    validateAudioContract(input.operation, input.prompt, input.parameters);
    if (!Array.isArray(input.inputAssetIds)) {
      throw new CanvasGenerationError(
        'INPUT_INVALID',
        'inputAssetIds must be an array.',
      );
    }
    for (const assetId of input.inputAssetIds) {
      requireText(assetId, 'inputAssetId');
      await this.dependencies.assetAccess.assertOwned({
        workspaceId: context.workspaceId,
        assetId,
        role: 'input',
      });
    }
    if (input.maskAssetId) {
      if (input.operation !== 'image.edit') {
        throw new CanvasGenerationError(
          'MASK_NOT_ALLOWED',
          'Mask assets are only accepted for image editing.',
        );
      }
      await this.dependencies.assetAccess.assertOwned({
        workspaceId: context.workspaceId,
        assetId: input.maskAssetId,
        role: 'mask',
      });
    }
    const references = input.parameters.referenceAssetIds;
    if (references !== undefined) {
      if (!Array.isArray(references) || !references.every((value) => typeof value === 'string')) {
        throw new CanvasGenerationError(
          'GENERATION_PARAMETER_INVALID',
          'referenceAssetIds must contain Asset IDs.',
        );
      }
      for (const assetId of references) {
        await this.dependencies.assetAccess.assertOwned({
          workspaceId: context.workspaceId,
          assetId,
          role: 'reference',
        });
      }
    }
    const payloadHash = digest(
      canonical({
        projectId: input.projectId,
        revisionId: input.revisionId,
        operation: input.operation,
        prompt: input.prompt,
        parameters: input.parameters,
        inputAssetIds: input.inputAssetIds,
        maskAssetId: input.maskAssetId,
      }),
    );
    return { entry: { ...entry, modelId: entry.modelId }, payloadHash };
  }

  private async requireCatalog(operation: CanvasGenerationOperation) {
    const entry = await this.dependencies.catalog.resolve(operation);
    if (!entry) {
      throw new CanvasGenerationError(
        'OPERATION_NOT_FOUND',
        'Generation operation was not found.',
      );
    }
    return entry;
  }

  private now() {
    return this.dependencies.clock?.() ?? new Date();
  }
}

function validateAudioContract(
  operation: CanvasGenerationOperation,
  prompt: string,
  parameters: Record<string, unknown>,
) {
  try {
    if (operation === 'audio.speech') {
      parseAudioSpeechContract(parameters);
    } else if (operation === 'audio.sfx') {
      parseAudioSfxContract({ description: prompt, ...parameters });
    }
  } catch {
    throw new CanvasGenerationError(
      'GENERATION_PARAMETER_INVALID',
      `${operation} parameters are invalid.`,
    );
  }
}

function validateParameters(
  parameters: Record<string, unknown>,
  allowedParameters: string[],
) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new CanvasGenerationError(
      'GENERATION_PARAMETER_INVALID',
      'Generation parameters must be an object.',
    );
  }
  const forbidden = new Set([
    'channelId',
    'baseUrl',
    'serverUrl',
    'apiKey',
    'providerPath',
    'requestTemplate',
    'poll_url',
    'dataUrl',
    'objectKey',
  ]);
  for (const key of Object.keys(parameters)) {
    if (forbidden.has(key) || !allowedParameters.includes(key)) {
      throw new CanvasGenerationError(
        'GENERATION_PARAMETER_FORBIDDEN',
        `Generation parameter ${key} is not allowed by the capability.`,
      );
    }
  }
}

function validateAudioDelivery(input: CanvasMediaDeliveryInput) {
  const allowed = new Set(['audio/mpeg', 'audio/wav']);
  if (!allowed.has(input.mimeType) || input.bytes.byteLength < 4) {
    throw new CanvasGenerationError(
      'AUDIO_CONTENT_INVALID',
      'Audio delivery failed the media allowlist.',
    );
  }
  const bytes = input.bytes;
  const mp3 =
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0);
  const wav =
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45;
  if (
    (input.mimeType === 'audio/mpeg' && !mp3) ||
    (input.mimeType === 'audio/wav' && !wav)
  ) {
    throw new CanvasGenerationError(
      'AUDIO_CONTENT_INVALID',
      'Audio delivery failed magic-byte validation.',
    );
  }
}

/**
 * Read boundary for generation state persisted before EditingContext used
 * projectId. The legacy id key is accepted only when projectId is absent;
 * callers receive the canonical shape and no legacy value is written back.
 */
export function readCanvasGenerationOrigin(
  value: unknown,
): AdvancedCanvasEditingContext | null {
  const canonical = editingContextSchema.safeParse(value);
  if (canonical.success) {
    return canonical.data.kind === 'advanced_canvas' ? canonical.data : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const origin = value as Record<string, unknown>;
  const hasProjectId = Object.prototype.hasOwnProperty.call(origin, 'projectId');
  const hasLegacyId = Object.prototype.hasOwnProperty.call(origin, 'id');
  if (hasProjectId || !hasLegacyId) return null;
  if (
    Object.keys(origin).some(
      (key) => key !== 'kind' && key !== 'id' && key !== 'revisionId',
    )
  ) {
    return null;
  }
  const legacy = editingContextSchema.safeParse({
    kind: 'advanced_canvas',
    projectId: origin.id,
    revisionId: origin.revisionId,
  });
  return legacy.success && legacy.data.kind === 'advanced_canvas'
    ? legacy.data
    : null;
}

function requireCanvasGenerationOrigin(
  value: unknown,
): AdvancedCanvasEditingContext {
  const origin = readCanvasGenerationOrigin(value);
  if (!origin) {
    throw new CanvasGenerationError(
      'GENERATION_ORIGIN_INVALID',
      'Generation job origin is not a supported advanced-canvas EditingContext.',
    );
  }
  return origin;
}

function generationJobProjection(
  state: CanvasGenerationWorkspaceState,
  job: PersistedCanvasGenerationJob,
) {
  const deliverable = job.textDeliverableId
    ? state.textDeliverables.find(
        (candidate) => candidate.id === job.textDeliverableId,
      )
    : undefined;
  return structuredClone({
    ...job,
    origin: requireCanvasGenerationOrigin(job.origin),
    ...(deliverable ? { text: deliverable.text } : {}),
  });
}

function requireJob(state: CanvasGenerationWorkspaceState, jobId: string) {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    throw new CanvasGenerationError(
      'GENERATION_JOB_NOT_FOUND',
      'Canvas generation job was not found.',
    );
  }
  return job;
}

function requireAttempt(state: CanvasGenerationWorkspaceState, jobId: string) {
  const attempt = state.attempts.find((candidate) => candidate.jobId === jobId);
  if (!attempt) {
    throw new CanvasGenerationError(
      'PROVIDER_ATTEMPT_NOT_FOUND',
      'Canvas provider attempt was not found.',
    );
  }
  return attempt;
}

function requireOutbox(state: CanvasGenerationWorkspaceState, jobId: string) {
  const outbox = state.outbox.find((candidate) => candidate.jobId === jobId);
  if (!outbox) {
    throw new CanvasGenerationError(
      'OUTBOX_ITEM_NOT_FOUND',
      'Canvas generation outbox item was not found.',
    );
  }
  return outbox;
}

function releaseReservation(
  state: CanvasGenerationWorkspaceState,
  jobId: string,
  now: Date,
) {
  settleReservation(state, jobId, 'released', now);
}

function commitReservation(
  state: CanvasGenerationWorkspaceState,
  jobId: string,
  now: Date,
) {
  settleReservation(state, jobId, 'committed', now);
}

function settleReservation(
  state: CanvasGenerationWorkspaceState,
  jobId: string,
  status: 'committed' | 'released',
  now: Date,
) {
  const reservation = state.reservations.find(
    (candidate) => candidate.jobId === jobId,
  );
  if (!reservation) {
    throw new CanvasGenerationError(
      'RESERVATION_NOT_FOUND',
      'Canvas usage reservation was not found.',
    );
  }
  if (reservation.status === status) return;
  if (reservation.status !== 'reserved') {
    throw new CanvasGenerationError(
      'SETTLEMENT_CONFLICT',
      'Canvas usage reservation is already terminal.',
    );
  }
  reservation.status = status;
  reservation.terminalAt = now.toISOString();
}

function emptyUsage(): Record<CanvasUsageResource, number> {
  return { copy: 0, image: 0, video: 0, audio: 0 };
}

function requireText(value: string, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CanvasGenerationError('INPUT_INVALID', `${field} is required.`);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
