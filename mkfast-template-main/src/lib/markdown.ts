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

function safeModelUrl(value: unknown) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('#') ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    /^(https?:|mailto:|tel:)/.test(normalized)
  );
}

function sanitizeAiMarkdownOutput() {
  return (tree: unknown) => {
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      const properties = record.properties;
      if (properties && typeof properties === 'object') {
        const values = properties as Record<string, unknown>;
        for (const key of Object.keys(values)) {
          if (key.toLowerCase().startsWith('on')) {
            delete values[key];
          }
        }
        for (const key of ['href', 'src']) {
          if (key in values && !safeModelUrl(values[key])) {
            delete values[key];
          }
        }
      }
      if (Array.isArray(record.children)) record.children.forEach(visit);
    };
    visit(tree);
  };
}

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

/**
 * Renders untrusted model output without enabling raw HTML. Keep this pipeline
 * separate from editorial markdown, where raw HTML is an explicit feature.
 */
export async function renderAiMarkdown(
  content: string
): Promise<MarkdownResult> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(sanitizeAiMarkdownOutput)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: { className: ['anchor'] },
    })
    .use(rehypeStringify)
    .process(content);

  return { markup: String(result) };
}
