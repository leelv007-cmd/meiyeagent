import { useId, type ReactNode } from 'react';

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

export interface WarmEmptyStateProps {
  media: ReactNode;
  title: string;
  description?: string;
  action: ReactNode;
}

export function WarmEmptyState({
  media,
  title,
  description,
  action,
}: WarmEmptyStateProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId}>
      <Empty>
        <EmptyMedia variant="icon" aria-hidden="true">
          {media}
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle id={titleId}>{title}</EmptyTitle>
          {description ? (
            <EmptyDescription>{description}</EmptyDescription>
          ) : null}
        </EmptyHeader>
        <EmptyContent>{action}</EmptyContent>
      </Empty>
    </section>
  );
}
