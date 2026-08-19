import {
  contentPackageDeliveryAttemptId,
  type ApprovalReceipt,
  type ContentPackage,
  type PublishHandoffView,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { isApprovalReceiptActiveAt } from '../operations/approval-receipt-validity.js';
import type { ContentPackageDeliveryService } from '../operations/content-package-delivery.js';
import type { PublishHandoffService } from '../operations/publish-handoff.js';
import type { OperationsDeliveryStore } from '../operations/operations-hot-path.js';
import type { OperationContext } from '../operations/types.js';
import type { AssistedReceiptService } from './assisted-receipt-service.js';
import type { StoredAssistedReceipt } from './assisted-receipt-repository.js';

export const DELIVERY_ENTRIES = [
  'workbench',
  'pending_inbox',
  'result_center',
] as const;

export type DeliveryEntry = (typeof DELIVERY_ENTRIES)[number];

export type DeliveryActorContext = P1Context | OperationContext;

export type DeliveryIdentity = {
  accountId: string;
  approvalReceiptId: string;
  deliveryAttemptId: string;
  packageId: string;
  payloadFingerprint: string;
  platform: ApprovalReceipt['binding']['platform'];
  variantVersionId: string;
  workspaceId: string;
};

export type DeliveryTtl = {
  expiresAt: string | undefined;
  issuedAt: string;
};

export type DeliveryAudit = {
  consumedAt?: string;
  consumedBy?: string;
  events: ApprovalReceipt['events'];
  externalEffectId?: string;
  status: ApprovalReceipt['status'];
};

export type DeliveryHandoffProjection = {
  expiresAt: string;
  token: string;
  consumedAt?: string;
};

export type DeliveryOutcomeProjection = {
  recordedAt: string;
  status: 'published' | 'failed' | 'unknown' | 'not_published';
};

export type DeliveryProjection = {
  audit: DeliveryAudit;
  entry: DeliveryEntry;
  handoff?: DeliveryHandoffProjection;
  identity: DeliveryIdentity;
  outcome?: DeliveryOutcomeProjection;
  ttl: DeliveryTtl;
};

export type PreparedDeliveryPackage = {
  approvalReceiptId: string;
  identity: DeliveryIdentity;
  packageRevision: number;
  status: ApprovalReceipt['status'];
};

export type DeliveryConsumeResult = {
  package: ContentPackage;
  projection: DeliveryProjection;
};

export class DeliveryApplicationError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | 'PACKAGE_NOT_READY'
      | 'EXPORT_NOT_FOUND'
      | 'APPROVAL_NOT_FOUND'
      | 'APPROVAL_NOT_ACTIVE'
      | 'APPROVAL_ALREADY_CONSUMED'
      | 'CANONICAL_HANDOFF_UNAVAILABLE',
    message: string,
    readonly projection?: DeliveryProjection,
  ) {
    super(message);
    this.name = 'DeliveryApplicationError';
    this.status = code === 'APPROVAL_NOT_FOUND' ? 404 : 409;
  }
}

export type DeliveryApplicationDeps = {
  assistedReceipts: AssistedReceiptService;
  clock?: () => string;
  createId?: () => string;
  delivery: ContentPackageDeliveryService;
  handoff: PublishHandoffService;
  repository: Pick<OperationsDeliveryStore, 'hasMembership' | 'getContentPackage'>;
};

export function comparableDeliveryFacts(state: DeliveryProjection) {
  return {
    audit: state.audit,
    handoff: state.handoff,
    identity: state.identity,
    outcome: state.outcome,
    ttl: state.ttl,
  };
}

export function createDeliveryApplication(deps: DeliveryApplicationDeps) {
  return new DeliveryApplication(deps);
}

/**
 * Single owner of delivery prepare / canonical handoff / consume / outcome /
 * projection. Workbench, Pending Inbox, and Result Center only pass an entry
 * tag; they do not own a second state machine.
 */
