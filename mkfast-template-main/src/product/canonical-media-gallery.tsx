import {
  IconMaximize,
  IconPhoto,
  IconRefresh,
  IconVideo,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  canonical_media_close,
  canonical_media_dialog_description,
  canonical_media_image_preview,
  canonical_media_kind_image,
  canonical_media_kind_video,
  canonical_media_load_error_description,
  canonical_media_load_error_title,
  canonical_media_open_detail,
  canonical_media_preview_aria,
  canonical_media_retry,
  canonical_media_video_preview,
} from '@/locale/paraglide/messages';
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';
import type { CanonicalMediaProjection } from './canonical-history-model';

function MediaDetailLink({ href }: { href: string }) {
  return (
    <a
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      href={getPathWithLocale(href)}
    >
      {canonical_media_open_detail()}
    </a>
  );
}

function MediaFailure({
  href,
  onRetry,
}: {
  href: string;
  onRetry: () => void;
}) {
  return (
    <output className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl bg-muted p-4 text-center">
      <span>
        <span className="block font-medium">
          {canonical_media_load_error_title()}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {canonical_media_load_error_description()}
        </span>
      </span>
      <span className="flex flex-wrap justify-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <IconRefresh aria-hidden="true" />
          {canonical_media_retry()}
        </Button>
        <MediaDetailLink href={href} />
      </span>
    </output>
  );
}

