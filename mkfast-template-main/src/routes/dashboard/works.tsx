import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { WorksListPage } from '@/product/works';
import { createFileRoute } from '@tanstack/react-router';

/**
 * 作品 list — T32 / #226 reshell.
 *
 * Points at the new works surface (canonical ContentPackage projection only).
 * The old CanonicalHistoryPage aggregate is no longer referenced from here,
 * which is half of T38's delete predicate (换壳全合入 ＋ 旧页零路由引用).
 *
 * The Glass sheet rides a route-level <link> exactly as /dashboard/ does — see
 * components/heroui-pro/README: HeroUI v3's --background/--foreground/--border/
 * --radius collide with the shadcn tokens the rest of the app still uses.
 */
export const Route = createFileRoute('/dashboard/works')({
  head: () => ({ links: [{ rel: 'stylesheet', href: heroUiGlassCss }] }),
  component: WorksListPage,
});
