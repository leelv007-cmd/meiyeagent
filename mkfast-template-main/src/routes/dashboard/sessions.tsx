import { appPageHead } from '@/lib/seo';
import { legacy_projection_kind_session } from '@/locale/paraglide/messages';
import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/sessions')({
  head: () => appPageHead(legacy_projection_kind_session()),
  component: SessionsPage,
});

function SessionsPage() {
  return <CanonicalHistoryPage mode="sessions" />;
}
