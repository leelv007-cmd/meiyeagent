import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ModeSwitcher } from '@/components/theme/mode-switcher';
import { websiteConfig } from '@/config/website';
import { Link } from '@tanstack/react-router';
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

  return (
    <header className="meiye-topbar flex h-(--header-height) shrink-0 items-center border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full min-w-0 items-center gap-2 px-4 lg:px-6">
        {!isMobile ? (
          <>
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator
              orientation="vertical"
              className="mx-2 h-4 data-vertical:self-auto"
            />
          </>
        ) : null}

        <Breadcrumb className="min-w-0 flex-1">
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

        <div className="meiye-topbar-capsule ml-auto flex shrink-0 items-center gap-2 px-2 py-1 pl-3">
          {actions}
          <LocaleSwitcher />
          {showModeSwitch && <ModeSwitcher />}
        </div>
      </div>
    </header>
  );
}
