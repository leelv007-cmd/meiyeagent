/**
 * ContentPackage → coverage + signal facts (V31-24 one-shot wiring).
 *
 * Read-only projection over already-owned ContentPackage rows:
 * - delivered = status usable (review_ready | accepted)
 * - published = deliveryEvents publish result status=published
 * - evidence = active resultSignals (V31-19 physical ledger)
 *
 * Does not invent statistics truth; reuses package fields only.
 */

import {
  contentPackageStatusGroup,
  type ContentPackageStatus,
} from '@meiye/contracts';

import type { ProactiveEvidenceCoveragePort } from './proactive-service.js';
import type { ProactiveSignal } from '@meiye/contracts';

/** Minimal package shape needed for coverage/signals — structural, not a new store. */
export type OwnedContentPackageFact = {
  id: string;
  workspaceId: string;
  status: string;
  updatedAt: string;
  createdAt?: string;
  resultSignals?: readonly OwnedResultSignalFact[];
  deliveryEvents?: readonly OwnedDeliveryEventFact[];
};

export type OwnedResultSignalFact = {
  id: string;
  kind: string;
  occurredAt: string;
  /**
   * Exact consumed ContentPackage revision, or `'unknown'` for the quarantined
   * legacy rows the V31-19 migration could not prove. Declared here because a
   * missing declaration silently dropped the field and let unprovable history
   * count as valid evidence.
   */
  contentPackageRevision?: number | 'unknown';
  status?: 'active' | 'superseded' | 'withdrawn' | string;
  supersedesSignalId?: string;
};

export type OwnedDeliveryEventFact = {
  type: string;
  status?: string;
  occurredAt?: string;
  operation?: string;
};

export type ContentPackageFactsReader = {
  listPackages(input: {
    resourceId: string;
  }): Promise<readonly OwnedContentPackageFact[]> | readonly OwnedContentPackageFact[];
};

/** Delivered for merchant progress = usable status group (review_ready | accepted). */
export function isDeliveredContentPackage(status: string): boolean {
  if (
    status !== 'draft' &&
    status !== 'needs_input' &&
    status !== 'generating' &&
    status !== 'verifying' &&
    status !== 'partial' &&
    status !== 'review_ready' &&
    status !== 'accepted' &&
    status !== 'needs_replacement' &&
    status !== 'cancelling' &&
    status !== 'cancelled' &&
    status !== 'save_unknown' &&
    status !== 'export_failed'
  ) {
    return false;
  }
  return contentPackageStatusGroup(status as ContentPackageStatus) === 'usable';
}

/** Mirrors hasPublishedDelivery in content-package-delivery (owned publish marks only). */
export function isPublishedContentPackage(
  packageRow: OwnedContentPackageFact,
): boolean {
  return (packageRow.deliveryEvents ?? []).some(
    (event) =>
      (event.type === 'automatic_publish_result' ||
        event.type === 'manual_publish_result') &&
      event.status === 'published',
  );
}

/**
 * Active latest projection over append-only resultSignals (V31-19 semantics).
 * Same rules as projectActiveResultSignals — kept local to avoid write-path imports.
 */
export function projectActiveOwnedResultSignals(
  history: readonly OwnedResultSignalFact[],
): OwnedResultSignalFact[] {
  const superseded = new Set(
    history
      .map((row) => row.supersedesSignalId)
      .filter((id): id is string => Boolean(id)),
  );
  return history.filter(
    (row) =>
      // Quarantine filter (the twin's rule): a row that cannot name the exact
      // revision it observed is not provable evidence, so U2's first-window
      // coverage must not count it.
      typeof row.contentPackageRevision === 'number' &&
      (row.status ?? 'active') !== 'withdrawn' &&
      (row.status ?? 'active') !== 'superseded' &&
      !superseded.has(row.id),
  );
}

export function packageHasActiveOutcomeEvidence(
  packageRow: OwnedContentPackageFact,
): boolean {
  return (
    projectActiveOwnedResultSignals(packageRow.resultSignals ?? []).length > 0
  );
}

export function listDeliveredPackages(
  packages: readonly OwnedContentPackageFact[],
  resourceId: string,
): OwnedContentPackageFact[] {
  return packages.filter(
    (row) =>
      row.workspaceId === resourceId && isDeliveredContentPackage(row.status),
  );
}

