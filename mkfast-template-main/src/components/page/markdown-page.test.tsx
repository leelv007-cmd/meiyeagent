import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PageDoc } from '@/lib/pages';
import { MarkdownPage } from './markdown-page';

test('renders legal links and stable heading anchors with the shared Markdown renderer', () => {
  const page = {
    content: '## Introduction\n\nPlease [contact us](/contact).',
    description: 'Legal terms',
    locale: 'en',
    slug: 'terms',
    title: 'Terms',
  } as PageDoc;

  const markup = renderToStaticMarkup(<MarkdownPage page={page} />);

  assert.match(markup, /data-slot="markdown"/u);
  assert.match(
    markup,
    /<h2 id="introduction"><a class="anchor" href="#introduction">Introduction<\/a><\/h2>/u
  );
  assert.match(markup, /<a href="\/contact">contact us<\/a>/u);
});
