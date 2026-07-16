import { createFileRoute, notFound } from '@tanstack/react-router';
import { PwaProof } from '@/components/pwa/pwa-proof';
import { PRODUCT_THEME_COLOR } from '@/config/theme';

export const Route = createFileRoute('/pwa-proof')({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound();
  },
  head: () => ({
    meta: [
      { title: '移动端能力验证 | Beauty Content Agent' },
      {
        name: 'description',
        content: 'PWA、后置相机与 iOS 媒体交接的移动端验证页。',
      },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'black-translucent',
      },
      { name: 'theme-color', content: PRODUCT_THEME_COLOR },
    ],
  }),
  component: PwaProof,
});
