import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/notifications')({
  beforeLoad: () => {
    throw redirect({ href: resolveLegacyRedirect('/settings/notifications')! });
  },
});
