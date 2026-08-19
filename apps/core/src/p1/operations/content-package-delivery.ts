import { randomUUID } from 'node:crypto';
import {
  approvalReceiptSchema,
  buildOutcomeEvidenceIdempotencyKey,
  contentPackageDeliveryAttemptId,
  isForbiddenNoActivityEncoding,
  mapContentPackageResultKindToOutcomeSignal,
  pendingApprovalRequestSchema,
} from '@meiye/contracts';
import type {
  ApprovalBinding,
  ApprovalReceipt,
  ContentPackage,
  ContentPackageDeliveryCapability,
  ContentPackageDeliveryEvent,
  ContentPackageResultSignal,
  ContextInvalidationEvent,
} from '@meiye/contracts';

import type { HarnessPolicyInput } from '../harness/policy-gates.js';
import { preparedAttemptRunIdForTask } from '../harness/prepared-attempt-run-id.js';
import {
  ApprovalReceiptError,
  ContentPackageApprovalService,
  approvalRequestMatchesBinding,
  type ApprovalReceiptRepository,
} from './content-package-approval.js';
import { isApprovalReceiptActiveAt } from './approval-receipt-validity.js';
import type { OperationsRepository } from './repository.js';
import type {
  OperationContext,
  OperationsAuditEvent,
  OperationsWorkspaceState,
} from './types.js';
import type { ContextBundleRepository } from './context-bundle-repository.js';
import type { ContextSourceRevisionRepository } from './context-source-revisions.js';
import type { ContextInvalidationSink } from './context-invalidation.js';
import type { StoreFactLedger } from './store-fact-ledger.js';
import { contentPackageVersionVisibleText } from './content-package-visible-copy-policy.js';

export interface ContentPackageApprovalPolicyPort {
  resolve(input: {
    contentPackage: ContentPackage;
    intendedUse: 'paid_promotion' | 'public_content';
    variantVersionId: string;
  }): Promise<{
    contextBundle: ApprovalBinding['contextBundle'];
    policy: Pick<
      HarnessPolicyInput,
      | 'brief'
      | 'bundle'
      | 'candidate'
      | 'identityRefs'
      | 'rightsRefs'
      | 'sourceRefs'
      | 'trustedFactClaims'
    >;
  }>;
}

export interface ContentPackagePublishPort {
  publish(input: {
    accountId: string;
    approvalReceiptId: string;
    contentPackage: ContentPackage;
    deliveryAttemptId: string;
    idempotencyKey: string;
    platform: ApprovalBinding['platform'];
    variantVersionId: string;
  }): Promise<{
    platformUrl?: string;
    providerReceiptId: string;
    status: 'failed' | 'published' | 'unknown';
  }>;
}

export interface LegacyDeliveryProjectionPort {
  list(contentPackage: ContentPackage): Promise<ContentPackageDeliveryEvent[]>;
}

export class ContentPackageDeliveryError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | 'APPROVAL_CONTEXT_UNAVAILABLE'
      | 'ASSISTED_HANDOFF_REQUIRES_EXPORT'
      | 'AUTOMATIC_PUBLISH_UNAVAILABLE'
      | 'CONTENT_PACKAGE_NOT_FOUND'
      | 'CONTENT_PACKAGE_NOT_PUBLISHED'
      | 'CONTENT_PACKAGE_REVISION_CONFLICT'
      | 'CONTENT_PACKAGE_VARIANT_NOT_FOUND'
      | 'RESULT_SIGNAL_NOTE_REJECTED'
      | 'RESULT_SIGNAL_OCCURRED_AT_OUT_OF_RANGE'
      | 'RESULT_SIGNAL_IDEMPOTENCY_CONFLICT'
      | 'RESULT_SIGNAL_SUPERSEDES_NOT_FOUND'
      | 'RESULT_SIGNAL_FEEDBACK_NO_ACTIVITY_FORBIDDEN',
    message: string
  ) {
    super(message);
    this.name = 'ContentPackageDeliveryError';
    this.status = this.code === 'CONTENT_PACKAGE_NOT_FOUND' ? 404 : 409;
  }
}

/**
 * How far back 「这是昨天的」 may reach. 30 days covers 昨天 and the merchant who
 * catches up on a week of walk-ins, and stops there: a signal older than the
 * weekly review window can only pollute the aggregates it would land in.
 */
export const RESULT_SIGNAL_BACKDATE_WINDOW_DAYS = 30;

const RESULT_SIGNAL_NOTE_MAX_LENGTH = 120;

/**
 * The merchant clock is merchant-supplied, so it is bounded by the write clock
 * rather than by the schema: the future is not a thing that happened, and a
 * date older than the review window silently rewrites the weekly aggregates it
 * should never have entered. Format stays a contracts concern; the window is
 * only knowable here, where the write clock is.
 */
export function assertResultSignalOccurredAtInWindow(
  occurredAt: string,
  recordedAt: string
) {
  const at = Date.parse(occurredAt);
  const now = Date.parse(recordedAt);
  if (Number.isNaN(at)) {
    throw new ContentPackageDeliveryError(
      'RESULT_SIGNAL_OCCURRED_AT_OUT_OF_RANGE',
      'The recorded time is not a valid timestamp.'
    );
  }
  if (at > now) {
    throw new ContentPackageDeliveryError(
      'RESULT_SIGNAL_OCCURRED_AT_OUT_OF_RANGE',
      'A result signal cannot be recorded as happening in the future.'
    );
  }
  if (at < now - RESULT_SIGNAL_BACKDATE_WINDOW_DAYS * 86_400_000) {
    throw new ContentPackageDeliveryError(
      'RESULT_SIGNAL_OCCURRED_AT_OUT_OF_RANGE',
      `A result signal can be backdated by at most ${RESULT_SIGNAL_BACKDATE_WINDOW_DAYS} days.`
    );
  }
}

/**
 * Same rule the chip panel applies before it sends (results/
 * outcome-observation-model.ts): a 备注 is a short private reminder, never a
 * pasted chat body and never a customer's contact details. The browser guard is
 * a courtesy; this one is the rule, because the command endpoint is reachable
 * without it.
 */
export function isUnsafeResultSignalNote(note: string | undefined): boolean {
  if (!note) return false;
  const trimmed = note.trim();
  if (trimmed.length > RESULT_SIGNAL_NOTE_MAX_LENGTH) return true;
  if (/(微信|手机|电话|1[3-9]\d{9})/u.test(trimmed)) return true;
  if (/@/u.test(trimmed) && /\./u.test(trimmed)) return true;
  return false;
}

