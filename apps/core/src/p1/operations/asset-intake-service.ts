import {
  assetIntakeBatchSchema,
  assetIntakeCapabilitySchema,
  assetIntakeDecisionEventSchema,
  confirmedFactReferenceSchema,
  prepareAssistedPriceIntakeCommandSchema,
  storeFactCandidateDraftSchema,
  type AssetIntakeBatch,
  type AssetIntakeDecisionEvent,
  type ContextBundle,
  type PrepareAssistedPriceIntakeCommand,
  type StoreFact,
  type StoreFactCandidateDraft,
} from '@meiye/contracts';
import { isDeepStrictEqual } from 'node:util';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  StoreFactRevisionConflictError,
  type StoreFactLedger,
} from './store-fact-ledger.js';

export type AssetIntakeErrorCode =
  | 'ASSISTED_INPUT_INVALID'
  | 'BATCH_CONFLICT'
  | 'BATCH_NOT_FOUND'
  | 'CANDIDATE_NOT_FOUND'
  | 'DECISION_CONFLICT'
  | 'EXAMPLE_FACT_ISOLATION'
  | 'WRONG_OBJECT_CHANNEL';

export class AssetIntakeError extends Error {
  readonly status: number;

  constructor(
    readonly code: AssetIntakeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssetIntakeError';
    this.status = code.endsWith('_NOT_FOUND') ? 404 : 409;
  }
}

export interface AssetIntakeDecisionReceipt {
  idempotencyKey: string;
  fingerprint: string;
  event: AssetIntakeDecisionEvent;
}

export interface AssistedScreenshotAssetAuthorizer {
  isAuthorized(workspaceId: string, assetId: string): Promise<boolean>;
}

export interface FactConfirmationReservation {
  workspaceId: string;
  batchId: string;
  candidateId: string;
  factId: string;
  expectedFactRevision: number;
  expectedCandidateRevision: number;
  idempotencyKey: string;
  fingerprint: string;
  draft: StoreFactCandidateDraft;
  recordedAt: string;
  recordedBy: string;
}

export interface AssetIntakeRepository {
  recordBatch(
    batch: AssetIntakeBatch,
    commandFingerprint?: string,
  ): Promise<AssetIntakeBatch>;
  getBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<AssetIntakeBatch | null>;
  appendDecision(
    receipt: AssetIntakeDecisionReceipt,
  ): Promise<AssetIntakeDecisionEvent>;
  decisionReceipt(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<AssetIntakeDecisionReceipt | null>;
  listDecisions(
    workspaceId: string,
    batchId: string,
  ): Promise<AssetIntakeDecisionEvent[]>;
  reserveFactConfirmation(
    reservation: FactConfirmationReservation,
  ): Promise<FactConfirmationReservation>;
  abortFactConfirmation(
    reservation: FactConfirmationReservation,
  ): Promise<void>;
}

function identity(workspaceId: string, ...values: Array<string | number>) {
  return JSON.stringify([workspaceId, ...values]);
}

export class MemoryAssetIntakeRepository implements AssetIntakeRepository {
  private readonly batches = new Map<string, AssetIntakeBatch>();
  private readonly batchCommandFingerprints = new Map<string, string>();
  private readonly decisions = new Map<string, AssetIntakeDecisionEvent[]>();
  private readonly receipts = new Map<string, AssetIntakeDecisionReceipt>();
  private readonly confirmationReservations = new Map<
    string,
    FactConfirmationReservation
  >();
  private readonly confirmationReservationKeys = new Map<string, string>();
  private readonly confirmationFactStreams = new Map<string, string>();
  private readonly candidateHeads = new Map<string, number>();

  async recordBatch(input: AssetIntakeBatch, commandFingerprint?: string) {
    const batch = assetIntakeBatchSchema.parse(input);
    const key = identity(batch.workspaceId, batch.batchId);
    const current = this.batches.get(key);
    if (
      current &&
      (!isDeepStrictEqual(current, batch) ||
        (this.batchCommandFingerprints.get(key) ?? null) !==
          (commandFingerprint ?? null))
    ) {
      throw new AssetIntakeError(
        'BATCH_CONFLICT',
        `Asset intake batch ${batch.batchId} already has another payload.`,
      );
    }
    if (!current) {
      this.batches.set(key, structuredClone(batch));
      if (commandFingerprint) {
        this.batchCommandFingerprints.set(key, commandFingerprint);
      }
    }
    return structuredClone(current ?? batch);
  }

