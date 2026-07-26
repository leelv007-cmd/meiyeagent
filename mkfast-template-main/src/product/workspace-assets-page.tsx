import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Widget } from '@/components/heroui-pro';
import { buttonVariants } from '@heroui/react';
import { Routes } from '@/lib/routes';
import {
  product_navigation_identity,
  product_navigation_store,
  workspace_assets_description,
  workspace_empty_facts,
  workspace_empty_identities,
  workspace_empty_materials,
  workspace_material_count,
  workspace_open_asset_library,
  workspace_open_identity,
  workspace_open_store,
  workspace_sample_isolation_note,
  workspace_section_facts,
  workspace_section_identities,
  workspace_section_materials,
} from '@/locale/paraglide/messages';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { useProductState } from '@/product/client';
import {
  isPlatformSampleId,
  type MarketingIdentityAsset,
  type StoreFact,
} from '@meiye/contracts';

/**
 * Content workspace asset container — T33 / #227.
 *
 * D-121 story 44: what a merchant sees here is their own material, their own
 * confirmed facts and their own identities. Platform sample assets belong to
 * the cold-start demo (D-126) and are filtered out by their reserved id
 * namespace before anything renders — see workspace-assets-page.test.ts.
 *
 * The D-121 套餐 dimension (工作区 1/2/3＋加油包) is deliberately absent: there is
 * no ContentWorkspace projection to read it from, and D-121 forbids reusing the
 * tenant workspaceId to stand in for it. That contract is tracked as OI-50.
 */
export function WorkspaceAssetsPage() {
  const { state } = useProductState();
  const workspaceId = state?.workspaceId;
  const [factsAsOf] = useState(() => new Date().toISOString());
  const factsPayload = {
    scope: { storeId: workspaceId ?? '' },
    at: factsAsOf,
  };
  const facts = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: p1QueryKeys.request(
      'context',
      'store_facts_active',
      factsPayload
    ),
    queryFn: ({ signal }) =>
      queryP1<StoreFact[]>(
        'context',
        { action: 'store_facts_active', payload: factsPayload },
        signal
      ),
  });
  const identities = useQuery({
    queryKey: ['marketing-identities'] as const,
    queryFn: ({ signal }) =>
      queryP1<MarketingIdentityAsset[]>(
        'marketing-identity',
        {
          action: 'marketing_identities',
          payload: { includeInactive: true },
        },
        signal
      ),
  });
  const materials = tenantMaterials(state?.assets ?? []);
  const activeIdentities = (identities.data ?? []).filter(
    (identity) => identity.status === 'active'
  );

  return (
    <div className="space-y-6">
      <p className="text-muted max-w-prose text-sm">
        {workspace_assets_description()}
      </p>

      <Widget className="meiye-porcelain">
        <Widget.Header>
          <Widget.Title>{workspace_section_materials()}</Widget.Title>
          <Widget.Description>
            {workspace_sample_isolation_note()}
          </Widget.Description>
        </Widget.Header>
        <Widget.Content className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted text-sm">
            {materials.length > 0
              ? workspace_material_count({ count: materials.length })
              : workspace_empty_materials()}
          </p>
          <Link
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
            to={Routes.AssetLibrary}
          >
            {workspace_open_asset_library()}
          </Link>
        </Widget.Content>
      </Widget>

      <Widget className="meiye-porcelain">
        <Widget.Header>
          <Widget.Title>{workspace_section_facts()}</Widget.Title>
        </Widget.Header>
        <Widget.Content className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted text-sm">
            {(facts.data ?? []).length > 0
              ? workspace_material_count({ count: facts.data?.length ?? 0 })
              : workspace_empty_facts()}
          </p>
          <Link
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
            to={Routes.StoreProfile}
          >
            {workspace_open_store()}
          </Link>
        </Widget.Content>
      </Widget>

      <Widget className="meiye-porcelain">
        <Widget.Header>
          <Widget.Title>{workspace_section_identities()}</Widget.Title>
        </Widget.Header>
        <Widget.Content className="space-y-3">
          {activeIdentities.length > 0 ? (
            <ul className="divide-divider divide-y">
              {activeIdentities.map((identity) => (
                <li
                  className="py-2 first:pt-0 last:pb-0 text-sm"
                  data-i18n-pass-through="identity-name"
                  key={identity.identityId}
                >
                  {identity.displayName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-sm">{workspace_empty_identities()}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Link
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              to={Routes.MarketingIdentity}
            >
              {workspace_open_identity()}
            </Link>
          </div>
        </Widget.Content>
      </Widget>

      <p className="text-muted text-xs">
        {product_navigation_store()} · {product_navigation_identity()}
      </p>
    </div>
  );
}

/**
 * D-126/story 44: platform_sample entities live in a reserved id namespace and
 * never belong to a tenant workspace view. Exported so the isolation is a
 * testable rule rather than a claim about the rendering.
 */
export function tenantMaterials<T extends { id: string }>(assets: T[]) {
  return assets.filter((asset) => !isPlatformSampleId(asset.id));
}
