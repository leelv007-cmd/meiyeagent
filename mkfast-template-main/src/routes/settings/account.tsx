import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { UpdateAvatarCard } from '@/components/settings/profile/update-avatar-card';
import { UpdateNameCard } from '@/components/settings/profile/update-name-card';
import { PasswordCardWrapper } from '@/components/settings/security/password-card-wrapper';
import { BillingCard } from '@/components/settings/billing/billing-card';
import { AccountUsagePanel } from '@/product/account-usage-panel';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { m } from '@/locale/paraglide/messages';

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
        { label: m.settings_title(), isCurrentPage: false },
        { label: m.settings_navigation_account(), isCurrentPage: true },
      ]}
      title={m.settings_navigation_account()}
      description={m.settings_account_description()}
    >
      <section className="scroll-mt-16 space-y-4" id="profile">
        <h2 className="text-lg font-semibold">
          {m.settings_account_profile_heading()}
        </h2>
        <div className="grid gap-4 xl:grid-cols-2">
          <UpdateNameCard />
          <UpdateAvatarCard />
        </div>
      </section>
      <section className="scroll-mt-16 space-y-4" id="security">
        <h2 className="text-lg font-semibold">
          {m.settings_account_security_heading()}
        </h2>
        <PasswordCardWrapper />
      </section>
      <section className="scroll-mt-16 space-y-4" id="usage">
        <h2 className="text-lg font-semibold">
          {m.settings_account_usage_heading()}
        </h2>
        <AccountUsagePanel />
        <BillingCard />
      </section>
    </DashboardLayout>
  );
}
