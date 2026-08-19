/**
 * V31-17 Publish Handoff + self-report journey (P1 action surface).
 *
 * - MobilePublishHandoff materials (merchant self-publish only)
 * - A19 reject of system-driven publish from QR / handoff token
 * - Capability three-state honest presentation
 * - 「我已发布」bound to exact ContentPackage revision (recordManualResult)
 * - Self-report ask frequency (U2) + write path via recordResultSignal
 *   (OutcomeEvidence physical store, V31-19)
 */

import { randomUUID } from 'node:crypto';
import {
  buildPublishHandoffCopyBlocks,
  buildVideoHandoffSafetyChecklist,
  decidePublishFromHandoff,
  evaluateSelfReportAsk,
  mapOutcomeSignalToContentPackageResultKind,
  orderedExportImagePath,
  projectPublishCapabilityPresentation,
  projectStoreConsecutiveIgnores,
  type AttemptPublishFromHandoffCommand,
  type ContentPackage,
  type ContentPackageDeliveryCapability,
  type MobilePublishHandoff,
  type OutcomeSelfReportChipSignal,
  type PrepareMobilePublishHandoffCommand,
  type PublishCapabilityMode,
  type PublishFromHandoffDecision,
  type PublishHandoffView,
  type RecordMerchantPublishedCommand,
  type RecordSelfReportAskCommand,
  type SelfReportAskDecision,
  type SelfReportAskEvent,
} from '@meiye/contracts';

import {
  assertRecoverablePreparedTarget,
  CanonicalAssistedDeliveryError,
  consumedCanonicalHandoffRequiresReprepare,
} from '../result-delivery/assisted-canonical-repository.js';
import type { AssistedReceiptService } from '../result-delivery/assisted-receipt-service.js';
import type { ContentPackageDeliveryService } from './content-package-delivery.js';
import type { OperationsDeliveryStore } from './operations-hot-path.js';
import type {
  OperationContext,
  OperationsAuditEvent,
} from './types.js';

const AUDIT_SELF_REPORT = 'publish_handoff.self_report_ask';

export class PublishHandoffError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | 'CONTENT_PACKAGE_NOT_FOUND'
      | 'CONTENT_PACKAGE_NOT_DELIVERED'
      | 'CONTENT_PACKAGE_REVISION_CONFLICT'
      | 'CONTENT_PACKAGE_VARIANT_NOT_FOUND'
      | 'CANONICAL_HANDOFF_EXPORT_NOT_FOUND'
      | 'CANONICAL_HANDOFF_APPROVAL_NOT_FOUND'
      | 'DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED'
      | 'SELF_REPORT_ASK_NOT_FOUND'
      | 'SELF_REPORT_ASK_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'PublishHandoffError';
    this.status =
      this.code === 'CONTENT_PACKAGE_NOT_FOUND'
        ? 404
        : this.code === 'DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED'
          ? 403
          : 409;
  }
}

export type PublishHandoffMaterialsInput = {
  contentPackage: ContentPackage;
  platform: string;
  variantVersionId: string;
  capabilityMode: PublishCapabilityMode;
  storeName?: string;
  workId?: string;
  /** Optional pre-built one-shot handoff. */
  mobileHandoff?: MobilePublishHandoff;
  /** Whether package kind is video (enables safety checklist). */
  isVideo?: boolean;
};

/**
 * Pure projection of Delivered publish handoff materials.
 * ZIP bytes remain ContentPackageZipExportAdapter; this freezes naming + order.
 */
