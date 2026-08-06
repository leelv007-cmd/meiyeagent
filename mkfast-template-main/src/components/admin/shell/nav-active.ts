import {
  ADMIN_NAV_GROUPS,
  ADMIN_UTILITY_ITEM,
  type AdminNavGroup,
  type ShellNavigationItem,
} from '@/config/sidebar-config';

/** `/admin` and `/admin/` are the same entry; a trailing slash must not
 * drop the active state. */
export function canonicalPath(value: string) {
  return value.replace(/\/$/, '') || '/';
}

// A declared nav href matches a pathname if it is the path itself or an
// ancestor of it (so detail routes keep their section active).
function hrefMatches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function allItems(): readonly ShellNavigationItem[] {
  return [ADMIN_UTILITY_ITEM, ...ADMIN_NAV_GROUPS.flatMap((g) => g.items)];
}

// The one active nav href for a pathname: the longest declared href that
// matches. A sub-route (/admin/supply/tasks/x) wins over the shell root
// (/admin) so exactly one item is highlighted.
export function activeAdminNavHref(pathname: string): string {
  const path = canonicalPath(pathname);
  let best = '';
  for (const item of allItems()) {
    if (hrefMatches(path, item.href) && item.href.length > best.length) {
      best = item.href;
    }
  }
  return best;
}

// The active area for a pathname: the utility entry (exception home) or a
// grouped item plus its group. Drives the sidebar highlight and the header
// breadcrumb trail. Returns null when nothing matches.
export function activeAdminTrail(pathname: string): {
  group?: AdminNavGroup;
  item: ShellNavigationItem;
} | null {
  const active = activeAdminNavHref(pathname);
  if (!active) return null;
  if (ADMIN_UTILITY_ITEM.href === active) return { item: ADMIN_UTILITY_ITEM };
  for (const group of ADMIN_NAV_GROUPS) {
    const item = group.items.find((entry) => entry.href === active);
    if (item) return { group, item };
  }
  return null;
}
