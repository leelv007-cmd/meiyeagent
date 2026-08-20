import { createHash, randomUUID } from 'node:crypto';
import {
  approvalBindingSchema,
  approvalReceiptIdSchema,
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
import type {
  OperationsDeliveryStore,
  OperationsHotPathRepository,
} from './operations-hot-path.js';
import type { OperationContext, OperationsAuditEvent } from './types.js';
import type { ContextBundleRepository } from './context-bundle-repository.js';
import type { ContextSourceRevisionRepository } from './context-source-revisions.js';
import type { ContextInvalidationSink } from './context-invalidation.js';
import type { StoreFactLedger } from './store-fact-ledger.js';
import { contentPackageVersionVisibleText } from './content-package-visible-copy-policy.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';

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
    private readonly repository: OperationsDeliveryStore,
    private readonly dependencies: {
      approvalPolicy: ContentPackageApprovalPolicyPort;
      capability(platform: ApprovalBinding['platform']): Promise<ContentPackageDeliveryCapability>;
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
    if (capability.mode !== 'assisted') {
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
    if (!(await this.repository.hasMembership(context.userId, context.workspaceId))) {
      throw new ContentPackageDeliveryError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'ContentPackage was not found.'
      );
    }

    let revisionConflict:
      | {
          currentRevision: number;
          packageId: string;
        }
      | undefined;
    try {
      return await this.repository.withHotPathLock(
        context.workspaceId,
        input.packageId,
        async (repository) => {
          const current = await requirePackageRow(
            repository,
            context.workspaceId,
            input.packageId
          );
          currentContentRevision(
            current,
            input.platform,
            input.variantVersionId
          );
          const existing = (current.deliveryEvents ?? []).find(
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
          if (existing) return structuredClone(current);

          if (current.revision !== input.expectedRevision) {
            revisionConflict = {
              currentRevision: current.revision,
              packageId: current.id,
            };
            throw new ContentPackageDeliveryError(
              'CONTENT_PACKAGE_REVISION_CONFLICT',
              'ContentPackage revision changed. Refresh and retry.'
            );
          }

          const assistedDelivery = [...(current.deliveryEvents ?? [])]
            .reverse()
            .find(
              (event) =>
                event.type === 'assisted_handoff_prepared' &&
                event.platform === input.platform &&
                event.variantVersionId === input.variantVersionId &&
                Boolean(event.artifactReceiptId) &&
                Boolean(event.deliveryIdentity)
            );
          const existingApproval = (current.approvalReceipts ?? []).find(
            (receipt) =>
              receipt.binding.packageId === current.id &&
              receipt.binding.platform === input.platform &&
              receipt.binding.variantVersionId === input.variantVersionId
          );
          const occurredAt = input.publishedAt ?? this.now();
          const createdApproval =
            input.status === 'published' && !existingApproval
              ? workbenchSelfPublishApproval({
                  actorId: context.userId,
                  contentRevision: currentContentRevision(
                    current,
                    input.platform,
                    input.variantVersionId
                  ),
                  occurredAt,
                  packageId: current.id,
                  platform: input.platform,
                  variantVersionId: input.variantVersionId,
                  workspaceId: context.workspaceId,
                })
              : undefined;
          const approval = existingApproval ?? createdApproval;
          const event: ContentPackageDeliveryEvent = {
            actorId: context.userId,
            ...(input.status === 'published' &&
            assistedDelivery?.type === 'assisted_handoff_prepared' &&
            assistedDelivery.artifactReceiptId &&
            assistedDelivery.deliveryIdentity
              ? {
                  afterRevision: current.revision + 1,
                  artifactReceiptId: assistedDelivery.artifactReceiptId,
                  beforeRevision: current.revision,
                  deliveryIdentity: assistedDelivery.deliveryIdentity,
                }
              : input.status === 'published' && approval
                ? {
                    afterRevision: current.revision + 1,
                    beforeRevision: current.revision,
                    deliveryIdentity: {
                      approvalReceiptId: approval.id,
                      deliveryAttemptId: contentPackageDeliveryAttemptId(
                        approval.id
                      ),
                      schema: 'approval_receipt_v1',
                    },
                  }
                : {}),
            id: this.id(),
            ...(input.accountDisplayLabel
              ? { accountDisplayLabel: input.accountDisplayLabel }
              : {}),
            ...(input.note ? { note: input.note } : {}),
            occurredAt,
            platform: input.platform,
            ...(input.platformUrl ? { platformUrl: input.platformUrl } : {}),
            source: 'native',
            status: input.status,
            type: 'manual_publish_result',
            variantVersionId: input.variantVersionId,
          };
          const updated = {
            ...current,
            ...(createdApproval
              ? {
                  approvalReceipts: [
                    ...(current.approvalReceipts ?? []),
                    createdApproval,
                  ],
                }
              : {}),
            deliveryEvents: [...(current.deliveryEvents ?? []), event],
            revision: current.revision + 1,
            updatedAt: event.occurredAt,
          };
          return repository.saveContentPackageRevision({
            auditEvents: [
              auditEvent(
                this.id,
                context,
                event.occurredAt,
                `content_package.${event.type}`,
                current.id
              ),
            ],
            contentPackage: updated,
            expectedRevision: current.revision,
          });
        }
      );
    } catch (error) {
      if (revisionConflict) {
        await this.repository.recordContentPackageRevisionConflict({
          actorId: context.userId,
          correlationId: context.correlationId,
          currentRevision: revisionConflict.currentRevision,
          expectedRevision: input.expectedRevision,
          occurredAt: this.now(),
          packageId: revisionConflict.packageId,
          workspaceId: context.workspaceId,
        });
      }
      throw error;
    }
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

    return this.repository.withHotPathLock(
      context.workspaceId,
      contentPackage.id,
      async (repository) => {
        const current = await requirePackageRow(
          repository,
          context.workspaceId,
          contentPackage.id
        );
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
        return repository.saveContentPackageRevision({
          auditEvents: [
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
            ),
          ],
          contentPackage: updated,
          expectedRevision: current.revision,
        });
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
    return this.repository.withHotPathLock(
      context.workspaceId,
      contentPackage.id,
      async (repository) => {
        const current = await requirePackageRow(
          repository,
          context.workspaceId,
          contentPackage.id
        );
        const updated = {
          ...current,
          resultReviewActions: [
            ...(current.resultReviewActions ?? []),
            event,
          ],
          revision: current.revision + 1,
          updatedAt: event.occurredAt,
        };
        return repository.saveContentPackageRevision({
          auditEvents: [
            auditEvent(
              this.id,
              context,
              event.occurredAt,
              `content_package.result_review_${event.action}`,
              current.id
            ),
          ],
          contentPackage: updated,
          expectedRevision: current.revision,
        });
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
    const contentPackage = await this.repository.getContentPackage(
      context.workspaceId,
      packageId
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

  private appendAssistedDeliveryEvent(
    context: OperationContext,
    packageId: string,
    authorizedReceipt: ApprovalReceipt,
    event: Extract<
      ContentPackageDeliveryEvent,
      { type: 'assisted_handoff_prepared' }
    >
  ) {
    return this.repository.withHotPathLock(
      context.workspaceId,
      packageId,
      async (repository) => {
        const current = await requirePackageRow(
          repository,
          context.workspaceId,
          packageId
        );
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
        return repository.saveContentPackageRevision({
          auditEvents: [
            auditEvent(
              this.id,
              context,
              event.occurredAt,
              `content_package.${event.type}`,
              packageId
            ),
          ],
          contentPackage: updated,
          expectedRevision: current.revision,
        });
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
  exportAvailable: boolean;
  platform: ApprovalBinding['platform'];
}): ContentPackageDeliveryCapability {
  // D-155 / RET-05: automatic publisher is archived. Complete live evidence
  // must not open automatic_verified; main chain is assisted or unavailable.
  return input.exportAvailable
    ? {
        mode: 'assisted',
        platform: input.platform,
        reason: 'automatic_publish_archived_d155',
      }
    : {
        mode: 'unavailable',
        platform: input.platform,
        reason: 'no_verified_automatic_or_assisted_path',
      };
}

class NestedApprovalReceiptRepository implements ApprovalReceiptRepository {
  constructor(
    private readonly repository: OperationsDeliveryStore,
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
      return await this.repository.withHotPathLock(
        this.context.workspaceId,
        input.receipt.binding.packageId,
        async (repository) => {
          const packages = await repository.listContentPackages(
            this.context.workspaceId
          );
          const all = packages.flatMap((item) => item.approvalReceipts ?? []);
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
          const current = await requirePackageRow(
            repository,
            this.context.workspaceId,
            input.receipt.binding.packageId
          );
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
          await repository.saveContentPackageRevision({
            auditEvents: [
              auditEvent(
                this.id,
                this.context,
                this.now(),
                'content_package.approval_recorded',
                current.id
              ),
            ],
            contentPackage: updated,
            expectedRevision: current.revision,
          });
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
    const packages = await this.repository.listContentPackages(
      this.context.workspaceId
    );
    return structuredClone(
      packages
        .flatMap((item) => item.approvalReceipts ?? [])
        .find((receipt) => receipt.id === receiptId) ?? null
    );
  }

  async listApproved(workspaceId: string) {
    const packages = await this.repository.listContentPackages(workspaceId);
    return structuredClone(
      packages
        .flatMap((item) => item.approvalReceipts ?? [])
        .filter((receipt) => receipt.status === 'approved')
    );
  }

  async saveTerminal(
    receipt: ApprovalReceipt,
    expectedStatus: 'approved',
    activeAt?: string,
  ) {
    const located = await this.locatePackageByReceipt(receipt.id);
    return this.repository.withHotPathLock(
      this.context.workspaceId,
      located.id,
      async (repository) => {
        const current = await requirePackageRow(
          repository,
          this.context.workspaceId,
          located.id
        );
        const receiptIndex = (current.approvalReceipts ?? []).findIndex(
          (item) => item.id === receipt.id
        );
        if (receiptIndex < 0) {
          throw new Error('ApprovalReceipt was not found.');
        }
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
        await repository.saveContentPackageRevision({
          contentPackage: {
            ...current,
            approvalReceipts: approvals,
            revision: current.revision + 1,
            updatedAt: this.now(),
          },
          expectedRevision: current.revision,
        });
        return structuredClone(receipt);
      }
    );
  }

  private async locatePackageByReceipt(receiptId: string) {
    const packages = await this.repository.listContentPackages(
      this.context.workspaceId
    );
    const located = packages.find((item) =>
      (item.approvalReceipts ?? []).some((receipt) => receipt.id === receiptId)
    );
    if (!located) {
      throw new Error('ApprovalReceipt was not found.');
    }
    return located;
  }
}

export function workbenchSelfPublishApproval(input: {
  actorId: string;
  contentRevision: number;
  occurredAt: string;
  packageId: string;
  platform: ApprovalBinding['platform'];
  variantVersionId: string;
  workspaceId: string;
}): ApprovalReceipt {
  const id = approvalReceiptIdSchema.parse(
    `approval-self-publish-${createHash('sha256')
      .update(
        [
          input.workspaceId,
          input.packageId,
          input.platform,
          input.variantVersionId,
        ].join('\0')
      )
      .digest('hex')
      .slice(0, 24)}`
  );
  const binding = approvalBindingSchema.parse({
    accountId: input.actorId,
    actionKind: 'publish',
    actionScheduledAt: input.occurredAt,
    contentRevision: input.contentRevision,
    contextBundle: {
      bundleId: 'workbench-self-publish',
      hash: 'workbench-self-publish',
      revision: 1,
    },
    cost: { amount: 0, currency: 'CNY' },
    packageId: input.packageId,
    platform: input.platform,
    purpose: 'publish_current_variant',
    variantVersionId: input.variantVersionId,
    workspaceId: input.workspaceId,
  });
  return approvalReceiptSchema.parse({
    binding,
    events: [
      {
        actorId: input.actorId,
        eventId: `${id}:approved`,
        occurredAt: input.occurredAt,
        type: 'approved',
      },
      {
        actorId: input.actorId,
        eventId: `${id}:consumed`,
        externalEffectId: contentPackageDeliveryAttemptId(id),
        occurredAt: input.occurredAt,
        type: 'consumed',
      },
    ],
    id,
    idempotencyKey: `workbench-self-publish:${input.packageId}:${input.platform}:${input.variantVersionId}`,
    payloadFingerprint: fingerprintValue({
      actorId: input.actorId,
      binding,
    }),
    status: 'consumed',
  });
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

async function requirePackageRow(
  repository: Pick<OperationsHotPathRepository, 'getContentPackage'>,
  workspaceId: string,
  packageId: string
) {
  const contentPackage = await repository.getContentPackage(
    workspaceId,
    packageId
  );
  if (!contentPackage) {
    throw new ContentPackageDeliveryError(
      'CONTENT_PACKAGE_NOT_FOUND',
      'ContentPackage was not found.'
    );
  }
  return contentPackage;
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
