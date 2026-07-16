import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreativeContentModuleId } from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CONTENT_MODULE_LABELS,
  CONTENT_MODULE_REQUIREMENTS,
  ContentModuleBuilder,
} from './content-module-builder';

const moduleIds = Object.keys(
  CONTENT_MODULE_LABELS
) as CreativeContentModuleId[];

function checkboxTag(html: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return html.match(
    new RegExp(
      `<span(?=[^>]*role="checkbox")(?=[^>]*aria-label="${escapedLabel}")[^>]*>`,
      'u'
    )
  )?.[0];
}

test('shows every module with its own concrete material requirement', () => {
  assert.equal(
    Object.keys(CONTENT_MODULE_REQUIREMENTS).length,
    moduleIds.length
  );
  assert.equal(
    new Set(Object.values(CONTENT_MODULE_REQUIREMENTS)).size,
    moduleIds.length
  );

  const html = renderToStaticMarkup(
    createElement(ContentModuleBuilder, {
      availableModules: ['social_cover', 'before_after'],
      disabled: false,
      onChange: () => undefined,
      presetName: '前后对比',
      selectedModules: ['social_cover'],
    })
  );

  for (const moduleId of moduleIds) {
    assert.match(html, new RegExp(CONTENT_MODULE_LABELS[moduleId], 'u'));
    assert.match(html, new RegExp(CONTENT_MODULE_REQUIREMENTS[moduleId], 'u'));
  }
  assert.equal(
    html.match(/“前后对比”预设未包含此模块。/gu)?.length,
    moduleIds.length - 2
  );
});

test('disables unavailable modules and preserves the last-selected guard', () => {
  const html = renderToStaticMarkup(
    createElement(ContentModuleBuilder, {
      availableModules: ['social_cover', 'before_after'],
      disabled: false,
      onChange: () => undefined,
      selectedModules: ['social_cover'],
    })
  );

  assert.doesNotMatch(
    checkboxTag(html, CONTENT_MODULE_LABELS.before_after) ?? '',
    /aria-disabled="true"/u
  );
  assert.match(
    checkboxTag(html, CONTENT_MODULE_LABELS.social_cover) ?? '',
    /aria-disabled="true"/u
  );
  assert.match(
    checkboxTag(html, CONTENT_MODULE_LABELS.price_card) ?? '',
    /aria-disabled="true"/u
  );
  assert.match(html, /当前起步卡或 Work 未包含此模块。/u);
});
