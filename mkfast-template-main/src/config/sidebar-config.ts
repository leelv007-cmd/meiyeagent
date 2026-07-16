import { m } from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { BUSINESS_NAVIGATION } from '@/lib/uiux/navigation';
import {
  IconBuildingStore,
  IconCpu,
  IconFileText,
  IconFolders,
  IconHistory,
  IconPlugConnected,
  IconReceipt,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconTemplate,
  IconUserCircle,
  IconUsers,
} from '@tabler/icons-react';

export type ShellMode = 'product' | 'settings' | 'admin';
export type ShellIcon = typeof IconSparkles;

export interface ShellNavigationItem {
  href: string;
  icon: ShellIcon;
  id: string;
  label: string;
}

const businessIcons: Record<
  (typeof BUSINESS_NAVIGATION)[number]['id'],
  ShellIcon
> = {
  workbench: IconSparkles,
  content: IconFileText,
  assets: IconFolders,
  store: IconBuildingStore,
};

export const BUSINESS_SIDEBAR_ITEMS: readonly ShellNavigationItem[] =
  BUSINESS_NAVIGATION.map((item) => ({
    id: item.id,
    href: item.href,
    icon: businessIcons[item.id],
    get label() {
      return item.label;
    },
  }));

export const SETTINGS_SIDEBAR_ITEMS = [
  {
    id: 'account',
    get label() {
      return m.settings_navigation_account();
    },
    href: Routes.SettingsAccount,
    icon: IconUserCircle,
  },
  {
    id: 'models',
    get label() {
      return m.settings_navigation_models();
    },
    href: Routes.SettingsModels,
    icon: IconCpu,
  },
  {
    id: 'connections',
    get label() {
      return m.settings_navigation_connections();
    },
    href: Routes.SettingsConnections,
    icon: IconPlugConnected,
  },
] as const satisfies readonly ShellNavigationItem[];

export const ADMIN_SIDEBAR_ITEMS = [
  {
    id: 'models',
    get label() {
      return m.admin_navigation_models();
    },
    href: Routes.AdminModels,
    icon: IconCpu,
  },
  {
    id: 'templates',
    get label() {
      return m.admin_navigation_templates();
    },
    href: Routes.AdminTemplates,
    icon: IconTemplate,
  },
  {
    id: 'integrations',
    get label() {
      return m.admin_navigation_integrations();
    },
    href: Routes.AdminIntegrations,
    icon: IconPlugConnected,
  },
  {
    id: 'plans',
    get label() {
      return m.admin_navigation_plans();
    },
    href: Routes.AdminPlans,
    icon: IconReceipt,
  },
  {
    id: 'users',
    get label() {
      return m.admin_navigation_users();
    },
    href: Routes.AdminUsers,
    icon: IconUsers,
  },
  {
    id: 'audit',
    get label() {
      return m.admin_navigation_audit();
    },
    href: Routes.AdminAudit,
    icon: IconHistory,
  },
] as const satisfies readonly ShellNavigationItem[];

export const SETTINGS_UTILITY_ITEM: ShellNavigationItem = {
  id: 'settings',
  get label() {
    return m.product_navigation_settings();
  },
  href: Routes.SettingsAccount,
  icon: IconSettings,
};

export const ADMIN_UTILITY_ITEM: ShellNavigationItem = {
  id: 'admin',
  get label() {
    return m.product_navigation_admin();
  },
  href: Routes.AdminModels,
  icon: IconShieldCheck,
};
