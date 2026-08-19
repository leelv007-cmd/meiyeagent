/**
 * Device relay contract: desktop↔mobile handoff through the canonical
 * deep-link mapping (LINK-01 / R-P1-09). Distinct from publish handoff
 * packages (/dashboard/handoff/$token).
 */

import {
  parseDeepLinkStage,
  resolveCanonicalDeepLink,
  serializeCanonicalDeepLink,
  type DeepLinkStage,
} from '@/product/canonical-deep-link';

export type RelayStage = DeepLinkStage;

export type RelayTarget =
  | { kind: 'work'; workId: string; stage?: RelayStage }
  | { kind: 'package'; packageId: string; stage?: RelayStage };

function splitHref(href: string): {
  pathname: string;
  search: Record<string, string>;
  pathWithSearch: string;
} {
  const url = new URL(href, 'https://meiye.internal');
  return {
    pathname: url.pathname,
    search: Object.fromEntries(url.searchParams.entries()),
    pathWithSearch: `${url.pathname}${url.search}`,
  };
}

export function buildRelayLocation(target: RelayTarget): {
  pathname: string;
  search: Record<string, string>;
  pathWithSearch: string;
} {
  if (target.kind === 'work') {
    return splitHref(
      serializeCanonicalDeepLink({
        producer: 'device_relay',
        objectClass: 'workId',
        id: target.workId,
        ...(target.stage ? { stage: target.stage } : {}),
      })
    );
  }
  if (target.kind === 'package') {
    return splitHref(
      serializeCanonicalDeepLink({
        producer: 'device_relay',
        objectClass: 'packageId',
        id: target.packageId,
        ...(target.stage ? { stage: target.stage } : {}),
      })
    );
  }
  throw new Error('Unknown relay target kind.');
}

/** Parse dashboard search (or a full path/URL search) into a relay target. */
export function parseRelayTarget(
  input: Record<string, unknown> | string | URLSearchParams
): RelayTarget | undefined {
  if (typeof input === 'string' && input.startsWith('/')) {
    const url = new URL(input, 'https://meiye.internal');
    const destination = resolveCanonicalDeepLink({
      pathname: url.pathname,
      search: Object.fromEntries(url.searchParams.entries()),
    });
    if (destination.consumer === 'result_center' && destination.workId) {
      return destination.stage
        ? { kind: 'work', workId: destination.workId, stage: destination.stage }
        : { kind: 'work', workId: destination.workId };
    }
    if (destination.consumer === 'works_archive' && destination.packageId) {
      return destination.stage
        ? {
            kind: 'package',
            packageId: destination.packageId,
            stage: destination.stage,
          }
        : { kind: 'package', packageId: destination.packageId };
    }
    return undefined;
  }

  const search =
    typeof input === 'string'
      ? Object.fromEntries(
          new URLSearchParams(input.replace(/^\?/, '')).entries()
        )
      : input instanceof URLSearchParams
        ? Object.fromEntries(input.entries())
        : input;

  const destination = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search,
  });
  if (destination.consumer === 'result_center' && destination.workId) {
    return destination.stage
      ? { kind: 'work', workId: destination.workId, stage: destination.stage }
      : { kind: 'work', workId: destination.workId };
  }
  if (destination.consumer === 'works_archive' && destination.packageId) {
    return destination.stage
      ? {
          kind: 'package',
          packageId: destination.packageId,
          stage: destination.stage,
        }
      : { kind: 'package', packageId: destination.packageId };
  }
  return undefined;
}

/**
 * Desktop landing for a relay URL: a package target opened on desktop should
 * land on the works archive (the workbench only consumes taskId).
 */
export function desktopRelayLanding(search: {
  workId?: string;
  packageId?: string;
  stage?: string;
}): { contentId: string; stage?: RelayStage } | undefined {
  const destination = resolveCanonicalDeepLink({
    pathname: '/dashboard',
    search,
  });
  if (destination.consumer !== 'works_archive' || !destination.packageId) {
    return undefined;
  }
  return destination.stage
    ? { contentId: destination.packageId, stage: destination.stage }
    : { contentId: destination.packageId };
}

export function tryBuildRelayLocation(
  target: unknown
): ReturnType<typeof buildRelayLocation> | undefined {
  if (!target || typeof target !== 'object') return undefined;
  const record = target as Record<string, unknown>;
  try {
    if (record.kind === 'work' && typeof record.workId === 'string') {
      return buildRelayLocation({
        kind: 'work',
        workId: record.workId,
        ...(parseDeepLinkStage(record.stage)
          ? { stage: parseDeepLinkStage(record.stage) }
          : {}),
      });
    }
    if (record.kind === 'package' && typeof record.packageId === 'string') {
      return buildRelayLocation({
        kind: 'package',
        packageId: record.packageId,
        ...(parseDeepLinkStage(record.stage)
          ? { stage: parseDeepLinkStage(record.stage) }
          : {}),
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}
