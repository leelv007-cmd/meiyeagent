import { Button } from '@/components/ui/button';
import {
  content_package_asset_count,
  content_package_kind_image_text,
  content_package_kind_video,
  content_package_legacy_migrated_badge,
  content_package_legacy_source_partial,
  content_package_legacy_source_summary,
  content_package_platform_video_account,
  content_package_untitled,
  content_package_view_details,
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
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

function platformLabel(platform: string) {
  if (platform === 'xiaohongshu') return creation_entry_platform_xiaohongshu();
  if (platform === 'douyin') return creation_entry_platform_douyin();
  return content_package_platform_video_account();
}

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
  const title = currentVersion?.title || content_package_untitled();
  const generatedMediaIds = new Set(contentPackage.generated.assetIds);
  const resolvedMedia = [
    ...media.filter((item) => generatedMediaIds.has(item.assetId)),
    ...media.filter((item) => !generatedMediaIds.has(item.assetId)),
  ];
  for (const asset of contentPackage.generated.ownedAssets ?? []) {
    if (resolvedMedia.some((item) => item.assetId === asset.id)) continue;
    resolvedMedia.push({
      assetId: asset.id,
      href: `/dashboard/assets/${encodeURIComponent(asset.id)}`,
      kind: asset.contentType.startsWith('video/') ? 'video' : 'image',
      src: `/api/core/p1/assets?objectKey=${encodeURIComponent(asset.objectKey)}`,
      title: title,
    });
  }
  const hasMedia = resolvedMedia.length > 0;

  return (
    <article
      className="group meiye-porcelain relative flex h-full flex-col overflow-hidden rounded-2xl"
      data-content-package-id={contentPackage.id}
      data-has-media={hasMedia ? 'true' : 'false'}
      id={`content-package-${contentPackage.id}`}
    >
      <div className="relative aspect-4/5 w-full overflow-hidden bg-muted sm:aspect-5/4">
        {hasMedia ? (
          resolvedMedia.map((item, index) =>
            item.kind === 'video' ? (
              <video
                aria-label={item.title}
                className={cn(
                  index === 0
                    ? 'absolute inset-0 size-full object-cover'
                    : 'sr-only'
                )}
                controls={index === 0}
                key={item.assetId}
                muted
                playsInline
                preload="metadata"
                src={item.src}
              />
            ) : (
              <img
                alt={item.title}
                className={cn(
                  index === 0
                    ? 'absolute inset-0 size-full object-cover transition duration-500 ease-out group-hover:scale-[1.03] group-focus-within:scale-[1.03]'
                    : 'sr-only'
                )}
                key={item.assetId}
                loading="lazy"
                src={item.src}
              />
            )
          )
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
          >
            {isVideo ? (
              <IconVideo className="size-10 opacity-60" />
            ) : (
              <IconFileText className="size-10 opacity-60" />
            )}
          </div>
        )}

        {hasMedia ? (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[oklch(0_0_0/0)] transition-colors duration-300 group-hover:bg-[oklch(0_0_0/0.25)] group-focus-within:bg-[oklch(0_0_0/0.25)]"
            />
            <div
              aria-hidden="true"
              className="meiye-media-mask pointer-events-none absolute inset-x-0 bottom-0 h-[58%] transition-[height] duration-300 group-hover:h-[70%] group-focus-within:h-[70%]"
            />
          </>
        ) : null}

        <div
          className={cn(
            'absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 p-4',
            hasMedia
              ? 'pt-16'
              : // DESIGN.md: no-media cards use porcelain title band + ink text
                // (dark porcelain + white-alpha ink in dark theme; paper + dark ink in light)
                'border-t border-divider bg-[var(--paper)] pt-4'
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <h3
              className={cn(
                'min-w-0 text-base font-semibold leading-6',
                hasMedia
                  ? 'text-white [text-shadow:0_1px_2px_oklch(0_0_0/0.45)]'
                  : 'text-[var(--ink-90)]'
              )}
            >
              {title}
            </h3>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium',
                hasMedia
                  ? 'border-white/30 bg-white/15 text-white backdrop-blur-sm'
                  : 'border-divider bg-[var(--paper)] text-[var(--ink-90)]'
              )}
            >
              {contentPackage.statusLabel}
            </span>
          </div>

          {currentVersion?.body ? (
            <p
              className={cn(
                'line-clamp-2 text-sm leading-5',
                hasMedia
                  ? 'text-white/88 [text-shadow:0_1px_2px_oklch(0_0_0/0.35)]'
                  : 'text-[var(--ink-60)]'
              )}
            >
              {currentVersion.body}
            </p>
          ) : null}

          <div
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs',
              hasMedia ? 'text-white/80' : 'text-[var(--ink-60)]'
            )}
          >
            <span>
              {isVideo
                ? content_package_kind_video()
                : content_package_kind_image_text()}
            </span>
            <span aria-hidden="true">·</span>
            <span>{content_package_asset_count({ count: assetCount })}</span>
            {contentPackage.variants.map((variant) => (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5',
                  hasMedia
                    ? 'border-white/25 bg-white/10'
                    : 'border-divider bg-[var(--paper)]'
                )}
                key={variant.platform}
              >
                {platformLabel(variant.platform)}
              </span>
            ))}
            {contentPackage.legacySource ? (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5',
                  hasMedia
                    ? 'border-white/25 bg-white/10'
                    : 'border-divider bg-[var(--paper)]'
                )}
              >
                {content_package_legacy_migrated_badge()}
              </span>
            ) : null}
          </div>

          {contentPackage.legacySource ? (
            <p
              className={cn(
                'text-xs',
                hasMedia ? 'text-white/70' : 'text-[var(--ink-60)]'
              )}
            >
              {content_package_legacy_source_summary({
                sourceId: contentPackage.legacySource.sourceId,
              })}
              {contentPackage.legacySource.mappingConfidence === 'exact'
                ? ''
                : ` · ${content_package_legacy_source_partial()}`}
            </p>
          ) : null}

          {onOpen ? (
            <div className="pt-1 opacity-100 transition-opacity duration-300 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <Button
                className={
                  hasMedia
                    ? 'border-white/40 bg-white/15 text-white hover:bg-white/25 hover:text-white focus-visible:ring-white/50'
                    : undefined
                }
                onClick={onOpen}
                size="sm"
                type="button"
                variant="outline"
              >
                {content_package_view_details()}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
