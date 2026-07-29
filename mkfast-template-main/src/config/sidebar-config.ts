import {
  admin_navigation_audit,
  admin_navigation_capabilities,
  admin_navigation_cloudflare,
  admin_navigation_integrations,
  admin_navigation_model_catalog,
  admin_navigation_models,
  admin_navigation_plans,
  admin_navigation_recipe_studio,
  admin_navigation_redemptions,
  admin_navigation_skills,
  admin_navigation_templates,
  admin_navigation_users,
  product_navigation_admin,
  product_navigation_settings,
  settings_navigation_account,
  settings_navigation_connections,
  settings_navigation_models,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { BUSINESS_NAVIGATION } from '@/lib/uiux/navigation';
import {
  IconBookmarks,
  IconBuildingStore,
  IconCloud,
  IconCpu,
  IconFileText,
  IconFolders,
  IconHistory,
  IconListDetails,
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
  memory: IconBookmarks,
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
      return settings_navigation_account();
    },
    href: Routes.SettingsAccount,
    icon: IconUserCircle,
  },
  {
    id: 'models',
    get label() {
      return settings_navigation_models();
    },
    href: Routes.SettingsModels,
    icon: IconCpu,
  },
  {
    id: 'connections',
    get label() {
      return settings_navigation_connections();
    },
    href: Routes.SettingsConnections,
    icon: IconPlugConnected,
  },
] as const satisfies readonly ShellNavigationItem[];

export const ADMIN_SIDEBAR_ITEMS = [
  {
    id: 'supply',
    get label() {
      return admin_navigation_models();
    },
    href: Routes.AdminSupply,
    icon: IconCpu,
  },
  {
    id: 'capabilities',
    get label() {
      return admin_navigation_capabilities();
    },
    href: Routes.AdminCapabilities,
    icon: IconListDetails,
  },
  {
    id: 'recipe-studio',
    get label() {
      return admin_navigation_recipe_studio();
    },
    href: Routes.AdminRecipeStudio,
    icon: IconSparkles,
  },
  {
    id: 'skills',
    get label() {
      return admin_navigation_skills();
    },
    href: Routes.AdminSkills,
    icon: IconListDetails,
  },
  {
    id: 'models',
    get label() {
      return admin_navigation_model_catalog();
    },
    href: Routes.AdminModels,
    icon: IconCpu,
  },
  {
    id: 'templates',
    get label() {
      return admin_navigation_templates();
    },
    href: Routes.AdminTemplates,
    icon: IconTemplate,
  },
  {
    id: 'integrations',
    get label() {
      return admin_navigation_integrations();
    },
    href: Routes.AdminIntegrations,
    icon: IconPlugConnected,
  },
  {
    id: 'plans',
    get label() {
      return admin_navigation_plans();
    },
    href: Routes.AdminPlans,
    icon: IconReceipt,
  },
  {
    id: 'redemptions',
    get label() {
      return admin_navigation_redemptions();
    },
    href: Routes.AdminRedemptions,
    icon: IconReceipt,
  },
  {
    id: 'users',
    get label() {
      return admin_navigation_users();
    },
    href: Routes.AdminUsers,
    icon: IconUsers,
  },
  {
    id: 'audit',
    get label() {
      return admin_navigation_audit();
    },
    href: Routes.AdminAudit,
    icon: IconHistory,
  },
  {
    id: 'cloudflare',
    get label() {
      return admin_navigation_cloudflare();
    },
    href: Routes.AdminCloudflare,
    icon: IconCloud,
  },
] as const satisfies readonly ShellNavigationItem[];

export const SETTINGS_UTILITY_ITEM: ShellNavigationItem = {
  id: 'settings',
  get label() {
    return product_navigation_settings();
  },
  href: Routes.SettingsAccount,
  icon: IconSettings,
};

export const ADMIN_UTILITY_ITEM: ShellNavigationItem = {
  id: 'admin',
  get label() {
    return product_navigation_admin();
  },
  // Exception home (J2) is the admin shell entry after Z2-WIRING batch B.
  href: Routes.Admin,
  icon: IconShieldCheck,
};
