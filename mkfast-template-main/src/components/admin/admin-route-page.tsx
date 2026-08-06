import { PageHeader } from '@/components/admin/shared/page-header';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  canonical_page_empty_description,
  canonical_page_empty_title,
} from '@/locale/paraglide/messages';
import type { ReactNode } from 'react';

/**
 * 后台页头 —— 每个 admin 页的统一外壳。
 *
 * 标题行走共享 `PageHeader`（与批次 A/B 自建页头收敛成同一件），品牌小字由壳的
 * header 独家承担，页内不再重复一行。横向内距归壳（`admin-dashboard-shell` 的
 * `p-4 md:p-6`），这里只排纵向节奏。
 *
 * 契约保持不变：每个 admin 页仍恰好渲染一个带页面标题的 `<h1>` 与一行描述，
 * 无 children 时仍是空态 —— e2e 按 `heading level 1` 找页面，测试不改也照过。
 */
export function AdminRoutePage({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      {children ?? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{canonical_page_empty_title()}</EmptyTitle>
            <EmptyDescription>
              {canonical_page_empty_description()}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
