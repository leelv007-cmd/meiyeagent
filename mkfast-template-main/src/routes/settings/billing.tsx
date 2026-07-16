import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/billing')({
  beforeLoad: () => {
    throw redirect({ href: resolveLegacyRedirect('/settings/billing')! });
  },
});
