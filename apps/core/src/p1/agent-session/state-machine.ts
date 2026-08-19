/**
 * In-turn observation graph for AgentTurnRunner.
 *
 * Each runner starts at idle and is discarded at turn end. This is not a
 * durable session state machine; cross-request durability stays on AgentRun
 * / AgentSessionStore revision CAS. Labels without a runner producer are
 * not declared.
 */

export const SESSION_HARNESS_STATES = [
  'idle',
  'interpreting',
  'retrieving',
  'hypothesis_ready',
  'awaiting_clarification',
  'plan_compiling',
  'handing_off',
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
  awaiting_clarification: [],
  plan_compiling: [],
  handing_off: [],
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
 * Level 1 pure-copy in-turn path: interpreting → handing_off.
 */
export function level1ShortcutPath(): readonly SessionHarnessState[] {
  return ['idle', 'interpreting', 'handing_off'];
}

/**
 * Level 0 deterministic light edit never enters the harness graph (V3.1 §21.1).
 * Exported for constructive proof that L0 stays outside SESSION_HARNESS_STATES
 * transitions for the turn.
 */
export function level0StaysOutsideMachine(): readonly SessionHarnessState[] {
  return ['idle'];
}
