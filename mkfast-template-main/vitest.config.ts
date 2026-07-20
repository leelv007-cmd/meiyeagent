import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for Web interaction tests (jsdom + Testing Library).
 * Pure model tests stay on node:test via `pnpm test`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.interaction.test.{ts,tsx}'],
    setupFiles: ['src/test/vitest-setup.ts'],
  },
});
