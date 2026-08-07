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
import { useCurrentPlan } from '@/hooks/use-payment';
import { Routes } from '@/lib/routes';
import {
  shell_product_subscription_upgrade,
  shell_product_subscription_upgrade_short,
  shell_product_usage_entry,
  shell_product_usage_entry_aria,
  sidebar_toggle,
} from '@/locale/paraglide/messages';
import { IconGauge, IconSparkles } from '@tabler/icons-react';
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

export interface DashboardBreadcrumbItem {
  label: string;
  href?: string;
  isCurrentPage?: boolean;
}

interface DashboardHeaderProps {
  breadcrumbs: DashboardBreadcrumbItem[];
  actions?: ReactNode;
}

/**
 * Dashboard header with breadcrumbs and actions
 */
export function DashboardHeader({
  breadcrumbs,
  actions,
}: DashboardHeaderProps) {
  const showModeSwitch = websiteConfig.ui?.mode?.enableSwitch ?? false;
  const isMobile = useIsMobile();
  const isAdmin = useRouterState({
    select: (state) => state.location.pathname.startsWith('/admin'),
  });
  const currentPlan = useCurrentPlan(!isAdmin);
  const showSubscriptionEntry =
    !isAdmin &&
    currentPlan.isSuccess &&
    !currentPlan.data?.currentPlan?.isLifetime &&
    !currentPlan.data?.subscription;

  return (
    <header className="meiye-topbar flex h-(--header-height) shrink-0 items-center border-b transition-[width,height] ease-linear">
      <div className="flex w-full min-w-0 items-center gap-2 px-4 lg:px-6">
        {!isMobile ? (
          <>
            <Sidebar.Trigger aria-label={sidebar_toggle()} className="-ml-1 shrink-0" />
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
            「我还剩多少」was reachable only by typing the URL: the pricing CTA
            answers「买什么」, not「剩多少」. The credits section is the one place
            that answers it, so the capsule links straight at it. Literal `to`
            instead of `Routes.SettingsAccount` — the typed router needs the
            path literal to accept `search`.
            `meiye-product-subscription-entry` is the shared topbar-pill shape,
            not a subscription-only style; see the handover note on renaming it.
          */}
          {!isAdmin ? (
            <Link
              aria-label={shell_product_usage_entry_aria()}
              className="meiye-product-subscription-entry"
              data-testid="product-usage-entry"
              search={{ section: 'credits' }}
              to="/settings/account"
            >
              <IconGauge aria-hidden="true" className="size-4" />
              <span>{shell_product_usage_entry()}</span>
            </Link>
          ) : null}
          {showSubscriptionEntry ? (
            <Link
              aria-label={shell_product_subscription_upgrade()}
              className="meiye-product-subscription-entry"
              data-testid="product-subscription-entry"
              to={Routes.Pricing}
            >
              <IconSparkles aria-hidden="true" className="size-4 text-spark" />
              {/* 390px used to leave a bare spark with no words next to it. */}
              <span className="sm:hidden">
                {shell_product_subscription_upgrade_short()}
              </span>
              <span className="hidden sm:inline">
                {shell_product_subscription_upgrade()}
              </span>
            </Link>
          ) : null}
          <LocaleSwitcher />
          {showModeSwitch && <ModeSwitcher />}
        </div>
      </div>
    </header>
  );
}
