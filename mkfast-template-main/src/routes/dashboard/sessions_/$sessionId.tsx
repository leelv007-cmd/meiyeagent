import { CreativeObjectPage } from '@/product/creative-object-page';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/sessions_/$sessionId')({
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  return <CreativeObjectPage id={sessionId} kind="Session" />;
}
