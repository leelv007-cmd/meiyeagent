/**
 * 作品媒体画廊 — T32 / #226.
 *
 * The old `canonical-media-gallery` is delete-after-reshell (归桶矩阵 §3), so
 * the new surface carries its own gallery rather than importing a page slated
 * for removal. It renders only what the canonical projection delivered: no
 * asset-library links, no object-id chrome (ADR-0011 D07).
 */

import { cn } from '@/lib/utils';

import type { WorkMedia } from './works-projection';

export function WorksMediaGallery({
  className,
  media,
  /** Cover-only mode for the list card. */
  cover = false,
}: {
  className?: string;
  cover?: boolean;
  media: readonly WorkMedia[];
}) {
  if (media.length === 0) return null;
  const items = cover ? media.slice(0, 1) : media;

  return (
    <ul
      className={cn(
        cover
          ? 'grid grid-cols-1'
          : 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
        className
      )}
      data-testid="works-media-gallery"
    >
      {items.map((item) => (
        <li
          className={cn(
            'bg-muted relative overflow-hidden',
            cover ? 'aspect-5/4' : 'aspect-4/5 rounded-2xl sm:aspect-5/4'
          )}
          data-media-kind={item.kind}
          key={item.assetId}
        >
          {item.kind === 'video' ? (
            <video
              aria-label={item.title}
              className="absolute inset-0 size-full object-cover"
              controls={!cover}
              muted
              playsInline
              preload="metadata"
              src={item.src}
            />
          ) : (
            <img
              alt={item.title}
              className="absolute inset-0 size-full object-cover"
              loading="lazy"
              src={item.src}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