  async getBatch(workspaceId: string, batchId: string) {
    const batch = this.batches.get(identity(workspaceId, batchId));
    return batch ? structuredClone(batch) : null;
  }

  async appendDecision(input: AssetIntakeDecisionReceipt) {
    const event = assetIntakeDecisionEventSchema.parse(input.event);
    const receiptKey = identity(event.workspaceId, input.idempotencyKey);
    const current = this.receipts.get(receiptKey);
    if (current) {
      if (current.fingerprint !== input.fingerprint) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          `Idempotency key ${input.idempotencyKey} was reused.`,
        );
      }
      return structuredClone(current.event);
    }
    const batchKey = identity(event.workspaceId, event.batchId);
    const candidateKey = identity(
      event.workspaceId,
      event.batchId,
      event.candidateId,
    );
    const head = this.candidateHeads.get(candidateKey) ?? 0;
    if (event.action === 'confirmed') {
      const reservation = this.confirmationReservations.get(
        this.confirmationReservationKeys.get(receiptKey) ?? '',
      );
      if (
        !reservation ||
        reservation.workspaceId !== event.workspaceId ||
        reservation.batchId !== event.batchId ||
        reservation.candidateId !== event.candidateId ||
        reservation.fingerprint !== input.fingerprint ||
        event.candidateRevision !== reservation.expectedCandidateRevision + 1 ||
        event.candidateRevision !== head ||
        event.factId !== reservation.factId ||
        event.factRevision !== reservation.expectedFactRevision + 1
      ) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'Fact confirmation does not own the current candidate generation.',
        );
      }
    } else {
      if (event.candidateRevision !== head + 1) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'Asset intake candidate decision head changed.',
        );
      }
      this.candidateHeads.set(candidateKey, event.candidateRevision);
    }
    this.decisions.set(batchKey, [
      ...(this.decisions.get(batchKey) ?? []),
      event,
    ]);
    this.receipts.set(receiptKey, {
      idempotencyKey: input.idempotencyKey,
      fingerprint: input.fingerprint,
      event,
    });
    return structuredClone(event);
  }

  async decisionReceipt(workspaceId: string, idempotencyKey: string) {
    const receipt = this.receipts.get(identity(workspaceId, idempotencyKey));
    return receipt ? structuredClone(receipt) : null;
  }

  async listDecisions(workspaceId: string, batchId: string) {
    return structuredClone(
      this.decisions.get(identity(workspaceId, batchId)) ?? [],
    );
  }

  async reserveFactConfirmation(input: FactConfirmationReservation) {
    const candidateKey = identity(
      input.workspaceId,
      input.batchId,
      input.candidateId,
    );
    const reservationKey = identity(
      input.workspaceId,
      input.batchId,
      input.candidateId,
      input.expectedCandidateRevision,
    );
    const factStreamKey = identity(
      input.workspaceId,
      input.factId,
      input.expectedFactRevision,
    );
    const receiptKey = identity(input.workspaceId, input.idempotencyKey);
    const current =
      this.confirmationReservations.get(reservationKey) ??
      this.confirmationReservations.get(
        this.confirmationReservationKeys.get(receiptKey) ?? '',
      ) ??
      this.confirmationReservations.get(
        this.confirmationFactStreams.get(factStreamKey) ?? '',
      );
    const isReplay =
      current?.idempotencyKey === input.idempotencyKey &&
      current.fingerprint === input.fingerprint;
    if (current && !isReplay && !isDeepStrictEqual(current, input)) {
      throw new AssetIntakeError(
        'DECISION_CONFLICT',
        'This fact revision or idempotency key already belongs to another confirmation.',
      );
    }
    if (!current) {
      const head = this.candidateHeads.get(candidateKey) ?? 0;
      if (head !== input.expectedCandidateRevision) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'Asset intake candidate decision head changed.',
        );
      }
      const reservation = structuredClone(input);
      this.confirmationReservations.set(reservationKey, reservation);
      this.confirmationReservationKeys.set(receiptKey, reservationKey);
      this.confirmationFactStreams.set(factStreamKey, reservationKey);
      this.candidateHeads.set(candidateKey, input.expectedCandidateRevision + 1);
    }
    return structuredClone(current ?? input);
  }

  async abortFactConfirmation(input: FactConfirmationReservation) {
    const candidateKey = identity(
      input.workspaceId,
      input.batchId,
      input.candidateId,
    );
    const reservationKey = identity(
      input.workspaceId,
      input.batchId,
      input.candidateId,
      input.expectedCandidateRevision,
    );
    const current = this.confirmationReservations.get(reservationKey);
    if (!current) return;
    if (!isDeepStrictEqual(current, input)) {
      throw new AssetIntakeError(
        'DECISION_CONFLICT',
        'Only the current fact confirmation owner can abort its reservation.',
      );
    }
    const receiptKey = identity(input.workspaceId, input.idempotencyKey);
    if (this.receipts.has(receiptKey)) {
      throw new AssetIntakeError(
        'DECISION_CONFLICT',
        'A completed fact confirmation cannot be aborted.',
      );
    }
    if (
      (this.candidateHeads.get(candidateKey) ?? 0) !==
      input.expectedCandidateRevision + 1
    ) {
      throw new AssetIntakeError(
        'DECISION_CONFLICT',
        'Fact confirmation reservation is no longer the candidate head.',
      );
    }
    const factStreamKey = identity(
      input.workspaceId,
      input.factId,
      input.expectedFactRevision,
    );
    this.confirmationReservations.delete(reservationKey);
    this.confirmationReservationKeys.delete(receiptKey);
    this.confirmationFactStreams.delete(factStreamKey);
    if (input.expectedCandidateRevision === 0) {
      this.candidateHeads.delete(candidateKey);
    } else {
      this.candidateHeads.set(candidateKey, input.expectedCandidateRevision);
    }
  }
}