export class DeliveryApplication {
  private readonly now: () => string;

  constructor(private readonly deps: DeliveryApplicationDeps) {
    this.now = deps.clock ?? (() => new Date().toISOString());
  }

  async preparePackage(
    context: DeliveryActorContext,
    input: {
      entry: DeliveryEntry;
      packageId: string;
      platform: ApprovalReceipt['binding']['platform'];
      variantVersionId: string;
    },
  ): Promise<PreparedDeliveryPackage> {
    assertDeliveryEntry(input.entry);
    const op = operationContext(context);
    const contentPackage = await this.requireAcceptedPackage(
      op,
      input.packageId,
    );
    this.requireExport(contentPackage, input.platform, input.variantVersionId);
    const approval = this.requireApproval(
      contentPackage,
      input.packageId,
      input.platform,
      input.variantVersionId,
    );
    return {
      approvalReceiptId: approval.id,
      identity: identityOf(approval),
      packageRevision: contentPackage.revision,
      status: approval.status,
    };
  }

  async prepareCanonicalHandoff(
    context: DeliveryActorContext,
    input: {
      entry: DeliveryEntry;
      expectedRevision: number;
      packageId: string;
      platform: string;
      variantVersionId: string;
      workId?: string;
    },
  ): Promise<PublishHandoffView> {
    assertDeliveryEntry(input.entry);
    return this.deps.handoff.prepareMobilePublishHandoff(
      operationContext(context),
      {
        expectedRevision: input.expectedRevision,
        packageId: input.packageId,
        platform: input.platform,
        variantVersionId: input.variantVersionId,
        ...(input.workId ? { workId: input.workId } : {}),
      },
    );
  }