export class ContentPackageDeliveryService implements ContextInvalidationSink {
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(
    private readonly repository: OperationsRepository,
    private readonly dependencies: {
      approvalPolicy: ContentPackageApprovalPolicyPort;
      capability(platform: ApprovalBinding['platform']): Promise<ContentPackageDeliveryCapability>;
      publisher: ContentPackagePublishPort;
      legacy?: LegacyDeliveryProjectionPort;
      clock?: () => string;
      createId?: () => string;
    }
  ) {
    this.now = dependencies.clock ?? (() => new Date().toISOString());
    this.id = dependencies.createId ?? randomUUID;
  }

  async approve(
    context: OperationContext,
    input: Omit<
      ApprovalBinding,
      'contentRevision' | 'contextBundle' | 'workspaceId'
    > & {
      expectedRevision: number;
      idempotencyKey: string;
      requestId: string;
    }
  ) {
    const contentPackage = await this.requirePackage(
      context,
      input.packageId,
      input.expectedRevision
    );
    const contentRevision = currentContentRevision(
      contentPackage,
      input.platform,
      input.variantVersionId
    );
    const resolved = await this.dependencies.approvalPolicy.resolve({
      contentPackage,
      intendedUse:
        input.actionKind === 'paid_action'
          ? 'paid_promotion'
          : 'public_content',
      variantVersionId: input.variantVersionId,
    });
    const approvals = this.approvals(context, input.expectedRevision);
    return approvals.approve({
      accountId: input.accountId,
      actionKind: input.actionKind,
      actionScheduledAt: input.actionScheduledAt,
      actorId: context.userId,
      contentRevision,
      contextBundle: resolved.contextBundle,
      cost: input.cost,
      idempotencyKey: input.idempotencyKey,
      packageId: contentPackage.id,
      platform: input.platform,
      purpose: input.purpose,
      requestId: input.requestId,
      variantVersionId: input.variantVersionId,
      workspaceId: context.workspaceId,
    });
  }

  async deliver(
    context: OperationContext,
    input: Omit<ApprovalBinding, 'contentRevision' | 'contextBundle' | 'workspaceId'> & {
      expectedRevision: number;
      receiptId?: string;
    }
  ) {
    const contentPackage = await this.requirePackage(
      context,
      input.packageId,
      input.expectedRevision
    );
    const contentRevision = currentContentRevision(
      contentPackage,
      input.platform,
      input.variantVersionId
    );
    const capability = await this.dependencies.capability(input.platform);
    if (capability.mode === 'unavailable') {
      throw new ContentPackageDeliveryError(
        'AUTOMATIC_PUBLISH_UNAVAILABLE',
        capability.reason
      );
    }
    const resolved = await this.dependencies.approvalPolicy.resolve({
      contentPackage,
      intendedUse:
        input.actionKind === 'paid_action'
          ? 'paid_promotion'
          : 'public_content',
      variantVersionId: input.variantVersionId,
    });
    const approvalRepository = this.approvalRepository(context);
    const approvals = new ContentPackageApprovalService(
      approvalRepository,
      this.now
    );
    if (capability.mode === 'assisted') {
      const receipt = await approvals.authorize({
        ...input,
        contentRevision,
        contextBundle: resolved.contextBundle,
        currentContentRevision: contentRevision,
        policy: resolved.policy,
        workspaceId: context.workspaceId,
      });
      const exportReceipt = [...contentPackage.exportReceipts]
        .reverse()
        .find(
          (receipt) =>
            receipt.platform === input.platform &&
            receipt.variantVersionId === input.variantVersionId &&
            receipt.status === 'succeeded'
        );
      if (!exportReceipt) {
        throw new ContentPackageDeliveryError(
          'ASSISTED_HANDOFF_REQUIRES_EXPORT',
          'Assisted handoff requires a successful export for the exact platform version.'
        );
      }
      const deliveryAttemptId = contentPackageDeliveryAttemptId(receipt.id);
      return this.appendAssistedDeliveryEvent(context, contentPackage.id, receipt, {
        actorId: context.userId,
        artifactReceiptId: exportReceipt.id,
        deliveryIdentity: {
          approvalReceiptId: receipt.id,
          deliveryAttemptId,
          schema: 'approval_receipt_v1',
        },
        id: this.id(),
        occurredAt: this.now(),
        platform: input.platform,
        source: 'native',
        type: 'assisted_handoff_prepared',
        variantVersionId: input.variantVersionId,
      });
    }
    const receipt = await approvals.authorize({
      ...input,
      contentRevision,
      contextBundle: resolved.contextBundle,
      currentContentRevision: contentRevision,
      policy: resolved.policy,
      workspaceId: context.workspaceId,
    });
    const deliveryAttemptId = contentPackageDeliveryAttemptId(receipt.id);
    await approvals.consume({
      actorId: context.userId,
      externalEffectId: deliveryAttemptId,
      receiptId: receipt.id,
    });
    let result: Awaited<ReturnType<ContentPackagePublishPort['publish']>>;
    try {
      result = await this.dependencies.publisher.publish({
        accountId: input.accountId,
        approvalReceiptId: receipt.id,
        contentPackage,
        deliveryAttemptId,
        idempotencyKey: deliveryAttemptId,
        platform: input.platform,
        variantVersionId: input.variantVersionId,
      });
    } catch (error) {
      await approvalRepository.restoreAfterPublishFailure(receipt.id);
      throw error;
    }
    if (result.status === 'failed') {
      await approvalRepository.restoreAfterPublishFailure(receipt.id);
    }
    return this.appendDeliveryEvent(context, contentPackage.id, {
      actorId: context.userId,
      deliveryIdentity: {
        approvalReceiptId: receipt.id,
        deliveryAttemptId,
        schema: 'approval_receipt_v1',
      },
      id: this.id(),
      occurredAt: this.now(),
      platform: input.platform,
      ...(result.platformUrl ? { platformUrl: result.platformUrl } : {}),
      providerReceiptId: result.providerReceiptId,
      source: 'native',
      status: result.status,
      type: 'automatic_publish_result',
      variantVersionId: input.variantVersionId,
    });
  }

