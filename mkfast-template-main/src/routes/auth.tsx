import { createFileRoute, Outlet } from '@tanstack/react-router';
import BackButtonSmall from '@/components/shared/back-button-small';

export const Route = createFileRoute('/auth')({
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="meiye-auth-shell relative flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <BackButtonSmall className="absolute top-6 left-6" />
      <div className="meiye-auth-card flex w-full max-w-sm flex-col gap-6 p-6 md:p-8">
        <Outlet />
      </div>
    </div>
  );
}
