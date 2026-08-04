import {
  pricing_description,
  pricing_plan_subtitle,
  pricing_title,
} from '@/locale/paraglide/messages';
import { getPublicPlanCatalog } from '@/api/plan-catalog';
import { authClient } from '@/auth/client';
import Container from '@/components/layout/container';
import { CreditPricingContent } from '@/components/pricing/credit-pricing-content';
import { PricingShell } from '@/components/pricing/pricing-shell';
import { websiteConfig } from '@/config/website';
import { seo } from '@/lib/seo';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/(pages)/pricing')({
  head: () =>
    seo('/pricing', {
      title: `${pricing_title()} | ${websiteConfig.metadata?.name}`,
      description: pricing_description(),
    }),
  loader: () => getPublicPlanCatalog(),
  component: PricingPage,
});

function PricingPage() {
  const catalog = Route.useLoaderData();
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
            catalog={catalog}
            isAuthenticated={isAuthenticated}
            userId={userId}
          />
        </div>
      </Container>
    </PricingShell>
  );
}
