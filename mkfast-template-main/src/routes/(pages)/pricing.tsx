import {
  pricing_description,
  pricing_plan_subtitle,
  pricing_title,
  pricing_unavailable_contact,
  pricing_unavailable_description,
  pricing_unavailable_retry,
  pricing_unavailable_title,
} from '@/locale/paraglide/messages';
import { getCommerceReadiness } from '@/api/commerce-readiness';
import { authClient } from '@/auth/client';
import Container from '@/components/layout/container';
import { CreditPricingContent } from '@/components/pricing/credit-pricing-content';
import { PricingShell } from '@/components/pricing/pricing-shell';
import { buttonVariants } from '@/components/ui/button';
import { websiteConfig } from '@/config/website';
import { Routes } from '@/lib/routes';
import { seo } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { getPathWithLocale } from '@/lib/urls';
import {
  createFileRoute,
  type ErrorComponentProps,
  useRouter,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/(pages)/pricing')({
  head: () =>
    seo('/pricing', {
      title: `${pricing_title()} | ${websiteConfig.metadata?.name}`,
      description: pricing_description(),
    }),
  loader: () => getCommerceReadiness(),
  component: PricingPage,
  errorComponent: PricingErrorState,
});

function PricingPage() {
  const commerceReadiness = Route.useLoaderData();
  const { data: session } = authClient.useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const userId = session?.user?.id;
  const isAuthenticated = mounted && Boolean(userId);

  return (
    <PricingShell>
      <Container className="px-4 py-16">
        <div className="mx-auto max-w-6xl space-y-10">
          <header className="space-y-3 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              {pricing_title()}
            </h1>
            <p className="mx-auto max-w-2xl text-base text-muted-foreground">
              {pricing_plan_subtitle()}
            </p>
          </header>

          <CreditPricingContent
            catalog={commerceReadiness.catalog}
            commerceReadiness={commerceReadiness.ready}
            isAuthenticated={isAuthenticated}
            userId={userId}
          />
        </div>
      </Container>
    </PricingShell>
  );
}

function PricingErrorState(_props: ErrorComponentProps) {
  const router = useRouter();

  return (
    <PricingShell>
      <Container className="px-4 py-16">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            {pricing_unavailable_title()}
          </h1>
          <p className="text-base text-muted-foreground">
            {pricing_unavailable_description()}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              className={cn(buttonVariants({ size: 'lg', variant: 'default' }))}
              onClick={() => {
                void router.invalidate();
              }}
            >
              {pricing_unavailable_retry()}
            </button>
            <a
              href={getPathWithLocale(Routes.Contact)}
              className={cn(buttonVariants({ size: 'lg', variant: 'outline' }))}
            >
              {pricing_unavailable_contact()}
            </a>
          </div>
        </div>
      </Container>
    </PricingShell>
  );
}
