import { createFileRoute } from '@tanstack/react-router';
import { PRODUCT_THEME_COLOR } from '@/config/theme';
import { websiteConfig } from '@/config/website';

/**
 * Dynamic Web App Manifest (PWA)
 * Serves /manifest.json with name/description from config instead of a static file
 * https://tanstack.dev/start/latest/docs/framework/react/guide/seo#dynamic-sitemap
 * https://web.dev/add-manifest/
 */
export const Route = createFileRoute('/manifest.json')({
  server: {
    handlers: {
      GET: async () => {
        const metadata = websiteConfig.metadata;
        const body = {
          name: metadata?.name,
          short_name: metadata?.name,
          description: metadata?.description,
          start_url: '/',
          scope: '/',
          display: 'standalone',
          // Keep in sync with <meta name="theme-color"> in src/routes/__root.tsx
          background_color: PRODUCT_THEME_COLOR,
          theme_color: PRODUCT_THEME_COLOR,
          icons: [
            {
              src: '/favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
            },
          ],
        };
        return new Response(JSON.stringify(body), {
          headers: {
            'Content-Type': 'application/manifest+json',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      },
    },
  },
});
