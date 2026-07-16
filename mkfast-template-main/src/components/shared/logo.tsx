import { cn } from '@/lib/utils';
import { m } from '@/locale/paraglide/messages';
import { IconSparkles } from '@tabler/icons-react';

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-label={m.site_logo_aria()}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm',
        className
      )}
      role="img"
    >
      <IconSparkles aria-hidden="true" className="size-5" />
    </span>
  );
}
