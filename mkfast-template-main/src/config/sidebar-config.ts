import {
  admin_nav_group_account_commerce,
  admin_nav_group_ai_supply,
  admin_nav_group_content_assets,
  admin_nav_group_integrations,
  admin_nav_group_ops_governance,
  admin_navigation_audit,
  admin_navigation_capabilities,
  admin_navigation_cloudflare,
  admin_navigation_integrations,
  admin_navigation_model_catalog,
  admin_navigation_models,
  admin_navigation_plans,
  admin_navigation_redemptions,
  admin_navigation_refund_review,
  admin_navigation_ops_console,
  admin_navigation_sensitive_words,
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
  IconReceiptRefund,
  IconRocket,
  IconSettings,
  IconShieldCheck,
  IconShieldLock,
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
    id: 'refund-review',
    get label() {
      return admin_navigation_refund_review();
    },
    href: Routes.AdminRefundReview,
    icon: IconReceiptRefund,
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
    id: 'sensitive-words',
    get label() {
      return admin_navigation_sensitive_words();
    },
    href: Routes.AdminSensitiveWords,
    icon: IconShieldLock,
  },
  {
    id: 'ops-console',
    get label() {
      return admin_navigation_ops_console();
    },
    href: Routes.AdminOpsConsole,
    icon: IconRocket,
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

export interface AdminNavGroup {
  id: string;
  label: string;
  items: readonly ShellNavigationItem[];
}

const adminItemById = new Map(
  ADMIN_SIDEBAR_ITEMS.map((item) => [item.id, item] as const)
);

function adminItem(id: (typeof ADMIN_SIDEBAR_ITEMS)[number]['id']) {
  const item = adminItemById.get(id);
  if (!item) throw new Error(`Unknown admin nav item: ${id}`);
  return item;
}

/**
 * D2 (admin-config-audit 2026-08-06 §6): the sidebar groups the flat
 * ADMIN_SIDEBAR_ITEMS word list by the six capability-catalog L1 domains.
 * ADMIN_SIDEBAR_ITEMS stays the single source of truth for labels/hrefs;
 * groups only arrange it. Recipe Studio sidebar entry retired by D3 / #375
 * — Templates is the sole governed Recipe entry.
 */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: 'account-commerce',
    get label() {
      return admin_nav_group_account_commerce();
    },
    // Spec G / #388: refund review write workflow under commerce/billing.
    items: [
      adminItem('users'),
      adminItem('plans'),
      adminItem('redemptions'),
      adminItem('refund-review'),
    ],
  },
  {
    id: 'ai-supply',
    get label() {
      return admin_nav_group_ai_supply();
    },
    items: [adminItem('supply'), adminItem('models')],
  },
  {
    id: 'content-assets',
    get label() {
      return admin_nav_group_content_assets();
    },
    items: [adminItem('templates'), adminItem('skills')],
  },
  {
    id: 'integrations',
    get label() {
      return admin_nav_group_integrations();
    },
    items: [adminItem('integrations')],
  },
  {
    id: 'ops-governance',
    get label() {
      return admin_nav_group_ops_governance();
    },
    // Spec G / #388: sensitive-words is compliance governance (not templates).
    // V31-22: ops-console is release / tool-policy / kill-switch control plane.
    items: [
      adminItem('capabilities'),
      adminItem('sensitive-words'),
      adminItem('ops-console'),
      adminItem('audit'),
      adminItem('cloudflare'),
    ],
  },
];
