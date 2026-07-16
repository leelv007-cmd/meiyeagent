import { Badge } from '@/components/ui/badge';
import { productStatusView, type ProductStatusTone } from '@/lib/uiux/status';
import { cn } from '@/lib/utils';

const toneStyle: Record<ProductStatusTone, string> = {
  neutral:
    'bg-[oklch(0.42_0_0/0.06)] text-[oklch(0_0_0/0.7)] dark:bg-[oklch(1_0_0/0.08)] dark:text-[oklch(1_0_0/0.78)]',
  progress:
    'bg-[oklch(0.5_0.19_262/0.1)] text-[oklch(0.4_0.16_262)] dark:bg-[oklch(0.5_0.19_262/0.18)] dark:text-[oklch(0.82_0.08_262)]',
  success:
    'bg-[oklch(0.53_0.14_150/0.1)] text-[oklch(0.4_0.12_150)] dark:bg-[oklch(0.53_0.14_150/0.18)] dark:text-[oklch(0.82_0.08_150)]',
  warning:
    'bg-[oklch(0.55_0.13_85/0.12)] text-[oklch(0.42_0.11_85)] dark:bg-[oklch(0.55_0.13_85/0.18)] dark:text-[oklch(0.88_0.08_85)]',
  danger:
    'bg-[oklch(0.55_0.2_27/0.1)] text-[oklch(0.45_0.16_27)] dark:bg-[oklch(0.55_0.2_27/0.18)] dark:text-[oklch(0.84_0.1_27)]',
};

const toneDotStyle: Record<ProductStatusTone, string> = {
  neutral: 'bg-[oklch(0.55_0_0)]',
  progress: 'bg-[oklch(0.5_0.19_262)]',
  success: 'bg-[oklch(0.53_0.14_150)]',
  warning: 'bg-[oklch(0.55_0.13_85)]',
  danger: 'bg-[oklch(0.55_0.2_27)]',
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
