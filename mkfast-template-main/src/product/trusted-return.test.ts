import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  parseTrustedReturn,
  TrustedReturnAnchor,
  TRUSTED_RETURN_IDS,
  trustedReturnHref,
  trustedReturnPath,
  withTrustedReturn,
} from './trusted-return';

test('parseTrustedReturn accepts only allowlisted ids', () => {
  for (const id of TRUSTED_RETURN_IDS) {
    assert.equal(parseTrustedReturn(id), id);
  }
});

test('parseTrustedReturn rejects open-redirect and free-form values', () => {
  const rejected = [
    'https://evil.com',
    '//evil.com',
    '/dashboard/x',
    '/dashboard',
    'dashboard',
    '../content',
    'content/../assets',
    'javascript:alert(1)',
    '',
    0,
    null,
    undefined,
    { id: 'content' },
    'CONTENT',
    'workbench ',
  ];
  for (const value of rejected) {
    assert.equal(
      parseTrustedReturn(value),
      undefined,
      `expected reject: ${JSON.stringify(value)}`
    );
  }
});

test('trusted return paths stay inside the product shell', () => {
  assert.equal(trustedReturnPath('workbench'), '/dashboard');
  assert.equal(trustedReturnPath('content'), '/dashboard/content');
  assert.equal(trustedReturnPath('assets'), '/dashboard/assets');
  assert.equal(trustedReturnPath('store'), '/dashboard/store');
  assert.equal(trustedReturnPath('tasks'), '/dashboard/tasks');
});

test('withTrustedReturn only appends the allowlisted id', () => {
  assert.equal(
    withTrustedReturn('/dashboard/content/pkg-1', 'workbench'),
    '/dashboard/content/pkg-1?from=workbench'
  );
  assert.equal(
    withTrustedReturn('/dashboard/assets/a1?tab=meta', 'assets'),
    '/dashboard/assets/a1?tab=meta&from=assets'
  );
});

test('TrustedReturnAnchor renders label and href for a valid from id', () => {
  const html = renderToStaticMarkup(
    createElement(TrustedReturnAnchor, { from: 'content' })
  );
  assert.match(html, /data-testid="trusted-return-anchor"/u);
  assert.match(html, /data-trusted-return="content"/u);
  assert.match(html, new RegExp(`href="${trustedReturnHref('content')}"`, 'u'));
  assert.match(html, /返回内容|Back to/u);
  assert.doesNotMatch(html, /https:\/\//u);
});

test('TrustedReturnAnchor renders nothing for illegal from values', () => {
  for (const from of [
    'https://evil.com',
    '//evil.com',
    '/dashboard/x',
    'nope',
  ]) {
    const html = renderToStaticMarkup(
      createElement(TrustedReturnAnchor, { from })
    );
    assert.equal(html, '');
  }
});
