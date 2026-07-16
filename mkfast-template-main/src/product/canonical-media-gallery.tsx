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
import { m } from '@/locale/paraglide/messages';
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';
import type { CanonicalMediaProjection } from './canonical-history-model';

function MediaDetailLink({ href }: { href: string }) {
  return (
    <a
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      href={getPathWithLocale(href)}
    >
      {m.canonical_media_open_detail()}
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
    <output className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-md bg-muted p-4 text-center">
      <span>
        <span className="block font-medium">
          {m.canonical_media_load_error_title()}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {m.canonical_media_load_error_description()}
        </span>
      </span>
      <span className="flex flex-wrap justify-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <IconRefresh aria-hidden="true" />
          {m.canonical_media_retry()}
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
}: {
  media: CanonicalMediaProjection;
  onActivate?: (
    media: CanonicalMediaProjection,
    trigger: HTMLButtonElement
  ) => void;
  presentation?: 'thumbnail' | 'hero';
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
    <div className="grid min-w-0 content-start">
      <div
        className={cn(
          'group overflow-hidden rounded-lg bg-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
          presentation === 'hero' ? 'min-h-44 max-h-[70vh]' : 'aspect-10/7'
        )}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={m.canonical_media_preview_aria({ title: media.title })}
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
                'size-full transition-opacity group-hover:opacity-80',
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
                'size-full transition-opacity group-hover:opacity-80',
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
          <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/90 px-2 py-1 text-xs font-medium shadow-sm backdrop-blur-sm">
            {media.kind === 'video' ? (
              <IconVideo className="size-3.5" aria-hidden="true" />
            ) : (
              <IconMaximize className="size-3.5" aria-hidden="true" />
            )}
            {media.kind === 'video'
              ? m.canonical_media_video_preview()
              : m.canonical_media_image_preview()}
          </span>
        </button>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">
        {media.title}
      </p>
      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {media.kind === 'video' ? (
          <IconVideo className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <IconPhoto className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">
          {media.kind === 'video'
            ? m.canonical_media_kind_video()
            : m.canonical_media_kind_image()}
        </span>
      </p>
      <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="truncate">{media.assetId}</span>
        <span className="shrink-0">
          <MediaDetailLink href={media.href} />
        </span>
      </div>
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
          {m.canonical_media_close()}
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
                className="max-h-[calc(100svh-8rem)] w-full rounded-lg object-contain"
                onError={() => setFailed(true)}
                src={media.src}
              />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: Generated media has no caption artifact to attach.
              <video
                key={`${media.src}:${attempt}`}
                ref={videoRef}
                aria-label={media.title}
                className="max-h-[calc(100svh-8rem)] w-full rounded-lg object-contain"
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
                {m.canonical_media_dialog_description()}
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
                  ? m.canonical_media_kind_video()
                  : m.canonical_media_kind_image()}
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
}: {
  className?: string;
  media: CanonicalMediaProjection[];
  presentation?: 'thumbnail' | 'hero';
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
            : 'grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 xl:gap-x-8',
          className
        )}
      >
        {media.map((item) => (
          <CanonicalMediaPreview
            key={item.assetId}
            media={item}
            presentation={presentation}
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
