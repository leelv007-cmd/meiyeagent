import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/sessions')({
  component: SessionsPage,
});

function SessionsPage() {
  return <CanonicalHistoryPage mode="sessions" />;
}
