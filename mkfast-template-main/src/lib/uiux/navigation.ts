import {
  product_navigation_assets,
  product_navigation_content,
  product_navigation_store,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { emitTelemetry } from '@/lib/product-telemetry';

export const BUSINESS_NAVIGATION = [
  {
    id: 'workbench',
    get label() {
      return product_navigation_workbench();
    },
    href: Routes.Dashboard,
  },
  {
    id: 'content',
    get label() {
      return product_navigation_content();
    },
    href: Routes.ContentLibrary,
  },
  {
    id: 'assets',
    get label() {
      return product_navigation_assets();
    },
    href: Routes.AssetLibrary,
  },
  {
    id: 'store',
    get label() {
      return product_navigation_store();
    },
    href: Routes.StoreProfile,
  },
] as const;

const legacyRedirects = new Map<string, string>([
  ['/dashboard#new-content', Routes.Dashboard],
  ['/dashboard/store?tab=assets', Routes.AssetLibrary],
  ['/settings/profile', `${Routes.SettingsAccount}?section=profile`],
  ['/settings/security', `${Routes.SettingsAccount}?section=security`],
  ['/settings/billing', `${Routes.SettingsAccount}?section=usage`],
  ['/settings/credits', `${Routes.SettingsAccount}?section=usage`],
  ['/settings/payment', `${Routes.SettingsAccount}?section=usage`],
  ['/settings/apikeys', `${Routes.SettingsModels}?section=byok`],
  ['/settings/files', Routes.AssetLibrary],
  ['/settings/integrations', Routes.SettingsConnections],
  [
    '/settings/notifications',
    `${Routes.SettingsConnections}?section=notifications`,
  ],
  ['/admin/p1', Routes.AdminModels],
  ['/admin/p1?tab=models', Routes.AdminModels],
  ['/admin/p1?tab=templates', Routes.AdminTemplates],
  ['/admin/p1?tab=integrations', Routes.AdminIntegrations],
]);

export function resolveLegacyRedirect(location: string) {
  if (!location.startsWith('/') || location.startsWith('//')) return undefined;
  const parsed = new URL(location, 'https://meiye.internal');
  if (parsed.origin !== 'https://meiye.internal') return undefined;
  const key = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const target = legacyRedirects.get(key);
  if (target) {
    emitTelemetry('redirect', {
      fromRoute: parsed.pathname,
      reason: 'legacy_alias',
      toRoute: target,
    });
  }
  return target;
}

export function resolveAdminP1Redirect(tab: unknown) {
  const target =
    tab === 'templates'
      ? Routes.AdminTemplates
      : tab === 'integrations'
        ? Routes.AdminIntegrations
        : Routes.AdminModels;
  emitTelemetry('redirect', {
    fromRoute: Routes.Admin,
    reason: 'admin_p1_alias',
    toRoute: target,
  });
  return target;
}

const returnObjectPaths = {
  asset: '/dashboard/assets',
  content: '/dashboard/content',
  job: '/dashboard/jobs',
  session: '/dashboard/sessions',
  task: '/dashboard/tasks',
  work: '/dashboard/works',
} as const;
const returnActions = new Set([
  'composer',
  'connection',
  'entitlement',
  'model',
  'publish',
]);

export function resolveTrustedReturnAnchor(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (
    typeof input.objectType !== 'string' ||
    !(input.objectType in returnObjectPaths) ||
    typeof input.objectId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(input.objectId) ||
    typeof input.action !== 'string' ||
    !returnActions.has(input.action)
  ) {
    return undefined;
  }
  const base =
    returnObjectPaths[input.objectType as keyof typeof returnObjectPaths];
  return `${base}/${encodeURIComponent(input.objectId)}?focus=${input.action}`;
}
