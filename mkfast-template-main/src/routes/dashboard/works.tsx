import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/works')({
  component: WorksPage,
});

function WorksPage() {
  return <CanonicalHistoryPage mode="works" />;
}
