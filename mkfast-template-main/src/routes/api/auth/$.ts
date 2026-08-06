import { createAuthCatchAllHandlers } from '@/auth/auth-endpoint-dispatch';
import { createFileRoute } from '@tanstack/react-router';

/** Production handlers — tests re-create via createAuthCatchAllHandlers with deps. */
export const authCatchAllHandlers = createAuthCatchAllHandlers();

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: authCatchAllHandlers,
  },
});
