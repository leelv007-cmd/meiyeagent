import { ProductIcon } from '@/components/uiux/product-icon';
import {
  BUSINESS_SIDEBAR_ITEMS,
  SETTINGS_SIDEBAR_ITEMS,
  type ShellMode,
  type ShellNavigationItem,
} from '@/config/sidebar-config';
import { Sidebar, useSidebar } from '@/components/heroui-pro';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  shell_business_navigation_aria,
  shell_settings,
  shell_settings_navigation_aria,
} from '@/locale/paraglide/messages';

interface SidebarMainProps {
  mode: ShellMode;
}

function canonicalPath(value: string) {
  return value.replace(/\/$/, '') || '/';
}

/**
 * 商家壳的导航列表（S7 / U07 换壳后）。
 *
 * 分组与分组标题走 HeroUI Pro 的 `Sidebar.Group` / `Sidebar.GroupLabel`，行不走
 * `Sidebar.MenuItem`：Pro 的行是 React Aria Tree 的 `role="row"`，会吃掉链接语义。
 * 词表仍然只有 `config/sidebar-config` 一个来源，`<nav aria-label>` 地标也照旧，
 * 换壳前后 `getByRole('navigation') → getByRole('link')` 读到的是同一组四项。
 */
export function SidebarMain({ mode }: SidebarMainProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { isMobile, setMobileOpen } = useSidebar();

  const closeMobileSidebar = () => {
    if (isMobile) setMobileOpen(false);
  };

  const renderNavigation = (
    items: readonly ShellNavigationItem[],
    label: string,
    groupLabel?: string
  ) => (
    <Sidebar.Group key={label}>
      {groupLabel ? (
        <Sidebar.GroupLabel>{groupLabel}</Sidebar.GroupLabel>
      ) : null}
      <nav aria-label={label}>
        <ul className="meiye-sidebar-nav">
          {items.map((item) => {
            const current = canonicalPath(pathname);
            const target = canonicalPath(item.href);
            const isActive =
              current === target ||
              (target !== '/dashboard' && current.startsWith(`${target}/`));
            return (
              <li key={item.id}>
                {/*
                  收起态（`collapsible="icon"`）里这一行只剩图标：vendored 表把
                  `[data-sidebar="label"]` 收成 visibility:hidden，图标又是
                  aria-hidden 的装饰件，于是链接的可访问名整个没有——读屏播报
                  「链接」，`getByRole('link', { name })` 也命不中。Pro 自带的
                  收起态 tooltip 只服务它自己的 Tree 行（Sidebar.MenuItem），
                  盖不到这里的真 `<Link>`。名字因此恒挂在 aria-label 上，取的
                  仍是 `config/sidebar-config` 那一份词表：展开态下它与可见文案
                  逐字相同，可访问名不因换态而变。
                */}
                <Link
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  className="meiye-sidebar-nav-item"
                  data-active={isActive ? 'true' : undefined}
                  onClick={closeMobileSidebar}
                  to={item.href}
                >
                  <ProductIcon icon={item.icon} />
                  <span className="truncate font-medium" data-sidebar="label">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </Sidebar.Group>
  );

  return (
    <>
      {renderNavigation(
        BUSINESS_SIDEBAR_ITEMS,
        shell_business_navigation_aria()
      )}
      {mode === 'settings'
        ? renderNavigation(
            SETTINGS_SIDEBAR_ITEMS,
            shell_settings_navigation_aria(),
            shell_settings()
          )
        : null}
    </>
  );
}
