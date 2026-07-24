/**
 * HeroUI Pro V3 (Glass) spike shell — T02 / issue #196.
 *
 * Dev-only scaffolding for the component base that T30–T36 build on. It mounts
 * nothing from the production IA and is hidden in production builds, so the
 * existing 门店橱窗 surfaces keep shipping unchanged (D-130: KEEP 桶不为换库迁移).
 *
 *   pnpm --filter @meiye/web dev → /heroui-spike
 */
import {
  createFileRoute,
  Link,
  notFound,
  Outlet,
} from '@tanstack/react-router';
import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { useTheme } from '@/components/theme/theme-provider';

export const Route = createFileRoute('/heroui-spike')({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound();
  },
  head: () => ({
    meta: [{ title: 'HeroUI Pro V3 Glass spike | Beauty Content Agent' }],
    // Route-scoped so src/styles.css and the initial CSS bundle stay untouched.
    links: [{ rel: 'stylesheet', href: heroUiGlassCss }],
  }),
  component: HeroUiSpikeLayout,
});

const SCAFFOLDS = [
  { to: '/heroui-spike/chat', label: '工作区交互页（template-chat）' },
  { to: '/heroui-spike/dashboard', label: '运营后台（template-dashboard）' },
] as const;

function HeroUiSpikeLayout() {
  return (
    <div className="meiye-heroui-glass bg-background text-foreground min-h-svh">
      <header className="border-border flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <span className="text-muted text-xs">
          HeroUI Pro V3 · Glass · 仅开发环境
        </span>
        <nav className="flex flex-wrap gap-2">
          {SCAFFOLDS.map((scaffold) => (
            <Link
              key={scaffold.to}
              to={scaffold.to}
              className="meiye-glass-piece text-foreground rounded-full px-4 py-1.5 text-xs"
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
            >
              {scaffold.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <Outlet />
    </div>
  );
}

/**
 * Both themes are first-class (D-042), so the spike carries its own switch
 * rather than depending on websiteConfig.ui.mode.enableSwitch — the dual-theme
 * screenshots have to be reachable regardless of how the app is configured.
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      data-testid="heroui-spike-theme-toggle"
      className="meiye-glass-piece text-foreground rounded-full px-4 py-1.5 text-xs"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {resolvedTheme === 'dark' ? '切到亮色' : '切到暗色'}
    </button>
  );
}
