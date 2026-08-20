import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/credits')({
  beforeLoad: () => {
    resolveLegacyRedirect('/settings/credits');
    throw redirect({
      search: { section: 'credits' },
      to: '/settings/account',
    });
  },
});
