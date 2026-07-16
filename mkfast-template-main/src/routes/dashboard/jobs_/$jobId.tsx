import { CanonicalJobRoutePage } from '@/product/canonical-object-route-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/jobs_/$jobId')({
  component: JobPage,
});

function JobPage() {
  const { jobId } = Route.useParams();
  return <CanonicalJobRoutePage jobId={jobId} />;
}
