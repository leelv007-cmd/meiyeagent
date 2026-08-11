import {
  IconArrowRight as ArrowRight,
  IconMail as Mail,
} from '@tabler/icons-react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  landing_a11y_nav_footer,
  landing_cta_email_placeholder,
  landing_cta_submit,
  landing_cta_subtitle,
  landing_cta_terms_and,
  landing_cta_terms_prefix,
  landing_cta_terms_privacy,
  landing_cta_terms_suffix,
  landing_cta_terms_tos,
  landing_cta_title,
  landing_footer_brand_line,
  landing_footer_col_company,
  landing_footer_col_product,
  landing_footer_copyright,
  landing_footer_link_contact,
  landing_footer_link_cookie,
  landing_footer_link_faq,
  landing_footer_link_features,
  landing_footer_link_pricing,
  landing_footer_link_privacy,
  landing_footer_link_terms,
  landing_nav_brand,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';

interface FooterLink {
  label: string;
  href: string;
}

/**
 * Footer targets mix in-page anchors with real routes; `#` goes to a plain
 * anchor, everything else to the router.
 */
function FooterLinkItem({ link }: { link: FooterLink }): ReactNode {
  const className =
    'text-sm text-neutral-900 hover:text-neutral-900/70 transition-colors';

  if (link.href.startsWith('#')) {
    return (
      <a href={link.href} className={className}>
        {link.label}
      </a>
    );
  }

  return (
    <Link to={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export function Footer(): ReactNode {
  const navigate = useNavigate();

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: landing_footer_col_product(),
      links: [
        { label: landing_footer_link_features(), href: '#features' },
        { label: landing_footer_link_pricing(), href: Routes.Pricing },
        { label: landing_footer_link_faq(), href: '#faq' },
      ],
    },
    {
      title: landing_footer_col_company(),
      links: [
        { label: landing_footer_link_contact(), href: Routes.Contact },
        { label: landing_footer_link_terms(), href: Routes.TermsOfService },
        { label: landing_footer_link_privacy(), href: Routes.PrivacyPolicy },
        { label: landing_footer_link_cookie(), href: Routes.CookiePolicy },
      ],
    },
  ];

  // The email box is a lead-in to sign-up, not a mailing-list endpoint: the
  // address is carried over by the user on the register form.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void navigate({ to: Routes.Register });
  };

  return (
    <footer className="relative pt-38 mt-24 mx-2.5 max-[850px]:mx-0">
      <div className="absolute left-1/2 -translate-x-1/2 top-0 w-full max-w-5xl">
        <div className="relative w-full rounded-3xl overflow-hidden shadow-2xl/15">
          <div
            className="absolute inset-0 bg-bottom bg-no-repeat brightness-105 blur scale-125"
            style={{
              backgroundImage: 'url(/landing/hero-bg.jpg)',
              backgroundSize: '150%',
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 flex flex-col items-center text-center px-12 py-24 max-[850px]:px-6 max-[850px]:py-6 max-[850px]:pt-12">
            <h2 className="text-6xl max-[850px]:text-3xl text-black font-medium tracking-tight max-w-2xl mb-14 max-[850px]:mb-8">
              {landing_cta_title()}
            </h2>

            <form
              onSubmit={handleSubmit}
              className="flex items-center w-full max-w-md bg-background rounded-xl p-1.5 shadow-lg max-[850px]:flex-col max-[850px]:p-3 max-[850px]:gap-3 max-[850px]:max-w-none"
            >
              <div className="flex items-center flex-1 w-full">
                <Mail
                  className="w-5 h-5 text-muted-foreground ml-3 flex-none max-[850px]:ml-1"
                  aria-hidden="true"
                />
                <input
                  type="email"
                  placeholder={landing_cta_email_placeholder()}
                  aria-label={landing_cta_email_placeholder()}
                  className="flex-1 px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-foreground hover:bg-foreground/90 text-background rounded-lg text-sm font-medium transition-colors whitespace-nowrap max-[850px]:w-full max-[850px]:py-3"
              >
                {landing_cta_submit()}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </form>

            <p className="mt-6 max-w-md text-sm text-black/70">
              {landing_cta_subtitle()}
            </p>

            <p className="mt-3 max-w-md text-xs text-black/60">
              {landing_cta_terms_prefix()}
              <Link to={Routes.TermsOfService} className="underline">
                {landing_cta_terms_tos()}
              </Link>
              {landing_cta_terms_and()}
              <Link to={Routes.PrivacyPolicy} className="underline">
                {landing_cta_terms_privacy()}
              </Link>
              {landing_cta_terms_suffix()}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-accent rounded-tr-[3rem] rounded-tl-[3rem] pt-96 pb-16 max-[850px]:pt-72">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-start justify-between gap-12 max-[850px]:flex-col max-[850px]:gap-10">
            <div className="flex flex-col gap-3">
              <Link to={Routes.Root} className="flex items-center gap-2">
                <img
                  src="/landing/logo.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8"
                />
                <span className="text-xl font-semibold text-neutral-900 leading-0">
                  {landing_nav_brand()}
                </span>
              </Link>
              <p className="max-w-xs text-sm text-neutral-900/60">
                {landing_footer_brand_line()}
              </p>
            </div>

            <nav
              className="flex gap-16 max-[850px]:gap-10 max-[850px]:flex-wrap"
              aria-label={landing_a11y_nav_footer()}
            >
              {columns.map((column) => (
                <div key={column.title}>
                  <h3 className="text-xs font-medium text-neutral-900/50 uppercase tracking-wider mb-4">
                    {column.title}
                  </h3>
                  <ul className="space-y-2">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <FooterLinkItem link={link} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>

          <div className="mt-16 pt-6">
            <p className="text-sm text-neutral-900/50 text-center">
              {landing_footer_copyright({
                year: String(new Date().getFullYear()),
              })}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