function fingerprint(value: unknown) {
  return JSON.stringify(value);
}

function factDraftMatches(
  fact: StoreFact,
  draft: StoreFactCandidateDraft,
) {
  return (
    fact.kind === draft.kind &&
    fact.key === draft.key &&
    isDeepStrictEqual(fact.value, draft.value) &&
    isDeepStrictEqual(fact.scope, draft.scope) &&
    isDeepStrictEqual(fact.source, draft.source) &&
    fact.effectiveFrom === draft.effectiveFrom &&
    fact.expiresAt === draft.expiresAt
  );
}

export class AssetIntakeService {
  constructor(
    private readonly repository: AssetIntakeRepository,
    private readonly facts: StoreFactLedger,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly screenshotAssets?: AssistedScreenshotAssetAuthorizer,
  ) {}

  async recordBatch(input: AssetIntakeBatch, commandFingerprint?: string) {
    const parsed = assetIntakeBatchSchema.parse(input);
    const existing = await this.repository.getBatch(
      parsed.workspaceId,
      parsed.batchId,
    );
    const batch = existing
      ? assetIntakeBatchSchema.parse({
          ...parsed,
          createdAt: existing.createdAt,
        })
      : parsed;
    if (
      batch.candidates.some(
        (candidate) =>
          candidate.objectKind === 'store_fact' &&
          candidate.fact.source.referenceId !== batch.source.referenceId,
      )
    ) {
      throw new AssetIntakeError(
        'WRONG_OBJECT_CHANNEL',
        'A StoreFact candidate must retain the intake source reference.',
      );
    }
    return this.repository.recordBatch(batch, commandFingerprint);
  }

