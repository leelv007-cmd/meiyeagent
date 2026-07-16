import {
  nav_cookie_policy_title,
  nav_faq,
  nav_features,
  nav_legal,
  nav_pricing,
  nav_privacy_policy_title,
  nav_product,
  nav_terms_of_service_title,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import type { MenuItemConfig } from '../types';
import { websiteConfig } from './website';
/**
 * Footer links, grouped by section
 */
export function getFooterLinks(): MenuItemConfig[] {
  const productItems: MenuItemConfig[] = [];
  productItems.push({
    title: nav_features(),
    href: Routes.Features,
    external: false,
  });
  if (websiteConfig.payment?.enable) {
    productItems.push({
      title: nav_pricing(),
      href: Routes.Pricing,
      external: false,
    });
  }
  productItems.push({
    title: nav_faq(),
    href: Routes.Faqs,
    external: false,
  });
  const legalItems: MenuItemConfig[] = [
    {
      title: nav_cookie_policy_title(),
      href: Routes.CookiePolicy,
      external: false,
    },
    {
      title: nav_privacy_policy_title(),
      href: Routes.PrivacyPolicy,
      external: false,
    },
    {
      title: nav_terms_of_service_title(),
      href: Routes.TermsOfService,
      external: false,
    },
  ];
  return [
    { title: nav_product(), items: productItems },
    { title: nav_legal(), items: legalItems },
  ];
}
