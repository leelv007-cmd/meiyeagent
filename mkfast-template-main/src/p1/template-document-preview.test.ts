import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TemplateDocumentPreview } from './template-catalog';

test('renders template text as native SVG content for thumbnail capture', () => {
  const html = renderToStaticMarkup(
    createElement(TemplateDocumentPreview, {
      preview: {
        document: {
          height: 1350,
          pages: [
            {
              elements: [
                {
                  fill: '#4B3130',
                  fontSize: 64,
                  height: 180,
                  id: 'headline',
                  kind: 'text',
                  text: 'Before / After',
                  width: 840,
                  x: 120,
                  y: 160,
                },
              ],
              id: 'page',
            },
          ],
          width: 1080,
        },
        name: 'Before / After',
        versionId: 'official-before-after-v1',
      },
    })
  );

  assert.match(html, /<text[^>]*fill="#4B3130"/u);
  assert.match(html, /<tspan[^>]*>Before \/ After<\/tspan>/u);
  assert.doesNotMatch(html, /foreignObject/u);
});
