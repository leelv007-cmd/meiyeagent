import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import {
  landing_pricing_coming_soon,
  landing_pricing_eyebrow,
  landing_pricing_footnote_link,
  landing_pricing_footnote_prefix,
  landing_pricing_footnote_suffix,
  landing_pricing_growth_badge,
  landing_pricing_growth_cta,
  landing_pricing_growth_desc,
  landing_pricing_growth_feature_1,
  landing_pricing_growth_feature_2,
  landing_pricing_growth_feature_3,
  landing_pricing_growth_feature_4,
  landing_pricing_growth_name,
  landing_pricing_growth_note,
  landing_pricing_growth_period,
  landing_pricing_lifetime_desc,
  landing_pricing_lifetime_feature_1,
  landing_pricing_lifetime_feature_2,
  landing_pricing_lifetime_feature_3,
  landing_pricing_lifetime_name,
  landing_pricing_starter_cta,
  landing_pricing_starter_desc,
  landing_pricing_starter_feature_1,
  landing_pricing_starter_feature_2,
  landing_pricing_starter_feature_3,
  landing_pricing_starter_feature_4,
  landing_pricing_starter_name,
  landing_pricing_starter_price,
  landing_pricing_subtitle,
  landing_pricing_title,
} from '@/locale/paraglide/messages';
import { growthMonthlyPriceLabel } from '@/lib/price-plan';
import { Routes } from '@/lib/routes';

interface PricingPlan {
  name: string;
  /**
   * Pilot pricing is expressed as a phrase, not a number, so each plan carries
   * its own type scale to keep the three cards visually balanced.
   */
  price: string;
  priceClassName: string;
  period?: string;
  /** Sits under the price — how the tier is actually opened during the pilot. */
  note?: string;
  description: string;
  features: string[];
  cta: string;
  /** Absent for plans that are not open yet — those render a disabled button. */
  href?: typeof Routes.Register | typeof Routes.Pricing;
  badge?: string;
  popular: boolean;
}

const ease = [0.23, 1, 0.32, 1] as const;

function PricingCard({
  plan,
  index,
}: {
  plan: PricingPlan;
  index: number;
}): ReactNode {
  const isPopular = plan.popular;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, ease, delay: index * 0.1 }}
      className="relative"
    >
      {isPopular && (
        <div
          className="absolute -inset-1 rounded-[1.2em] bg-accent"
          aria-hidden="true"
        />
      )}

      <div
        className={`relative flex h-full flex-col rounded-2xl bg-frame p-6 sm:p-8 ${
          isPopular ? '' : 'border border-border'
        }`}
      >
        {isPopular && plan.badge && (
          <div className="absolute -top-4 left-1/2 -translate-x-1/2">
            <span className="inline-block rounded-full bg-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-black/50">
              {plan.badge}
            </span>
          </div>
        )}

        <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>

        <div className="mt-4">
          <div className="flex items-end gap-3">
            <span
              className={`font-bold tracking-tight text-foreground ${plan.priceClassName}`}
            >
              {plan.price}
            </span>
            {plan.period && (
              <span className="mb-1 text-sm text-muted-foreground">
                {plan.period}
              </span>
            )}
          </div>
          {plan.note && (
            <p className="mt-2 text-sm text-muted-foreground">{plan.note}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {plan.description}
          </p>
        </div>

        {plan.href ? (
          <Link
            to={plan.href}
            className={`mt-6 w-full rounded-xl py-3 text-center text-sm font-semibold transition-colors ${
              isPopular
                ? 'bg-foreground text-background hover:bg-foreground/90'
                : 'bg-muted text-foreground hover:bg-muted/80'
            }`}
          >
            {plan.cta}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-6 w-full cursor-not-allowed rounded-xl bg-muted py-3 text-sm font-semibold text-muted-foreground"
          >
            {plan.cta}
          </button>
        )}

        <ul className="mt-8 space-y-3">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center gap-3">
              <Check
                className="h-4 w-4 shrink-0 text-foreground"
                strokeWidth={2.5}
              />
              <span className="text-sm text-foreground">{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

export function Pricing(): ReactNode {
  const plans: PricingPlan[] = [
    {
      name: landing_pricing_starter_name(),
      price: landing_pricing_starter_price(),
      priceClassName: 'text-4xl',
      description: landing_pricing_starter_desc(),
      features: [
        landing_pricing_starter_feature_1(),
        landing_pricing_starter_feature_2(),
        landing_pricing_starter_feature_3(),
        landing_pricing_starter_feature_4(),
      ],
      cta: landing_pricing_starter_cta(),
      href: Routes.Register,
      popular: false,
    },
    {
      name: landing_pricing_growth_name(),
      // D-143: one mapping feeds both public surfaces, so landing and /pricing
      // can never drift apart on what the paid tier costs.
      price: growthMonthlyPriceLabel() ?? landing_pricing_coming_soon(),
      priceClassName: 'text-5xl',
      period: landing_pricing_growth_period(),
      note: landing_pricing_growth_note(),
      description: landing_pricing_growth_desc(),
      features: [
        landing_pricing_growth_feature_1(),
        landing_pricing_growth_feature_2(),
        landing_pricing_growth_feature_3(),
        landing_pricing_growth_feature_4(),
      ],
      cta: landing_pricing_growth_cta(),
      href: Routes.Register,
      badge: landing_pricing_growth_badge(),
      popular: true,
    },
    {
      name: landing_pricing_lifetime_name(),
      price: landing_pricing_coming_soon(),
      priceClassName: 'text-3xl',
      description: landing_pricing_lifetime_desc(),
      features: [
        landing_pricing_lifetime_feature_1(),
        landing_pricing_lifetime_feature_2(),
        landing_pricing_lifetime_feature_3(),
      ],
      cta: landing_pricing_coming_soon(),
      popular: false,
    },
  ];

  return (
    <section
      id="pricing"
      className="w-full bg-background px-6 py-20 sm:py-28 scroll-mt-24"
    >
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease }}
          className="mb-12 text-center sm:mb-16"
        >
          <span className="text-sm font-medium text-muted-foreground">
            {landing_pricing_eyebrow()}
          </span>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            {landing_pricing_title()}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {landing_pricing_subtitle()}
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {plans.map((plan, index) => (
            <PricingCard key={plan.name} plan={plan} index={index} />
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-muted-foreground">
          {landing_pricing_footnote_prefix()}
          <Link to={Routes.Pricing} className="underline hover:text-foreground">
            {landing_pricing_footnote_link()}
          </Link>
          {landing_pricing_footnote_suffix()}
        </p>
      </div>
    </section>
  );
}