export function projectPublishHandoffView(
  input: PublishHandoffMaterialsInput,
): PublishHandoffView {
  const version = resolveVariantVersion(
    input.contentPackage,
    input.platform,
    input.variantVersionId,
  );
  const revision = input.contentPackage.revision;
  const topics = version.topics ?? [];
  const copyBlocks = buildPublishHandoffCopyBlocks({
    title: version.title,
    body: version.body,
    topics,
    cta: version.conversionHook,
  });
  const orderedImagePaths = (version.orderedAssetIds ?? []).map((_, index) =>
    orderedExportImagePath(index, 'jpg'),
  );
  const capability = projectPublishCapabilityPresentation(input.capabilityMode);
  const generatedAt =
    version.createdAt ??
    input.contentPackage.updatedAt ??
    input.contentPackage.createdAt;
  const kindLabel =
    input.contentPackage.kind === 'video' || input.isVideo
      ? '视频'
      : orderedImagePaths.length > 0
        ? '图文'
        : '文案';
  const zipFileName = buildProjectedZipFileName({
    storeName: input.storeName ?? '门店',
    kindLabel,
    platform: input.platform,
    generatedAt,
    revision,
  });

  return {
    schemaVersion: 'publish-handoff/v1',
    contentPackageRef: {
      id: input.contentPackage.id,
      revision,
    },
    ...(input.workId ? { workId: input.workId } : {}),
    platform: input.platform,
    copyBlocks,
    zipFileName,
    orderedImagePaths,
    ...(input.contentPackage.kind === 'video' || input.isVideo
      ? {
          videoSafety: buildVideoHandoffSafetyChecklist({
            platform: input.platform,
          }),
        }
      : {}),
    capability,
    ...(input.mobileHandoff ? { mobileHandoff: input.mobileHandoff } : {}),
    publicationBindingRevision: revision,
  };
}

function resolveVariantVersion(
  contentPackage: ContentPackage,
  platform: string,
  variantVersionId: string,
) {
  const nestedVersions = contentPackage.variants.flatMap((variant) =>
    variant.versions.map((version) => ({
      platform: variant.platform,
      currentVersionId: variant.currentVersionId,
      version,
    })),
  );
  const topLevel = contentPackage.versions.map((version) => ({
    platform,
    currentVersionId: contentPackage.currentVersionId,
    version,
  }));
  const all = [...topLevel, ...nestedVersions];
  const byId = all.find((row) => row.version.id === variantVersionId);
  if (byId) return byId.version;
  const byPlatformCurrent = all.find(
    (row) =>
      row.platform === platform &&
      row.currentVersionId === row.version.id,
  );
  if (byPlatformCurrent) return byPlatformCurrent.version;
  const byPackageCurrent = all.find(
    (row) => row.version.id === contentPackage.currentVersionId,
  );
  if (byPackageCurrent) return byPackageCurrent.version;
  if (all[0]) return all[0].version;
  throw new PublishHandoffError(
    'CONTENT_PACKAGE_VARIANT_NOT_FOUND',
    'No ContentPackage version is available for publish handoff.',
  );
}

function buildProjectedZipFileName(input: {
  storeName: string;
  kindLabel: string;
  platform: string;
  generatedAt: string;
  revision: number | string;
}): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})/u.exec(input.generatedAt);
  const dateToken = date
    ? `${date[1]}${date[2]}${date[3]}`
    : '00000000';
  const platformLabel = platformDisplay(input.platform);
  const store = sanitizeSegment(input.storeName, '门店');
  const kind = sanitizeSegment(input.kindLabel, '内容');
  const rev =
    typeof input.revision === 'number'
      ? `r${input.revision}`
      : String(input.revision).slice(0, 8);
  return `${store}-${kind}-${platformLabel}-${dateToken}-${rev}.zip`;
}

function platformDisplay(platform: string): string {
  switch (platform) {
    case 'xiaohongshu':
      return '小红书';
    case 'douyin':
      return '抖音';
    case 'video_account':
      return '视频号';
    case 'wechat_moments':
      return '朋友圈';
    default:
      return sanitizeSegment(platform, '平台');
  }
}

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}

function normalizePublishPlatform(
  platform: string,
): 'xiaohongshu' | 'douyin' | 'video_account' {
  if (
    platform === 'xiaohongshu' ||
    platform === 'douyin' ||
    platform === 'video_account'
  ) {
    return platform;
  }
  // wechat_moments is export/distribution only — map handoff record to video_account
  // is wrong; fail closed with a clear error for unknown platforms.
  throw new PublishHandoffError(
    'CONTENT_PACKAGE_VARIANT_NOT_FOUND',
    `Platform ${platform} is not eligible for merchant published binding.`,
  );
}