  async prepareAssistedPriceIntake(
    context: { workspaceId: string },
    value: PrepareAssistedPriceIntakeCommand,
  ) {
    const input = prepareAssistedPriceIntakeCommandSchema.parse(value);
    const commandFingerprint = fingerprintValue({
      workspaceId: context.workspaceId,
      command: input,
    });
    const existing = await this.repository.getBatch(
      context.workspaceId,
      input.batchId,
    );
    if (
      !existing &&
      input.inputMode === 'screenshot' &&
      !(await this.screenshotAssets?.isAuthorized(
        context.workspaceId,
        input.screenshotAssetId,
      ))
    ) {
      throw new AssetIntakeError(
        'ASSISTED_INPUT_INVALID',
        'The screenshot must be an authorized asset in this workspace.',
      );
    }
    const amount =
      input.inputMode === 'manual_select'
        ? input.amount
        : assistedPriceAmount(
            input.inputMode === 'screenshot'
              ? input.recognizedText
              : input.pastedText,
          );
    const referenceId =
      input.inputMode === 'screenshot'
        ? input.screenshotAssetId
        : `assisted-${input.inputMode}:${input.batchId}`;
    const capturedAt = existing?.createdAt ?? this.now();
    return this.recordBatch({
      batchId: input.batchId,
      workspaceId: context.workspaceId,
      taskId: input.taskId,
      source: {
        sourceId: `assisted-source:${input.batchId}`,
        kind:
          input.inputMode === 'screenshot'
            ? 'group_buy_screenshot'
            : input.inputMode === 'paste_text'
              ? 'pasted_text'
              : 'manual',
        referenceId,
        capabilityStatus: 'assisted',
        sourceWorkspaceId: context.workspaceId,
        capturedAt,
        example: false,
      },
      summary: `Current price candidate: CNY ${amount}`,
      candidates: [
        {
          candidateId: input.candidateId,
          objectKind: 'store_fact',
          status: 'pending',
          fact: {
            kind: 'price',
            key: input.key,
            value: {
              amount,
              currency:
                input.inputMode === 'manual_select'
                  ? input.currency
                  : 'CNY',
            },
            scope: input.scope,
            source: {
              kind:
                input.inputMode === 'screenshot'
                  ? 'screenshot_extraction'
                  : 'user_confirmation',
              referenceId,
              capturedAt,
            },
            effectiveFrom: input.effectiveFrom,
            expiresAt: input.expiresAt,
          },
        },
      ],
      createdAt: capturedAt,
    }, commandFingerprint);
  }

  async view(workspaceId: string, batchId: string) {
    const batch = await this.batch(workspaceId, batchId);
    const decisions = await this.repository.listDecisions(workspaceId, batchId);
    return {
      batch,
      decisions,
      capability: assetIntakeCapabilitySchema.parse({
        status: batch.source.capabilityStatus,
        fallbackInputs:
          batch.source.capabilityStatus === 'assisted'
            ? ['screenshot', 'paste_text', 'manual_select']
            : [],
        reason:
          batch.source.capabilityStatus === 'assisted'
            ? 'Automatic source parsing is not verified; use an assisted input.'
            : null,
      }),
    };
  }

