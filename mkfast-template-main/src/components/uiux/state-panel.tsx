import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProductIcon } from './product-icon';
import {
  IconAlertTriangle,
  IconCircleDashed,
  IconFolderOff,
  IconLock,
  IconRefresh,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';

type StatePanelKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'unknown'
  | 'permission-denied';

const stateIcon = {
  loading: IconCircleDashed,
  empty: IconFolderOff,
  error: IconAlertTriangle,
  unknown: IconAlertTriangle,
  'permission-denied': IconLock,
} as const;

interface StatePanelProps {
  actionLabel?: string;
  children?: ReactNode;
  description: string;
  kind: StatePanelKind;
  onAction?: () => void;
  title: string;
}

export function StatePanel({
  actionLabel,
  children,
  description,
  kind,
  onAction,
  title,
}: StatePanelProps) {
  const Icon = stateIcon[kind];
  const isBlocking =
    kind === 'error' || kind === 'unknown' || kind === 'permission-denied';
  return (
    <section
      aria-busy={kind === 'loading' ? true : undefined}
      aria-live={kind === 'loading' ? 'polite' : undefined}
      className={cn(
        'grid min-h-44 place-items-center rounded-lg bg-surface-1 p-6 text-center',
        isBlocking && 'border border-destructive/40 bg-destructive/10'
      )}
    >
      <div className="max-w-md space-y-3">
        <span
          className={cn(
            'mx-auto grid size-10 place-items-center rounded-full bg-surface-2 text-muted-foreground',
            isBlocking && 'bg-destructive/10 text-destructive'
          )}
        >
          <ProductIcon
            className={kind === 'loading' ? 'animate-spin' : undefined}
            icon={Icon}
            size={20}
          />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {children}
        {actionLabel && onAction ? (
          <Button type="button" variant="outline" onClick={onAction}>
            <ProductIcon icon={IconRefresh} size={16} />
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
