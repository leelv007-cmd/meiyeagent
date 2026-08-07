import { createFileRoute, Outlet } from '@tanstack/react-router';
import BackButtonSmall from '@/components/shared/back-button-small';

export const Route = createFileRoute('/auth')({
  component: AuthLayout,
});

/**
 * The five auth pages share one shell: the 门店橱窗 ambient gradient behind a
 * single centred column, headings floating on the ambient band and the form
 * sitting on porcelain below it — the same order the workbench uses. Both
 * classes are load-bearing: `.meiye-auth-shell` carries the neutral ink tokens
 * this surface shares with /privacy, `.meiye-auth-window` adds the ambient
 * layer and the dark theme, which /privacy deliberately does not take.
 */
function AuthLayout() {
  return (
    <div className="meiye-auth-shell meiye-auth-window relative flex min-h-svh flex-col items-center justify-center px-6 py-20 md:p-10">
      <BackButtonSmall className="absolute top-6 left-6" />
      <div className="flex w-full max-w-md flex-col gap-6">
        <Outlet />
      </div>
    </div>
  );
}
