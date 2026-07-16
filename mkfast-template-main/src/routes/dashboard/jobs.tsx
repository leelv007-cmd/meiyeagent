import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/jobs')({
  component: JobsPage,
});

function JobsPage() {
  return <CanonicalHistoryPage mode="jobs" />;
}