function selfReportAuditEvent(
  context: OperationContext,
  id: string,
  createdAt: string,
  event: SelfReportAskEvent,
): OperationsAuditEvent {
  return {
    id,
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    action: AUDIT_SELF_REPORT,
    entityType: 'self_report_ask',
    entityId: event.askId,
    details: { event },
    createdAt,
  };
}

/**
 * Latest-status projection of self-report ask rows from append-only audit log.
 */
export function projectSelfReportAskEvents(
  auditEvents: readonly OperationsAuditEvent[],
): SelfReportAskEvent[] {
  const byId = new Map<string, SelfReportAskEvent>();
  for (const audit of auditEvents) {
    if (audit.action !== AUDIT_SELF_REPORT) continue;
    const event = audit.details?.event as SelfReportAskEvent | undefined;
    if (!event?.askId) continue;
    byId.set(event.askId, event);
  }
  return [...byId.values()].sort((a, b) =>
    a.askedAt.localeCompare(b.askedAt),
  );
}

export function capabilityModeFromDelivery(
  capability: ContentPackageDeliveryCapability,
): PublishCapabilityMode {
  return capability.mode;
}

export class PublishHandoffService {
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(
    private readonly repository: OperationsDeliveryStore,
    private readonly delivery: Pick<
      ContentPackageDeliveryService,
      'recordManualResult' | 'recordResultSignal'
    >,
    options: {
      clock?: () => string;
      createId?: () => string;
      assistedReceipts: AssistedReceiptService;
      /** Resolve live capability for a platform (production wiring). */
      resolveCapability?: (
        platform: string,
      ) => Promise<ContentPackageDeliveryCapability>;
    },
  ) {
    this.now = options.clock ?? (() => new Date().toISOString());
    this.id = options.createId ?? randomUUID;
    this.assistedReceipts = options.assistedReceipts;
    this.resolveCapability = options.resolveCapability;
  }

  private readonly assistedReceipts: AssistedReceiptService;

  private readonly resolveCapability?: (
    platform: string,
  ) => Promise<ContentPackageDeliveryCapability>;

