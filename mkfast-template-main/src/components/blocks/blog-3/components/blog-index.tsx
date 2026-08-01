import { useEffect, useState } from 'react';

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel';
import { Progress, ProgressLabel } from '@/components/ui/progress';

import { BLOG_POSTS } from './data';
import { PostCard } from './post-card';

function getVisibleArticleCount() {
  if (typeof window === 'undefined') return 1;
  if (window.matchMedia('(min-width: 1024px)').matches) return 3;
  if (window.matchMedia('(min-width: 640px)').matches) return 2;
  return 1;
}

export function BlogIndex() {
  const [api, setApi] = useState<CarouselApi>();
  const [carouselState, setCarouselState] = useState({
    selected: 0,
    visible: 1,
  });

  useEffect(() => {
    if (!api) return;

    const updateCarouselState = () => {
      setCarouselState({
        selected: api.selectedScrollSnap(),
        visible: getVisibleArticleCount(),
      });
    };

    updateCarouselState();
    api.on('select', updateCarouselState);
    api.on('reInit', updateCarouselState);

    return () => {
      api.off('select', updateCarouselState);
      api.off('reInit', updateCarouselState);
    };
  }, [api]);

  const currentStart = carouselState.selected + 1;
  const currentEnd = Math.min(
    carouselState.selected + carouselState.visible,
    BLOG_POSTS.length
  );
  const progressValue = (currentEnd / BLOG_POSTS.length) * 100;

  return (
    <Carousel
      setApi={setApi}
      opts={{ align: 'start', containScroll: 'trimSnaps' }}
      className="flex flex-col gap-5 md:gap-6"
      aria-label="Featured blog articles"
    >
      <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex max-w-3xl flex-col gap-2.5">
          <span className="text-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            Blog
          </span>
          <h1 className="text-foreground max-w-[32rem] text-3xl leading-tight font-semibold tracking-tight whitespace-nowrap sm:text-4xl sm:leading-tight lg:text-[2.35rem]">
            Notes & Insights
          </h1>
        </div>

        <div className="flex items-center gap-2 lg:pb-1">
          <CarouselPrevious
            type="button"
            variant="outline"
            size="icon-sm"
            className="static top-auto left-auto size-10 translate-y-0 rounded-full [&_svg]:size-5"
            aria-label="Previous articles"
          />
          <CarouselNext
            type="button"
            variant="default"
            size="icon-sm"
            className="static top-auto right-auto size-10 translate-y-0 rounded-full [&_svg]:size-5"
            aria-label="Next articles"
          />
        </div>
      </header>

      <Progress
        value={progressValue}
        aria-label={`Showing articles ${currentStart} to ${currentEnd} of ${BLOG_POSTS.length}`}
        className="bg-border [&_[data-slot=progress-indicator]]:bg-foreground h-px [&_[data-slot=progress-track]]:h-px"
      >
        <ProgressLabel className="sr-only">
          Showing articles {currentStart} to {currentEnd} of {BLOG_POSTS.length}
        </ProgressLabel>
      </Progress>

      <CarouselContent className="-ml-5">
        {BLOG_POSTS.map((post) => (
          <CarouselItem
            key={post.id}
            className="basis-full pl-5 sm:basis-1/2 lg:basis-1/3"
          >
            <PostCard post={post} />
          </CarouselItem>
        ))}
      </CarouselContent>
    </Carousel>
  );
}
