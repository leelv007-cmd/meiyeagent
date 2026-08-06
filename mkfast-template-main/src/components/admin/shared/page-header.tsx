import { Badge } from '@/components/reui/badge';
import type { ReactNode } from 'react';

// Consistent page-level header chrome for every admin content page: a
// prominent title with an optional count badge, an optional subtitle, and an
// actions slot on the right.
//
// The title is CENTER-aligned against the actions and the row carries a
// min-height matching the action buttons (h-8). Bottom-aligning instead
// (items-end) lets the title's vertical position ride on whatever sits on the
// right, so the same heading lands at a different Y on every page. Centering
// in a fixed-height row pins it to one position everywhere.
export function PageHeader({
  title,
  count,
  description,
  actions,
}: {
  title: string;
  count?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:min-h-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <h1 className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
            {title}
          </h1>
          {count && (
            <Badge variant="secondary" radius="full" className="tabular-nums">
              {count}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
