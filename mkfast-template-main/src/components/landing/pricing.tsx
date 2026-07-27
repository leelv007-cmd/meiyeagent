import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Building2, Check, Rocket, Zap } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import {
  landing_pricing_coming_soon,
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
  landing_pricing_title,
} from '@/locale/paraglide/messages';
import { growthMonthlyPriceLabel } from '@/lib/price-plan';
import { Routes } from '@/lib/routes';

interface PricingPlan {
  name: string;
  description: string;
  price: string;
  period: string;
  note?: string;
  badge?: string;
  features: string[];
  cta: string;
  href?: string;
  popular?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
}

function PricingCard({ plan }: { plan: PricingPlan }) {
  const Icon = plan.icon;

  const cardContent = (
    <div
      className={`relative flex h-full flex-col rounded-3xl bg-background p-3 ${
        plan.popular ? '' : 'border border-foreground/10'
      }`}
    >
      <div className="mb-6 flex items-start justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <Icon className="h-5 w-5 text-foreground" />
        </div>
        {plan.badge && (
          <span className="rounded-full border border-accent/50 bg-accent/20 px-4 py-1.5 text-sm font-medium text-accent">
            {plan.badge}
          </span>
        )}
        {plan.disabled && !plan.badge && (
          <span className="rounded-full border border-foreground/10 bg-muted px-4 py-1.5 text-sm font-medium text-muted-foreground">
            {landing_pricing_coming_soon()}
          </span>
        )}
      </div>

      <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-5xl font-semibold tracking-tight text-foreground">
          {plan.price}
        </span>
        {plan.period && (
          <span className="text-lg text-muted-foreground">{plan.period}</span>
        )}
        {plan.note && (
          <span className="ml-auto text-right text-sm text-muted-foreground">
            {plan.note}
          </span>
        )}
      </div>

      <div className="mt-8 flex-1">
        <div className="flex h-full flex-col rounded-xl bg-muted/50 p-6">
          <ul className="flex-1 space-y-4">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <span className="text-sm text-foreground">{feature}</span>
              </li>
            ))}
          </ul>

          {plan.disabled || !plan.href ? (
            <span
              aria-disabled="true"
              className="mt-6 flex w-full cursor-not-allowed items-center justify-center rounded-full bg-muted py-4 text-base font-semibold text-muted-foreground"
            >
              {plan.cta}
            </span>
          ) : (
            <Link
              to={plan.href}
              className={`mt-6 block w-full cursor-pointer rounded-full py-4 text-center text-base font-semibold transition-all ${
                plan.popular
                  ? 'bg-accent text-accent-foreground hover:opacity-90'
                  : 'bg-foreground text-background hover:bg-foreground/70'
              }`}
            >
              {plan.cta}
            </Link>
          )}
        </div>
      </div>
    </div>
  );

  if (plan.popular) {
    return (
      <div className="relative">
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[70%] rounded-full bg-accent-light opacity-50 blur-3xl"
          animate={{
            x: ['-50%', '-30%', '-70%', '-40%', '-60%', '-50%'],
            y: ['-50%', '-70%', '-30%', '-60%', '-40%', '-50%'],
            scale: [1, 1.2, 0.9, 1.1, 0.95, 1],
          }}
          transition={{
            duration: 12,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
            times: [0, 0.2, 0.4, 0.6, 0.8, 1],
          }}
        />
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[50%] w-[50%] rounded-full bg-accent opacity-40 blur-3xl"
          animate={{
            x: ['-50%', '-70%', '-30%', '-60%', '-40%', '-50%'],
            y: ['-50%', '-30%', '-70%', '-40%', '-60%', '-50%'],
            scale: [1, 0.9, 1.15, 0.95, 1.1, 1],
          }}
          transition={{
            duration: 10,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
            times: [0, 0.2, 0.4, 0.6, 0.8, 1],
          }}
        />
        <div className="absolute -inset-px rounded-[1.52rem] bg-linear-to-br from-accent to-accent-light opacity-25" />
        <div className="relative">{cardContent}</div>
      </div>
    );
  }

  return cardContent;
}

export function Pricing(): ReactNode {
  const plans: PricingPlan[] = [
    {
      name: landing_pricing_starter_name(),
      description: landing_pricing_starter_desc(),
      price: landing_pricing_starter_price(),
      period: '',
      icon: Rocket,
      href: Routes.Register,
      features: [
        landing_pricing_starter_feature_1(),
        landing_pricing_starter_feature_2(),
        landing_pricing_starter_feature_3(),
        landing_pricing_starter_feature_4(),
      ],
      cta: landing_pricing_starter_cta(),
    },
    {
      name: landing_pricing_growth_name(),
      description: landing_pricing_growth_desc(),
      // D-143: read from the same payment configuration /pricing quotes.
      // This page used to carry its own price message while /pricing computed
      // a different one, so the two public pages disagreed about one plan.
      price: growthMonthlyPriceLabel() ?? landing_pricing_coming_soon(),
      period: landing_pricing_growth_period(),
      note: landing_pricing_growth_note(),
      badge: landing_pricing_growth_badge(),
      icon: Zap,
      href: Routes.Register,
      features: [
        landing_pricing_growth_feature_1(),
        landing_pricing_growth_feature_2(),
        landing_pricing_growth_feature_3(),
        landing_pricing_growth_feature_4(),
      ],
      cta: landing_pricing_growth_cta(),
      popular: true,
    },
    {
      name: landing_pricing_lifetime_name(),
      description: landing_pricing_lifetime_desc(),
      price: landing_pricing_coming_soon(),
      period: '',
      icon: Building2,
      disabled: true,
      features: [
        landing_pricing_lifetime_feature_1(),
        landing_pricing_lifetime_feature_2(),
        landing_pricing_lifetime_feature_3(),
      ],
      cta: landing_pricing_coming_soon(),
    },
  ];

  return (
    <section id="pricing" className="px-4 py-20 sm:px-6 md:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16">
          <p className="text-4xl font-medium tracking-tight text-foreground">
            {landing_pricing_title()}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {plans.map((plan) => (
            <PricingCard key={plan.name} plan={plan} />
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-2xl text-center text-lg text-muted-foreground">
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
