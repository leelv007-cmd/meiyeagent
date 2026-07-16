import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
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

const serviceWorkerTemplatePath = fileURLToPath(
  new URL('./src/components/pwa/service-worker.js', import.meta.url)
);

function renderServiceWorker(cacheVersion: string) {
  return readFileSync(serviceWorkerTemplatePath, 'utf8').replace(
    '__PWA_CACHE_VERSION__',
    cacheVersion
  );
}

function pwaServiceWorker(): Plugin {
  return {
    name: 'pwa-service-worker',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost')
          .pathname;
        if (pathname !== '/sw.js') {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/javascript');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Service-Worker-Allowed', '/');
        response.end(renderServiceWorker('development'));
      });
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') {
        return;
      }

      const cacheVersion = createHash('sha256')
        .update(Object.keys(bundle).sort().join('|'))
        .digest('hex')
        .slice(0, 12);

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderServiceWorker(cacheVersion),
      });
    },
  };
}

/**
 * Vite configuration
 * https://vite.dev/config/
 */
const config = defineConfig(({ command }) => ({
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    pwaServiceWorker(),
    devtools({
      eventBusConfig: {
        port: 0,
      },
    }),
    tailwindcss(),
    contentCollections(),
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
                ...(process.env.CANVAS_SERVICE_URL
                  ? { CANVAS_SERVICE_URL: process.env.CANVAS_SERVICE_URL }
                  : {}),
                ...(process.env.CANVAS_SERVICE_TOKEN
                  ? { CANVAS_SERVICE_TOKEN: process.env.CANVAS_SERVICE_TOKEN }
                  : {}),
                ...(process.env.CANVAS_ORIGIN
                  ? { CANVAS_ORIGIN: process.env.CANVAS_ORIGIN }
                  : {}),
                ...(process.env.PRO_STUDIO_OFFER_ID
                  ? { PRO_STUDIO_OFFER_ID: process.env.PRO_STUDIO_OFFER_ID }
                  : {}),
                ...(process.env.PRO_STUDIO_PRICE_ID
                  ? { PRO_STUDIO_PRICE_ID: process.env.PRO_STUDIO_PRICE_ID }
                  : {}),
                ...(process.env.PRO_STUDIO_AMOUNT_CENTS
                  ? {
                      PRO_STUDIO_AMOUNT_CENTS:
                        process.env.PRO_STUDIO_AMOUNT_CENTS,
                    }
                  : {}),
                ...(process.env.PRO_STUDIO_CURRENCY
                  ? { PRO_STUDIO_CURRENCY: process.env.PRO_STUDIO_CURRENCY }
                  : {}),
                ...(process.env.PRO_STUDIO_PAYMENT_TYPE
                  ? {
                      PRO_STUDIO_PAYMENT_TYPE:
                        process.env.PRO_STUDIO_PAYMENT_TYPE,
                    }
                  : {}),
                ...(process.env.STRIPE_SECRET_KEY
                  ? { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY }
                  : {}),
                ...(process.env.STRIPE_WEBHOOK_SECRET
                  ? { STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET }
                  : {}),
                ...(process.env.CREEM_API_KEY
                  ? { CREEM_API_KEY: process.env.CREEM_API_KEY }
                  : {}),
                ...(process.env.CREEM_WEBHOOK_SECRET
                  ? { CREEM_WEBHOOK_SECRET: process.env.CREEM_WEBHOOK_SECRET }
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
