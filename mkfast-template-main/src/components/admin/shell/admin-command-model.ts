/**
 * Admin ⌘K search source: six-domain nav + recordable admin destinations.
 * Labels come from sidebar-config (single source of truth).
 */
import {
  ADMIN_NAV_GROUPS,
  ADMIN_UTILITY_ITEM,
  type ShellNavigationItem,
} from '@/config/sidebar-config';
import { Routes } from '@/lib/routes';

export type AdminCommandEntryKind = 'entity' | 'navigation';

export interface AdminCommandEntry {
  groupId: string;
  groupLabel: string;
  href: string;
  id: string;
  kind: AdminCommandEntryKind;
  keywords: string;
  label: string;
}

function entryFromNavItem(
  item: ShellNavigationItem,
  groupId: string,
  groupLabel: string,
  kind: AdminCommandEntryKind
): AdminCommandEntry {
  return {
    groupId,
    groupLabel,
    href: item.href,
    id: item.id,
    kind,
    keywords: [item.id, item.label, groupLabel, item.href]
      .filter(Boolean)
      .join(' '),
    label: item.label,
  };
}

/**
 * Navigation = six domain groups + exception-home utility.
 * Entities = recordable admin surfaces (users, supply, refunds, …) that hold
 * durable records — still sourced from the same nav list, no extra fetch.
 */
export function buildAdminCommandEntries(): AdminCommandEntry[] {
  const navigation: AdminCommandEntry[] = [
    entryFromNavItem(
      ADMIN_UTILITY_ITEM,
      'home',
      ADMIN_UTILITY_ITEM.label,
      'navigation'
    ),
  ];

  for (const group of ADMIN_NAV_GROUPS) {
    for (const item of group.items) {
      navigation.push(
        entryFromNavItem(item, group.id, group.label, 'navigation')
      );
    }
  }

  // Recordable destinations already in the six-domain nav, re-tagged so the
  // command palette can group them as "records" without a second source.
  const recordableIds = new Set([
    'users',
    'supply',
    'refund-review',
    'redemptions',
    'templates',
    'skills',
    'audit',
    'models',
  ]);
  const entities = navigation
    .filter((entry) => recordableIds.has(entry.id))
    .map((entry) => ({
      ...entry,
      id: `entity:${entry.id}`,
      kind: 'entity' as const,
    }));

  // Ensure exception home is always searchable even if utility label changes.
  if (!navigation.some((entry) => entry.href === Routes.Admin)) {
    navigation.unshift({
      groupId: 'home',
      groupLabel: 'Home',
      href: Routes.Admin,
      id: 'exception-home',
      kind: 'navigation',
      keywords: 'exception home admin',
      label: ADMIN_UTILITY_ITEM.label,
    });
  }

  return [...navigation, ...entities];
}

export function filterAdminCommandEntries(
  entries: readonly AdminCommandEntry[],
  query: string
): AdminCommandEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => {
    const haystack =
      `${entry.label} ${entry.keywords} ${entry.groupLabel}`.toLowerCase();
    return haystack.includes(needle);
  });
}