  async recordManualResult(
    context: OperationContext,
    input: {
      accountDisplayLabel?: string;
      expectedRevision: number;
      note?: string;
      packageId: string;
      platform: ApprovalBinding['platform'];
      platformUrl?: string;
      publishedAt?: string;
      status: 'failed' | 'published' | 'unknown';
      variantVersionId: string;
    }
  ) {
    // Load without OCC first so duplicate submits can short-circuit on the
    // existing publication record (P1-D2 idempotency).
    const contentPackage = await this.requirePackage(
      context,
      input.packageId
    );
    currentContentRevision(
      contentPackage,
      input.platform,
      input.variantVersionId
    );
    const existing = (contentPackage.deliveryEvents ?? []).find(
      (event) =>
        event.type === 'manual_publish_result' &&
        event.platform === input.platform &&
        event.variantVersionId === input.variantVersionId &&
        event.status === input.status &&
        (event.accountDisplayLabel ?? '') ===
          (input.accountDisplayLabel ?? '') &&
        (event.platformUrl ?? '') === (input.platformUrl ?? '') &&
        (event.note ?? '') === (input.note ?? '') &&
        (input.publishedAt === undefined ||
          event.occurredAt === input.publishedAt)
    );
    if (existing) {
      return structuredClone(contentPackage);
    }
    // New write still requires the caller's expected revision.
    await this.requirePackage(
      context,
      input.packageId,
      input.expectedRevision
    );
    const assistedDelivery = [...(contentPackage.deliveryEvents ?? [])]
      .reverse()
      .find(
        (event) =>
          event.type === 'assisted_handoff_prepared' &&
          event.platform === input.platform &&
          event.variantVersionId === input.variantVersionId &&
          Boolean(event.artifactReceiptId) &&
          Boolean(event.deliveryIdentity)
      );
    return this.appendDeliveryEvent(context, contentPackage.id, {
      actorId: context.userId,
      ...(assistedDelivery?.type === 'assisted_handoff_prepared' &&
      assistedDelivery.artifactReceiptId &&
      assistedDelivery.deliveryIdentity
        ? {
            afterRevision: contentPackage.revision + 1,
            artifactReceiptId: assistedDelivery.artifactReceiptId,
            beforeRevision: contentPackage.revision,
            deliveryIdentity: assistedDelivery.deliveryIdentity,
          }
        : {}),
      id: this.id(),
      ...(input.accountDisplayLabel
        ? { accountDisplayLabel: input.accountDisplayLabel }
        : {}),
      ...(input.note ? { note: input.note } : {}),
      occurredAt: input.publishedAt ?? this.now(),
      platform: input.platform,
      ...(input.platformUrl ? { platformUrl: input.platformUrl } : {}),
      source: 'native',
      status: input.status,
      type: 'manual_publish_result',
      variantVersionId: input.variantVersionId,
    });
  }

