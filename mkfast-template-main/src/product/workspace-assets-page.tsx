import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Widget } from '@/components/heroui-pro';
import { buttonVariants } from '@heroui/react';
import { Routes } from '@/lib/routes';
import {
  dashboard_store_facts_failed,
  dashboard_store_facts_loading,
  product_navigation_identity,
  product_navigation_store,
  workspace_assets_description,
  workspace_empty_facts,
  workspace_empty_identities,
  workspace_empty_materials,
  workspace_identities_failed,
  workspace_identities_loading,
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
import { marketingIdentitiesQuery } from '@/product/marketing-identity-queries';
import {
  isPlatformSampleId,
  type MarketingIdentityAsset,
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
      queryP1(
        'context',
        { action: 'store_facts_active', payload: factsPayload },
        signal
      ),
  });
  const identities = useQuery<MarketingIdentityAsset[]>(
    marketingIdentitiesQuery
  );
  const materials = tenantMaterials(state?.assets ?? []);
  const activeIdentities = (identities.data ?? []).filter(
    (identity) => identity.status === 'active'
  );

  return (
    <div className="space-y-6">
      {/*
        这一行与页脚那一行不在白瓷件里，直接压在 product 壳的门店橱窗氛围底图上。
        `text-muted` 在这里是双重的错：--muted 在商家壳是 4% 的底色（heroui-glass.css
        已在共享边界上把它映回壳的 muted 前景），但即便映成 --ink-60，深灰压在照片上
        实测也只有 1.6:1——这是「层」的问题，不是 token 的问题，token 侧收不动。
        压在氛围层上的字走 DESIGN.md 的 .meiye-ambient-copy：白字 + 投影，和 works /
        store / identity 的页头副行同一套（T46 已按这套量过）。
      */}
      <div className="meiye-ambient-copy">
        <p
          className="meiye-type-aux max-w-prose"
          data-testid="workspace-assets-description"
        >
          {workspace_assets_description()}
        </p>
      </div>

      <Widget className="meiye-porcelain">
        <Widget.Header>
          <Widget.Title>{workspace_section_materials()}</Widget.Title>
          <Widget.Description>
            {workspace_sample_isolation_note()}
          </Widget.Description>
        </Widget.Header>
        <Widget.Content className="flex flex-wrap items-center justify-between gap-4">
          <p
            className="text-muted text-sm"
            data-testid="workspace-materials-summary"
          >
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
          {/* A read that has not landed yet, and a read that failed, are not
              the same thing as an empty store — say which one it is. */}
          <p className="text-muted text-sm">
            {facts.isPending
              ? dashboard_store_facts_loading()
              : facts.isError
                ? dashboard_store_facts_failed()
                : facts.data.length > 0
                  ? workspace_material_count({ count: facts.data.length })
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
          {identities.isPending ? (
            <p className="text-muted text-sm">
              {workspace_identities_loading()}
            </p>
          ) : identities.isError ? (
            <p className="text-muted text-sm">
              {workspace_identities_failed()}
            </p>
          ) : activeIdentities.length > 0 ? (
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

      {/*
        页脚指路也压在氛围层上，但它落在页尾——压暗遮罩到那里已经散完（实测底色
        170,151,139，是照片的亮部），白字只有 2.71:1，页头那套在这里反而不成立。
        氛围层上的字要么有遮罩，要么自带面：这一行给它一枚白瓷小丸，落回和同页
        三张 Widget 一样的实体底，两个主题下都是 text-muted → --ink-60 压白瓷的
        5.74:1，不再随照片明暗漂。
      */}
      <p
        className="meiye-porcelain text-muted inline-flex rounded-full px-3 py-1 text-xs"
        data-testid="workspace-assets-footnote"
      >
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
