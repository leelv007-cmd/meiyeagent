import { useQuery } from '@tanstack/react-query';

import { Widget } from '@/components/heroui-pro';
import { buttonVariants } from '@heroui/react';
import { getLocale } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { queryP1 } from '@/p1/client';
import type { MarketingIdentityAsset } from '@meiye/contracts';

import { IDENTITY_QUERY_KEY } from './marketing-identity-page';

/**
 * Identity summary on the asset page — T33 / #227.
 *
 * Identity management moved to its own page (D-117 wants「创建人设」「设为默认」
 * 「本次会话选择」visibly apart, which needs more room than a panel wedged into
 * the asset library). What stays here is the summary and the way in, so the
 * asset page keeps its identity entry without carrying the whole surface.
 */
const COPY = {
  zh: {
    title: '表达身份',
    description: '记下品牌或个人 IP 怎么说话、什么不能说。',
    active: '{count} 个生效中',
    empty: '尚未登记身份。没有活动身份时，任务会回退为门店官方中性表达。',
    manage: '管理表达身份',
  },
  en: {
    title: 'Expression identity',
    description:
      'Note how the brand or personal IP speaks and what it must never say.',
    active: '{count} active',
    empty:
      'No identities yet. Tasks fall back to the store’s neutral official voice.',
    manage: 'Manage expression identities',
  },
} as const;

export function MarketingIdentityManager() {
  const copy = COPY[getLocale()];
  const identities = useQuery({
    queryKey: IDENTITY_QUERY_KEY,
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
  const activeCount = (identities.data ?? []).filter(
    (identity) => identity.status === 'active'
  ).length;

  return (
    <Widget
      aria-labelledby="marketing-identity-manager-title"
      className="meiye-porcelain"
      // Widget renders a div; the mobile entry points assert a landmark here.
      role="region"
    >
      <Widget.Header>
        <Widget.Title id="marketing-identity-manager-title">
          {copy.title}
        </Widget.Title>
        <Widget.Description>{copy.description}</Widget.Description>
      </Widget.Header>
      <Widget.Content className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted text-sm">
          {activeCount > 0
            ? copy.active.replace('{count}', String(activeCount))
            : copy.empty}
        </p>
        <a
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          href={getPathWithLocale(Routes.MarketingIdentity)}
        >
          {copy.manage}
        </a>
      </Widget.Content>
    </Widget>
  );
}
