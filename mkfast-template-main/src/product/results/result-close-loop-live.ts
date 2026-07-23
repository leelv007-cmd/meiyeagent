import type {
  ContentPackagePlatform,
  PublicContentPackage,
} from '@meiye/contracts';

import {
  ASSISTED_RESPONSIBILITY_ROLE_LABEL,
  type AssistedReceipt,
  type DeliveryPanelTarget,
} from './delivery-b3-types';
import {
  deliveryActionReceiptIdempotencyKey,
  receiptKindFromDeliveryEvent,
  type DeliveryActionReceiptFact,
} from './delivery-action-receipt-model';
import {
  observationsFromResultSignals,
  type OutcomeObservationFact,
} from './outcome-observation-model';
import {
  publicationRecordsFromDeliveryEvents,
  type PublicationRecordFact,
} from './publication-record-model';
import type {
  WeeklyNextAction,
  WeeklyReviewFacts,
} from './weekly-review-model';

export type ResultCloseLoopFacts = {
  contentPackageId: string;
  contentPackageRevision: number;
  variantVersionId?: string;
  publicationPlatform?: ContentPackagePlatform;
  workspaceId: string;
  deliveryReceipts: readonly DeliveryActionReceiptFact[];
  publicationRecords: readonly PublicationRecordFact[];
  observations: readonly OutcomeObservationFact[];
  weeklyReview: WeeklyReviewFacts;
  automaticVerifiedPlatformCount: number;
  hasOneShotLink: boolean;
  canShareFiles: boolean;
  hasDownload: boolean;
};

function merchantOwnerLabel(receipt: AssistedReceipt) {
  const role = receipt.binding?.responsibilityRole;
  return role ? ASSISTED_RESPONSIBILITY_ROLE_LABEL[role] : '待确认责任人';
}

function receiptFactsForPackage(
  contentPackage: PublicContentPackage,
  assistedReceipts: readonly AssistedReceipt[]
): DeliveryActionReceiptFact[] {
  const facts: DeliveryActionReceiptFact[] = [];

  for (const receipt of assistedReceipts) {
    const binding = receipt.binding;
    if (!binding || binding.packageId !== contentPackage.id) continue;

    for (const [index, event] of receipt.events.entries()) {
      const kind =
        event.type === 'materials_prepared'
          ? receiptKindFromDeliveryEvent('materials_prepared')
          : event.type === 'handed_over'
            ? receiptKindFromDeliveryEvent('handed_over')
            : null;
      if (!kind) continue;

      facts.push({
        id: `${receipt.id}:${event.type}:${index}`,
        kind,
        binding: {
          accountOrOwnerLabel: merchantOwnerLabel(receipt),
          actorId: 'actorId' in event ? event.actorId : 'system',
          contentPackageId: binding.packageId,
          contentPackageRevision: binding.contentPackageRevision,
          occurredAt: event.occurredAt,
          platform: binding.platform,
          purpose: binding.purpose,
          variantVersionId: binding.variantVersionId,
        },
        idempotencyKey: deliveryActionReceiptIdempotencyKey({
          contentPackageId: binding.packageId,
          contentPackageRevision: binding.contentPackageRevision,
          kind,
          platform: binding.platform,
          purpose: binding.purpose,
        }),
      });
    }
  }

  return facts;
}

function publicationFactsForPackage(
  contentPackage: PublicContentPackage,
  assistedReceipts: readonly AssistedReceipt[]
): PublicationRecordFact[] {
  const native = publicationRecordsFromDeliveryEvents({
    contentPackageId: contentPackage.id,
    contentPackageRevision: contentPackage.revision,
    events: contentPackage.deliveryEvents ?? [],
  });
  const assisted = assistedReceipts.flatMap((receipt) => {
    const binding = receipt.binding;
    const result = receipt.publishResult;
    if (
      !binding ||
      binding.packageId !== contentPackage.id ||
      !result ||
      result.status === 'not_published'
    ) {
      return [];
    }
    return [
      {
        id: `${receipt.id}:publish-result`,
        contentPackageId: binding.packageId,
        contentPackageRevision: binding.contentPackageRevision,
        platform: binding.platform,
        accountDisplayLabel: merchantOwnerLabel(receipt),
        publishedAt: result.recordedAt,
        actorId: 'assisted_handoff',
        sourceTier: 'manual_record' as const,
        createdAt: result.recordedAt,
        status: result.status,
        variantVersionId: binding.variantVersionId,
        ...(result.platformUrl ? { platformUrl: result.platformUrl } : {}),
        ...(result.note ? { note: result.note } : {}),
      },
    ];
  });
  return [...native, ...assisted];
}

