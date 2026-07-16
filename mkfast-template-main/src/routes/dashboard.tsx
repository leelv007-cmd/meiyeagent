import { ProductShellPage } from '@/components/layout/sidebar-layout';
import {
  dashboard_pending_description,
  dashboard_pending_eyebrow,
  dashboard_pending_loading,
  dashboard_pending_loading_description,
  dashboard_pending_title,
} from '@/locale/paraglide/messages';
import { authRouteMiddleware } from '@/middlewares/auth-middleware';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard')({
  ssr: false,
  component: ProductShellPage,
  pendingComponent: DashboardPending,
  server: {
    middleware: [authRouteMiddleware],
  },
});

function DashboardPending() {
  return (
    <div className="meiye-product-shell flex min-h-svh">
      <aside
        aria-hidden="true"
        className="hidden w-72 shrink-0 bg-sidebar lg:block"
      />
      <main className="min-w-0 flex-1">
        <div aria-hidden="true" className="h-12 border-b" />
        <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
          <p className="text-sm font-medium text-primary">
            {dashboard_pending_eyebrow()}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {dashboard_pending_title()}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {dashboard_pending_description()}
          </p>
          <section
            aria-busy="true"
            aria-live="polite"
            className="mt-6 min-h-44 rounded-lg border border-dashed bg-card p-6"
          >
            <p className="font-semibold">{dashboard_pending_loading()}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {dashboard_pending_loading_description()}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
