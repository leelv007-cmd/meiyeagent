/**
 * L2 Journey Replay / L3 Shadow — trigger-bound backlog skeleton (V31-23 / §31.3).
 * Not production pathways yet; when built must carry readonly paid-side-effect gate (B4).
 */

import {
  EVAL_HIGHER_LAYER_BACKLOG_SCHEMA_VERSION,
  EVAL_HIGHER_LAYER_KINDS,
  evalHigherLayerBacklogEntrySchema,
  type EvalHigherLayerBacklogEntry,
  type EvalHigherLayerKind,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

export const EVAL_HIGHER_LAYER_BACKLOG: readonly EvalHigherLayerBacklogEntry[] =
  EVAL_HIGHER_LAYER_KINDS.map((kind) =>
    evalHigherLayerBacklogEntrySchema.parse({
      schemaVersion: EVAL_HIGHER_LAYER_BACKLOG_SCHEMA_VERSION,
      kind,
      status: 'trigger_bound_backlog',
      trigger: 'historical_tasks_hundreds',
      readonlyGateRequired: true,
      paidSideEffectsForbidden: true,
    }),
  );

export function getHigherLayerBacklog(
  kind: EvalHigherLayerKind,
): EvalHigherLayerBacklogEntry {
  const entry = EVAL_HIGHER_LAYER_BACKLOG.find((item) => item.kind === kind);
  if (!entry) {
    throw new P1DomainError(
      'NOT_FOUND',
      `Unknown higher eval layer: ${kind}`,
    );
  }
  return entry;
}

/**
 * Read-only gate for any future L2/L3 execution entrypoint.
 * Fail closed if paid side effects would be allowed.
 */
export function assertHigherLayerReadonlyGate(input: {
  kind: EvalHigherLayerKind;
  allowPaidSideEffects: boolean;
  writeProductionContentPackage?: boolean;
}): void {
  const entry = getHigherLayerBacklog(input.kind);
  if (!entry.readonlyGateRequired || !entry.paidSideEffectsForbidden) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${input.kind} backlog entry must require readonly + forbid paid side effects`,
    );
  }
  if (input.allowPaidSideEffects) {
    throw new P1DomainError(
      'FORBIDDEN',
      `${input.kind} is trigger-bound backlog and forbids paid side effects (B4)`,
    );
  }
  if (input.writeProductionContentPackage) {
    throw new P1DomainError(
      'FORBIDDEN',
      `${input.kind} must not write production ContentPackage`,
    );
  }
}

/**
 * Placeholder runner — always refuses until trigger condition is met and a
 * real implementation lands. Exists so wiring/tests have a stable seam.
 */
export function runHigherLayerIfEnabled(_input: {
  kind: EvalHigherLayerKind;
  allowPaidSideEffects: boolean;
}): never {
  assertHigherLayerReadonlyGate({
    kind: _input.kind,
    allowPaidSideEffects: _input.allowPaidSideEffects,
  });
  throw new P1DomainError(
    'INVALID_STATE',
    `${_input.kind} remains trigger_bound_backlog until historical task volume trigger`,
  );
}
