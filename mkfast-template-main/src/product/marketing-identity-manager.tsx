import { useQuery } from '@tanstack/react-query';

import { buttonVariants } from '@/components/ui/button';
import { getLocale } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import type { MarketingIdentityAsset } from '@meiye/contracts';

import { marketingIdentitiesQuery } from './marketing-identity-queries';

/**
 * Identity summary on the asset page — T33 / #227.
 *
 * Identity management moved to its own page (D-117 wants「创建人设」「设为默认」
 * 「本次会话选择」visibly apart, which needs more room than a panel wedged into
 * the asset library). What stays here is the summary and the way in, so the
 * asset page keeps its identity entry without carrying the whole surface.
 *
 * Styled with global primitives on purpose: the only host is /dashboard/assets,
 * which is T32's file and carries no heroui-glass stylesheet link, so HeroUI
 * class names would render here as unstyled orphans.
 */
const COPY = {
  zh: {
    title: '口吻',
    description: '记下品牌或个人 IP 怎么说话、什么不能说。',
    active: '{count} 个生效中',
    empty: '还没有登记别的口吻。没有的时候，创作会用门店官方口吻。',
    manage: '管理口吻',
  },
  en: {
    title: 'Voices',
    description:
      'Note how the brand or personal IP speaks and what it must never say.',
    active: '{count} active',
    empty:
      'No other voice registered yet. Creation uses the store’s official voice.',
    manage: 'Manage voices',
  },
} as const;

export function MarketingIdentityManager() {
  const copy = COPY[getLocale()];
  const identities = useQuery<MarketingIdentityAsset[]>(
    marketingIdentitiesQuery
  );
  const activeCount = (identities.data ?? []).filter(
    (identity) => identity.status === 'active'
  ).length;

  return (
    <section
      aria-labelledby="marketing-identity-manager-title"
      className="meiye-porcelain space-y-4 rounded-2xl border p-4"
    >
      <div>
        <h3 className="font-medium" id="marketing-identity-manager-title">
          {copy.title}
        </h3>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
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
      </div>
    </section>
  );
}
