import { BottomLink } from '@/components/auth/bottom-link';
import { Logo } from '@/components/shared/logo';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

interface AuthCardProps {
  children: React.ReactNode;
  title: string;
  description?: string;
  /**
   * DESIGN.md §3 「问候语法则」 reserves the Display step for a personified
   * greeting and bans function titles from it, so login and register open at
   * `display` while the recovery pages (forgot / reset / error) open at
   * `headline`. Everything below the heading is identical across the five.
   */
  titleTone?: 'display' | 'headline';
  bottomButtonLabel: string;
  bottomButtonHref: string;
  className?: string;
}

/**
 * The heading block rides the ambient band and the form rides porcelain — one
 * composition for all five auth pages. It used to be a single shadcn Card whose
 * `CardDescription` carried the greeting at 14px, which put the merchant's first
 * touchpoint two type steps below the same sentence in the workbench.
 */
export function AuthCard({
  children,
  title,
  description,
  titleTone = 'headline',
  bottomButtonLabel,
  bottomButtonHref,
  className,
}: AuthCardProps) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col items-start gap-3">
        <Link to="/">
          <Logo />
        </Link>
        <h1
          className={
            titleTone === 'display'
              ? 'meiye-auth-display'
              : 'meiye-auth-headline'
          }
        >
          {title}
        </h1>
        {description ? (
          <p className="meiye-auth-lead text-pretty">{description}</p>
        ) : null}
      </header>
      <div
        className={cn(
          'meiye-porcelain flex flex-col gap-5 rounded-[20px] p-6',
          className
        )}
      >
        {children}
        <BottomLink label={bottomButtonLabel} href={bottomButtonHref} />
      </div>
    </div>
  );
}
