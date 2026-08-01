/**
 * AgentFrame six-family registry (#313 / xhs-vertical-integration D1 / §10.1).
 *
 * Maps existing Composer turn kinds onto the six presentation families from the
 * AgentFrame visual grammar. Progressive mapping only — DBOS / Task /
 * ContentPackage remain the truth chain (C11). No new agent runtime.
 *
 * Families (proposal 1 §二):
 *   narrative | decision | plan | task | result | memory
 */

import type { ComposerTurn } from './composer-session';

/** Six presentation families — closed set. */
export const AGENT_FRAME_KINDS = [
  'narrative',
  'decision',
  'plan',
  'task',
  'result',
  'memory',
] as const;

export type AgentFrameKind = (typeof AGENT_FRAME_KINDS)[number];

/**
 * Turn kinds that appear in the document timeline, including the folded
 * `stages` group produced at render time.
 */
export const COMPOSER_TIMELINE_TURN_KINDS = [
  'merchant',
  'route_notice',
  'stage',
  'stages',
  'question',
  /** P1-05: paid-media AG-UI interrupt (plan.ready → execution_confirm). */
  'execution_confirm',
  'candidate',
  'delivery',
  'report',
  'terminal',
] as const;

export type ComposerTimelineTurnKind =
  (typeof COMPOSER_TIMELINE_TURN_KINDS)[number];

/**
 * Session-model turn kinds (ComposerTurn['kind']) — excludes render-only
 * `stages` fold group.
 */
export const COMPOSER_SESSION_TURN_KINDS = [
  'merchant',
  'route_notice',
  'stage',
  'question',
  'execution_confirm',
  'candidate',
  'delivery',
  'report',
  'terminal',
] as const satisfies ReadonlyArray<ComposerTurn['kind']>;

/**
 * Compile-time exhaustiveness: a new ComposerTurn['kind'] that is missing from
 * COMPOSER_SESSION_TURN_KINDS fails typecheck (Exclude… extends never).
 */
type AssertSessionTurnKindsExhaustive =
  Exclude<
    ComposerTurn['kind'],
    (typeof COMPOSER_SESSION_TURN_KINDS)[number]
  > extends never
    ? true
    : ['Missing ComposerTurn kind in COMPOSER_SESSION_TURN_KINDS'];

const _assertSessionTurnKindsExhaustive: AssertSessionTurnKindsExhaustive = true;
void _assertSessionTurnKindsExhaustive;

/**
 * Resolve the AgentFrame family for a timeline turn kind.
 *
 * Mapping (progressive, P1-01 base + P1-05 interrupt):
 * - merchant / route_notice / stage(s) / report → narrative
 * - question → decision (补问)
 * - execution_confirm → decision (付费媒体执行确认 interrupt；DecisionFrame 承载)
 * - candidate / delivery → result
 * - terminal → task (cancelled / leave-recover outcomes)
 *
 * plan / memory have no turn-kind producer yet; they stay registered for
 * future progressive mapping (NotePlan, memory proposals).
 */
export function resolveAgentFrameKind(
  turnKind: ComposerTimelineTurnKind
): AgentFrameKind {
  switch (turnKind) {
    case 'merchant':
    case 'route_notice':
    case 'stage':
    case 'stages':
    case 'report':
      return 'narrative';
    case 'question':
    case 'execution_confirm':
      return 'decision';
    case 'candidate':
    case 'delivery':
      return 'result';
    case 'terminal':
      return 'task';
  }
}

/** True when every session turn kind resolves through the registry. */
export function everySessionTurnKindRegistered(): boolean {
  return COMPOSER_SESSION_TURN_KINDS.every((kind) => {
    const frame = resolveAgentFrameKind(kind);
    return (AGENT_FRAME_KINDS as readonly string[]).includes(frame);
  });
}

/** True when every timeline turn kind (incl. stages fold) resolves. */
export function everyTimelineTurnKindRegistered(): boolean {
  return COMPOSER_TIMELINE_TURN_KINDS.every((kind) => {
    const frame = resolveAgentFrameKind(kind);
    return (AGENT_FRAME_KINDS as readonly string[]).includes(frame);
  });
}

/**
 * Full registry snapshot — used by unit tests and static gates so a new turn
 * kind cannot land without a frame mapping.
 */
export function agentFrameRegistryEntries(): ReadonlyArray<{
  turnKind: ComposerTimelineTurnKind;
  frameKind: AgentFrameKind;
}> {
  return COMPOSER_TIMELINE_TURN_KINDS.map((turnKind) => ({
    turnKind,
    frameKind: resolveAgentFrameKind(turnKind),
  }));
}
