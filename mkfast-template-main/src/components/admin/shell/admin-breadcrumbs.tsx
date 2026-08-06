import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ADMIN_UTILITY_ITEM } from '@/config/sidebar-config';
import { Link, useRouterState } from '@tanstack/react-router';
import { Fragment } from 'react';
import { activeAdminTrail, canonicalPath } from './nav-active';
import { useRecordCrumbLabel } from './page-crumb';

/**
 * The header trail states where you are; the sidebar does the browsing. Trail
 * = admin root / group label (plain text — groups have no landing page) /
 * section (link while a record segment follows, current page otherwise) /
 * record name published by the page via useRecordCrumb.
 */
export function AdminBreadcrumbs() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const recordLabel = useRecordCrumbLabel();
  const path = canonicalPath(pathname);
  const trail = activeAdminTrail(path);

  const atRoot = path === canonicalPath(ADMIN_UTILITY_ITEM.href);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {atRoot ? (
            <BreadcrumbPage>{ADMIN_UTILITY_ITEM.label}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              render={<Link to={ADMIN_UTILITY_ITEM.href} />}
              className="hidden sm:inline-flex"
            >
              {ADMIN_UTILITY_ITEM.label}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {trail && !atRoot ? (
          <Fragment>
            {trail.group ? (
              <Fragment>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem className="hidden sm:inline-flex">
                  {trail.group.label}
                </BreadcrumbItem>
              </Fragment>
            ) : null}
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem>
              {recordLabel ? (
                <BreadcrumbLink render={<Link to={trail.item.href} />}>
                  {trail.item.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{trail.item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {recordLabel ? (
              <Fragment>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{recordLabel}</BreadcrumbPage>
                </BreadcrumbItem>
              </Fragment>
            ) : null}
          </Fragment>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
