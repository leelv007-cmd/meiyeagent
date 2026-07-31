import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card';
import { UpdateNameCard } from '@/components/settings/profile/update-name-card';
import { PasswordCardWrapper } from '@/components/settings/security/password-card-wrapper';
import { BillingCard } from '@/components/settings/billing/billing-card';
import { AccountUsagePanel } from '@/product/account-usage-panel';
import { RedemptionCard } from '@/p1/redemption-card';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect } from 'react';
import {
  settings_account_description,
  settings_account_jump_label,
  settings_account_profile_heading,
  settings_account_pwa_heading,
  settings_account_security_heading,
  settings_account_usage_heading,
  settings_navigation_account,
  settings_title,
} from '@/locale/paraglide/messages';
import { InstallPrompt } from '@/pwa/install-prompt';

interface AccountSearch {
  section?: 'profile' | 'security' | 'usage';
}

export const Route = createFileRoute('/settings/account')({
  validateSearch: (search: Record<string, unknown>): AccountSearch => ({
    ...(search.section === 'profile' ||
    search.section === 'security' ||
    search.section === 'usage'
      ? { section: search.section }
      : {}),
  }),
  component: AccountPage,
});

function AccountPage() {
  const { section } = Route.useSearch();
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
      title={settings_navigation_account()}
      description={settings_account_description()}
    >
      {/*
        The three sections were reachable only by typing a `?section=` URL — the
        legacy aliases (/settings/profile · /settings/security · /settings/billing
        · /settings/credits · /settings/payment) all land here, and the sidebar
        settings group carries only 账户/模型/连接. These in-page jumps make every
        one of those destinations reachable without adding sidebar entries.
      */}
      <nav
        aria-label={settings_account_jump_label()}
        className="flex flex-wrap items-center gap-2"
        data-testid="settings-account-section-nav"
      >
        <span className="text-sm text-muted-foreground">
          {settings_account_jump_label()}
        </span>
        {(
          [
            ['profile', settings_account_profile_heading()],
            ['security', settings_account_security_heading()],
            ['usage', settings_account_usage_heading()],
          ] as const
        ).map(([id, label]) => (
          <Link
            className="inline-flex min-h-touch-target items-center rounded-full bg-surface-1 px-4 text-sm"
            key={id}
            search={{ section: id }}
            to="/settings/account"
          >
            {label}
          </Link>
        ))}
      </nav>

      <section className="scroll-mt-16 space-y-4" id="profile">
        <h2 className="text-lg font-semibold">
          {settings_account_profile_heading()}
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <UpdateNameCard />
          <UpdateAvatarCard />
        </div>
      </section>
      <section className="scroll-mt-16 space-y-4" id="security">
        <h2 className="text-lg font-semibold">
          {settings_account_security_heading()}
        </h2>
        <PasswordCardWrapper />
      </section>
      <section className="scroll-mt-16 space-y-4" id="usage">
        <h2 className="text-lg font-semibold">
          {settings_account_usage_heading()}
        </h2>
        <AccountUsagePanel />
        <RedemptionCard />
        <BillingCard />
      </section>
      <section className="scroll-mt-16 space-y-4" id="pwa-install">
        <h2 className="text-lg font-semibold">
          {settings_account_pwa_heading()}
        </h2>
        <InstallPrompt variant="settings" />
      </section>
    </DashboardLayout>
  );
}
