import type {
  PublicContentPackage,
  TodayRecommendationState,
} from '@meiye/contracts';

import { operationsQuery } from '@/p1/client';
import { readTodayRecommendation } from '@/product/harness-client';

/**
 * Dashboard recommendation read model.
 *
 * The Harness projection remains authoritative when it has a current
 * recommendation. Some normal Composer deliveries predate the Harness
 * `package_delivered` audit shape, though, while still producing a canonical
 * ContentPackage. In that case the newest usable package is the honest hot
 * state instead of an empty recommendation card.
 */
export function projectDashboardHomeRecommendation(
  harness: TodayRecommendationState,
  contentPackages: readonly PublicContentPackage[]
): TodayRecommendationState {
  if (harness.recommendation || harness.stale) return harness;

  const latest = [...contentPackages]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find((contentPackage) => {
      const version = contentPackage.versions.find(
        (candidate) => candidate.id === contentPackage.currentVersionId
      );
      return Boolean(
        version?.title.trim() &&
          version.body.trim() &&
          version.conversionHook?.trim() &&
          (contentPackage.marketing?.factRefs.length ||
            contentPackage.source.storeProfileId) &&
          harness.currentFactsRevision > 0 &&
          contentPackage.rights.state === 'authorized'
      );
    });
  if (!latest) return harness;

  const version = latest.versions.find(
    (candidate) => candidate.id === latest.currentVersionId
  );
  if (!version?.conversionHook) return harness;

  return {
    currentFactsRevision: harness.currentFactsRevision,
    recommendation: {
      body: version.body,
      createdAt: latest.updatedAt,
      customerAction: version.conversionHook,
      factsRevision: harness.currentFactsRevision,
      factReferences: latest.marketing?.factRefs.length
        ? [...latest.marketing.factRefs]
        : [latest.source.storeProfileId!],
      packageId: latest.id,
      sourceLabel: version.title,
      taskId:
        latest.source.workflowId ??
        latest.source.workId ??
        `content-package:${latest.id}`,
      title: version.title,
      versionId: version.id,
      whyNow: '你最近完成了这份内容，今天可以沿着同一主题继续发',
      workspaceId: latest.workspaceId,
      ...(latest.marketing?.opportunity
        ? { opportunity: latest.marketing.opportunity }
        : {}),
    },
    stale: false,
    workspaceId: latest.workspaceId,
  };
}

export async function readDashboardHomeRecommendation(signal?: AbortSignal) {
  const [harness, contentPackages] = await Promise.all([
    readTodayRecommendation(signal),
    operationsQuery<PublicContentPackage[]>('content_packages', {}, signal),
  ]);
  return projectDashboardHomeRecommendation(harness, contentPackages);
}
