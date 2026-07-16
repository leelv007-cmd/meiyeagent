import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ObjectEvidence } from './object-evidence';

test('top-level object evidence never renders a raw object id', () => {
  const html = renderToStaticMarkup(
    createElement(ObjectEvidence, {
      id: 'asset-private-raw-id',
      kind: 'Asset',
      source: 'Canvas',
    })
  );

  assert.match(html, />(?:Asset|资产)</);
  assert.match(html, />(?:Canvas|画布)</);
  assert.doesNotMatch(html, /asset-private-raw-id/);
});

test('object evidence renders canonical labels without its private id', () => {
  const html = renderToStaticMarkup(
    createElement(ObjectEvidence, {
      id: 'work-private-raw-id',
      kind: 'Work',
      source: 'Canvas',
    })
  );

  assert.match(html, />(?:Work|\u5de5\u4f5c\u8bb0\u5f55)</);
  assert.match(html, />(?:Canvas|\u753b\u5e03)</);
  assert.doesNotMatch(html, /work-private-raw-id/);
});
