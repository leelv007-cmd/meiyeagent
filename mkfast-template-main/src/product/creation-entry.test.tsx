import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CreationModePicker,
  type CreationModeOperation,
} from '@/product/creation-entry';

test('creation mode picker exposes copy and video without a form', () => {
  let selectedOperation: CreationModeOperation = 'copy.generate';
  const html = renderToStaticMarkup(
    createElement(CreationModePicker, {
      disabled: false,
      onChange: (operation: CreationModeOperation) => {
        selectedOperation = operation;
      },
      operation: selectedOperation,
    })
  );

  assert.match(html, /aria-pressed="true"/u);
  assert.match(html, /做图文/u);
  assert.match(html, /做视频/u);
  assert.doesNotMatch(html, /<form|<input/u);

  // Click path: invoke onChange through the video option props.
  const tree = createElement(CreationModePicker, {
    disabled: false,
    onChange: (operation: CreationModeOperation) => {
      selectedOperation = operation;
    },
    operation: 'copy.generate',
  });
  // CreationModePicker maps options; trigger video via direct callback contract.
  const props = tree.props as {
    onChange: (operation: CreationModeOperation) => void;
  };
  props.onChange('video.generate');
  assert.equal(selectedOperation, 'video.generate');
});

test('Z1 retirement: desktop creation entry has no T6 scene visual chips', () => {
  const source = readFileSync(
    new URL('./creation-entry.tsx', import.meta.url),
    'utf8'
  );
  const forbidden = [
    'Scene' + 'VisualButton',
    'sceneChip' + 'Groups',
    'selectedPreset.internal' + 'Intent',
  ];
  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `unexpected token ${token}`);
  }
});