  async timeline(context: OperationContext, packageId: string) {
    const contentPackage = await this.requirePackage(context, packageId);
    const legacy = this.dependencies.legacy
      ? await this.dependencies.legacy.list(contentPackage)
      : [];
    return [...(contentPackage.deliveryEvents ?? []), ...legacy].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt)
    );
  }

  async handle(event: ContextInvalidationEvent) {
    await this.approvals({
      actor: 'worker',
      correlationId: event.eventId,
      userId: 'system:context-invalidation',
      workspaceId: event.workspaceId,
    }).handle(event);
  }

  async recordResultSignal(
    context: OperationContext,
    input: {
      action?: 'record' | 'correct' | 'withdraw';
      expectedRevision: number;
      kind: ContentPackageResultSignal['kind'];
      note?: string;
      occurredAt?: string;
      packageId: string;
      quantity?: number;
      sourceRef?: string;
      supersedesSignalId?: string;
    }
  ) {
    const action = input.action ?? 'record';
    // Load without OCC first so duplicate submits can short-circuit (same
    // pattern as recordManualResult / P1-D2 idempotency).
    const contentPackage = await this.requirePackage(context, input.packageId);
    if (!hasPublishedDelivery(contentPackage)) {
      throw new ContentPackageDeliveryError(
        'CONTENT_PACKAGE_NOT_PUBLISHED',
        'Result signals can only be recorded after a published delivery event.'
      );
    }
    if (isUnsafeResultSignalNote(input.note)) {
      throw new ContentPackageDeliveryError(
        'RESULT_SIGNAL_NOTE_REJECTED',
        'A result note must stay a short reminder and must not carry contact details.'
      );
    }
    const domainSignal = mapContentPackageResultKindToOutcomeSignal(input.kind);
    if (
      domainSignal &&
      isForbiddenNoActivityEncoding(domainSignal, input.note)
    ) {
      throw new ContentPackageDeliveryError(
        'RESULT_SIGNAL_FEEDBACK_NO_ACTIVITY_FORBIDDEN',
        'no_activity must use kind=no_activity; do not encode via feedback notes.'
      );
    }
    if (
      (action === 'correct' || action === 'withdraw') &&
      !input.supersedesSignalId
    ) {
      throw new ContentPackageDeliveryError(
        'RESULT_SIGNAL_SUPERSEDES_NOT_FOUND',
        `${action} requires supersedesSignalId.`
      );
    }

    // 「这是昨天的」 backdates the signal's own clock. The row is still written
    // now, so the package's updatedAt and its audit event keep the write time —
    // a backdated signal must never make the package look older than it is.
    const recordedAt = this.now();
    if (input.occurredAt) {
      assertResultSignalOccurredAtInWindow(input.occurredAt, recordedAt);
    }
    const observedAt = input.occurredAt ?? recordedAt;

    // Idempotency key = contentPackage id + signal + observedAt/sourceRef.
    // Revision is the exact package binding snapshot at write time; lookup
    // matches on signal identity so retries after success stay idempotent.
    {
      const existing = contentPackage.resultSignals ?? [];
      const duplicate = existing.find((row) =>
        resultSignalMatchesWriteIdentity(row, {
          ...input,
          action,
          observedAt,
        }, contentPackage.id)
      );
      if (duplicate) {
        // An idempotent replay may quote the revision it originally consumed
        // (row binding) or the current one it just re-read; anything else is
        // a stale caller and keeps the OCC contract.
        if (
          input.expectedRevision !== duplicate.contentPackageRevision &&
          input.expectedRevision !== contentPackage.revision
        ) {
          throw new ContentPackageDeliveryError(
            'CONTENT_PACKAGE_REVISION_CONFLICT',
            'ContentPackage revision changed. Refresh and retry.'
          );
        }
        if (!resultSignalPayloadMatches(duplicate, input)) {
          throw new ContentPackageDeliveryError(
            'RESULT_SIGNAL_IDEMPOTENCY_CONFLICT',
            'A different result signal already exists for this idempotency key.'
          );
        }
        return structuredClone(contentPackage);
      }
    }

    // New write still requires the caller's expected revision (exact binding).
    await this.requirePackage(
      context,
      input.packageId,
      input.expectedRevision
    );

    return this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository) => {
        const state = await requireState(repository, context.workspaceId);
        const index = state.contentPackages.findIndex(
          (candidate) => candidate.id === contentPackage.id
        );
        const current = state.contentPackages[index]!;
        const existing = current.resultSignals ?? [];

        if (action === 'correct' || action === 'withdraw') {
          const prior = existing.find(
            (row) => row.id === input.supersedesSignalId
          );
          if (!prior) {
            throw new ContentPackageDeliveryError(
              'RESULT_SIGNAL_SUPERSEDES_NOT_FOUND',
              'The supersedesSignalId does not exist on this ContentPackage.'
            );
          }
        }

        // Re-check idempotency under the lock for concurrent record races.
        {
          const duplicate = existing.find((row) =>
            resultSignalMatchesWriteIdentity(row, {
              ...input,
              action,
              observedAt,
            }, current.id)
          );
          if (duplicate) {
            if (
              input.expectedRevision !== duplicate.contentPackageRevision &&
              input.expectedRevision !== current.revision
            ) {
              throw new ContentPackageDeliveryError(
                'CONTENT_PACKAGE_REVISION_CONFLICT',
                'ContentPackage revision changed. Refresh and retry.'
              );
            }
            if (!resultSignalPayloadMatches(duplicate, input)) {
              throw new ContentPackageDeliveryError(
                'RESULT_SIGNAL_IDEMPOTENCY_CONFLICT',
                'A different result signal already exists for this idempotency key.'
              );
            }
            return structuredClone(current);
          }
        }

        // The earlier check is only an optimistic fast-fail. The authoritative
        // OCC comparison must happen after acquiring the workspace lock so two
        // distinct writes cannot both consume the same package revision.
        if (current.revision !== input.expectedRevision) {
          throw new ContentPackageDeliveryError(
            'CONTENT_PACKAGE_REVISION_CONFLICT',
            'ContentPackage revision changed. Refresh and retry.'
          );
        }

        const signal: ContentPackageResultSignal = {
          actorId: context.userId,
          contentPackageRevision: current.revision,
          id: this.id(),
          kind: input.kind,
          ...(input.note ? { note: input.note } : {}),
          occurredAt: observedAt,
          ...(input.quantity ? { quantity: input.quantity } : {}),
          source: 'merchant_recorded',
          ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
          status: action === 'withdraw' ? 'withdrawn' : 'active',
          ...(input.supersedesSignalId
            ? { supersedesSignalId: input.supersedesSignalId }
            : {}),
        };
        const updated = {
          ...current,
          resultSignals: [...existing, signal],
          revision: current.revision + 1,
          updatedAt: recordedAt,
        };
        state.contentPackages[index] = updated;
        state.auditEvents.push(
          auditEvent(
            this.id,
            context,
            recordedAt,
            action === 'withdraw'
              ? 'content_package.result_signal_withdrawn'
              : action === 'correct'
                ? 'content_package.result_signal_corrected'
                : 'content_package.result_signal_recorded',
            current.id,
            {
              contentPackageRevision: current.revision,
              signalId: signal.id,
            }
          )
        );
        await repository.saveWorkspace(state);
        return structuredClone(updated);
      }
    );
  }

  async results(context: OperationContext, packageId: string) {
    const contentPackage = await this.requirePackage(context, packageId);
    const history = contentPackage.resultSignals ?? [];
    const latest = projectActiveResultSignals(history);
    const quarantined = history.filter(
      (signal) => signal.contentPackageRevision === 'unknown'
    );
    const merchant = latest.filter(
      (signal) => signal.source === 'merchant_recorded'
    );
    const verified = latest.filter(
      (signal) => signal.source === 'verified_adapter'
    );
    // Inferred is a pure projection of active merchant rows — temporal
    // correlation only, never written as a second ledger (V31-19).
    // no_activity is merchant-only and must not spawn inferred absence.
    const inferred: ContentPackageResultSignal[] = hasPublishedDelivery(
      contentPackage
    )
      ? merchant
          .filter((signal) => signal.kind !== 'no_activity')
          .map((signal) => ({
            ...signal,
            actorId: 'system:temporal-association',
            id: `inferred:${signal.id}`,
            note: '仅时间与内容关联，不代表由该内容导致。',
            source: 'inferred_temporal' as const,
            status: 'active' as const,
          }))
      : [];
    return {
      ladder: resultLadder(contentPackage, merchant),
      signals: {
        inferred,
        merchant,
        quarantined,
        verified,
        history,
      },
    };
  }

  async recordResultReviewAction(
    context: OperationContext,
    input: {
      action: 'change_cta' | 'change_platform' | 'continue_series' | 'stop_series';
      expectedRevision: number;
      packageId: string;
    }
  ) {
    const contentPackage = await this.requirePackage(
      context,
      input.packageId,
      input.expectedRevision
    );
    const event = {
      action: input.action,
      actorId: context.userId,
      id: this.id(),
      occurredAt: this.now(),
    } as const;
    return this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository) => {
        const state = await requireState(repository, context.workspaceId);
        const index = state.contentPackages.findIndex(
          (candidate) => candidate.id === contentPackage.id
        );
        const current = state.contentPackages[index]!;
        const updated = {
          ...current,
          resultReviewActions: [
            ...(current.resultReviewActions ?? []),
            event,
          ],
          revision: current.revision + 1,
          updatedAt: event.occurredAt,
        };
        state.contentPackages[index] = updated;
        state.auditEvents.push(
          auditEvent(
            this.id,
            context,
            event.occurredAt,
            `content_package.result_review_${event.action}`,
            current.id
          )
        );
        await repository.saveWorkspace(state);
        return structuredClone(updated);
      }
    );
  }

  private approvals(context: OperationContext, expectedRevision?: number) {
    return new ContentPackageApprovalService(
      this.approvalRepository(context, expectedRevision),
      this.now
    );
  }

  private approvalRepository(
    context: OperationContext,
    expectedRevision?: number
  ) {
    return new NestedApprovalReceiptRepository(
      this.repository,
      context,
      this.now,
      this.id,
      expectedRevision
    );
  }

  private async requirePackage(
    context: OperationContext,
    packageId: string,
    expectedRevision?: number
  ) {
    if (!(await this.repository.hasMembership(context.userId, context.workspaceId))) {
      throw new ContentPackageDeliveryError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'ContentPackage was not found.'
      );
    }
    const state = await this.repository.loadWorkspace(context.workspaceId);
    const contentPackage = state?.contentPackages.find(
      (candidate) => candidate.id === packageId
    );
    if (!contentPackage) {
      throw new ContentPackageDeliveryError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'ContentPackage was not found.'
      );
    }
    if (
      expectedRevision !== undefined &&
      contentPackage.revision !== expectedRevision
    ) {
      // Revision §7 calls this occ_conflict; this repository's canonical event is revision_conflict.
      await this.repository.recordContentPackageRevisionConflict({
        actorId: context.userId,
        correlationId: context.correlationId,
        currentRevision: contentPackage.revision,
        expectedRevision,
        occurredAt: this.now(),
        packageId: contentPackage.id,
        workspaceId: context.workspaceId,
      });
      throw new ContentPackageDeliveryError(
        'CONTENT_PACKAGE_REVISION_CONFLICT',
        'ContentPackage revision changed. Refresh and retry.'
      );
    }
    return contentPackage;
  }

  private appendDeliveryEvent(
    context: OperationContext,
    packageId: string,
    event: ContentPackageDeliveryEvent
  ) {
    return this.repository.withWorkspaceLock(context.workspaceId, async (repository) => {
      const state = await requireState(repository, context.workspaceId);
      const index = state.contentPackages.findIndex(
        (candidate) => candidate.id === packageId
      );
      const current = state.contentPackages[index];
      if (!current) {
        throw new ContentPackageDeliveryError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'ContentPackage was not found.'
        );
      }
      const updated = {
        ...current,
        deliveryEvents: [...(current.deliveryEvents ?? []), event],
        revision: current.revision + 1,
        updatedAt: event.occurredAt,
      };
      state.contentPackages[index] = updated;
      state.auditEvents.push(
        auditEvent(this.id, context, event.occurredAt, `content_package.${event.type}`, packageId)
      );
      await repository.saveWorkspace(state);
      return structuredClone(updated);
    });
  }

  private appendAssistedDeliveryEvent(
    context: OperationContext,
    packageId: string,
    authorizedReceipt: ApprovalReceipt,
    event: Extract<
      ContentPackageDeliveryEvent,
      { type: 'assisted_handoff_prepared' }
    >
  ) {
    return this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository) => {
        const state = await requireState(repository, context.workspaceId);
        const packageIndex = state.contentPackages.findIndex(
          (candidate) => candidate.id === packageId
        );
        const current = state.contentPackages[packageIndex];
        if (!current) {
          throw new ContentPackageDeliveryError(
            'CONTENT_PACKAGE_NOT_FOUND',
            'ContentPackage was not found.'
          );
        }
        const receiptIndex = (current.approvalReceipts ?? []).findIndex(
          (receipt) => receipt.id === authorizedReceipt.id
        );
        const receipt = (current.approvalReceipts ?? [])[receiptIndex];
        if (!receipt) {
          throw new ApprovalReceiptError(
            'APPROVAL_NOT_FOUND',
            'The ApprovalReceipt was not found.'
          );
        }
        if (
          !isApprovalReceiptActiveAt(receipt, event.occurredAt) ||
          receipt.payloadFingerprint !== authorizedReceipt.payloadFingerprint
        ) {
          throw new ApprovalReceiptError(
            'APPROVAL_NOT_ACTIVE',
            'The ApprovalReceipt is no longer active.'
          );
        }
        const deliveryAttemptId = contentPackageDeliveryAttemptId(receipt.id);
        const receipts = [...(current.approvalReceipts ?? [])];
        receipts[receiptIndex] = approvalReceiptSchema.parse({
          ...receipt,
          events: [
            ...receipt.events,
            {
              actorId: context.userId,
              eventId: `${receipt.id}:consumed`,
              externalEffectId: deliveryAttemptId,
              occurredAt: event.occurredAt,
              type: 'consumed',
            },
          ],
          status: 'consumed',
        });
        const updated = {
          ...current,
          approvalReceipts: receipts,
          deliveryEvents: [...(current.deliveryEvents ?? []), event],
          revision: current.revision + 1,
          updatedAt: event.occurredAt,
        };
        state.contentPackages[packageIndex] = updated;
        state.auditEvents.push(
          auditEvent(
            this.id,
            context,
            event.occurredAt,
            `content_package.${event.type}`,
            packageId
          )
        );
        await repository.saveWorkspace(state);
        return structuredClone(updated);
      }
    );
  }
}

