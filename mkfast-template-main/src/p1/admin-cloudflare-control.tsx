/**
 * Admin Cloudflare read-only control (J6).
 *
 * Explicit view is the SSR seam. Product rendering reads the Core-side
 * read-only inventory query. No Cloudflare write controls or GraphQL.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';

import { CloudflareReadonlyPanel } from '@/components/admin/cloudflare/cloudflare-readonly-panel';
import {
  projectAdminCfProbe,
  type AdminCfProbeKind,
  type AdminCfProbeView,
} from '@/p1/admin-cloudflare-probe';
import {
  buildAdminCloudflarePresentation,
  type AdminCfInventoryInput,
  type AdminCfPresentationView,
  type AdminCfResolvedDeepLinkInput,
} from '@/p1/admin-cloudflare-presentation';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  ADMIN_CF_DEEP_LINK_RESOURCE_KINDS,
  type AdminCfDeepLinkResourceKind,
} from '@/p1/admin-cloudflare-deep-link';

const freshnessSchema = z.enum([
  'fresh',
  'stale',
  'unknown',
  'not_verified',
  'unavailable',
]);
const PROBE_KINDS = [
  'shell_http',
  'database_connectivity',
  'object_storage_binding',
  'mapping_readiness',
] as const satisfies readonly AdminCfProbeKind[];
const deepLinkKindSchema = z.enum(ADMIN_CF_DEEP_LINK_RESOURCE_KINDS);
const NO_EVIDENCE_AT = '1970-01-01T00:00:00.000Z';
const nonEmpty = z.string().min(1);
const optionalFreshness = { freshness: freshnessSchema.optional() };
const unknownFieldSchema = z.object({
  status: z.literal('unknown'),
  reason: nonEmpty,
  detail: nonEmpty.optional(),
  ...optionalFreshness,
});
const deploymentSchema = z
  .object({
    deploymentId: nonEmpty,
    versionId: nonEmpty.optional(),
    createdOn: nonEmpty.optional(),
    source: nonEmpty.optional(),
    trafficPercent: z.number().optional(),
    note: nonEmpty.optional(),
  })
  .transform((row) => ({
    ...row,
    note:
      row.note ??
      '部署版本仅反映 App Shell 发布事实，不是业务数据回滚；不覆盖 Core/Canvas',
  }));
const deploymentsFieldSchema = z.discriminatedUnion('status', [
  unknownFieldSchema,
  z.object({
    status: z.literal('known'),
    value: z.array(deploymentSchema),
    ...optionalFreshness,
  }),
]);
const versionsFieldSchema = z.discriminatedUnion('status', [
  unknownFieldSchema,
  z.object({
    status: z.literal('known'),
    value: z.array(
      z.object({ versionId: nonEmpty, createdOn: nonEmpty.optional() })
    ),
    ...optionalFreshness,
  }),
]);
const inventorySchema = z.object({
  mappingRef: nonEmpty,
  capturedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  freshness: freshnessSchema,
  deployments: deploymentsFieldSchema,
  versions: versionsFieldSchema,
  resources: z.array(
    z.object({
      kind: nonEmpty,
      name: nonEmpty,
      readiness: nonEmpty,
      businessImpact: nonEmpty,
      detail: nonEmpty.optional(),
    })
  ),
  cloudflareQueuesEnabled: z.literal(false),
  graphqlAnalyticsDeferred: z.literal(true),
  cache: z
    .object({
      hit: z.boolean(),
      ttlMs: z.number(),
      ageMs: z.number().nullable(),
    })
    .optional(),
});
const probeSchema = z.object({
  kind: z.enum(PROBE_KINDS),
  status: z.enum(['ok', 'degraded', 'failed', 'unknown', 'not_ready']),
  businessImpact: nonEmpty,
  observedAt: nonEmpty,
  detail: nonEmpty.optional(),
});
const deepLinkSchema = z.object({
  kind: deepLinkKindSchema,
  dashboardUrl: nonEmpty,
});
const cloudflareReadResponseSchema = z.union([
  z.object({
    inventory: inventorySchema,
    probes: z.array(probeSchema).optional(),
    deepLinks: z.array(deepLinkSchema).optional(),
  }),
  inventorySchema.transform((inventory) => ({ inventory })),
]);

function unknownProbes(reason: string, observedAt: string): AdminCfProbeView[] {
  return PROBE_KINDS.map((kind) =>
    projectAdminCfProbe({
      kind,
      status: 'unknown',
      businessImpact: `自有健康探针读取不可用（${reason}），不得展示为正常`,
      observedAt,
      detail: reason,
    })
  );
}

export function projectAdminCloudflareLiveView(
  value: unknown,
  state: { failed?: boolean } = {}
): AdminCfPresentationView {
  const response = cloudflareReadResponseSchema.safeParse(value);
  const parsedInventory: AdminCfInventoryInput | undefined = response.success
    ? response.data.inventory
    : undefined;
  const inventory: AdminCfInventoryInput | undefined =
    parsedInventory && state.failed
      ? {
          ...parsedInventory,
          freshness: 'stale',
          deployments: { ...parsedInventory.deployments, freshness: 'stale' },
          versions: { ...parsedInventory.versions, freshness: 'stale' },
        }
      : parsedInventory;
  const observedAt = inventory?.capturedAt ?? NO_EVIDENCE_AT;
  const probes = response.success
    ? ('probes' in response.data ? (response.data.probes ?? []) : []).map(
        projectAdminCfProbe
      )
    : [];
  const deepLinks: AdminCfResolvedDeepLinkInput[] | undefined =
    response.success && 'deepLinks' in response.data
      ? (response.data.deepLinks as
          | Array<{ kind: AdminCfDeepLinkResourceKind; dashboardUrl: string }>
          | undefined)
      : undefined;
  if (inventory) {
    return buildAdminCloudflarePresentation({
      inventory,
      probes:
        probes.length > 0
          ? probes
          : unknownProbes(
              state.failed ? 'read_failed' : 'self_probe_not_returned',
              observedAt
            ),
      now: new Date(observedAt),
      deepLinks,
    });
  }

  const reason = state.failed ? 'read_failed' : 'cache_miss';
  return buildAdminCloudflarePresentation({
    inventory: {
      mappingRef: 'shell-default',
      capturedAt: observedAt,
      freshness: 'unknown',
      deployments: { status: 'unknown', reason, freshness: 'unknown' },
      versions: { status: 'unknown', reason, freshness: 'unknown' },
      resources: [],
      cloudflareQueuesEnabled: false,
      graphqlAnalyticsDeferred: true,
    },
    probes: unknownProbes(reason, observedAt),
    now: new Date(observedAt),
    deepLinks,
  });
}

function LiveAdminCloudflareControl() {
  const query = useQuery({
    queryKey: p1QueryKeys.request('admin-config', 'cloudflare_inventory'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'admin-config',
        { action: 'cloudflare_inventory', payload: {} },
        signal
      ),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const view = useMemo(
    () => projectAdminCloudflareLiveView(query.data, { failed: query.isError }),
    [query.data, query.isError]
  );
  return <CloudflareReadonlyPanel view={view} />;
}

export function AdminCloudflareControl({
  inventory,
  view: viewProp,
}: {
  inventory?: AdminCfInventoryInput | null;
  view?: AdminCfPresentationView;
} = {}) {
  if (viewProp) return <CloudflareReadonlyPanel view={viewProp} />;
  if (inventory !== undefined) {
    return (
      <CloudflareReadonlyPanel
        view={buildAdminCloudflarePresentation({
          inventory,
          probes: unknownProbes(
            'self_probe_not_returned',
            inventory?.capturedAt ?? NO_EVIDENCE_AT
          ),
        })}
      />
    );
  }

  return <LiveAdminCloudflareControl />;
}
