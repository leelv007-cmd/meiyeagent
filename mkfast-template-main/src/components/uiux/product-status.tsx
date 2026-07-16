import { Badge } from '@/components/ui/badge';
import { productStatusView, type ProductStatusTone } from '@/lib/uiux/status';
import { cn } from '@/lib/utils';

const toneStyle: Record<ProductStatusTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
  success: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200',
  warning:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  danger: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200',
};

const toneDotStyle: Record<ProductStatusTone, string> = {
  neutral: 'bg-gray-400',
  progress: 'bg-blue-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  danger: 'bg-red-500',
};

interface ProductStatusProps {
  announce?: boolean;
  className?: string;
  showExplanation?: boolean;
  status: string;
}

export function ProductStatus({
  announce = false,
  className,
  showExplanation = false,
  status,
}: ProductStatusProps) {
  const view = productStatusView(status);

  return (
    <div
      aria-live={announce ? 'polite' : undefined}
      className={cn('space-y-1', className)}
    >
      <Badge
        className={cn(
          'h-auto gap-x-1.5 rounded-md border-transparent px-2 py-1',
          toneStyle[view.tone]
        )}
        variant="outline"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            toneDotStyle[view.tone]
          )}
        />
        {view.label}
      </Badge>
      {showExplanation ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {view.explanation} {view.nextAction}
        </p>
      ) : null}
    </div>
  );
}
