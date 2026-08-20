import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/billing')({
  beforeLoad: () => {
    resolveLegacyRedirect('/settings/billing');
    throw redirect({
      search: { section: 'credits' },
      to: '/settings/account',
    });
  },
});
