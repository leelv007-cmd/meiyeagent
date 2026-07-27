import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeStringify from 'rehype-stringify';

export type MarkdownResult = {
  markup: string;
};

/**
 * Renders markdown to HTML using unified (remark/rehype) with GFM,
 * heading IDs, and autolink headings.
 * https://tanstack.dev/start/latest/docs/framework/react/guide/rendering-markdown
 */
export async function renderMarkdown(content: string): Promise<MarkdownResult> {
  const result = await unified()
    .use(remarkParse) // Parse markdown
    .use(remarkGfm) // Support GitHub Flavored Markdown
    .use(remarkRehype, { allowDangerousHtml: true }) // Convert to HTML AST
    .use(rehypeRaw) // Process raw HTML in markdown
    .use(rehypeSlug) // Add IDs to headings
    .use(rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: { className: ['anchor'] },
    })
    .use(rehypeStringify)
    .process(content);

  return { markup: String(result) };
}

/*
 * The separate `renderAiMarkdown` pipeline that used to live here is gone with
 * U03: model output is now rendered by the HeroUI Pro `markdown` unit, which
 * never enables raw HTML in the first place, so the app no longer keeps a
 * second sanitising renderer for the same job. Its guarantees are asserted at
 * the live surface — `src/components/markdown/ai-markdown.interaction.test.tsx`.
 * The pipeline above is for editorial markdown, where raw HTML is a feature.
 */
