import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  IconBook2,
  IconBrandTiktok,
  IconBrandWechat,
} from '@tabler/icons-react';
import {
  landing_footer_col_company,
  landing_footer_col_product,
  landing_footer_copyright,
  landing_footer_follow,
  landing_footer_link_contact,
  landing_footer_link_cookie,
  landing_footer_link_faq,
  landing_footer_link_features,
  landing_footer_link_pricing,
  landing_footer_link_privacy,
  landing_footer_link_showcase,
  landing_footer_link_terms,
  landing_footer_social_douyin,
  landing_footer_social_wechat,
  landing_footer_social_xhs,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';

interface FooterLink {
  label: string;
  href?: string;
  to?: string;
}

export function Footer(): ReactNode {
  const year = new Date().getFullYear();

  const footerColumns: { title: string; links: FooterLink[] }[] = [
    {
      title: landing_footer_col_product(),
      links: [
        { label: landing_footer_link_features(), href: '#features' },
        { label: landing_footer_link_showcase(), href: '#showcase' },
        { label: landing_footer_link_pricing(), to: Routes.Pricing },
        { label: landing_footer_link_faq(), href: '#faq' },
      ],
    },
    {
      title: landing_footer_col_company(),
      links: [
        { label: landing_footer_link_contact(), to: Routes.Contact },
        { label: landing_footer_link_terms(), to: Routes.TermsOfService },
        { label: landing_footer_link_privacy(), to: Routes.PrivacyPolicy },
        { label: landing_footer_link_cookie(), to: Routes.CookiePolicy },
      ],
    },
  ];

  const socialLinks = [
    { icon: IconBrandWechat, href: '#', label: landing_footer_social_wechat() },
    { icon: IconBrandTiktok, href: '#', label: landing_footer_social_douyin() },
    { icon: IconBook2, href: '#', label: landing_footer_social_xhs() },
  ];

  return (
    <footer className="relative overflow-hidden bg-background px-4 text-foreground sm:px-6 lg:px-8">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 opacity-60"
        style={{
          background:
            'linear-gradient(to top, rgba(195,154,94,0.55) 0%, rgba(214,178,120,0.35) 20%, rgba(228,199,148,0.25) 40%, rgba(238,216,172,0.12) 60%, rgba(245,230,198,0.05) 80%, transparent 100%)',
          maskImage:
            'linear-gradient(to top, black 0%, black 20%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to top, black 0%, black 20%, transparent 100%)',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-7xl py-16">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">
          <div className="grid flex-1 gap-8 sm:grid-cols-2">
            {footerColumns.map((column) => (
              <div key={column.title}>
                <h3 className="text-sm text-muted-foreground">
                  {column.title}
                </h3>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.to ? (
                        <Link
                          to={link.to}
                          className="text-lg text-foreground transition-colors hover:text-foreground/70"
                        >
                          {link.label}
                        </Link>
                      ) : (
                        <a
                          href={link.href}
                          className="text-lg text-foreground transition-colors hover:text-foreground/70"
                        >
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="lg:text-right">
            <h3 className="text-sm text-muted-foreground">
              {landing_footer_follow()}
            </h3>
            <div className="mt-4 flex gap-3 lg:justify-end">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground/10 text-foreground/40 transition-colors hover:bg-foreground/20"
                  aria-label={social.label}
                >
                  <social.icon className="h-5 w-5" stroke={1.5} />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl py-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            {landing_footer_copyright({ year })}
          </p>
        </div>
      </div>

      <div className="relative mx-auto max-w-338 select-none h-44 pb-12">
        <img
          src="/landing/logo-text.svg"
          alt=""
          width={2500}
          height={400}
          className="w-full opacity-5 invert dark:invert-0"
          aria-hidden="true"
        />
      </div>
    </footer>
  );
}
