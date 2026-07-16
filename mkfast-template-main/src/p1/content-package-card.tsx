import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { m } from '@/locale/paraglide/messages';
import type { CanonicalMediaProjection } from '@/product/canonical-history-model';
import type {
  ContentPackage,
  ContentPackageStatusGroup,
} from '@meiye/contracts';
import { IconFileText, IconVideo } from '@tabler/icons-react';

export type ContentPackageProjection = ContentPackage & {
  statusGroup: ContentPackageStatusGroup;
  statusLabel: string;
};

export function ContentPackageCard({
  contentPackage,
  media = [],
  onOpen,
}: {
  contentPackage: ContentPackageProjection;
  media?: CanonicalMediaProjection[];
  onOpen?: () => void;
}) {
  const currentVersion = contentPackage.versions.find(
    (version) => version.id === contentPackage.currentVersionId
  );
  const assetCount =
    currentVersion?.orderedAssetIds.length ??
    contentPackage.generated.assetIds.length;
  const isVideo = contentPackage.kind === 'video';
  const resolvedMedia = [...media];
  for (const asset of contentPackage.generated.ownedAssets ?? []) {
    if (resolvedMedia.some((item) => item.assetId === asset.id)) continue;
    resolvedMedia.push({
      assetId: asset.id,
      href: `/dashboard/assets/${encodeURIComponent(asset.id)}`,
      kind: asset.contentType.startsWith('video/') ? 'video' : 'image',
      src: `/api/core/p1/assets?objectKey=${encodeURIComponent(asset.objectKey)}`,
      title: currentVersion?.title || m.content_package_untitled(),
    });
  }

  return (
    <Card
      className="rounded-md bg-surface-1 shadow-none"
      data-content-package-id={contentPackage.id}
      id={`content-package-${contentPackage.id}`}
    >
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {isVideo ? <IconVideo /> : <IconFileText />}
            {isVideo
              ? m.content_package_kind_video()
              : m.content_package_kind_image_text()}
          </Badge>
          <Badge className="ml-auto" variant="outline">
            {contentPackage.statusLabel}
          </Badge>
          {contentPackage.legacySource ? (
            <Badge variant="outline">
              {m.content_package_legacy_migrated_badge()}
            </Badge>
          ) : null}
        </div>
        <CardTitle className="text-base leading-6">
          {currentVersion?.title || m.content_package_untitled()}
        </CardTitle>
        {currentVersion?.body ? (
          <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
            {currentVersion.body}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {resolvedMedia.length > 0 ? (
          <div className="grid basis-full grid-cols-2 gap-2 sm:grid-cols-3">
            {resolvedMedia.map((item) =>
              item.kind === 'video' ? (
                <video
                  aria-label={item.title}
                  className="aspect-video w-full rounded-md bg-muted object-cover"
                  controls
                  key={item.assetId}
                  muted
                  playsInline
                  preload="metadata"
                  src={item.src}
                />
              ) : (
                <img
                  alt={item.title}
                  className="aspect-4/3 w-full rounded-md bg-muted object-cover"
                  key={item.assetId}
                  loading="lazy"
                  src={item.src}
                />
              )
            )}
          </div>
        ) : null}
        <span>{m.content_package_asset_count({ count: assetCount })}</span>
        {contentPackage.variants.map((variant) => (
          <Badge key={variant.platform} variant="outline">
            {variant.platform === 'xiaohongshu'
              ? m.creation_entry_platform_xiaohongshu()
              : variant.platform === 'douyin'
                ? m.creation_entry_platform_douyin()
                : m.content_package_platform_video_account()}
          </Badge>
        ))}
        {contentPackage.legacySource ? (
          <p className="basis-full text-xs">
            {m.content_package_legacy_source_summary({
              sourceId: contentPackage.legacySource.sourceId,
            })}
            {contentPackage.legacySource.mappingConfidence === 'exact'
              ? ''
              : ` · ${m.content_package_legacy_source_partial()}`}
          </p>
        ) : null}
        {onOpen ? (
          <Button
            className="ml-auto"
            onClick={onOpen}
            size="sm"
            variant="outline"
          >
            {m.content_package_view_details()}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
