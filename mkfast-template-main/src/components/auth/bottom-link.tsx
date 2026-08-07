import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BottomLinkProps {
  href: string;
  label: string;
}

/**
 * The way out of each auth page. It sits at body size, not at the legal
 * footnote's 12px: `size="sm"` used to render it at 12.8px, one hair below the
 * form labels it competes with.
 */
export function BottomLink({ href, label }: BottomLinkProps) {
  return (
    <Link
      to={href}
      className={cn(
        buttonVariants({ variant: 'link', size: 'default' }),
        'w-full text-sm font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
      )}
    >
      {label}
    </Link>
  );
}
