import { useId, type ReactNode } from 'react';

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

export interface WarmEmptyStateProps {
  media: ReactNode;
  title: string;
  description?: string;
  action: ReactNode;
  className?: string;
}

export function WarmEmptyState({
  media,
  title,
  description,
  action,
  className,
}: WarmEmptyStateProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className={cn(className)}>
      <Empty className="meiye-porcelain gap-5 rounded-2xl px-6 py-10 sm:px-10 sm:py-12">
        <EmptyMedia
          className="size-12 rounded-2xl bg-surface-2 text-foreground [&_svg:not([class*='size-'])]:size-6"
          variant="icon"
          aria-hidden="true"
        >
          {media}
        </EmptyMedia>
        <EmptyHeader className="max-w-md gap-2.5">
          <EmptyTitle
            className="text-base font-semibold tracking-tight"
            id={titleId}
          >
            {title}
          </EmptyTitle>
          {description ? (
            <EmptyDescription className="text-sm leading-6 text-muted-foreground">
              {description}
            </EmptyDescription>
          ) : null}
        </EmptyHeader>
        <EmptyContent className="mt-1">{action}</EmptyContent>
      </Empty>
    </section>
  );
}
