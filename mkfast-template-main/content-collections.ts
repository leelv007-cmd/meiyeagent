import { defineCollection, defineConfig } from '@content-collections/core';
import { z } from 'zod';

function getLocaleSlug(path: string) {
  const localeMatch = path.match(/^(?<slug>.+)\.(?<locale>en|zh)$/);
  if (localeMatch?.groups) {
    return {
      locale: localeMatch.groups.locale,
      slug: localeMatch.groups.slug,
    };
  }
  return { locale: 'en', slug: path };
}

const pages = defineCollection({
  name: 'pages',
  directory: 'content/pages',
  include: '**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string().optional(),
    content: z.string(),
  }),
  transform: (doc) => {
    const { locale, slug } = getLocaleSlug(
      (doc as { _meta: { path: string } })._meta.path
    );
    return { ...doc, locale, slug };
  },
});

export default defineConfig({
  collections: [pages],
});
