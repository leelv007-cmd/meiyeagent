import type { CompilerOptions } from '@inlang/paraglide-js';

export const paraglideCompilerOptions = {
  project: './project.inlang',
  outdir: './src/locale/paraglide',
  strategy: ['url', 'cookie', 'baseLocale'],
  routeStrategies: [
    { match: '/api/:path(.*)?', exclude: true },
    { match: '/robots.txt', exclude: true },
    { match: '/sitemap.xml', exclude: true },
    { match: '/manifest.json', exclude: true },
    { match: '/sw.js', exclude: true },
  ],
  emitTsDeclarations: true,
  isServer: 'import.meta.env?.SSR === true',
} satisfies CompilerOptions;
