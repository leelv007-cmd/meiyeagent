export const Routes = {
  Root: '/',

  // Marketing routes
  Features: '/#features',
  Faqs: '/#faqs',
  Pricing: '/pricing',
  Blog: '/blog',
  Contact: '/contact',

  // Auth routes
  Auth: '/auth',
  Login: '/auth/login',
  Register: '/auth/register',
  AuthError: '/auth/error',
  ForgotPassword: '/auth/forgot-password',
  ResetPassword: '/auth/reset-password',

  // Legal routes
  TermsOfService: '/terms',
  PrivacyPolicy: '/privacy',
  CookiePolicy: '/cookie',

  // Payment routes
  Payment: '/settings/payment',

  // Dashboard routes
  Dashboard: '/dashboard',
  AssetLibrary: '/dashboard/assets',
  /**
   * 一级导航「内容」(T34 / #228). The merchant's content surface is the reshelled
   * one under `/dashboard/works`; `/dashboard/content` survives only as a
   * redirect shell for old links. There is no second content surface.
   */
  ContentLibrary: '/dashboard/works',
  StoreProfile: '/dashboard/store',
  ContentWorkspace: '/dashboard/workspace',
  MarketingIdentity: '/dashboard/identity',

  // Settings routes
  Settings: '/settings',
  SettingsAccount: '/settings/account',
  SettingsConnections: '/settings/connections',
  SettingsProfile: '/settings/profile',
  SettingsBilling: '/settings/billing',
  SettingsCredits: '/settings/credits',
  SettingsSecurity: '/settings/security',
  SettingsFiles: '/settings/files',
  SettingsApiKeys: '/settings/apikeys',
  SettingsModels: '/settings/models',
  SettingsIntegrations: '/settings/integrations',
  SettingsNotifications: '/settings/notifications',

  // Admin routes
  Admin: '/admin',
  AdminCapabilities: '/admin/capabilities',
  AdminRecipeStudio: '/admin/recipe-studio',
  AdminSkills: '/admin/skills',
  AdminCloudflare: '/admin/cloudflare',
  AdminSupply: '/admin/supply',
  AdminModels: '/admin/models',
  AdminTemplates: '/admin/templates',
  AdminIntegrations: '/admin/integrations',
  AdminPlans: '/admin/plans',
  AdminRedemptions: '/admin/redemptions',
  AdminUsers: '/admin/users',
  AdminAudit: '/admin/audit',
} as const;

/** Default login redirect route */
export const DEFAULT_LOGIN_REDIRECT = Routes.Dashboard;
