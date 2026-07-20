import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const { CanonicalAssetCapture } = await import('./canonical-asset-actions');

test('places asset capture title and description on a breakpoint-stable porcelain surface', () => {
  const html = renderToStaticMarkup(
    createElement(CanonicalAssetCapture, {
      product: {
        error: undefined,
        execute: async () => undefined,
        pending: false,
        state: {
          store: { name: '测试门店' },
        },
      } as never,
    })
  );

  assert.match(html, /<section[^>]*class="[^"]*meiye-porcelain[^"]*"[^>]*>/u);
  assert.match(html, /id="asset-capture-title"/u);
  assert.match(html, /上传后可在素材详情里确认是否能用于宣传/u);
});
