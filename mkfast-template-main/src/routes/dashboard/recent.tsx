import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/recent')({
  component: RecentPage,
});

function RecentPage() {
  return <CanonicalHistoryPage mode="recent" />;
}