  async rejectCandidate(
    context: { workspaceId: string; userId: string },
    input: {
      batchId: string;
      candidateId: string;
      reason: string;
      idempotencyKey: string;
    },
  ) {
    const decisionFingerprint = fingerprint({
      action: 'rejected',
      batchId: input.batchId,
      candidateId: input.candidateId,
      reason: input.reason,
    });
    const existing = await this.repository.decisionReceipt(
      context.workspaceId,
      input.idempotencyKey,
    );
    if (existing) {
      if (
        existing.fingerprint !== decisionFingerprint ||
        existing.event.action !== 'rejected'
      ) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          `Idempotency key ${input.idempotencyKey} was reused.`,
        );
      }
      return existing.event;
    }
    const batch = await this.batch(context.workspaceId, input.batchId);
    if (
      !batch.candidates.some((item) => item.candidateId === input.candidateId)
    ) {
      throw new AssetIntakeError(
        'CANDIDATE_NOT_FOUND',
        `Asset intake candidate ${input.candidateId} was not found.`,
      );
    }
    const decisions = (
      await this.repository.listDecisions(context.workspaceId, input.batchId)
    ).filter((item) => item.candidateId === input.candidateId);
    if (decisions.at(-1)?.action === 'confirmed') {
      throw new AssetIntakeError(
        'DECISION_CONFLICT',
        'A confirmed fact candidate cannot be rejected retroactively.',
      );
    }
    const candidateRevision = decisions.at(-1)?.candidateRevision ?? 0;
    const event = assetIntakeDecisionEventSchema.parse({
      eventId: `asset-intake:${input.idempotencyKey}`,
      workspaceId: context.workspaceId,
      batchId: input.batchId,
      candidateId: input.candidateId,
      candidateRevision: candidateRevision + 1,
      action: 'rejected',
      reason: input.reason,
      actorId: context.userId,
      occurredAt: this.now(),
    });
    return this.repository.appendDecision({
      idempotencyKey: input.idempotencyKey,
      fingerprint: decisionFingerprint,
      event,
    });
  }

  private async batch(workspaceId: string, batchId: string) {
    const batch = await this.repository.getBatch(workspaceId, batchId);
    if (!batch) {
      throw new AssetIntakeError(
        'BATCH_NOT_FOUND',
        `Asset intake batch ${batchId} was not found.`,
      );
    }
    return batch;
  }

  private async factDraft(
    workspaceId: string,
    batchId: string,
    candidateId: string,
  ) {
    const batch = await this.batch(workspaceId, batchId);
    const candidate = batch.candidates.find(
      (item) => item.candidateId === candidateId,
    );
    if (!candidate) {
      throw new AssetIntakeError(
        'CANDIDATE_NOT_FOUND',
        `Asset intake candidate ${candidateId} was not found.`,
      );
    }
    if (candidate.objectKind !== 'store_fact') {
      throw new AssetIntakeError(
        'WRONG_OBJECT_CHANNEL',
        `Candidate ${candidateId} is not a StoreFact candidate.`,
      );
    }
    let draft = candidate.fact;
    let latestDecision: AssetIntakeDecisionEvent | null = null;
    let confirmedFactId: string | null = null;
    for (const event of await this.repository.listDecisions(
      workspaceId,
      batchId,
    )) {
      if (event.candidateId !== candidateId) continue;
      latestDecision = event;
      if (event.action === 'corrected') draft = event.correctedFact;
      if (event.action === 'confirmed') confirmedFactId ??= event.factId;
    }
    return {
      batch,
      draft,
      latestDecision,
      confirmedFactId,
      candidateRevision: latestDecision?.candidateRevision ?? 0,
    };
  }

  async correctFact(
    context: { workspaceId: string; userId: string },
    input: {
      batchId: string;
      candidateId: string;
      correctedFact: StoreFactCandidateDraft;
      idempotencyKey: string;
    },
  ) {
    const { candidateRevision } = await this.factDraft(
      context.workspaceId,
      input.batchId,
      input.candidateId,
    );
    const correctedFact = storeFactCandidateDraftSchema.parse(
      input.correctedFact,
    );
    if (correctedFact.source.kind !== 'user_confirmation') {
      throw new AssetIntakeError(
        'WRONG_OBJECT_CHANNEL',
        'A user correction must retain a user_confirmation source.',
      );
    }
    const decisionFingerprint = fingerprint({
      action: 'corrected',
      batchId: input.batchId,
      candidateId: input.candidateId,
      correctedFact,
    });
    const existing = await this.repository.decisionReceipt(
      context.workspaceId,
      input.idempotencyKey,
    );
    if (existing) {
      if (existing.fingerprint !== decisionFingerprint) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          `Idempotency key ${input.idempotencyKey} was reused.`,
        );
      }
      return existing.event;
    }
    const event = assetIntakeDecisionEventSchema.parse({
      eventId: `asset-intake:${input.idempotencyKey}`,
      workspaceId: context.workspaceId,
      batchId: input.batchId,
      candidateId: input.candidateId,
      candidateRevision: candidateRevision + 1,
      action: 'corrected',
      correctedFact,
      actorId: context.userId,
      occurredAt: this.now(),
    });
    return this.repository.appendDecision({
      idempotencyKey: input.idempotencyKey,
      fingerprint: decisionFingerprint,
      event,
    });
  }

  async confirmFact(
    context: { workspaceId: string; userId: string },
    input: {
      batchId: string;
      candidateId: string;
      factId: string;
      expectedFactRevision: number;
      idempotencyKey: string;
    },
  ) {
    const decisionFingerprint = fingerprint({
      action: 'confirmed',
      batchId: input.batchId,
      candidateId: input.candidateId,
      expectedFactRevision: input.expectedFactRevision,
      factId: input.factId,
    });
    const existing = await this.repository.decisionReceipt(
      context.workspaceId,
      input.idempotencyKey,
    );
    if (existing) {
      if (
        existing.fingerprint !== decisionFingerprint ||
        existing.event.action !== 'confirmed'
      ) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          `Idempotency key ${input.idempotencyKey} was reused.`,
        );
      }
      const confirmedEvent = existing.event;
      const replay = (
        await this.facts.history(context.workspaceId, confirmedEvent.factId)
      ).find((fact) => fact.revision === confirmedEvent.factRevision);
      if (!replay) throw new Error('Asset intake confirmation is corrupt.');
      return replay;
    }

    const {
      batch,
      draft,
      latestDecision,
      confirmedFactId,
      candidateRevision,
    } =
      await this.factDraft(
        context.workspaceId,
        input.batchId,
        input.candidateId,
      );
    if (
      batch.source.example ||
      batch.source.sourceWorkspaceId !== context.workspaceId
    ) {
      throw new AssetIntakeError(
        'EXAMPLE_FACT_ISOLATION',
        'Example or cross-workspace sources cannot enter StoreFact.',
      );
    }
    if (latestDecision?.action === 'confirmed') {
      throw new AssetIntakeError(
        'DECISION_CONFLICT',
        'This candidate was already confirmed and must be corrected before another fact revision.',
      );
    }
    if (confirmedFactId !== null && confirmedFactId !== input.factId) {
      throw new AssetIntakeError(
        'DECISION_CONFLICT',
        `This candidate is already bound to fact stream ${confirmedFactId}.`,
      );
    }
    const reservation = await this.repository.reserveFactConfirmation({
      workspaceId: context.workspaceId,
      batchId: input.batchId,
      candidateId: input.candidateId,
      factId: input.factId,
      expectedFactRevision: input.expectedFactRevision,
      expectedCandidateRevision: candidateRevision,
      idempotencyKey: input.idempotencyKey,
      fingerprint: decisionFingerprint,
      draft,
      recordedAt: this.now(),
      recordedBy: context.userId,
    });
    const history = await this.facts.history(
      context.workspaceId,
      input.factId,
    );
    const recovered = history.find(
      (fact) =>
        fact.revision === input.expectedFactRevision + 1 &&
        factDraftMatches(fact, reservation.draft) &&
        fact.recordedAt === reservation.recordedAt &&
        fact.recordedBy === reservation.recordedBy,
    );
    let fact = recovered;
    if (!fact) {
      try {
        fact = await this.facts.append({
          ...reservation.draft,
          factId: input.factId,
          workspaceId: context.workspaceId,
          recordedAt: reservation.recordedAt,
          recordedBy: reservation.recordedBy,
          expectedRevision: input.expectedFactRevision,
        });
      } catch (error) {
        if (error instanceof StoreFactRevisionConflictError) {
          await this.repository.abortFactConfirmation(reservation);
        }
        throw error;
      }
    }
    const event = assetIntakeDecisionEventSchema.parse({
      eventId: `asset-intake:${input.idempotencyKey}`,
      workspaceId: context.workspaceId,
      batchId: input.batchId,
      candidateId: input.candidateId,
      candidateRevision: reservation.expectedCandidateRevision + 1,
      action: 'confirmed',
      factId: fact.factId,
      factRevision: fact.revision,
      actorId: context.userId,
      occurredAt: reservation.recordedAt,
    });
    await this.repository.appendDecision({
      idempotencyKey: input.idempotencyKey,
      fingerprint: decisionFingerprint,
      event,
    });
    return fact;
  }

  missingFactKeys(input: {
    bundle: ContextBundle;
    requiredKeys: readonly string[];
  }) {
    const activeKeys = new Set(
      Object.entries(input.bundle.dimensions.store_facts_assets)
        .filter(([, value]) => value.sourceRef.startsWith('store_fact:'))
        .map(([key]) => key),
    );
    return [...new Set(input.requiredKeys)]
      .filter((key) => !activeKeys.has(key))
      .sort((left, right) => left.localeCompare(right));
  }
}

