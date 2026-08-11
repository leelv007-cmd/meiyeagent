import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { IconCheck as Check } from '@tabler/icons-react';
import { motion } from 'motion/react';
import {
  landing_pricing_coming_soon,
  landing_pricing_credit_model_1,
  landing_pricing_credit_model_2,
  landing_pricing_credit_model_3,
  landing_pricing_cta,
  landing_pricing_eyebrow,
  landing_pricing_footnote_link,
  landing_pricing_footnote_prefix,
  landing_pricing_footnote_suffix,
  landing_pricing_plans_link,
  landing_pricing_price_badge,
  landing_pricing_price_note,
  landing_pricing_price_period,
  landing_pricing_subtitle,
  landing_pricing_title,
} from '@/locale/paraglide/messages';
import {
  growthMonthlyPriceLabel,
  PUBLIC_PAID_MONTHLY_PRICE_TESTID,
} from '@/lib/price-plan';
import { Routes } from '@/lib/routes';

const ease = [0.23, 1, 0.32, 1] as const;

/**
 * The landing states the credit model and the shared price. It names no tier.
 *
 * This block used to be three named cards, each with its own price, feature
 * list and CTA. That made the landing the owner of a second plan vocabulary,
 * and it drifted from the one /pricing sells: the two pages disagreed on the
 * tier names, on what a tier included, and through the per-card numbers on
 * what it cost. Keeping them in step was a copy-review chore nothing enforced.
 *
 * The user's 2026-08-05 ruling settles it structurally instead of by review:
 * tier names are a marketing asset that lives on /pricing (D-172's four tiers),
 * and the landing does not hold a second copy of them. What is left is what a
 * visitor needs before clicking through — how the unit works, what the paid
 * month costs, and the way to the real catalog — and nothing that can fork from
 * /pricing, because no per-tier fact is left here to fork.
 */
export function Pricing(): ReactNode {
  // D-143: one mapping feeds both public surfaces, so the landing and /pricing
  // can never drift apart on what the paid month costs.
  const priceLabel = growthMonthlyPriceLabel() ?? landing_pricing_coming_soon();
  const creditModel = [
    landing_pricing_credit_model_1(),
    landing_pricing_credit_model_2(),
    landing_pricing_credit_model_3(),
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

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6, ease }}
          className="relative mx-auto max-w-2xl"
        >
          <div
            className="absolute -inset-1 rounded-[1.2em] bg-accent"
            aria-hidden="true"
          />

          <div className="relative flex flex-col rounded-2xl bg-frame p-6 sm:p-8">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="inline-block rounded-full bg-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-black/50">
                {landing_pricing_price_badge()}
              </span>
            </div>

            <div className="mt-2 text-center">
              <div className="flex items-end justify-center gap-3">
                <span
                  data-testid={PUBLIC_PAID_MONTHLY_PRICE_TESTID}
                  className="font-bold tracking-tight text-foreground text-5xl"
                >
                  {priceLabel}
                </span>
                <span className="mb-1 text-sm text-muted-foreground">
                  {landing_pricing_price_period()}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {landing_pricing_price_note()}
              </p>
            </div>

            <ul className="mt-8 space-y-3">
              {creditModel.map((line) => (
                <li key={line} className="flex items-center gap-3">
                  <Check
                    className="h-4 w-4 shrink-0 text-foreground"
                    strokeWidth={2.5}
                  />
                  <span className="text-sm text-foreground">{line}</span>
                </li>
              ))}
            </ul>

            <Link
              to={Routes.Register}
              className="mt-8 w-full rounded-xl bg-foreground py-3 text-center text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              {landing_pricing_cta()}
            </Link>
            <Link
              to={Routes.Pricing}
              className="mt-3 w-full rounded-xl bg-muted py-3 text-center text-sm font-semibold text-foreground transition-colors hover:bg-muted/80"
            >
              {landing_pricing_plans_link()}
            </Link>
          </div>
        </motion.div>

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
