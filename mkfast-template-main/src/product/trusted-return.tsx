import { buttonVariants } from '@/components/ui/button';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { cn } from '@/lib/utils';
import {
  product_navigation_assets,
  product_navigation_content,
  product_navigation_store,
  product_navigation_workbench,
  trusted_return_anchor,
} from '@/locale/paraglide/messages';

/**
 * Trusted return destinations for detail pages.
 * Only enum ids are accepted — never raw URLs or free-form paths (no open redirect).
 *
 * `tasks` left the list with T34 / #228: the 旧任务页 retired and its successor,
 * the pending-actions inbox, is a workbench drawer with no location of its own.
 * A return anchor has to land somewhere real, so the id is gone rather than
 * pointed at a redirect.
 */
export const TRUSTED_RETURN_IDS = [
  'workbench',
  'content',
  'assets',
  'store',
] as const;

export type TrustedReturnId = (typeof TRUSTED_RETURN_IDS)[number];

const TRUSTED_RETURN_SET = new Set<string>(TRUSTED_RETURN_IDS);

export const TRUSTED_RETURN_TARGETS: Record<
  TrustedReturnId,
  { path: string; label: () => string }
> = {
  workbench: {
    path: Routes.Dashboard,
    label: () => product_navigation_workbench(),
  },
  content: {
    path: Routes.ContentLibrary,
    label: () => product_navigation_content(),
  },
  assets: {
    path: Routes.AssetLibrary,
    label: () => product_navigation_assets(),
  },
  store: {
    path: Routes.StoreProfile,
    label: () => product_navigation_store(),
  },
};

/** Accept only allowlisted id strings. Reject URLs, paths, and unknown values. */
export function parseTrustedReturn(
  value: unknown
): TrustedReturnId | undefined {
  if (typeof value !== 'string') return undefined;
  if (!TRUSTED_RETURN_SET.has(value)) return undefined;
  return value as TrustedReturnId;
}

export function trustedReturnPath(id: TrustedReturnId): string {
  return TRUSTED_RETURN_TARGETS[id].path;
}

export function trustedReturnHref(id: TrustedReturnId): string {
  return getPathWithLocale(trustedReturnPath(id));
}

export function TrustedReturnAnchor({
  from,
  className,
}: {
  from?: unknown;
  className?: string;
}) {
  const id = parseTrustedReturn(from);
  if (!id) return null;
  const target = TRUSTED_RETURN_TARGETS[id];
  return (
    <a
      className={cn(
        buttonVariants({ size: 'sm', variant: 'ghost' }),
        'min-h-touch-target w-fit px-0 text-sm font-medium text-primary underline-offset-4 hover:underline',
        className
      )}
      data-testid="trusted-return-anchor"
      data-trusted-return={id}
      href={trustedReturnHref(id)}
    >
      {trusted_return_anchor({ name: target.label() })}
    </a>
  );
}

/** Append `from=<id>` to an internal path that may already have a query string. */
export function withTrustedReturn(path: string, from: TrustedReturnId): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}from=${from}`;
}
