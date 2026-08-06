import { createP1CommandsHandlers } from '@/lib/p1-module-proxy';
import { createFileRoute } from '@tanstack/react-router';

/** Production handlers — tests re-create via createP1CommandsHandlers with deps. */
export const p1CommandsHandlers = createP1CommandsHandlers();

export const Route = createFileRoute('/api/core/p1/commands')({
  server: {
    handlers: p1CommandsHandlers,
  },
});