  /**
   * Prepare MobilePublishHandoff materials after Delivered.
   * Always merchant_self_publish; systemDrivenPublishAllowed = false.
   */
  async prepareMobilePublishHandoff(
    context: OperationContext,
    input: PrepareMobilePublishHandoffCommand,
  ): Promise<PublishHandoffView> {
    const contentPackage = await this.requirePackage(
      context,
      input.packageId,
      input.expectedRevision,
    );
    if (contentPackage.status !== 'accepted') {
      throw new PublishHandoffError(
        'CONTENT_PACKAGE_NOT_DELIVERED',
        'Publish handoff requires an accepted ContentPackage.',
      );
    }
    const capability = await this.capabilityFor(input.platform);
    const platform = normalizePublishPlatform(input.platform);
    const exportReceipt = [...contentPackage.exportReceipts]
      .reverse()
      .find(
        (candidate) =>
          candidate.platform === platform &&
          candidate.variantVersionId === input.variantVersionId &&
          candidate.status === 'succeeded' &&
          Boolean(candidate.artifactAssetId),
      );
    if (!exportReceipt) {
      throw new PublishHandoffError(
        'CANONICAL_HANDOFF_EXPORT_NOT_FOUND',
        'Publish handoff requires the exact successful export receipt.',
      );
    }
    const delivered = [...(contentPackage.deliveryEvents ?? [])]
      .reverse()
      .find(
        (event) =>
          event.type === 'assisted_handoff_prepared' &&
          event.platform === platform &&
          event.variantVersionId === input.variantVersionId &&
          event.artifactReceiptId === exportReceipt.id &&
          Boolean(event.deliveryIdentity),
      );
    const approval = (contentPackage.approvalReceipts ?? []).find(
      (candidate) =>
        candidate.id ===
          (delivered?.type === 'assisted_handoff_prepared'
            ? delivered.deliveryIdentity?.approvalReceiptId
            : undefined) &&
        candidate.status === 'consumed' &&
        candidate.events.at(-1)?.type === 'consumed' &&
        candidate.binding.workspaceId === context.workspaceId &&
        candidate.binding.packageId === contentPackage.id &&
        candidate.binding.platform === platform &&
        candidate.binding.variantVersionId === input.variantVersionId,
    );
    if (!approval) {
      throw new PublishHandoffError(
        'CANONICAL_HANDOFF_APPROVAL_NOT_FOUND',
        'Publish handoff requires the exact completed assisted delivery.',
      );
    }
    const occurredAt = this.now();
    const receiptId = [
      'assisted',
      contentPackage.id,
      platform,
      input.variantVersionId,
      exportReceipt.id,
    ].join(':');
    const existing = (await this.assistedReceipts.list(context)).find(
      (stored) => stored.receipt.id === receiptId,
    );
    if (existing) {
      const recovery = assertRecoverablePreparedTarget(
        existing.receipt,
        contentPackage,
      );
      if (
        consumedCanonicalHandoffRequiresReprepare(
          existing.receipt,
          recovery.recoveredNonContentRevision,
        )
      ) {
        throw new CanonicalAssistedDeliveryError(
          'CANONICAL_HANDOFF_REPREPARE_REQUIRED',
          'The consumed handoff link cannot be reused after a non-published result.',
        );
      }
    }
    const requestedToken = this.id().replace(/-/gu, '');
    const handed = await this.assistedReceipts.prepareHandoff(context, {
      binding: {
        accountId: approval.binding.accountId,
        approvalReceiptId: approval.id,
        contentPackageRevision: contentPackage.revision,
        costRange: {
          currency: approval.binding.cost.currency,
          maxAmount: approval.binding.cost.amount,
          minAmount: 0,
        },
        packageId: contentPackage.id,
        platform,
        purpose: approval.binding.purpose,
        responsibilityRole: 'self_publish',
        scheduledAt: approval.binding.actionScheduledAt,
        variantVersionId: input.variantVersionId,
        workspaceId: context.workspaceId,
      },
      linkToken: requestedToken,
      prepare: {
        contentPackageRevision: contentPackage.revision,
        exportReceiptId: exportReceipt.id,
        id: receiptId,
        occurredAt,
        packageId: contentPackage.id,
        platform,
        variantVersionId: input.variantVersionId,
      },
    });
    const link = handed.receipt.handoffLink;
    if (!link) {
      throw new PublishHandoffError(
        'CANONICAL_HANDOFF_EXPORT_NOT_FOUND',
        'Canonical assisted handoff did not issue a link.',
      );
    }
    const prefix = (input.handoffPathPrefix ?? '/dashboard/handoff/').replace(
      /\/?$/u,
      '/',
    );
    const mobileHandoff: MobilePublishHandoff = {
      schemaVersion: 'publish-handoff/v1',
      handoffId: handed.receipt.id,
      token: link.token,
      handoffUrl: `${prefix}${link.token}`,
      expiresAt: link.expiresAt,
      contentPackageRef: {
        id: contentPackage.id,
        revision: contentPackage.revision,
      },
      platform,
      publishActor: 'merchant_self_publish',
      systemDrivenPublishAllowed: false,
    };

    const view = projectPublishHandoffView({
      contentPackage,
      platform,
      variantVersionId: input.variantVersionId,
      capabilityMode: capabilityModeFromDelivery(capability),
      workId: input.workId,
      mobileHandoff,
      isVideo: contentPackage.kind === 'video',
    });
    return {
      ...view,
      publicationBindingRevision: contentPackage.revision,
    };
  }

  /**
   * A19 hard reject: any driven publish intent from handoff token fails closed.
   */
  attemptPublishFromHandoff(
    input: AttemptPublishFromHandoffCommand,
  ): PublishFromHandoffDecision {
    return decidePublishFromHandoff(input.intent);
  }

  /**
   * 「我已发布」— binds exact ContentPackage revision via recordManualResult.
   */
  async recordMerchantPublished(
    context: OperationContext,
    input: RecordMerchantPublishedCommand,
  ): Promise<ContentPackage> {
    const platform = normalizePublishPlatform(input.platform);
    return this.delivery.recordManualResult(context, {
      packageId: input.packageId,
      expectedRevision: input.expectedRevision,
      platform,
      variantVersionId: input.variantVersionId,
      status: 'published',
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      ...(input.platformUrl ? { platformUrl: input.platformUrl } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.accountDisplayLabel
        ? { accountDisplayLabel: input.accountDisplayLabel }
        : {}),
    });
  }

