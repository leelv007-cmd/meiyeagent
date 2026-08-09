/**
 * External store small encapsulation for AgentWorkbenchClientState
 * (V3.1 §28.2 — no Redux/Zustand). React via useSyncExternalStore.
 */

import { useSyncExternalStore } from 'react';

import {
  createEmptyAgentWorkbenchState,
  reduceAgentWorkbench,
  type AgentWorkbenchAction,
  type AgentWorkbenchClientState,
  type ReduceResult,
} from './agent-event-reducer';

export type AgentEventStore = {
  getState: () => AgentWorkbenchClientState;
  dispatch: (action: AgentWorkbenchAction) => ReduceResult;
  subscribe: (listener: () => void) => () => void;
};

export function createAgentEventStore(
  initial?: AgentWorkbenchClientState
): AgentEventStore {
  let state = initial ?? createEmptyAgentWorkbenchState();
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: (action) => {
      const result = reduceAgentWorkbench(state, action);
      if (result.state !== state) {
        state = result.state;
        for (const listener of listeners) listener();
      }
      return result;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Module-level host store — one active workbench thread projection per tab. */
let hostStore: AgentEventStore | null = null;

export function getAgentWorkbenchHostStore(): AgentEventStore {
  if (!hostStore) {
    hostStore = createAgentEventStore();
  }
  return hostStore;
}

/** Test seam: replace host store between cases. */
export function __resetAgentWorkbenchHostStoreForTests(
  store?: AgentEventStore
): void {
  hostStore = store ?? createAgentEventStore();
}

export function useAgentWorkbenchState(
  store: AgentEventStore = getAgentWorkbenchHostStore()
): AgentWorkbenchClientState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useAgentWorkbenchDispatch(
  store: AgentEventStore = getAgentWorkbenchHostStore()
): AgentEventStore['dispatch'] {
  // Return the store method directly — a fresh arrow each render would
  // re-trigger effects that list `dispatch` in their dependency arrays.
  return store.dispatch;
}
