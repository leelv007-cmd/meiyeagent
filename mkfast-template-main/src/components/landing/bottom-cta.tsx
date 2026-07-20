import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  landing_cta_email_placeholder,
  landing_cta_submit,
  landing_cta_subtitle,
  landing_cta_terms_and,
  landing_cta_terms_prefix,
  landing_cta_terms_privacy,
  landing_cta_terms_suffix,
  landing_cta_terms_tos,
  landing_cta_title,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';

export function BottomCTA(): ReactNode {
  const navigate = useNavigate();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ to: Routes.Register });
  };

  return (
    <section className="px-4 py-24 sm:px-6 lg:px-8">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-muted/50">
        <div className="relative z-10 px-8 py-12 sm:px-12">
          <div className="max-w-xl">
            <h2 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              {landing_cta_title()}
            </h2>
            <p className="mt-3 max-w-md text-lg text-muted-foreground">
              {landing_cta_subtitle()}
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-8 flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="email"
                placeholder={landing_cta_email_placeholder()}
                className="h-12 sm:min-w-86 appearance-none rounded-xl border-0 bg-background px-6 text-foreground shadow-none placeholder:text-muted-foreground outline-none! ring-0! transition-shadow duration-200 focus:border-0 focus:shadow-[0_0_20px_rgba(0,0,0,0.08)] dark:focus:shadow-[0_0_20px_rgba(255,255,255,0.1)]"
                required
              />
              <button
                type="submit"
                className="h-12 cursor-pointer rounded-full bg-background px-8 font-medium text-foreground transition-opacity hover:opacity-90"
              >
                {landing_cta_submit()}
              </button>
            </form>

            <p className="mt-4 max-w-xs text-xs text-muted-foreground">
              {landing_cta_terms_prefix()}
              <Link
                to={Routes.TermsOfService}
                className="underline hover:text-foreground"
              >
                {landing_cta_terms_tos()}
              </Link>
              {landing_cta_terms_and()}
              <Link
                to={Routes.PrivacyPolicy}
                className="underline hover:text-foreground"
              >
                {landing_cta_terms_privacy()}
              </Link>
              {landing_cta_terms_suffix()}
            </p>
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-2/3 opacity-25 sm:opacity-25"
          style={{
            background: 'linear-gradient(to left, #C39A5E, transparent)',
            maskImage:
              'linear-gradient(to left, black 0%, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to left, black 0%, black 40%, transparent 100%)',
          }}
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