  /**
   * Refresh-safe projection for the next-day follow-up. The publish result is
   * already the canonical durable fact, so completedAt is recovered from the
   * latest manual publish event instead of browser memory.
   */
  async getPublishHandoffRecovery(
    context: OperationContext,
    input: {
      packageId: string;
      workId: string;
      platform: string;
      variantVersionId: string;
    },
  ): Promise<{
    contentPackageId: string;
    latestRevision: number;
    publishHandoffCompletedAt: string | null;
  }> {
    const contentPackage = await this.requirePackage(context, input.packageId);
    const assisted = await this.assistedReceipts.list(context);
    const prepared = assisted.find((stored) => {
      const target = stored.receipt.canonicalTarget;
      return (
        stored.receipt.packageId === input.packageId &&
        target?.platform === input.platform &&
        target.variantVersionId === input.variantVersionId &&
        stored.receipt.status !== 'materials_ready'
      );
    });
    const published = [...(contentPackage.deliveryEvents ?? [])]
      .reverse()
      .find((event) => {
        return (
          contentPackage.source.workId === input.workId &&
          event.type === 'manual_publish_result' &&
          event.status === 'published' &&
          event.platform === input.platform &&
          event.variantVersionId === input.variantVersionId
        );
      });
    return {
      contentPackageId: contentPackage.id,
      latestRevision: contentPackage.revision,
      publishHandoffCompletedAt:
        prepared && published ? published.occurredAt : null,
    };
  }

  /**
   * Self-report chip write path: consumes OutcomeEvidence physical writer
   * (recordResultSignal) with exact revision OCC.
   */
  async recordSelfReportSignal(
    context: OperationContext,
    input: {
      packageId: string;
      expectedRevision: number;
      signal: OutcomeSelfReportChipSignal;
      note?: string;
      occurredAt?: string;
      sourceRef?: string;
      workId?: string;
      askId?: string;
    },
  ): Promise<ContentPackage> {
    const kind = mapOutcomeSignalToContentPackageResultKind(
      input.signal,
    ) as Parameters<ContentPackageDeliveryService['recordResultSignal']>[1]['kind'];
    const updated = await this.delivery.recordResultSignal(context, {
      packageId: input.packageId,
      expectedRevision: input.expectedRevision,
      kind,
      ...(input.note ? { note: input.note } : {}),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      ...(input.sourceRef
        ? { sourceRef: input.sourceRef }
        : { sourceRef: `self-report:${input.signal}` }),
    });
    if (input.workId) {
      await this.recordSelfReportAsk(context, {
        workId: input.workId,
        contentPackageId: input.packageId,
        contentPackageRevision: input.expectedRevision,
        action: 'mark_answered',
        ...(input.askId ? { askId: input.askId } : {}),
      });
    }
    return updated;
  }

  async evaluateSelfReportAskForWork(
    context: OperationContext,
    input: {
      workId: string;
      contentPackageId: string;
      platform: string;
      variantVersionId: string;
    },
  ): Promise<SelfReportAskDecision> {
    // Whether the merchant published, and when, is a durable delivery fact.
    // Reading it back here — instead of taking the browser's word for it — is
    // what keeps the next-day follow-up from being triggerable on demand, and
    // is also what makes the ask survive a refresh with no client state.
    const recovery = await this.getPublishHandoffRecovery(context, {
      packageId: input.contentPackageId,
      workId: input.workId,
      platform: input.platform,
      variantVersionId: input.variantVersionId,
    });
    const history = projectSelfReportAskEvents(
      await this.repository.listAuditEvents(
        context.workspaceId,
        AUDIT_SELF_REPORT,
      ),
    );
    const workHistory = history.filter((row) => row.workId === input.workId);
    const storeConsecutiveIgnores = projectStoreConsecutiveIgnores(history);
    return evaluateSelfReportAsk({
      workId: input.workId,
      contentPackageId: input.contentPackageId,
      contentPackageRevision: recovery.latestRevision,
      publishHandoffCompletedAt: recovery.publishHandoffCompletedAt,
      now: this.now(),
      workAskHistory: workHistory,
      storeConsecutiveIgnores,
    });
  }

