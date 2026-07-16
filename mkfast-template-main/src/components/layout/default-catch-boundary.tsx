import { m } from '@/locale/paraglide/messages';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Logo } from '@/components/shared/logo';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { emitTelemetry } from '@/lib/product-telemetry';
import { getPathWithLocale } from '@/lib/urls';
import { useEffect } from 'react';
/**
 * Default catch boundary for TanStack Router.
 * Layout and styling aligned with NotFound for consistency.
 */
export function DefaultCatchBoundary(_props: ErrorComponentProps) {
  useEffect(() => {
    emitTelemetry('page_error', {
      errorCode: 'route_boundary',
      route: window.location.pathname,
    });
  }, []);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8 px-4">
      <Logo className="size-12" />
      <h1 className="text-4xl font-bold">{m.catch_boundary_title()}</h1>
      <p className="text-balance text-center text-xl font-medium text-muted-foreground">
        {m.catch_boundary_description()}
      </p>
      <a
        href={getPathWithLocale('/')}
        className={cn(buttonVariants({ size: 'lg', variant: 'default' }))}
      >
        {m.catch_boundary_back_to_home()}
      </a>
    </div>
  );
}
