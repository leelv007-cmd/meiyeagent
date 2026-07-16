import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import { Breadcrumb, BreadcrumbEllipsis } from './breadcrumb';
import { Carousel, CarouselContent, CarouselItem } from './carousel';
import {
  Pagination,
  PaginationEllipsis,
  PaginationNext,
  PaginationPrevious,
} from './pagination';
import { Spinner } from './spinner';

function renderSharedControls(locale: 'en' | 'zh') {
  overwriteGetLocale(() => locale);
  return renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(Spinner),
      createElement(Breadcrumb, null, createElement(BreadcrumbEllipsis)),
      createElement(
        Carousel,
        null,
        createElement(
          CarouselContent,
          null,
          createElement(CarouselItem, null, 'Example')
        )
      ),
      createElement(
        Pagination,
        null,
        createElement(PaginationPrevious, { href: '#previous' }),
        createElement(PaginationEllipsis),
        createElement(PaginationNext, { href: '#next' })
      )
    )
  );
}

test('shared accessibility names follow the active Chinese or English locale', () => {
  try {
    const chinese = renderSharedControls('zh');
    assert.match(chinese, /aria-label="加载中\.\.\."/u);
    assert.match(chinese, /aria-label="面包屑"/u);
    assert.match(chinese, /aria-label="分页"/u);
    assert.match(chinese, /aria-label="上一页"/u);
    assert.match(chinese, /aria-label="下一页"/u);
    assert.match(chinese, /aria-roledescription="轮播"/u);
    assert.match(chinese, /aria-roledescription="轮播项"/u);
    assert.match(chinese, /更多页面/u);

    const english = renderSharedControls('en');
    assert.match(english, /aria-label="Loading\.\.\."/u);
    assert.match(english, /aria-label="Breadcrumb"/u);
    assert.match(english, /aria-label="Pagination"/u);
    assert.match(english, /aria-label="Previous page"/u);
    assert.match(english, /aria-label="Next page"/u);
    assert.match(english, /aria-roledescription="Carousel"/u);
    assert.match(english, /aria-roledescription="Slide"/u);
    assert.match(english, /More pages/u);
  } finally {
    overwriteGetLocale(() => 'zh');
  }
});

test('dialog and sheet close controls use the shared localized close label', () => {
  for (const file of ['dialog.tsx', 'sheet.tsx']) {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ui', file), 'utf8');
    assert.match(source, /\bcommon_close\b[\s\S]*from ["']@\/locale\/paraglide\/messages["']/u, file);
    assert.match(source, /\bcommon_close\(\)/u, file);
    assert.doesNotMatch(source, />Close<|>\s*Close\s*</u, file);
  }
});
