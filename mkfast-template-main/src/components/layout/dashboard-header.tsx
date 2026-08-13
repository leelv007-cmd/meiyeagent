import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { Sidebar } from '@/components/heroui-pro';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ModeSwitcher } from '@/components/theme/mode-switcher';
import { websiteConfig } from '@/config/website';
import { isMobileReachableSettingsSurface } from '@/lib/uiux/navigation';
import {
  shell_product_usage_entry,
  shell_product_usage_entry_aria,
  sidebar_toggle,
} from '@/locale/paraglide/messages';
import { IconGauge } from '@tabler/icons-react';
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useShellCreditsSummary } from '@/components/layout/use-shell-credits-summary';
import { useWorkspaceProvisioningNotice } from '@/components/layout/use-workspace-provisioning-notice';
import { WorkspaceProvisioningNotice } from '@/components/layout/workspace-provisioning-notice';

export interface DashboardBreadcrumbItem {
  label: string;
  href?: string;
  isCurrentPage?: boolean;
}

interface DashboardHeaderProps {
  breadcrumbs: DashboardBreadcrumbItem[];
  actions?: ReactNode;
  /**
   * Balance text for the topbar credits entry, from whichever surface already
   * knows it. When present the single entry prints the balance instead of the
   * bare label — one control answering「我还剩多少」and taking her to where the
   * rest of the answer is, rather than a readout parked beside a link.
   */
  creditsSummary?: string;
}

/**
 * Dashboard header with breadcrumbs and actions
 */
export function DashboardHeader({
  breadcrumbs,
  actions,
  creditsSummary,
}: DashboardHeaderProps) {
  const showModeSwitch = websiteConfig.ui?.mode?.enableSwitch ?? false;
  const isMobile = useIsMobile();
  const resolvedCreditsSummary = useShellCreditsSummary(creditsSummary);
  const provisioningDegraded = useWorkspaceProvisioningNotice();
  const isAdmin = useRouterState({
    select: (state) => state.location.pathname.startsWith('/admin'),
  });
  /*
   * Whether the credits surface is the page we are already on. TanStack marks
   * the link `aria-current="page"` there, which a screen reader hears but a
   * merchant looking at an identical pill does not — so it stops being a link
   * at all and stays as the balance readout it already was.
   */
  const onCreditsSurface = useRouterState({
    select: (state) =>
      isMobileReachableSettingsSurface(
        state.location.pathname,
        state.location.search
      ),
  });

  return (
    <>
      <header className="meiye-topbar flex h-(--header-height) shrink-0 items-center border-b transition-[width,height] ease-linear">
        <div className="flex w-full min-w-0 items-center gap-2 px-4 lg:px-6">
          {!isMobile ? (
            <>
              <Sidebar.Trigger
                aria-label={sidebar_toggle()}
                className="-ml-1 shrink-0"
              />
              <Separator
                orientation="vertical"
                className="mx-2 h-4 data-vertical:self-auto"
              />
            </>
          ) : null}

          {/*
          Every crumb but the last is already `hidden md:block`, so on a phone
          this renders one non-interactive word — and the same word is the h1
          right below it. At 390px the capsule row is 350 of the 358 available,
          which squeezed that word down to 14px and wrapped it one character
          per line. Drop the duplicate rather than shave the controls: the
          phone reads its location from the page title and the bottom bar.
        */}
          <Breadcrumb className="hidden min-w-0 flex-1 md:block">
            <BreadcrumbList className="text-sm font-medium">
              {breadcrumbs.map((item, index) => (
                <React.Fragment key={`breadcrumb-${index}`}>
                  {index > 0 && (
                    <BreadcrumbSeparator
                      key={`sep-${index}`}
                      className="hidden md:block"
                    />
                  )}
                  <BreadcrumbItem
                    key={`item-${index}`}
                    className={
                      index < breadcrumbs.length - 1 ? 'hidden md:block' : ''
                    }
                  >
                    {item.isCurrentPage ? (
                      <BreadcrumbPage>{item.label}</BreadcrumbPage>
                    ) : item.href ? (
                      <BreadcrumbLink render={<Link to={item.href} />}>
                        {item.label}
                      </BreadcrumbLink>
                    ) : (
                      item.label
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="meiye-topbar-capsule ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {actions}
            {/*
            One credits entry, not two. The topbar used to carry this pill
            beside a second「查看套餐与积分」pill, and on the workbench a third
            capsule printing the balance — three controls for one question,
            and on the credits page itself one of them pointed at the page the
            merchant was already reading. What is left answers「我还剩多少」and
            goes where the rest of the answer is; 「升级套餐」 lives on that page,
            next to the plan it would change (BillingCard), and on /pricing.
            Literal `to` instead of `Routes.SettingsAccount` — the typed router
            needs the path literal to accept `search`.
            `meiye-product-subscription-entry` is the shared topbar-pill shape,
            not a subscription-only style; see the handover note on renaming it.
          */}
            {!isAdmin ? (
              onCreditsSurface ? (
                <span
                  aria-current="page"
                  className="meiye-product-subscription-entry max-w-[min(60vw,22rem)]"
                  data-testid="product-usage-entry"
                  title={resolvedCreditsSummary ?? undefined}
                >
                  <IconGauge aria-hidden="true" className="size-4" />
                  {/*
                  The workbench balance handle rides on the entry it merged
                  into, so what used to be a capsule of its own is still one
                  named thing for the browser suite to read.
                */}
                  <span
                    className="truncate"
                    data-testid={
                      resolvedCreditsSummary
                        ? 'workbench-credit-topbar-balance'
                        : undefined
                    }
                  >
                    {resolvedCreditsSummary ?? shell_product_usage_entry()}
                  </span>
                </span>
              ) : (
                <Link
                  aria-label={shell_product_usage_entry_aria()}
                  className="meiye-product-subscription-entry max-w-[min(60vw,22rem)]"
                  data-testid="product-usage-entry"
                  search={{ section: 'credits' }}
                  title={resolvedCreditsSummary ?? undefined}
                  to="/settings/account"
                >
                  <IconGauge aria-hidden="true" className="size-4" />
                  {/*
                  The workbench balance handle rides on the entry it merged
                  into, so what used to be a capsule of its own is still one
                  named thing for the browser suite to read.
                */}
                  <span
                    className="truncate"
                    data-testid={
                      resolvedCreditsSummary
                        ? 'workbench-credit-topbar-balance'
                        : undefined
                    }
                  >
                    {resolvedCreditsSummary ?? shell_product_usage_entry()}
                  </span>
                </Link>
              )
            ) : null}
            <LocaleSwitcher />
            {showModeSwitch && <ModeSwitcher />}
          </div>
        </div>
      </header>
      {!isAdmin ? (
        <WorkspaceProvisioningNotice visible={provisioningDegraded} />
      ) : null}
    </>
  );
}
