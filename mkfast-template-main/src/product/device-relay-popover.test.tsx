import assert from 'node:assert/strict';
import { mock } from 'node:test';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildDeviceRelayAbsoluteUrl,
  DeviceRelayPopover,
} from './device-relay-popover';

test('buildDeviceRelayAbsoluteUrl encodes package relay under origin', () => {
  const url = buildDeviceRelayAbsoluteUrl(
    { kind: 'package', packageId: 'pkg-1', stage: 'action' },
    'https://app.example'
  );
  assert.match(url, /^https:\/\/app\.example\//u);
  assert.match(url, /packageId=pkg-1/u);
  assert.match(url, /stage=action/u);
  assert.doesNotMatch(url, /handoff\//u);
});

test('buildDeviceRelayAbsoluteUrl encodes work relay', () => {
  const url = buildDeviceRelayAbsoluteUrl(
    { kind: 'work', workId: 'work-9' },
    'https://app.example'
  );
  assert.match(url, /workId=work-9/u);
});

test('DeviceRelayPopover exposes a phone-continue trigger without publish handoff copy', () => {
  // Popover portal is client-only; static markup still exposes the trigger.
  const html = renderToStaticMarkup(
    createElement(DeviceRelayPopover, {
      target: { kind: 'package', packageId: 'pkg-2' },
    })
  );
  assert.match(html, /data-testid="device-relay-trigger"/u);
  assert.match(html, /用手机继续|Continue on phone/u);
  assert.doesNotMatch(html, /发布交接|publish handoff/iu);
});

test('copy handler is reachable via clipboard mock contract', async () => {
  const writeText = mock.fn(async () => undefined);
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText } },
  });
  try {
    const payload = buildDeviceRelayAbsoluteUrl(
      { kind: 'work', workId: 'w1' },
      'https://app.example'
    );
    await globalThis.navigator.clipboard.writeText(payload);
    assert.equal(writeText.mock.calls.length, 1);
    assert.match(payload, /workId=w1/u);
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: original,
    });
  }
});
