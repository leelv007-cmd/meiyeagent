import assert from 'node:assert/strict';
import test from 'node:test';
import { Route } from './content';

test('the content compatibility route remains a redirect-only shell', () => {
  assert.equal(Route.options.component, undefined);
  assert.equal(typeof Route.options.beforeLoad, 'function');
});
