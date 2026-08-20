import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';

const readPublicCommerceReadiness = createServerOnlyFn(async () => {
  const server = await import('./commerce-readiness.server');
  return server.readPublicCommerceReadiness();
});

/**
 * POST on purpose: a GET server function can be reused across `/pricing`
 * visits, so an admin CAS of `plan.credits.*` would keep quoting the old
 * catalogue. POST + route staleTime 0 is the public quote contract (#310).
 */
export const getCommerceReadiness = createServerFn({ method: 'POST' }).handler(
  () => readPublicCommerceReadiness()
);
