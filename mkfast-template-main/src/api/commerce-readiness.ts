import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';

const readPublicCommerceReadiness = createServerOnlyFn(async () => {
  const server = await import('./commerce-readiness.server');
  return server.readPublicCommerceReadiness();
});

/** Client-safe stub. Runtime ports and credentials stay in the server module. */
export const getCommerceReadiness = createServerFn({ method: 'GET' }).handler(
  () => readPublicCommerceReadiness()
);
