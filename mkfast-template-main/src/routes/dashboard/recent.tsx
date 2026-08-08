import { ThreadListPage } from '@/product/thread-list-page';
import { createFileRoute } from '@tanstack/react-router';

/**
 * V31-05: /dashboard/recent is the Thread list projection (supersede D-088).
 * Sole session entry — no parallel Work-centric history surface.
 */
export const Route = createFileRoute('/dashboard/recent')({
  component: RecentPage,
});

function RecentPage() {
  return <ThreadListPage />;
}
