import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect } from 'react';

import { appPageHead } from '@/lib/seo';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card';
import { UpdateNameCard } from '@/components/settings/profile/update-name-card';
import { PasswordCardWrapper } from '@/components/settings/security/password-card-wrapper';
import { SettingsSection } from '@/components/settings/settings-section';
import { BillingCard } from '@/components/settings/billing/billing-card';
import { MerchantCreditDetailPanel } from '@/product/merchant-credit-detail-panel';
import { RedemptionCard } from '@/p1/redemption-card';
import {
  desktop_relay_return_mobile,
  settings_account_description,
  settings_account_credits_heading,
  settings_account_jump_label,
  settings_account_mobile_credits_description,
  settings_account_profile_heading,
  settings_account_pwa_heading,
  settings_account_security_heading,
  settings_navigation_account,
  settings_title,
} from '@/locale/paraglide/messages';
import { InstallPrompt } from '@/pwa/install-prompt';
import { useIsMobile } from '@/hooks/use-mobile';

interface AccountSearch {
  section?: 'profile' | 'security' | 'credits';
}

export const Route = createFileRoute('/settings/account')({
  validateSearch: (search: Record<string, unknown>): AccountSearch => {
    const section = search.section === 'usage' ? 'credits' : search.section;
    return section === 'profile' ||
      section === 'security' ||
      section === 'credits'
      ? { section }
      : {};
  },
  head: () => appPageHead(settings_navigation_account()),
  component: AccountPage,
});

const JUMP_PILL_CLASS =
  'inline-flex min-h-touch-target items-center rounded-full bg-surface-1 px-4 text-sm';

function AccountPage() {
  const { section } = Route.useSearch();
  /*
    The phone reaches this route through one door only — `?section=credits`,
    the hole `isMobileReachableSettingsSurface` opens in the desktop relay.
    So it shows that one section and names itself after it; 个人资料 / 登录安全
    / 应用安装 stay desktop-side, and their in-page jump pills would otherwise
    scroll to nothing.
  */
  const isMobile = useIsMobile();
  useEffect(() => {
    if (!section) return;
    document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [section]);
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: settings_title(), isCurrentPage: false },
        { label: settings_navigation_account(), isCurrentPage: true },
      ]}
      title={
        isMobile
          ? settings_account_credits_heading()
          : settings_navigation_account()
      }
      description={
        isMobile
          ? settings_account_mobile_credits_description()
          : settings_account_description()
      }
    >
      {/*
        Settings has no sidebar and no bottom bar on a phone, so without this
        the credits hole is a room with no door back out.
      */}
      {isMobile ? (
        <Link
          className={JUMP_PILL_CLASS}
          data-testid="settings-account-mobile-return"
          to="/dashboard"
        >
          {desktop_relay_return_mobile()}
        </Link>
      ) : null}

      {/*
        The account sections were reachable only by typing a `?section=` URL — the
        legacy aliases (/settings/profile · /settings/security · /settings/billing
        · /settings/credits · /settings/payment) all land here, and the sidebar
        settings group carries only 账户/模型/连接. These in-page jumps make every
        one of those destinations reachable without adding sidebar entries.
      */}
      <nav
        aria-label={settings_account_jump_label()}
        className={isMobile ? 'hidden' : 'flex flex-wrap items-center gap-2'}
        data-testid="settings-account-section-nav"
      >
        <span className="text-sm text-muted-foreground">
          {settings_account_jump_label()}
        </span>
        {(
          [
            ['profile', settings_account_profile_heading()],
            ['security', settings_account_security_heading()],
            ['credits', settings_account_credits_heading()],
          ] as const
        ).map(([id, label]) => (
          <Link
            className={JUMP_PILL_CLASS}
            key={id}
            search={{ section: id }}
            to="/settings/account"
          >
            {label}
          </Link>
        ))}
      </nav>

      {/*
        One surface per section. Every group below used to be a card of its own
        under the section heading — two names for one thing where the heading
        already said it (登录安全 over a card called 修改密码), and three cards
        competing at equal weight under 积分与账单. The section is the panel now
        and the groups are separated by a rule.
      */}
      {isMobile ? null : (
        <>
          <SettingsSection
            id="profile"
            title={settings_account_profile_heading()}
          >
            <UpdateNameCard />
            <UpdateAvatarCard />
          </SettingsSection>
          <SettingsSection
            id="security"
            title={settings_account_security_heading()}
          >
            <PasswordCardWrapper />
          </SettingsSection>
        </>
      )}
      {/* On the phone the page is this section, and the h1 already says so. */}
      <SettingsSection
        id="credits"
        title={isMobile ? undefined : settings_account_credits_heading()}
      >
        <MerchantCreditDetailPanel />
        <RedemptionCard />
        <BillingCard />
      </SettingsSection>
      {isMobile ? null : (
        <SettingsSection
          id="pwa-install"
          title={settings_account_pwa_heading()}
        >
          <InstallPrompt variant="settings" />
        </SettingsSection>
      )}
    </DashboardLayout>
  );
}