  async recordSelfReportAsk(
    context: OperationContext,
    input: RecordSelfReportAskCommand,
  ): Promise<SelfReportAskEvent> {
    return this.repository.withHotPathLock(
      context.workspaceId,
      `self-report:${input.workId}`,
      async (repository) => {
        const events = projectSelfReportAskEvents(
          await repository.listAuditEvents(
            context.workspaceId,
            AUDIT_SELF_REPORT,
          ),
        );
        const now = this.now();

        if (input.action === 'mark_asked') {
          const existing = events.filter((row) => row.workId === input.workId);
          if (existing.length > 0) {
            throw new PublishHandoffError(
              'SELF_REPORT_ASK_CONFLICT',
              'This Work was already asked (U2 maxAsksPerWork=1).',
            );
          }
          const row: SelfReportAskEvent = {
            askId: input.askId ?? this.id(),
            workId: input.workId,
            contentPackageId: input.contentPackageId,
            contentPackageRevision: input.contentPackageRevision,
            askedAt: now,
            status: 'asked',
          };
          await repository.appendAuditEvent(
            selfReportAuditEvent(context, this.id(), now, row),
          );
          return row;
        }

        const target =
          (input.askId
            ? events.find((row) => row.askId === input.askId)
            : undefined) ??
          [...events].reverse().find((row) => row.workId === input.workId);

        // Chip answer can land without a prior system ask (merchant opens
        // outcome panel directly). Create an answered row so U2 max-once
        // still holds for the Work.
        if (!target) {
          if (input.action === 'mark_ignored') {
            throw new PublishHandoffError(
              'SELF_REPORT_ASK_NOT_FOUND',
              'No self-report ask found for this Work.',
            );
          }
          const row: SelfReportAskEvent = {
            askId: input.askId ?? this.id(),
            workId: input.workId,
            contentPackageId: input.contentPackageId,
            contentPackageRevision: input.contentPackageRevision,
            askedAt: now,
            status: 'answered',
            answeredAt: now,
          };
          await repository.appendAuditEvent(
            selfReportAuditEvent(context, this.id(), now, row),
          );
          return row;
        }

        if (target.status === 'answered' || target.status === 'ignored') {
          return target;
        }
        const updated: SelfReportAskEvent =
          input.action === 'mark_ignored'
            ? { ...target, status: 'ignored', ignoredAt: now }
            : { ...target, status: 'answered', answeredAt: now };
        // Append-only correction of status (latest projection wins).
        await repository.appendAuditEvent(
          selfReportAuditEvent(context, this.id(), now, updated),
        );
        return updated;
      },
    );
  }

  private async capabilityFor(
    platform: string,
  ): Promise<ContentPackageDeliveryCapability> {
    if (this.resolveCapability) {
      return this.resolveCapability(platform);
    }
    // Default launch freeze: automatic_verified = 0 → assisted when export path exists.
    return {
      mode: 'assisted',
      platform: platform as ContentPackageDeliveryCapability['platform'],
      reason: 'automatic_publish_not_fully_verified',
    };
  }

  private async requirePackage(
    context: OperationContext,
    packageId: string,
    expectedRevision?: number,
  ): Promise<ContentPackage> {
    const contentPackage = await this.repository.getContentPackage(
      context.workspaceId,
      packageId,
    );
    if (!contentPackage) {
      throw new PublishHandoffError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'ContentPackage was not found.',
      );
    }
    if (
      expectedRevision !== undefined &&
      contentPackage.revision !== expectedRevision
    ) {
      throw new PublishHandoffError(
        'CONTENT_PACKAGE_REVISION_CONFLICT',
        `ContentPackage revision conflict: expected ${expectedRevision}, got ${contentPackage.revision}.`,
      );
    }
    return structuredClone(contentPackage);
  }
}
