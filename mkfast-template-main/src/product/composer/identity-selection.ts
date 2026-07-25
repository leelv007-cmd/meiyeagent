export type IdentityChoice = {
  id: string;
  revision: string;
  label: string;
};

export type IdentitySelectionQuery =
  | { state: 'loading' }
  | { state: 'failed' }
  | {
      state: 'ready';
      identities: IdentityChoice[];
      defaultIdentityId: string | null;
    };

export type IdentitySelectionProjection = {
  state: 'loading' | 'query_failed' | 'empty' | 'unselected' | 'selected';
  identities: IdentityChoice[];
  selected: IdentityChoice | null;
  source: 'session' | 'default' | null;
  fallback: 'official_neutral' | null;
};

export function projectIdentitySelection(input: {
  query: IdentitySelectionQuery;
  sessionIdentityId: string | null | undefined;
}): IdentitySelectionProjection {
  if (input.query.state === 'loading') {
    return projection('loading');
  }
  if (input.query.state === 'failed') {
    return projection('query_failed');
  }
  if (input.query.identities.length === 0) {
    return projection('empty');
  }
  const { defaultIdentityId, identities } = input.query;

  if (input.sessionIdentityId === null) {
    return {
      state: 'selected',
      identities,
      selected: null,
      source: 'session',
      fallback: 'official_neutral',
    };
  }

  const sessionIdentity = identities.find(
    (identity) => identity.id === input.sessionIdentityId
  );
  if (sessionIdentity) {
    return {
      state: 'selected',
      identities,
      selected: sessionIdentity,
      source: 'session',
      fallback: null,
    };
  }

  const defaultIdentity = identities.find(
    (identity) => identity.id === defaultIdentityId
  );
  if (defaultIdentity) {
    return {
      state: 'selected',
      identities,
      selected: defaultIdentity,
      source: 'default',
      fallback: null,
    };
  }

  return {
    state: 'unselected',
    identities,
    selected: null,
    source: null,
    fallback: 'official_neutral',
  };
}

function projection(
  state: 'loading' | 'query_failed' | 'empty'
): IdentitySelectionProjection {
  return {
    state,
    identities: [],
    selected: null,
    source: null,
    fallback: state === 'loading' ? null : 'official_neutral',
  };
}
