import assert from 'node:assert/strict';
import test from 'node:test';

import { projectIdentitySelection } from './identity-selection';

const identities = [
  { id: 'brand-1', revision: '2', label: '青禾门店号' },
  { id: 'person-1', revision: '4', label: '小美老师' },
] as const;

test('identity query failure, empty, and unselected remain three distinct states', () => {
  assert.equal(
    projectIdentitySelection({
      query: { state: 'failed' },
      sessionIdentityId: undefined,
    }).state,
    'query_failed'
  );
  assert.equal(
    projectIdentitySelection({
      query: { state: 'ready', identities: [], defaultIdentityId: null },
      sessionIdentityId: undefined,
    }).state,
    'empty'
  );
  assert.equal(
    projectIdentitySelection({
      query: {
        state: 'ready',
        identities: [...identities],
        defaultIdentityId: null,
      },
      sessionIdentityId: undefined,
    }).state,
    'unselected'
  );
});

test('multiple identities never silently select the first row', () => {
  const projection = projectIdentitySelection({
    query: {
      state: 'ready',
      identities: [...identities],
      defaultIdentityId: null,
    },
    sessionIdentityId: undefined,
  });

  assert.equal(projection.state, 'unselected');
  assert.equal(projection.selected, null);
  assert.equal(projection.fallback, 'official_neutral');
});

test('the remembered default is preselected on a later session', () => {
  const projection = projectIdentitySelection({
    query: {
      state: 'ready',
      identities: [...identities],
      defaultIdentityId: 'person-1',
    },
    sessionIdentityId: undefined,
  });

  assert.equal(projection.state, 'selected');
  assert.equal(projection.selected?.id, 'person-1');
  assert.equal(projection.source, 'default');
});

test('a session selection overrides but does not mutate the remembered default', () => {
  const query = {
    state: 'ready' as const,
    identities: [...identities],
    defaultIdentityId: 'brand-1',
  };

  const current = projectIdentitySelection({
    query,
    sessionIdentityId: 'person-1',
  });
  const nextSession = projectIdentitySelection({
    query,
    sessionIdentityId: undefined,
  });

  assert.equal(current.selected?.id, 'person-1');
  assert.equal(current.source, 'session');
  assert.equal(query.defaultIdentityId, 'brand-1');
  assert.equal(nextSession.selected?.id, 'brand-1');
  assert.equal(nextSession.source, 'default');
});

test('an explicit official voice overrides but does not clear the remembered default', () => {
  const query = {
    state: 'ready' as const,
    identities: [...identities],
    defaultIdentityId: 'brand-1',
  };

  const current = projectIdentitySelection({
    query,
    sessionIdentityId: null,
  });
  const nextSession = projectIdentitySelection({
    query,
    sessionIdentityId: undefined,
  });

  assert.equal(current.state, 'selected');
  assert.equal(current.selected, null);
  assert.equal(current.source, 'session');
  assert.equal(current.fallback, 'official_neutral');
  assert.equal(nextSession.selected?.id, 'brand-1');
  assert.equal(nextSession.source, 'default');
});