  async consume(
    context: DeliveryActorContext,
    input: {
      approvalReceiptId: string;
      entry: DeliveryEntry;
      packageId: string;
    },
  ): Promise<DeliveryConsumeResult> {
    assertDeliveryEntry(input.entry);
    const op = operationContext(context);
    const contentPackage = await this.requireAcceptedPackage(
      op,
      input.packageId,
    );
    const approval = contentPackage.approvalReceipts?.find(
      (candidate) => candidate.id === input.approvalReceiptId,
    );
    if (!approval) {
      throw new DeliveryApplicationError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.',
      );
    }
    const observedAt = this.now();
    if (approval.status === 'consumed') {
      throw new DeliveryApplicationError(
        'APPROVAL_ALREADY_CONSUMED',
        'The ApprovalReceipt was already consumed.',
        await this.projectLoaded(op, input.entry, contentPackage, approval),
      );
    }
    if (!isApprovalReceiptActiveAt(approval, observedAt)) {
      throw new DeliveryApplicationError(
        'APPROVAL_NOT_ACTIVE',
        'The ApprovalReceipt is no longer active.',
        await this.projectLoaded(op, input.entry, contentPackage, approval),
      );
    }
    const updated = await this.deps.delivery.deliver(op, {
      accountId: approval.binding.accountId,
      actionKind: approval.binding.actionKind,
      actionScheduledAt: approval.binding.actionScheduledAt,
      cost: approval.binding.cost,
      expectedRevision: contentPackage.revision,
      packageId: approval.binding.packageId,
      platform: approval.binding.platform,
      purpose: approval.binding.purpose,
      receiptId: approval.id,
      variantVersionId: approval.binding.variantVersionId,
    });
    const consumed = this.requireApproval(
      updated,
      input.packageId,
      approval.binding.platform,
      approval.binding.variantVersionId,
    );
    return {
      package: updated,
      projection: await this.projectLoaded(op, input.entry, updated, consumed),
    };
  }

  async recordOutcome(
    context: DeliveryActorContext,
    input: {
      entry: DeliveryEntry;
      expectedRevision: number;
      note?: string;
      packageId: string;
      platform: string;
      platformUrl?: string;
      variantVersionId: string;
      workId?: string;
    },
  ): Promise<DeliveryConsumeResult> {
    assertDeliveryEntry(input.entry);
    const op = operationContext(context);
    const updated = await this.deps.handoff.recordMerchantPublished(op, {
      expectedRevision: input.expectedRevision,
      packageId: input.packageId,
      platform: input.platform,
      variantVersionId: input.variantVersionId,
      ...(input.note ? { note: input.note } : {}),
      ...(input.platformUrl ? { platformUrl: input.platformUrl } : {}),
      ...(input.workId ? { workId: input.workId } : {}),
    });
    const approval = this.requireApprovalOnPackage(updated, input.packageId);
    return {
      package: updated,
      projection: await this.projectLoaded(op, input.entry, updated, approval),
    };
  }

  async projectState(
    context: DeliveryActorContext,
    input: {
      approvalReceiptId: string;
      entry: DeliveryEntry;
      packageId: string;
    },
  ): Promise<DeliveryProjection> {
    assertDeliveryEntry(input.entry);
    const op = operationContext(context);
    const contentPackage = await this.requirePackage(op, input.packageId);
    const approval = contentPackage.approvalReceipts?.find(
      (candidate) => candidate.id === input.approvalReceiptId,
    );
    if (!approval) {
      throw new DeliveryApplicationError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.',
      );
    }
    return this.projectLoaded(op, input.entry, contentPackage, approval);
  }

  private async projectLoaded(
    context: OperationContext,
    entry: DeliveryEntry,
    contentPackage: ContentPackage,
    approval: ApprovalReceipt,
  ): Promise<DeliveryProjection> {
    const assisted = await this.findAssisted(context, contentPackage, approval);
    const consumed = approval.events.find((event) => event.type === 'consumed');
    const approved = approval.events.find((event) => event.type === 'approved');
    const outcome = outcomeOf(contentPackage, approval, assisted);
    return {
      audit: {
        events: approval.events,
        status: approval.status,
        ...(consumed && consumed.type === 'consumed'
          ? {
              consumedAt: consumed.occurredAt,
              consumedBy: consumed.actorId,
              externalEffectId: consumed.externalEffectId,
            }
          : {}),
      },
      entry,
      identity: identityOf(approval),
      ttl: {
        expiresAt: approval.expiresAt,
        issuedAt: approved?.occurredAt ?? contentPackage.createdAt,
      },
      ...(assisted?.receipt.handoffLink
        ? {
            handoff: {
              expiresAt: assisted.receipt.handoffLink.expiresAt,
              token: assisted.receipt.handoffLink.token,
              ...(assisted.receipt.handoffLink.consumedAt
                ? { consumedAt: assisted.receipt.handoffLink.consumedAt }
                : {}),
            },
          }
        : {}),
      ...(outcome ? { outcome } : {}),
    };
  }

  private async findAssisted(
    context: OperationContext,
    contentPackage: ContentPackage,
    approval: ApprovalReceipt,
  ): Promise<StoredAssistedReceipt | undefined> {
    const stored = await this.deps.assistedReceipts.list(context);
    return stored.find(
      (candidate) =>
        candidate.receipt.packageId === contentPackage.id &&
        candidate.receipt.binding?.approvalReceiptId === approval.id,
    );
  }

  private async requireAcceptedPackage(
    context: OperationContext,
    packageId: string,
  ) {
    const contentPackage = await this.requirePackage(context, packageId);
    if (contentPackage.status !== 'accepted') {
      throw new DeliveryApplicationError(
        'PACKAGE_NOT_READY',
        'Delivery requires an accepted ContentPackage.',
      );
    }
    return contentPackage;
  }

  private async requirePackage(
    context: OperationContext,
    packageId: string,
  ): Promise<ContentPackage> {
    if (
      !(await this.deps.repository.hasMembership(
        context.userId,
        context.workspaceId,
      ))
    ) {
      throw new DeliveryApplicationError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.',
      );
    }
    const contentPackage = await this.deps.repository.getContentPackage(
      context.workspaceId,
      packageId,
    );
    if (!contentPackage) {
      throw new DeliveryApplicationError(
        'PACKAGE_NOT_READY',
        'ContentPackage was not found.',
      );
    }
    return contentPackage;
  }

  private requireExport(
    contentPackage: ContentPackage,
    platform: ApprovalReceipt['binding']['platform'],
    variantVersionId: string,
  ) {
    const exportReceipt = [...contentPackage.exportReceipts]
      .reverse()
      .find(
        (candidate) =>
          candidate.platform === platform &&
          candidate.variantVersionId === variantVersionId &&
          candidate.status === 'succeeded',
      );
    if (!exportReceipt) {
      throw new DeliveryApplicationError(
        'EXPORT_NOT_FOUND',
        'Delivery requires the exact successful export receipt.',
      );
    }
    return exportReceipt;
  }

  private requireApproval(
    contentPackage: ContentPackage,
    packageId: string,
    platform: ApprovalReceipt['binding']['platform'],
    variantVersionId: string,
  ) {
    const approval = contentPackage.approvalReceipts?.find(
      (candidate) =>
        candidate.binding.packageId === packageId &&
        candidate.binding.platform === platform &&
        candidate.binding.variantVersionId === variantVersionId,
    );
    if (!approval) {
      throw new DeliveryApplicationError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.',
      );
    }
    return approval;
  }

  private requireApprovalOnPackage(
    contentPackage: ContentPackage,
    packageId: string,
  ) {
    const approval = contentPackage.approvalReceipts?.find(
      (candidate) => candidate.binding.packageId === packageId,
    );
    if (!approval) {
      throw new DeliveryApplicationError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.',
      );
    }
    return approval;
  }
}

