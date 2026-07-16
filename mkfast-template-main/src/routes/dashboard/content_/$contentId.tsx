import { CanonicalContentDetailPage } from '@/product/canonical-history-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/content_/$contentId')({
  component: ContentDetailRoute,
});

function ContentDetailRoute() {
  return <CanonicalContentDetailPage contentId={Route.useParams().contentId} />;
}
