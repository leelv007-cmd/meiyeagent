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
  /**
   * 一级导航「经验」(D-164④ + P2-13 / D5). Route id stays memory; merchant
   * copy is 经验. What the product has learned about this shop is
   * the reason it gets better with use, so it has to be somewhere she can
   * look — a moat she cannot see gives her no reason to stay.
   */
  MemoryVault: '/dashboard/memory',

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
  AdminSkills: '/admin/skills',
  AdminCloudflare: '/admin/cloudflare',
  AdminSupply: '/admin/supply',
  AdminModels: '/admin/models',
  AdminTemplates: '/admin/templates',
  AdminIntegrations: '/admin/integrations',
  AdminPlans: '/admin/plans',
  AdminRedemptions: '/admin/redemptions',
  AdminUsers: '/admin/users',
  /** Spec G / #388: write workflow under account_and_commerce. */
  AdminRefundReview: '/admin/refund-review',
  AdminAudit: '/admin/audit',
  /** Spec G / #388: compliance governance under runtime_and_governance. */
  AdminSensitiveWords: '/admin/sensitive-words',
} as const;

/** Default login redirect route */
export const DEFAULT_LOGIN_REDIRECT = Routes.Dashboard;