function identityOf(approval: ApprovalReceipt): DeliveryIdentity {
  return {
    accountId: approval.binding.accountId,
    approvalReceiptId: approval.id,
    deliveryAttemptId: contentPackageDeliveryAttemptId(approval.id),
    packageId: approval.binding.packageId,
    payloadFingerprint: approval.payloadFingerprint,
    platform: approval.binding.platform,
    variantVersionId: approval.binding.variantVersionId,
    workspaceId: approval.binding.workspaceId,
  };
}

function outcomeOf(
  contentPackage: ContentPackage,
  approval: ApprovalReceipt,
  assisted: StoredAssistedReceipt | undefined,
): DeliveryOutcomeProjection | undefined {
  const assistedResult = assisted?.receipt.publishResult;
  if (assistedResult) {
    return {
      recordedAt: assistedResult.recordedAt,
      status: assistedResult.status,
    };
  }
  const published = [...(contentPackage.deliveryEvents ?? [])]
    .reverse()
    .find(
      (event) =>
        event.type === 'manual_publish_result' &&
        event.platform === approval.binding.platform &&
        event.variantVersionId === approval.binding.variantVersionId,
    );
  if (published?.type !== 'manual_publish_result') return undefined;
  return {
    recordedAt: published.occurredAt,
    status: published.status,
  };
}

function operationContext(context: DeliveryActorContext): OperationContext {
  const actor = context.actor ?? 'owner';
  if (actor === 'payment') {
    throw new DeliveryApplicationError(
      'PACKAGE_NOT_READY',
      'The payment actor cannot perform delivery actions.',
    );
  }
  return {
    actor,
    correlationId: context.correlationId,
    userId: context.userId,
    workspaceId: context.workspaceId,
  };
}

function assertDeliveryEntry(entry: DeliveryEntry) {
  if (!DELIVERY_ENTRIES.includes(entry)) {
    throw new DeliveryApplicationError(
      'PACKAGE_NOT_READY',
      'Delivery entry must be workbench, pending_inbox, or result_center.',
    );
  }
}