export class ContextBundleApprovalPolicyResolver
  implements ContentPackageApprovalPolicyPort
{
  constructor(
    private readonly bundles: Pick<ContextBundleRepository, 'get'>,
    private readonly live?: {
      sourceRevisions: Pick<ContextSourceRevisionRepository, 'current'>;
      facts: Pick<StoreFactLedger, 'history'>;
      now?: () => string;
    }
  ) {}

  async resolve(input: {
    contentPackage: ContentPackage;
    intendedUse: 'paid_promotion' | 'public_content';
    variantVersionId: string;
  }) {
    const workflowId = input.contentPackage.source.workflowId;
    let bundle = workflowId
      ? await this.bundles.get(
          input.contentPackage.workspaceId,
          `context-${workflowId}`
        )
      : null;
    if (!bundle && workflowId) {
      // V31-56: a merchant-confirmed run executes — and freezes its
      // ContextBundle — under `<taskId>:plan-r<revision>`, while the package's
      // source keeps the base task id for task-identity consumers. The
      // package's workflowRevision is that frozen plan revision.
      const attemptRunId = preparedAttemptRunIdForTask(
        workflowId,
        input.contentPackage.source.workflowRevision ?? 0
      );
      bundle = attemptRunId
        ? await this.bundles.get(
            input.contentPackage.workspaceId,
            `context-${attemptRunId}`
          )
        : null;
    }
    if (!bundle) {
      throw new ContentPackageDeliveryError(
        'APPROVAL_CONTEXT_UNAVAILABLE',
        'The frozen ContextBundle for this content revision is unavailable.'
      );
    }
    if (this.live) {
      const [sourceRevisions, factHistories] = await Promise.all([
        this.live.sourceRevisions.current(input.contentPackage.workspaceId),
        Promise.all(
          bundle.referencedFactRevisions.map((reference) =>
            this.live!.facts.history(
              input.contentPackage.workspaceId,
              reference.factId
            )
          )
        ),
      ]);
      const identityChanged =
        sourceRevisions.identity !== bundle.sourceRevisions.identity;
      const at = Date.parse(this.live.now?.() ?? new Date().toISOString());
      const factChanged = factHistories.some((history, index) => {
        const current = history.at(-1);
        const frozen = bundle.referencedFactRevisions[index];
        return (
          !current ||
          current.revision !== frozen?.revision ||
          Date.parse(current.effectiveFrom) > at ||
          (current.expiresAt !== null && Date.parse(current.expiresAt) <= at)
        );
      });
      if (identityChanged || factChanged) {
        throw new ContentPackageDeliveryError(
          'APPROVAL_CONTEXT_UNAVAILABLE',
          'Facts or identity changed after this ContentPackage was frozen. Recompile and review a new version before delivery.'
        );
      }
    }
    const variant = input.contentPackage.variants.find((candidate) =>
      candidate.versions.some((version) => version.id === input.variantVersionId)
    );
    const version =
      input.contentPackage.versions.find(
        (candidate) => candidate.id === input.variantVersionId
      ) ??
      variant?.versions.find(
        (candidate) => candidate.id === input.variantVersionId
      );
    if (!version) {
      throw new ContentPackageDeliveryError(
        'CONTENT_PACKAGE_VARIANT_NOT_FOUND',
        'The current platform version was not found.'
      );
    }
    const factValues = Object.entries(bundle.dimensions.store_facts_assets);
    const identityValues = Object.values(
      bundle.dimensions.expression_identity
    ).filter((value) => value.sourceRef.startsWith('marketing_identity:'));
    const expressionIdentityRef = identityValues[0]?.sourceRef;
    const trustedFactClaims = factValues.flatMap(([key, value]) => {
      const kind = policyFactKind(key);
      return kind
        ? [
            {
              kind,
              sourceRef: value.sourceRef,
              value: JSON.stringify(value.value),
            },
          ]
        : [];
    });
    return {
      contextBundle: {
        bundleId: bundle.bundleId,
        hash: bundle.hash,
        revision: bundle.revision,
      },
      policy: {
        brief: {},
        bundle: {
          revision: bundle.revision,
          workspaceId: bundle.workspaceId,
        },
        candidate: {
          assetRefs: [...version.orderedAssetIds],
          candidateId: version.id,
          factClaims: [],
          intendedUse: input.intendedUse,
          ...(expressionIdentityRef ? { expressionIdentityRef } : {}),
          visibleText: contentPackageVersionVisibleText(version),
          workspaceId: bundle.workspaceId,
        },
        identityRefs: identityValues.map((value) => ({
          id: value.sourceRef,
          status: 'registered' as const,
          workspaceId: bundle.workspaceId,
        })),
        rightsRefs: version.orderedAssetIds.map((assetId) => ({
          allowedUses: [input.intendedUse],
          assetId,
          status:
            input.contentPackage.rights.state === 'authorized'
              ? ('authorized' as const)
              : ('withdrawn' as const),
          workspaceId: bundle.workspaceId,
        })),
        sourceRefs: bundle.referencedFactRevisions.map((fact) => ({
          id: `store_fact:${fact.factId}:${fact.revision}`,
          revision: fact.revision,
          status: 'current' as const,
          workspaceId: bundle.workspaceId,
        })),
        trustedFactClaims,
      },
    };
  }
}

