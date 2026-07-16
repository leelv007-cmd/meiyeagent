export const productQueryKeys = {
  all: ['product'] as const,
  state: () => ['product', 'state'] as const,
};
