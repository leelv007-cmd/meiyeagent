/**
 * HeroUI Pro V3 (Glass) spike shell — T02 / issue #196.
 *
 * ISOLATED VENDOR SPIKE (admin restyle residual #387):
 * - Not part of the admin product surface. Admin heroui dependency scan
 *   excludes `src/routes/heroui-spike/**`.
 * - Dev-only: `beforeLoad` throws notFound() in production.
 * - Merchant shell + `heroui-pro` stay for product surfaces; this route is a
 *   sandbox that still consumes ListView and other HeroUI Pro blocks.
 * - Do not promote imports from this tree into `/admin/*` or `src/p1/admin-*`.
 *
 *   pnpm --filter @meiye/web dev → /heroui-spike
 */
import { useState } from 'react';
import {
  createFileRoute,
  Link,
  notFound,
  Outlet,
} from '@tanstack/react-router';
import { Button, Modal, Popover, Tooltip } from '@heroui/react';
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
        <div className="ml-auto flex items-center gap-2">
          <PortalProbe />
          <ThemeToggle />
        </div>
      </header>
      <Outlet />
    </div>
  );
}

/**
 * Portal token probe — the acceptance surface for C-02 blocker #2.
 *
 * modal / popover / tooltip all render through React Aria's <Overlay>, which
 * portals to document.body: they leave the .meiye-heroui-glass subtree, so they
 * are the case that decides whether the DESIGN.md token bridge actually reaches
 * every floating surface. Opening all three at once lets one capture read the
 * computed tokens off each of them and diff them against the shell.
 */
function PortalProbe() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="heroui-spike-portal-probe"
        className="meiye-glass-piece text-foreground rounded-full px-4 py-1.5 text-xs"
        onClick={() => setIsOpen((open) => !open)}
      >
        浮层探针
      </button>

      <Modal isOpen={isOpen} onOpenChange={setIsOpen}>
        <Modal.Backdrop isDismissable={false}>
          <Modal.Container size="sm">
            <Modal.Dialog data-testid="heroui-spike-portal-modal">
              <Modal.Header>
                <Modal.Heading>浮层 token 探针</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-muted text-sm">
                  这张卡片挂在 document.body 上，用来回读 DESIGN.md token。
                </p>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger>
          <Button size="sm" variant="ghost">
            气泡
          </Button>
        </Popover.Trigger>
        <Popover.Content data-testid="heroui-spike-portal-popover">
          <Popover.Dialog aria-label="气泡浮层探针">
            <span className="text-foreground text-sm">气泡浮层</span>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      <Tooltip isOpen={isOpen} onOpenChange={setIsOpen}>
        <Tooltip.Trigger>
          <Button size="sm" variant="ghost">
            提示
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content data-testid="heroui-spike-portal-tooltip">
          提示浮层
        </Tooltip.Content>
      </Tooltip>
    </>
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