export function contentPackageDeliveryCapability(input: {
  accountAndScopeVerified: boolean;
  callbackVerified: boolean;
  exportAvailable: boolean;
  liveAdapter: boolean;
  platform: ApprovalBinding['platform'];
  publishRecoveryVerified: boolean;
  snapshotSource: 'content_package_revision' | 'legacy_handoff';
  submitAndPollVerified: boolean;
}): ContentPackageDeliveryCapability {
  const automatic =
    input.liveAdapter &&
    input.snapshotSource === 'content_package_revision' &&
    input.accountAndScopeVerified &&
    input.submitAndPollVerified &&
    input.callbackVerified &&
    input.publishRecoveryVerified;
  if (automatic) {
    return {
      mode: 'automatic_verified',
      platform: input.platform,
      reason: 'live_adapter_and_revision_evidence_verified',
    };
  }
  return input.exportAvailable
    ? {
        mode: 'assisted',
        platform: input.platform,
        reason: 'automatic_publish_not_fully_verified',
      }
    : {
        mode: 'unavailable',
        platform: input.platform,
        reason: 'no_verified_automatic_or_assisted_path',
      };
}

class NestedApprovalReceiptRepository implements ApprovalReceiptRepository {
  constructor(
    private readonly repository: OperationsRepository,
    private readonly context: OperationContext,
    private readonly now: () => string,
    private readonly id: () => string,
    private readonly expectedRevision?: number
  ) {}

