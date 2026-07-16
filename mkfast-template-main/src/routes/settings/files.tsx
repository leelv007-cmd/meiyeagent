import { resolveLegacyRedirect } from '@/lib/uiux/navigation';
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/settings/files')({
  beforeLoad: () => {
    throw redirect({ href: resolveLegacyRedirect('/settings/files')! });
  },
});
