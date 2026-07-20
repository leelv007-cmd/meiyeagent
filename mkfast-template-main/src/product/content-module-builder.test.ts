import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreativeContentModuleId } from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  content_module_unavailable_entry,
  content_suite_locked_summary,
  content_suite_locked_summary_preset,
} from '@/locale/paraglide/messages';
import {
  CONTENT_MODULE_LABELS,
  CONTENT_MODULE_REQUIREMENTS,
  ContentModuleBuilder,
} from './content-module-builder';

const moduleIds = Object.keys(
  CONTENT_MODULE_LABELS
) as CreativeContentModuleId[];

function chipTags(html: string) {
  return (html.match(/<button[^>]*>/gu) ?? []).filter((tag) =>
    tag.includes('aria-pressed="')
  );
}

test('keeps a unique concrete material requirement per module', () => {
  assert.equal(
    Object.keys(CONTENT_MODULE_REQUIREMENTS).length,
    moduleIds.length
  );
  assert.equal(
    new Set(Object.values(CONTENT_MODULE_REQUIREMENTS)).size,
    moduleIds.length
  );
});

test('renders available modules as chips and folds locked ones behind one quiet line', () => {
  const html = renderToStaticMarkup(
    createElement(ContentModuleBuilder, {
      availableModules: ['social_cover', 'before_after'],
      disabled: false,
      onChange: () => undefined,
      selectedModules: ['social_cover'],
    })
  );

  // Conversation-flow chips replace the D-031 slot-form checklist entirely:
  // no checkboxes, no numbered scaffold, exactly one chip per available module.
  assert.doesNotMatch(html, /role="checkbox"/u);
  assert.doesNotMatch(html, /\d+\.\s/u);
  assert.equal(chipTags(html).length, 2);

  // Locked modules collapse behind a single closed-by-default summary line
  // carrying the true count.
  assert.ok(html.includes(content_suite_locked_summary({ count: 5 })));
  assert.match(html, /<details(?![^>]*\sopen)/u);

  // Availability truth stays inspectable (D-028): every locked module and its
  // material requirement is in the disclosure — without the old repeated
  // per-module unavailability sentence.
  const locked = moduleIds.filter(
    (moduleId) => moduleId !== 'social_cover' && moduleId !== 'before_after'
  );
  for (const moduleId of locked) {
    assert.ok(html.includes(CONTENT_MODULE_LABELS[moduleId]));
    assert.ok(html.includes(CONTENT_MODULE_REQUIREMENTS[moduleId]));
  }
  assert.ok(!html.includes(content_module_unavailable_entry()));
});

test('preset context states the honest unlock condition (switch template, not add material)', () => {
  const html = renderToStaticMarkup(
    createElement(ContentModuleBuilder, {
      availableModules: ['social_cover', 'before_after'],
      disabled: false,
      onChange: () => undefined,
      presetName: '前后对比',
      selectedModules: ['social_cover'],
    })
  );

  assert.ok(
    html.includes(
      content_suite_locked_summary_preset({ count: 5, preset: '前后对比' })
    )
  );
  assert.ok(!html.includes(content_suite_locked_summary({ count: 5 })));
});

test('preserves the last-selected guard and shows assembly order for multi-selection', () => {
  const single = renderToStaticMarkup(
    createElement(ContentModuleBuilder, {
      availableModules: ['social_cover', 'before_after', 'price_card'],
      disabled: false,
      onChange: () => undefined,
      selectedModules: ['social_cover'],
    })
  );
  const singleChips = chipTags(single);
  const pressed = singleChips.find((tag) =>
    tag.includes('aria-pressed="true"')
  );
  assert.ok(pressed, 'the selected module renders a pressed chip');
  assert.ok(
    pressed.includes('disabled=""'),
    'the last remaining module cannot be unselected'
  );
  for (const tag of singleChips.filter((candidate) => candidate !== pressed)) {
    assert.ok(!tag.includes('disabled=""'));
  }

  const richer = renderToStaticMarkup(
    createElement(ContentModuleBuilder, {
      availableModules: ['social_cover', 'before_after'],
      disabled: false,
      onChange: () => undefined,
      selectedModules: ['social_cover', 'before_after'],
    })
  );
  for (const tag of chipTags(richer)) {
    assert.ok(!tag.includes('disabled=""'));
  }
  assert.ok(
    richer.includes(
      `${CONTENT_MODULE_LABELS.social_cover} → ${CONTENT_MODULE_LABELS.before_after}`
    )
  );
});
