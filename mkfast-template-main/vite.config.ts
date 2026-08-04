import { defineConfig } from 'vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath, URL } from 'url';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import contentCollections from '@content-collections/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { paraglideCompilerOptions } from './paraglide.config';
import { e2eDisconnectedSocketPlugin } from './scripts/e2e/vite-disconnected-socket-plugin';
import { paraglideDevHeartbeatPlugin } from './scripts/locale/dev-heartbeat-plugin';

/**
 * Vite configuration
 * https://vite.dev/config/
 */
const config = defineConfig(({ command, mode }) => ({
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    devtools({
      eventBusConfig: {
        port: 0,
      },
    }),
    mode === 'e2e' ? e2eDisconnectedSocketPlugin() : null,
    tailwindcss(),
    contentCollections(),
    // Heartbeat so `locale:compile` fails fast instead of rewriting
    // src/locale/paraglide under a live dev server (#266). Registered even
    // when PARAGLIDE_PRECOMPILED disables the compiler plugin — that dev
    // server still reads the shared output directory.
    paraglideDevHeartbeatPlugin(),
    process.env.PARAGLIDE_PRECOMPILED === 'true'
      ? null
      : paraglideVitePlugin(paraglideCompilerOptions),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    // https://tanstack.dev/start/latest/docs/framework/react/build-from-scratch
    tanstackStart({
      srcDirectory: 'src',
      start: { entry: './start.tsx' },
      server: { entry: './server.ts' },
    }),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
    // https://developers.cloudflare.com/workers/vite-plugin/
    cloudflare({
      config:
        command === 'serve'
          ? (workerConfig) => ({
              vars: {
                ...workerConfig.vars,
                ...(process.env.CORE_SERVICE_URL
                  ? { CORE_SERVICE_URL: process.env.CORE_SERVICE_URL }
                  : {}),
                ...(process.env.CORE_SERVICE_TOKEN
                  ? { CORE_SERVICE_TOKEN: process.env.CORE_SERVICE_TOKEN }
                  : {}),
                ...(process.env.STRIPE_SECRET_KEY
                  ? { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY }
                  : {}),
                ...(process.env.STRIPE_WEBHOOK_SECRET
                  ? { STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET }
                  : {}),
                ...(process.env.WAFFO_DEBUG
                  ? { WAFFO_DEBUG: process.env.WAFFO_DEBUG }
                  : {}),
                ...(process.env.WAFFO_MERCHANT_ID
                  ? { WAFFO_MERCHANT_ID: process.env.WAFFO_MERCHANT_ID }
                  : {}),
                ...(process.env.WAFFO_PRIVATE_KEY
                  ? { WAFFO_PRIVATE_KEY: process.env.WAFFO_PRIVATE_KEY }
                  : {}),
                ...(process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY
                  ? {
                      WAFFO_WEBHOOK_TEST_PUBLIC_KEY:
                        process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY,
                    }
                  : {}),
              },
            })
          : undefined,
      viteEnvironment: {
        name: 'ssr',
      },
    }),
  ],
}));

export default config;