  async create(input: {
    fingerprint: string;
    receipt: ApprovalReceipt;
    requestId: string;
  }) {
    let revisionConflict:
      | {
          currentRevision: number;
          expectedRevision: number;
          packageId: string;
        }
      | undefined;
    try {
      return await this.repository.withWorkspaceLock(
        this.context.workspaceId,
        async (repository) => {
          const state = await requireState(
            repository,
            this.context.workspaceId
          );
          const all = state.contentPackages.flatMap(
            (item) => item.approvalReceipts ?? []
          );
          const existing = all.find(
            (receipt) => receipt.idempotencyKey === input.receipt.idempotencyKey
          );
          if (existing) {
            return existing.payloadFingerprint === input.fingerprint
              ? {
                  kind: 'replayed' as const,
                  receipt: structuredClone(existing),
                }
              : { kind: 'conflict' as const };
          }
          const index = state.contentPackages.findIndex(
            (item) => item.id === input.receipt.binding.packageId
          );
          const current = state.contentPackages[index];
          if (!current) {
            throw new ContentPackageDeliveryError(
              'CONTENT_PACKAGE_NOT_FOUND',
              'ContentPackage was not found.'
            );
          }
          if (
            this.expectedRevision !== undefined &&
            current.revision !== this.expectedRevision
          ) {
            revisionConflict = {
              currentRevision: current.revision,
              expectedRevision: this.expectedRevision,
              packageId: current.id,
            };
            throw new ContentPackageDeliveryError(
              'CONTENT_PACKAGE_REVISION_CONFLICT',
              'ContentPackage revision changed. Refresh and retry.'
            );
          }
          const requestIndex = (current.approvalRequests ?? []).findIndex(
            (request) =>
              request.id === input.requestId &&
              request.status === 'pending' &&
              approvalRequestMatchesBinding(request, input.receipt.binding)
          );
          const request = (current.approvalRequests ?? [])[requestIndex];
          if (!request || request.status !== 'pending') {
            return { kind: 'request_not_pending' as const };
          }
          const requests = [...(current.approvalRequests ?? [])];
          requests[requestIndex] = pendingApprovalRequestSchema.parse({
            ...request,
            consumedAt: input.receipt.events[0]!.occurredAt,
            receiptId: input.receipt.id,
            status: 'consumed',
          });
          const updated = {
            ...current,
            approvalRequests: requests,
            approvalReceipts: [
              ...(current.approvalReceipts ?? []),
              structuredClone(input.receipt),
            ],
            revision: current.revision + 1,
            updatedAt: this.now(),
          };
          state.contentPackages[index] = updated;
          state.auditEvents.push(
            auditEvent(
              this.id,
              this.context,
              this.now(),
              'content_package.approval_recorded',
              current.id
            )
          );
          await repository.saveWorkspace(state);
          return {
            kind: 'created' as const,
            receipt: structuredClone(input.receipt),
          };
        }
      );
    } catch (error) {
      if (revisionConflict) {
        await this.repository.recordContentPackageRevisionConflict({
          actorId: this.context.userId,
          correlationId: this.context.correlationId,
          currentRevision: revisionConflict.currentRevision,
          expectedRevision: revisionConflict.expectedRevision,
          occurredAt: this.now(),
          packageId: revisionConflict.packageId,
          workspaceId: this.context.workspaceId,
        });
      }
      throw error;
    }
  }

  async get(receiptId: string) {
    const state = await this.repository.loadWorkspace(this.context.workspaceId);
    return structuredClone(
      state?.contentPackages
        .flatMap((item) => item.approvalReceipts ?? [])
        .find((receipt) => receipt.id === receiptId) ?? null
    );
  }

  async listApproved(workspaceId: string) {
    const state = await this.repository.loadWorkspace(workspaceId);
    return structuredClone(
      state?.contentPackages
        .flatMap((item) => item.approvalReceipts ?? [])
        .filter((receipt) => receipt.status === 'approved') ?? []
    );
  }

  async saveTerminal(
    receipt: ApprovalReceipt,
    expectedStatus: 'approved',
    activeAt?: string,
  ) {
    return this.repository.withWorkspaceLock(
      this.context.workspaceId,
      async (repository) => {
        const state = await requireState(repository, this.context.workspaceId);
        for (let packageIndex = 0; packageIndex < state.contentPackages.length; packageIndex += 1) {
          const current = state.contentPackages[packageIndex]!;
          const receiptIndex = (current.approvalReceipts ?? []).findIndex(
            (item) => item.id === receipt.id
          );
          if (receiptIndex < 0) continue;
          const approvals = [...(current.approvalReceipts ?? [])];
          const currentReceipt = approvals[receiptIndex];
          if (
            currentReceipt?.status !== expectedStatus ||
            (activeAt &&
              !isApprovalReceiptActiveAt(currentReceipt, activeAt))
          ) {
            throw new ApprovalReceiptError(
              'APPROVAL_NOT_ACTIVE',
              'The ApprovalReceipt is no longer active.'
            );
          }
          approvals[receiptIndex] = structuredClone(receipt);
          state.contentPackages[packageIndex] = {
            ...current,
            approvalReceipts: approvals,
            revision: current.revision + 1,
            updatedAt: this.now(),
          };
          await repository.saveWorkspace(state);
          return structuredClone(receipt);
        }
        throw new Error('ApprovalReceipt was not found.');
      }
    );
  }

  async restoreAfterPublishFailure(receiptId: string) {
    return this.repository.withWorkspaceLock(
      this.context.workspaceId,
      async (repository) => {
        const state = await requireState(repository, this.context.workspaceId);
        for (
          let packageIndex = 0;
          packageIndex < state.contentPackages.length;
          packageIndex += 1
        ) {
          const current = state.contentPackages[packageIndex]!;
          const receiptIndex = (current.approvalReceipts ?? []).findIndex(
            (receipt) => receipt.id === receiptId
          );
          if (receiptIndex < 0) continue;
          const approvals = [...(current.approvalReceipts ?? [])];
          const consumed = approvals[receiptIndex];
          if (consumed?.status !== 'consumed') {
            throw new Error('ApprovalReceipt is not reserved for publishing.');
          }
          const restored: ApprovalReceipt = {
            ...consumed,
            events: consumed.events.filter(
              (event) => event.eventId !== `${consumed.id}:consumed`
            ),
            status: 'approved',
          };
          approvals[receiptIndex] = restored;
          const occurredAt = this.now();
          state.contentPackages[packageIndex] = {
            ...current,
            approvalReceipts: approvals,
            revision: current.revision + 1,
            updatedAt: occurredAt,
          };
          state.auditEvents.push(
            auditEvent(
              this.id,
              this.context,
              occurredAt,
              'content_package.approval_restored_after_publish_failure',
              current.id
            )
          );
          await repository.saveWorkspace(state);
          return structuredClone(restored);
        }
        throw new Error('ApprovalReceipt was not found.');
      }
    );
  }
}

function currentContentRevision(
  contentPackage: ContentPackage,
  platform: ApprovalBinding['platform'],
  versionId: string
) {
  const variant = contentPackage.variants.find((item) => item.platform === platform);
  if (!variant || variant.currentVersionId !== versionId) {
    throw new ContentPackageDeliveryError(
      'CONTENT_PACKAGE_VARIANT_NOT_FOUND',
      'The current platform version was not found.'
    );
  }
  const revision = variant.versions.findIndex((version) => version.id === versionId) + 1;
  if (revision <= 0) {
    throw new ContentPackageDeliveryError(
      'CONTENT_PACKAGE_VARIANT_NOT_FOUND',
      'The current platform version was not found.'
    );
  }
  return revision;
}

