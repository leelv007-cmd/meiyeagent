import {
  pricing_description,
  pricing_output_concurrency_label,
  pricing_output_contact,
  pricing_output_copy_count,
  pricing_output_copy_label,
  pricing_output_description,
  pricing_output_heading,
  pricing_output_image_count,
  pricing_output_image_label,
  pricing_output_plan_growth,
  pricing_output_plan_pro,
  pricing_output_plan_starter,
  pricing_output_video_count,
  pricing_output_video_label,
  pricing_subtitle,
  pricing_title,
} from '@/locale/paraglide/messages';
import { authClient } from '@/auth/client';
import Container from '@/components/layout/container';
import { PricingTable } from '@/components/pricing/pricing-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { websiteConfig } from '@/config/website';
import { useCurrentPlan } from '@/hooks/use-payment';
import { seo } from '@/lib/seo';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/(pages)/pricing')({
  head: () =>
    seo('/pricing', {
      title: `${pricing_title()} | ${websiteConfig.metadata?.name}`,
      description: pricing_description(),
    }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <Container className="py-16 px-4">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            {pricing_title()}
          </h1>
          <p className="text-lg text-muted-foreground">{pricing_subtitle()}</p>
        </div>
        <OutputPlanComparison />
        {websiteConfig.payment?.enable ? <EnabledPricingTable /> : null}
      </div>
    </Container>
  );
}

function EnabledPricingTable() {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const { data: planData } = useCurrentPlan(!!userId);

  return (
    <PricingTable
      currentPlan={planData?.currentPlan ?? null}
      metadata={userId ? { userId } : undefined}
    />
  );
}

const OUTPUT_PLANS = [
  {
    id: 'starter',
    name: pricing_output_plan_starter,
    copy: 30,
    image: 10,
    video: 5,
    concurrency: 1,
  },
  {
    id: 'growth',
    name: pricing_output_plan_growth,
    copy: 100,
    image: 40,
    video: 20,
    concurrency: 4,
  },
  {
    id: 'pro',
    name: pricing_output_plan_pro,
    copy: 300,
    image: 120,
    video: 60,
    concurrency: 8,
  },
] as const;

function OutputPlanComparison() {
  return (
    <section aria-labelledby="output-plan-heading" className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold" id="output-plan-heading">
          {pricing_output_heading()}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {pricing_output_description()}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {OUTPUT_PLANS.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{plan.name()}</CardTitle>
                {plan.id === 'pro' ? (
                  <Badge variant="outline">{pricing_output_contact()}</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">
                    {pricing_output_copy_label()}
                  </dt>
                  <dd className="font-semibold">
                    {pricing_output_copy_count({ count: plan.copy })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {pricing_output_image_label()}
                  </dt>
                  <dd className="font-semibold">
                    {pricing_output_image_count({ count: plan.image })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {pricing_output_video_label()}
                  </dt>
                  <dd className="font-semibold">
                    {pricing_output_video_count({ count: plan.video })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {pricing_output_concurrency_label()}
                  </dt>
                  <dd className="font-semibold">{plan.concurrency}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
