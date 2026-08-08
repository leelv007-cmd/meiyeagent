/**
 * Agent Session Harness state machine (V3.1 §21.1).
 *
 * Level 0/1 shortcuts (V31-08) consume transition helpers; this module only
 * owns legal edges so 07/08 mount cleanly without redefining the graph.
 */

export const SESSION_HARNESS_STATES = [
  'idle',
  'interpreting',
  'retrieving',
  'hypothesis_ready',
  'awaiting_clarification',
  'plan_compiling',
  'plan_ready',
  'awaiting_approval',
  'handing_off',
  'steering',
  'completed',
] as const;

export type SessionHarnessState = (typeof SESSION_HARNESS_STATES)[number];

/** Legal next states for each current state (optional branches included). */
export const SESSION_HARNESS_TRANSITIONS: Readonly<
  Record<SessionHarnessState, readonly SessionHarnessState[]>
> = {
  idle: ['interpreting'],
  interpreting: [
    'retrieving',
    'hypothesis_ready',
    'handing_off', // Level 1 pure-copy shortcut (U1 / V31-08)
    'awaiting_clarification',
  ],
  retrieving: ['hypothesis_ready', 'awaiting_clarification'],
  hypothesis_ready: [
    'awaiting_clarification',
    'plan_compiling',
    'handing_off',
  ],
  awaiting_clarification: ['interpreting', 'plan_compiling', 'handing_off'],
  plan_compiling: ['plan_ready'],
  plan_ready: ['awaiting_approval', 'handing_off'],
  awaiting_approval: ['handing_off', 'plan_compiling'],
  handing_off: ['steering', 'completed'],
  steering: ['handing_off', 'completed'],
  completed: [],
};

export class SessionHarnessStateError extends Error {
  readonly code = 'SESSION_HARNESS_STATE_INVALID';

  constructor(
    readonly from: SessionHarnessState,
    readonly to: SessionHarnessState,
  ) {
    super(`Illegal session harness transition ${from} → ${to}`);
    this.name = 'SessionHarnessStateError';
  }
}

export function canTransition(
  from: SessionHarnessState,
  to: SessionHarnessState,
): boolean {
  return SESSION_HARNESS_TRANSITIONS[from].includes(to);
}

export function transition(
  from: SessionHarnessState,
  to: SessionHarnessState,
): SessionHarnessState {
  if (!canTransition(from, to)) {
    throw new SessionHarnessStateError(from, to);
  }
  return to;
}

/**
 * Level 1 pure-copy path: interpreting → handing_off (skip plan_ready /
 * awaiting_approval). Used by V31-08; exported for constructive graph proof.
 */
export function level1ShortcutPath(): readonly SessionHarnessState[] {
  return ['idle', 'interpreting', 'handing_off', 'completed'];
}

/**
 * Level 0 deterministic light edit never enters the harness graph (V3.1 §21.1).
 * Exported for constructive proof that L0 stays outside SESSION_HARNESS_STATES
 * transitions for the turn.
 */
export function level0StaysOutsideMachine(): readonly SessionHarnessState[] {
  return ['idle'];
}
