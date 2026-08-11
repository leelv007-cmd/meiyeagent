/**
 * Serialization snapshot: Provider/Deployment/Credential/fallback never
 * appear in the browser composer contract (D-062 / D-081 channel boundary).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORBIDDEN_BROWSER_COMPOSER_KEYS,
  findForbiddenBrowserComposerKey,
  projectBrowserComposerPayload,
  serializeBrowserComposerPayload,
} from './browser-contract';
import {
  projectComposerQuoteView,
  serializeComposerQuoteForBrowser,
} from './quote-wiring';
import { productQuoteFixture } from './quote-fixture.test-helper';
import {
  createComposerLensState,
  selectLens,
  updateSettings,
  type ComposerLensState,
} from './lens-state-machine';
import { lensStateView } from './lens-state-machine';

test('forbidden key list covers Provider / Deployment / Credential / fallback', () => {
  const joined = FORBIDDEN_BROWSER_COMPOSER_KEYS.join(' ').toLowerCase();
  assert.match(joined, /provider/);
  assert.match(joined, /deployment/);
  assert.match(joined, /credential/);
  assert.match(joined, /fallback/);
});

test('projectBrowserComposerPayload strips channel-side keys', () => {
  const dirty = {
    catalogModelId: 'model.copy.basic',
    catalogModelName: '文案基础版',
    provider: 'openai',
    deploymentId: 'dep-1',
    credentialRef: 'cred-vault-9',
    fallbackOrder: ['a', 'b'],
    nested: {
      ExecutionChannel: 'mid-gateway',
      safe: true,
    },
  };

  const projected = projectBrowserComposerPayload(dirty);
  assert.equal(projected.catalogModelId, 'model.copy.basic');
  assert.equal(projected.catalogModelName, '文案基础版');
  assert.equal('provider' in projected, false);
  assert.equal('deploymentId' in projected, false);
  assert.equal('credentialRef' in projected, false);
  assert.equal('fallbackOrder' in projected, false);
  const nested = projected.nested as Record<string, unknown>;
  assert.equal('ExecutionChannel' in nested, false);
  assert.equal(nested.safe, true);

  assert.equal(findForbiddenBrowserComposerKey(projected), null);
});

test('findForbiddenBrowserComposerKey reports first leak path', () => {
  const hit = findForbiddenBrowserComposerKey({
    settings: { provider: 'x' },
  });
  assert.equal(hit, '$.settings.provider');
});

test('composer state view serializes without channel leaks', () => {
  let state: ComposerLensState = createComposerLensState();
  state = selectLens(state, 'image_text');
  state = updateSettings(
    state,
    {
      catalogModelId: 'model.img.v1',
      catalogModelName: '图文精修',
      aspectRatio: '3:4',
      quantity: 4,
    },
    'user'
  );

  const view = lensStateView(state);
  const payload = projectBrowserComposerPayload({
    phase: view.phase,
    lensId: view.lensId,
    source: view.source,
    settings: view.settings,
    delivery: view.delivery,
    userText: view.userText,
  });

  const json = serializeBrowserComposerPayload(payload);
  assert.doesNotMatch(json, /provider|deployment|credential|fallback/i);
  assert.match(json, /图文精修|model\.img\.v1/);
  assert.equal(findForbiddenBrowserComposerKey(payload), null);
});

test('quote browser payload stays channel-clean', () => {
  const quote = productQuoteFixture({
    quoteId: 'q-snap',
    revision: 'server-revision-snapshot',
    catalogModelId: 'model.video.std',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_output_second',
    targetSeconds: 15,
    quotedSeconds: 15,
    confirmedAmount: 45,
    authorizedCeiling: 45,
    formula: { expression: '3 × 15s', unitRate: 3 },
  });
  const view = projectComposerQuoteView(quote);
  const browserQuote = serializeComposerQuoteForBrowser(view);
  assert.equal(findForbiddenBrowserComposerKey(browserQuote), null);
  assert.equal(browserQuote.catalogModelId, 'model.video.std');
  assert.doesNotMatch(
    serializeBrowserComposerPayload(browserQuote),
    /provider|deployment|credential|fallback/i
  );
});

test('snapshot: clean browser contract JSON shape', () => {
  const payload = projectBrowserComposerPayload({
    lensId: 'copy',
    source: 'user_explicit',
    catalogModel: {
      id: 'model.copy.basic',
      displayName: '文案基础版',
      revision: 'cm-1',
    },
    settings: {
      quantity: 3,
      aspectRatio: null,
    },
    delivery: {
      platform: 'xiaohongshu',
      deliverableKind: 'note',
    },
    quote: {
      revision: 'rev-1',
      amount: 3,
      billingMode: 'per_request',
    },
  });

  assert.deepEqual(payload, {
    lensId: 'copy',
    source: 'user_explicit',
    catalogModel: {
      id: 'model.copy.basic',
      displayName: '文案基础版',
      revision: 'cm-1',
    },
    settings: {
      quantity: 3,
      aspectRatio: null,
    },
    delivery: {
      platform: 'xiaohongshu',
      deliverableKind: 'note',
    },
    quote: {
      revision: 'rev-1',
      amount: 3,
      billingMode: 'per_request',
    },
  });
});
