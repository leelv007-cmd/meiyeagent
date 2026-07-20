import { CanonicalWorkRoutePage } from '@/product/canonical-object-route-page';
import { parseLightComposerCarrier } from '@/p1/content-package-export-carrier';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/works_/$workId')({
  component: WorkPage,
});

function WorkPage() {
  const { workId } = Route.useParams();
  const { exportCarrier } = Route.useSearch() as { exportCarrier?: unknown };
  return (
    <CanonicalWorkRoutePage
      exportUseDelivery={parseLightComposerCarrier(exportCarrier)}
      workId={workId}
    />
  );
}
