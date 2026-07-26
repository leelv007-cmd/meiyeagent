import { EmptyState } from '@/components/heroui-pro';
import {
  canonical_page_empty_description,
  canonical_page_empty_title,
  shell_admin_brand,
} from '@/locale/paraglide/messages';
import type { ReactNode } from 'react';

/**
 * 后台页头 —— 换壳前走 `CanonicalPage` → `DashboardLayout`（商家壳的页头），
 * 现在直接落在 template-dashboard 壳里（D-130）。
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
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <span className="text-muted text-xs">{shell_admin_brand()}</span>
        <h1 className="text-foreground text-2xl font-semibold">{title}</h1>
        <p className="text-muted text-sm">{description}</p>
      </header>
      {children ?? (
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>{canonical_page_empty_title()}</EmptyState.Title>
            <EmptyState.Description>
              {canonical_page_empty_description()}
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      )}
    </div>
  );
}
