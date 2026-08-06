import { createP1QueryHandlers } from '@/lib/p1-module-proxy';
import { createFileRoute } from '@tanstack/react-router';

/** Production handlers — tests re-create via createP1QueryHandlers with deps. */
export const p1QueryHandlers = createP1QueryHandlers();

export const Route = createFileRoute('/api/core/p1/query')({
  server: {
    handlers: p1QueryHandlers,
  },
});
