import type {
  ContentPackage,
  ContentPackageLegacySource,
} from '@meiye/contracts';

export interface LegacyContentCountItem {
  id: string;
  sourceType: ContentPackageLegacySource['sourceType'];
}

function legacySourceKey(
  sourceType: ContentPackageLegacySource['sourceType'],
  sourceId: string
) {
  return `${sourceType}\0${sourceId}`;
}

export function contentCount(
  legacyContents: readonly LegacyContentCountItem[],
  contentPackages: ReadonlyArray<Pick<ContentPackage, 'legacySource'>>
) {
  const migratedLegacySources = new Set(
    contentPackages.flatMap((contentPackage) =>
      contentPackage.legacySource
        ? [
            legacySourceKey(
              contentPackage.legacySource.sourceType,
              contentPackage.legacySource.sourceId
            ),
          ]
        : []
    )
  );
  const unmigratedLegacyCount = legacyContents.filter(
    (content) =>
      !migratedLegacySources.has(
        legacySourceKey(content.sourceType, content.id)
      )
  ).length;

  return contentPackages.length + unmigratedLegacyCount;
}
