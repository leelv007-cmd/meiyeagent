import { m } from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import type { MenuItemConfig } from '../types';
import { websiteConfig } from './website';
/**
 * Footer links, grouped by section
 */
export function getFooterLinks(): MenuItemConfig[] {
  const productItems: MenuItemConfig[] = [];
  productItems.push({
    title: m.nav_features(),
    href: Routes.Features,
    external: false,
  });
  if (websiteConfig.payment?.enable) {
    productItems.push({
      title: m.nav_pricing(),
      href: Routes.Pricing,
      external: false,
    });
  }
  productItems.push({
    title: m.nav_faq(),
    href: Routes.Faqs,
    external: false,
  });
  const legalItems: MenuItemConfig[] = [
    {
      title: m.nav_cookie_policy_title(),
      href: Routes.CookiePolicy,
      external: false,
    },
    {
      title: m.nav_privacy_policy_title(),
      href: Routes.PrivacyPolicy,
      external: false,
    },
    {
      title: m.nav_terms_of_service_title(),
      href: Routes.TermsOfService,
      external: false,
    },
  ];
  return [
    { title: m.nav_product(), items: productItems },
    { title: m.nav_legal(), items: legalItems },
  ];
}