function assistedPriceAmount(text: string) {
  const values = new Set<number>();
  const pattern =
    /(?:[¥￥]\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:元|CNY|RMB))/giu;
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[1] ?? match[2]);
    if (Number.isFinite(amount) && amount >= 0) values.add(amount);
  }
  if (values.size !== 1) {
    throw new AssetIntakeError(
      'ASSISTED_INPUT_INVALID',
      'Assisted price intake requires exactly one recognizable CNY amount.',
    );
  }
  return [...values][0]!;
}

export function confirmedFactReferenceFromBundle(
  fact: StoreFact,
  bundle: ContextBundle,
) {
  if (fact.workspaceId !== bundle.workspaceId) {
    throw new AssetIntakeError(
      'EXAMPLE_FACT_ISOLATION',
      'A fact reference cannot cross workspaces.',
    );
  }
  if (
    !bundle.referencedFactRevisions.some(
      (reference) =>
        reference.factId === fact.factId &&
        reference.revision === fact.revision,
    )
  ) {
    throw new AssetIntakeError(
      'CANDIDATE_NOT_FOUND',
      'The frozen ContextBundle does not reference this fact revision.',
    );
  }
  return confirmedFactReferenceSchema.parse({
    factId: fact.factId,
    factRevision: fact.revision,
    taskId: bundle.taskId,
    contextBundleId: bundle.bundleId,
    contextBundleRevision: bundle.revision,
  });
}