/**
 * Coverage projection:
 * - denominator = delivered packages
 * - numerator = delivered packages with ≥1 active OutcomeEvidence (resultSignals)
 */
export function projectEvidenceCoverageCounts(input: {
  resourceId: string;
  packages: readonly OwnedContentPackageFact[];
}): { denominator: number; numerator: number } {
  const delivered = listDeliveredPackages(input.packages, input.resourceId);
  const withEvidence = delivered.filter(packageHasActiveOutcomeEvidence);
  return {
    denominator: delivered.length,
    numerator: withEvidence.length,
  };
}

export class ContentPackageEvidenceCoveragePort
  implements ProactiveEvidenceCoveragePort
{
  constructor(private readonly reader: ContentPackageFactsReader) {}

  async countDelivered(input: { resourceId: string }): Promise<number> {
    const packages = await this.reader.listPackages(input);
    return projectEvidenceCoverageCounts({
      resourceId: input.resourceId,
      packages,
    }).denominator;
  }

  async countWithEvidence(input: { resourceId: string }): Promise<number> {
    const packages = await this.reader.listPackages(input);
    return projectEvidenceCoverageCounts({
      resourceId: input.resourceId,
      packages,
    }).numerator;
  }
}

export type ContentPackageSignalOptions = {
  /** Days delivered without publish before unpublished_duration (default 3). */
  unpublishedDays?: number;
  /** Days after publish before no-evidence signal (default 1). */
  postPublishEvidenceGraceDays?: number;
};

/**
 * Derive owned signals from ContentPackage facts only:
 * - unpublished_duration: delivered usable, no publish mark, aged past threshold
 * - historical_performance: published, no active outcome signal, past grace
 */
export function deriveContentPackageSignals(input: {
  resourceId: string;
  packages: readonly OwnedContentPackageFact[];
  now: string;
  options?: ContentPackageSignalOptions;
}): ProactiveSignal[] {
  const unpublishedMs =
    (input.options?.unpublishedDays ?? 3) * 24 * 60 * 60 * 1000;
  const graceMs =
    (input.options?.postPublishEvidenceGraceDays ?? 1) *
    24 *
    60 *
    60 *
    1000;
  const nowMs = Date.parse(input.now);
  const out: ProactiveSignal[] = [];

  for (const row of listDeliveredPackages(input.packages, input.resourceId)) {
    const published = isPublishedContentPackage(row);
    if (!published) {
      const baseline = Date.parse(row.updatedAt || row.createdAt || '');
      if (!Number.isFinite(baseline)) continue;
      if (nowMs - baseline < unpublishedMs) continue;
      const days = Math.max(
        1,
        Math.floor((nowMs - baseline) / (24 * 60 * 60 * 1000)),
      );
      out.push({
        kind: 'unpublished_duration',
        resourceId: input.resourceId,
        observedAt: input.now,
        summary: `成品已交付 ${days} 天仍未记录发布`,
        evidenceRefs: [
          { kind: 'content_package_delivered', ref: row.id },
          { kind: 'status', ref: row.status },
        ],
        weight: 2,
      } as ProactiveSignal);
      continue;
    }

    if (packageHasActiveOutcomeEvidence(row)) continue;

    const publishedAt = latestPublishAt(row);
    const baseline = publishedAt
      ? Date.parse(publishedAt)
      : Date.parse(row.updatedAt);
    if (!Number.isFinite(baseline)) continue;
    if (nowMs - baseline < graceMs) continue;
    out.push({
      kind: 'historical_performance',
      resourceId: input.resourceId,
      observedAt: input.now,
      summary: '已发布但尚无经营结果信号',
      evidenceRefs: [
        { kind: 'content_package_published', ref: row.id },
        { kind: 'missing_outcome_evidence', ref: row.id },
      ],
      weight: 2,
    } as ProactiveSignal);
  }

  return out;
}

function latestPublishAt(packageRow: OwnedContentPackageFact): string | null {
  const times = (packageRow.deliveryEvents ?? [])
    .filter(
      (event) =>
        (event.type === 'automatic_publish_result' ||
          event.type === 'manual_publish_result') &&
        event.status === 'published' &&
        event.occurredAt,
    )
    .map((event) => event.occurredAt!)
    .sort();
  return times.at(-1) ?? null;
}