function weekBounds(nowIso: string) {
  const now = new Date(nowIso);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function weeklyFactsFromPackages(input: {
  contentPackages: readonly PublicContentPackage[];
  assistedReceipts: readonly AssistedReceipt[];
  nowIso: string;
  workspaceId: string;
}): WeeklyReviewFacts {
  const packages = input.contentPackages.filter(
    (contentPackage) => contentPackage.workspaceId === input.workspaceId
  );
  const publications = packages.flatMap((contentPackage) =>
    publicationFactsForPackage(contentPackage, input.assistedReceipts)
  );
  const observations = packages.flatMap((contentPackage) =>
    observationsFromResultSignals({
      workspaceId: contentPackage.workspaceId,
      contentPackageId: contentPackage.id,
      contentPackageRevision: contentPackage.revision,
      publicationRecordId: publications.find(
        (publication) =>
          publication.contentPackageId === contentPackage.id &&
          publication.status === 'published'
      )?.id,
      signals: contentPackage.resultSignals ?? [],
    })
  );
  const { start, end } = weekBounds(input.nowIso);

  return {
    workspaceId: input.workspaceId,
    weekStartedAt: start,
    weekEndedAt: end,
    packages: packages.map((contentPackage) => {
      const current = contentPackage.versions.find(
        (version) => version.id === contentPackage.currentVersionId
      );
      return {
        contentPackageId: contentPackage.id,
        title: current?.title ?? '成品',
        platform: contentPackage.variants[0]?.platform,
        ctaLabel: current?.conversionHook,
        revision: contentPackage.revision,
      };
    }),
    publications,
    observations,
    lastDecisionByPackageId: Object.fromEntries(
      packages.flatMap((contentPackage) => {
        const action = contentPackage.resultReviewActions?.at(-1)?.action;
        return action ? [[contentPackage.id, action as WeeklyNextAction]] : [];
      })
    ),
  };
}

export function projectResultCloseLoopFacts(input: {
  contentPackage: PublicContentPackage;
  contentPackages: readonly PublicContentPackage[];
  assistedReceipts: readonly AssistedReceipt[];
  canShareFiles: boolean;
  hasDownload: boolean;
  nowIso: string;
  preferredPlatform?: DeliveryPanelTarget;
}): ResultCloseLoopFacts {
  const variant =
    input.contentPackage.variants.find(
      (candidate) => candidate.platform === input.preferredPlatform
    ) ?? input.contentPackage.variants[0];
  const publications = publicationFactsForPackage(
    input.contentPackage,
    input.assistedReceipts
  );

  return {
    contentPackageId: input.contentPackage.id,
    contentPackageRevision: input.contentPackage.revision,
    ...(variant
      ? {
          publicationPlatform: variant.platform,
          // Bind the exact platform *version* — not the variant entity id —
          // so record_content_package_manual_result can resolve the variant.
          variantVersionId: variant.currentVersionId,
        }
      : {}),
    workspaceId: input.contentPackage.workspaceId,
    deliveryReceipts: receiptFactsForPackage(
      input.contentPackage,
      input.assistedReceipts
    ),
    publicationRecords: publications,
    observations: observationsFromResultSignals({
      workspaceId: input.contentPackage.workspaceId,
      contentPackageId: input.contentPackage.id,
      contentPackageRevision: input.contentPackage.revision,
      publicationRecordId: publications.find(
        (publication) => publication.status === 'published'
      )?.id,
      signals: input.contentPackage.resultSignals ?? [],
    }),
    weeklyReview: weeklyFactsFromPackages({
      contentPackages: input.contentPackages,
      assistedReceipts: input.assistedReceipts,
      nowIso: input.nowIso,
      workspaceId: input.contentPackage.workspaceId,
    }),
    automaticVerifiedPlatformCount: 0,
    hasOneShotLink: input.assistedReceipts.some(
      (receipt) =>
        receipt.binding?.packageId === input.contentPackage.id &&
        Boolean(receipt.handoffLink)
    ),
    canShareFiles: input.canShareFiles,
    hasDownload: input.hasDownload,
  };
}
