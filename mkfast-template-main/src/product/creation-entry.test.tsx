import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  resolvePresetIdForScene,
  sceneIntent,
} from '@/product/creation-entry-model';
import {
  CreationModePicker,
  MarketingEntryContextPicker,
} from '@/product/creation-entry';
import type { MarketingEntryId } from '@/product/marketing-entry-model';

type ActionElement = ReactElement<{
  children?: ReactNode;
  onClick?: () => void;
}>;

function visibleText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(visibleText).join('');
  if (!isValidElement(node)) return '';
  const element = node as ReactElement<{ children?: ReactNode }>;
  return Children.toArray(element.props.children).map(visibleText).join('');
}

function findAction(node: ReactNode, label: string): ActionElement | undefined {
  if (!isValidElement(node)) return undefined;
  const element = node as ActionElement;
  if (
    element.props.onClick &&
    visibleText(element.props.children).includes(label)
  ) {
    return element;
  }
  for (const child of Children.toArray(element.props.children)) {
    const match = findAction(child, label);
    if (match) return match;
  }
  return undefined;
}

test('brand IP entry switches composer context without rendering an identity form', () => {
  let selectedEntry: MarketingEntryId | undefined;
  let selectedIntent: string | undefined;
  const renderPicker = () =>
    MarketingEntryContextPicker({
      onSelectEntry: (context) => {
        selectedEntry = context.entryId;
        selectedIntent = context.intent;
      },
      onSelectScene: () => undefined,
      releasedEntries: ['brand_ip'],
      selectedMarketingEntry: selectedEntry,
    });

  const entry = findAction(renderPicker(), '品牌与个人 IP');
  assert.ok(entry?.props.onClick);
  entry.props.onClick();

  assert.equal(selectedEntry, 'brand_ip');
  assert.equal(
    selectedIntent,
    '用已确认的品牌或个人表达身份制作一条系列内容，保持口吻和栏目一致，并给出下一条续写建议。'
  );
  const html = renderToStaticMarkup(renderPicker());
  assert.match(html, /aria-pressed="true"/u);
  assert.doesNotMatch(html, /<form|required|展示名称|归属人\/主体/u);
});

test('video mode is a composer chip that changes the selected deliverable', () => {
  let selectedOperation: 'copy.generate' | 'video.generate' = 'copy.generate';
  const renderPicker = () =>
    CreationModePicker({
      disabled: false,
      onChange: (operation) => {
        selectedOperation = operation;
      },
      operation: selectedOperation,
    });

  const video = findAction(renderPicker(), '做视频');
  assert.ok(video?.props.onClick);
  video.props.onClick();

  assert.equal(selectedOperation, 'video.generate');
  const html = renderToStaticMarkup(renderPicker());
  assert.match(html, /aria-pressed="true"/u);
  assert.match(html, /做图文/u);
  assert.match(html, /做视频/u);
  assert.doesNotMatch(html, /<form|<input/u);
});

test('desktop creation entry mounts scene chips from the shared model and maps scene to preset', () => {
  const source = readFileSync(
    new URL('./creation-entry.tsx', import.meta.url),
    'utf8'
  );

  // Same data source as mobile — no second scene catalog.
  assert.match(source, /sceneChipGroups\(getLocale\(\)\)/u);
  assert.match(source, /SceneVisualButton/u);
  assert.match(source, /creation_entry_scene_legend/u);
  // UI-only context tag boundary (selectedScene state, not Work-persisted).
  assert.match(source, /UI-only context tag/u);
  // Scene click must not navigate.
  assert.doesNotMatch(source, /selectScene[\s\S]{0,120}navigate\(/u);

  const presets = [
    { family: 'price_card', id: 'official-price_card' },
    { family: 'before_after', id: 'official-before_after' },
    { family: 'package_explainer', id: 'official-package_explainer' },
  ];
  assert.equal(
    resolvePresetIdForScene('promotion-nail', presets),
    'official-price_card'
  );
  assert.equal(
    resolvePresetIdForScene(
      'promotion-nail',
      [{ family: 'before_after', id: 'other-family' }],
      'current-preset'
    ),
    'current-preset'
  );
  assert.match(sceneIntent('promotion-nail'), /活动推广/u);
});

test('Day-0 submit renders the passive allowance line beside its CTA', () => {
  const source = readFileSync(
    new URL('./creation-entry.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /quotaLine\?: string/u);
  assert.match(source, /data-testid="creation-entry-quota-line"/u);
  assert.match(source, /quotaBlocked/u);
});
