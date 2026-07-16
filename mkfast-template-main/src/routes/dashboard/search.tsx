import { CanonicalHistoryPage } from '@/product/canonical-history-page';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/search')({
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q.slice(0, 120) : '',
  }),
});

function SearchPage() {
  const navigate = useNavigate({ from: '/dashboard/search' });
  const { q } = Route.useSearch();
  return (
    <CanonicalHistoryPage
      mode="search"
      searchQuery={q}
      onSearchQueryChange={(query) =>
        void navigate({ replace: true, search: { q: query } })
      }
    />
  );
}