async function requireState(
  repository: OperationsRepository,
  workspaceId: string
): Promise<OperationsWorkspaceState> {
  const state = await repository.loadWorkspace(workspaceId);
  if (!state) {
    throw new ContentPackageDeliveryError(
      'CONTENT_PACKAGE_NOT_FOUND',
      'ContentPackage was not found.'
    );
  }
  return state;
}

function auditEvent(
  id: () => string,
  context: OperationContext,
  createdAt: string,
  action: string,
  entityId: string,
  details?: Record<string, unknown>
): OperationsAuditEvent {
  return {
    action,
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt,
    entityId,
    entityType: 'content_package',
    ...(details ? { details } : {}),
    id: id(),
    workspaceId: context.workspaceId,
  };
}

function policyFactKind(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.includes('price')) return 'price' as const;
  if (
    normalized.includes('offer') ||
    normalized.includes('group_buy') ||
    normalized.includes('discount')
  ) {
    return 'offer' as const;
  }
  if (normalized.includes('benefit')) return 'benefit' as const;
  if (normalized.includes('qualification')) return 'qualification' as const;
  return null;
}

/**
 * Active latest projection over append-only resultSignals (V31-19).
 * Superseded = referenced by a later supersedesSignalId; withdrawn excluded.
 */
export function projectActiveResultSignals(
  history: readonly ContentPackageResultSignal[]
): ContentPackageResultSignal[] {
  const superseded = new Set(
    history
      .map((row) => row.supersedesSignalId)
      .filter((id): id is string => Boolean(id))
  );
  return history.filter(
    (row) =>
      typeof row.contentPackageRevision === 'number' &&
      (row.status ?? 'active') !== 'withdrawn' &&
      (row.status ?? 'active') !== 'superseded' &&
      !superseded.has(row.id)
  );
}

/**
 * Identity half of the OutcomeEvidence idempotency key inside one package:
 * signal + observedAt + sourceRef (package id is ambient).
 */
function resultSignalMatchesIdempotencyIdentity(
  row: ContentPackageResultSignal,
  identity: {
    packageId: string;
    kind: ContentPackageResultSignal['kind'];
    observedAt: string;
    sourceRef?: string;
  }
): boolean {
  if ((row.status ?? 'active') === 'withdrawn') return false;
  const rowSignal =
    mapContentPackageResultKindToOutcomeSignal(row.kind) ?? 'feedback';
  const inputSignal =
    mapContentPackageResultKindToOutcomeSignal(identity.kind) ?? 'feedback';
  // Quarantined historical rows (no consumed revision) cannot satisfy a new
  // idempotency identity and remain read-only.
  if (typeof row.contentPackageRevision !== 'number') return false;
  // Revision is bound at write time on the package; identity compare uses the
  // stable package id + signal + clocks (MAJOR-13 submit key). A retry that
  // re-read a bumped revision is still the same evidence.
  const rowKey = buildOutcomeEvidenceIdempotencyKey({
    contentPackageId: identity.packageId,
    contentPackageRevision: '_',
    signal: rowSignal,
    observedAt: row.occurredAt,
    sourceRef: row.sourceRef,
  });
  const inputKey = buildOutcomeEvidenceIdempotencyKey({
    contentPackageId: identity.packageId,
    contentPackageRevision: '_',
    signal: inputSignal,
    observedAt: identity.observedAt,
    sourceRef: identity.sourceRef,
  });
  return rowKey === inputKey;
}

function resultSignalMatchesWriteIdentity(
  row: ContentPackageResultSignal,
  input: {
    action: 'record' | 'correct' | 'withdraw';
    expectedRevision: number;
    kind: ContentPackageResultSignal['kind'];
    observedAt: string;
    sourceRef?: string;
    supersedesSignalId?: string;
  },
  packageId: string,
): boolean {
  if (input.action === 'record') {
    return resultSignalMatchesIdempotencyIdentity(row, {
      packageId,
      kind: input.kind,
      observedAt: input.observedAt,
      sourceRef: input.sourceRef,
    });
  }
  return row.contentPackageRevision === input.expectedRevision &&
    row.supersedesSignalId === input.supersedesSignalId &&
    ((input.action === 'withdraw') === ((row.status ?? 'active') === 'withdrawn'));
}

function resultSignalPayloadMatches(
  row: ContentPackageResultSignal,
  input: {
    kind: ContentPackageResultSignal['kind'];
    note?: string;
    occurredAt?: string;
    quantity?: number;
    sourceRef?: string;
  },
): boolean {
  return row.kind === input.kind &&
    (row.note ?? '') === (input.note ?? '') &&
    (row.quantity ?? null) === (input.quantity ?? null) &&
    (row.sourceRef ?? '') === (input.sourceRef ?? '') &&
    (input.occurredAt === undefined || row.occurredAt === input.occurredAt);
}

function resultLadder(
  contentPackage: ContentPackage,
  signals: ContentPackageResultSignal[]
) {
  const published = hasPublishedDelivery(contentPackage);
  const stage = signals.reduce((highest, signal) => {
    // no_activity is a negative chip — it must not advance the ladder.
    if (signal.kind === 'no_activity') return highest;
    const current =
      signal.kind === 'redeemed' ||
      signal.kind === 'redemption' ||
      signal.kind === 'store_visit'
        ? 4
        : signal.kind === 'appointment' ||
            signal.kind === 'voucher_purchase' ||
            signal.kind === 'voucher_purchased'
          ? 3
          : signal.kind === 'attention'
            ? 1
            : 2;
    return Math.max(highest, current);
  }, 0);
  return [
    { id: 'published', reached: published },
    { id: 'attention', reached: stage >= 1 },
    { id: 'consultation', reached: stage >= 2 },
    { id: 'appointment_or_purchase', reached: stage >= 3 },
    { id: 'redeemed_or_visited', reached: stage >= 4 },
  ] as const;
}

function hasPublishedDelivery(contentPackage: ContentPackage) {
  return (contentPackage.deliveryEvents ?? []).some(
    (event) =>
      (event.type === 'automatic_publish_result' ||
        event.type === 'manual_publish_result') &&
      event.status === 'published'
  );
}
