import {
  dashboard_avatar_billing,
  dashboard_avatar_dashboard,
  dashboard_avatar_settings,
} from '@/locale/paraglide/messages';
import {
  IconCreditCard,
  IconLayoutDashboard,
  IconSettings2,
} from '@tabler/icons-react';
import { Routes } from '@/lib/routes';
import type { MenuItemConfig } from '../types';
import { websiteConfig } from './website';
/**
 * Avatar dropdown links
 */
export function getAvatarLinks(): MenuItemConfig[] {
  return [
    {
      title: dashboard_avatar_dashboard(),
      href: Routes.Dashboard,
      icon: IconLayoutDashboard,
    },
    ...(websiteConfig.payment?.enable
      ? [
          {
            title: dashboard_avatar_billing(),
            href: Routes.SettingsBilling,
            icon: IconCreditCard,
          },
        ]
      : []),
    {
      title: dashboard_avatar_settings(),
      href: Routes.SettingsProfile,
      icon: IconSettings2,
    },
  ];
}
