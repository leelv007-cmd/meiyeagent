import type { ContentPackage } from '@meiye/contracts';

export function mobileContentPackage(
  contentPackages: ContentPackage[],
  binding: { packageId?: string; workId?: string }
) {
  if (binding.packageId) {
    const exact = contentPackages.find(
      (contentPackage) => contentPackage.id === binding.packageId
    );
    return !binding.workId || exact?.source.workId === binding.workId
      ? exact
      : undefined;
  }
  if (!binding.workId) {
    return [...contentPackages].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )[0];
  }
  return contentPackages
    .filter((contentPackage) => contentPackage.source.workId === binding.workId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}
