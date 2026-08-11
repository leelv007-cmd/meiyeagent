import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import { Breadcrumb, BreadcrumbEllipsis } from './breadcrumb';
import { Spinner } from './spinner';

function renderSharedControls(locale: 'en' | 'zh') {
  overwriteGetLocale(() => locale);
  return renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(Spinner),
      createElement(Breadcrumb, null, createElement(BreadcrumbEllipsis))
    )
  );
}

test('shared accessibility names follow the active Chinese or English locale', () => {
  try {
    const chinese = renderSharedControls('zh');
    assert.match(chinese, /aria-label="加载中\.\.\."/u);
    assert.match(chinese, /aria-label="面包屑"/u);

    const english = renderSharedControls('en');
    assert.match(english, /aria-label="Loading\.\.\."/u);
    assert.match(english, /aria-label="Breadcrumb"/u);
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
