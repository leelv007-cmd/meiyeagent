import { CanonicalWorkRoutePage } from '@/product/canonical-object-route-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/works_/$workId')({
  component: WorkPage,
});

function WorkPage() {
  const { workId } = Route.useParams();
  return <CanonicalWorkRoutePage workId={workId} />;
}