export function CanonicalMediaPreview({
  media,
  onActivate,
  presentation = 'thumbnail',
  showMeta = true,
}: {
  media: CanonicalMediaProjection;
  onActivate?: (
    media: CanonicalMediaProjection,
    trigger: HTMLButtonElement
  ) => void;
  presentation?: 'thumbnail' | 'hero';
  showMeta?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setAttempt(0);
  }, [media.src]);

  if (failed) {
    return (
      <MediaFailure
        href={media.href}
        onRetry={() => {
          setAttempt((value) => value + 1);
          setFailed(false);
        }}
      />
    );
  }

  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div
        className={cn(
          'group relative min-w-0 overflow-hidden rounded-2xl bg-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
          presentation === 'hero' ? 'min-h-44 max-h-[70vh]' : 'aspect-10/7'
        )}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={canonical_media_preview_aria({ title: media.title })}
          className={cn(
            'relative block size-full w-full overflow-hidden text-left outline -outline-offset-1 outline-foreground/10 focus-visible:outline-none',
            presentation === 'hero' ? 'min-h-44 max-h-[70vh]' : 'aspect-10/7'
          )}
          onClick={(event) => onActivate?.(media, event.currentTarget)}
        >
          {media.kind === 'image' ? (
            <img
              key={`${media.src}:${attempt}`}
              alt={media.title}
              className={cn(
                'size-full transition duration-500 ease-out group-hover:scale-[1.03]',
                presentation === 'hero'
                  ? 'max-h-[70vh] object-contain'
                  : 'object-cover'
              )}
              loading="lazy"
              onError={() => setFailed(true)}
              src={media.src}
            />
          ) : (
            <video
              key={`${media.src}:${attempt}`}
              aria-label={media.title}
              className={cn(
                'size-full transition duration-500 ease-out group-hover:scale-[1.03]',
                presentation === 'hero'
                  ? 'max-h-[70vh] object-contain'
                  : 'object-cover'
              )}
              muted
              onError={() => setFailed(true)}
              playsInline
              preload="metadata"
              src={media.src}
            />
          )}

          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/20 group-focus-within:bg-black/20"
          />
          <span
            aria-hidden="true"
            className="meiye-media-mask pointer-events-none absolute inset-x-0 bottom-0 h-[52%] transition-[height] duration-300 group-hover:h-[62%] group-focus-within:h-[62%]"
          />

          <span className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white [text-shadow:0_1px_2px_oklch(0_0_0/0.45)]">
                {media.title}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-white/80">
                {media.kind === 'video' ? (
                  <IconVideo className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <IconPhoto className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">
                  {media.kind === 'video'
                    ? canonical_media_kind_video()
                    : canonical_media_kind_image()}
                </span>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/30 bg-white/15 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {media.kind === 'video' ? (
                <IconVideo className="size-3.5" aria-hidden="true" />
              ) : (
                <IconMaximize className="size-3.5" aria-hidden="true" />
              )}
              {media.kind === 'video'
                ? canonical_media_video_preview()
                : canonical_media_image_preview()}
            </span>
          </span>
        </button>
      </div>
      {showMeta ? (
        <div className="flex min-w-0 items-center justify-between gap-2 px-0.5 text-sm text-muted-foreground">
          <span className="truncate">{media.assetId}</span>
          <span className="shrink-0">
            <MediaDetailLink href={media.href} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CanonicalMediaLightbox({
  media,
  onOpenChange,
  open,
}: {
  media?: CanonicalMediaProjection;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setFailed(false);
    setAttempt(0);
  }, [media?.src]);

  useEffect(() => {
    if (!open) videoRef.current?.pause();
  }, [open]);

  if (!media) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto p-0 sm:max-w-5xl"
        showCloseButton={false}
      >
        <DialogClose
          render={
            <Button
              className="absolute top-4 right-4 z-10 shadow-sm"
              size="sm"
              variant="outline"
            />
          }
        >
          <IconX aria-hidden="true" />
          {canonical_media_close()}
        </DialogClose>
        <div className="grid w-full grid-cols-1 items-stretch sm:grid-cols-12">
          <div className="flex min-h-64 items-center bg-muted p-4 sm:col-span-7 sm:p-6 lg:col-span-8 lg:p-8">
            {failed ? (
              <div className="w-full">
                <MediaFailure
                  href={media.href}
                  onRetry={() => {
                    setAttempt((value) => value + 1);
                    setFailed(false);
                  }}
                />
              </div>
            ) : media.kind === 'image' ? (
              <img
                key={`${media.src}:${attempt}`}
                alt={media.title}
                className="max-h-[calc(100svh-8rem)] w-full rounded-2xl object-contain"
                onError={() => setFailed(true)}
                src={media.src}
              />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: Generated media has no caption artifact to attach.
              <video
                key={`${media.src}:${attempt}`}
                ref={videoRef}
                aria-label={media.title}
                className="max-h-[calc(100svh-8rem)] w-full rounded-2xl object-contain"
                controls
                onError={() => setFailed(true)}
                playsInline
                preload="metadata"
                src={media.src}
              />
            )}
          </div>
          <div className="flex min-w-0 flex-col border-t p-6 sm:col-span-5 sm:border-t-0 sm:border-l lg:col-span-4 lg:p-8">
            <DialogHeader className="pr-20">
              <DialogTitle>{media.title}</DialogTitle>
              <DialogDescription>
                {canonical_media_dialog_description()}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 space-y-2 border-y py-4 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                {media.kind === 'video' ? (
                  <IconVideo className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <IconPhoto className="size-4 shrink-0" aria-hidden="true" />
                )}
                {media.kind === 'video'
                  ? canonical_media_kind_video()
                  : canonical_media_kind_image()}
              </p>
              <p className="truncate">{media.assetId}</p>
            </div>
            <div className="mt-4">
              <MediaDetailLink href={media.href} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CanonicalMediaGallery({
  className,
  media,
  presentation = 'thumbnail',
  showMeta = true,
}: {
  className?: string;
  media: CanonicalMediaProjection[];
  presentation?: 'thumbnail' | 'hero';
  showMeta?: boolean;
}) {
  const [selected, setSelected] = useState<CanonicalMediaProjection>();
  const triggerRef = useRef<HTMLButtonElement | undefined>(undefined);

  const close = () => {
    setSelected(undefined);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  if (media.length === 0) return null;
  return (
    <>
      <div
        className={cn(
          presentation === 'hero'
            ? 'grid gap-3'
            : 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4',
          className
        )}
      >
        {media.map((item) => (
          <CanonicalMediaPreview
            key={item.assetId}
            media={item}
            presentation={presentation}
            showMeta={showMeta}
            onActivate={(next, trigger) => {
              triggerRef.current = trigger;
              setSelected(next);
            }}
          />
        ))}
      </div>
      <CanonicalMediaLightbox
        media={selected}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close();
        }}
        open={Boolean(selected)}
      />
    </>
  );
}
