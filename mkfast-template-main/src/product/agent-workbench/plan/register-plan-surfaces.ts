/**
 * V31-10 Controlled Surface registrations (plan surfaces only).
 * Negative gates for unregistered / dangerous props stay in V31-04 tests.
 */

import { registerAgentSurface } from '../controlled-surface-registry';

export const AGENT_PLAN_SURFACE_KEYS = [
  'living_plan',
  'plan_section',
  'plan_diff',
  'compact_plan',
  'commit_strip',
] as const;

export type AgentPlanSurfaceKey = (typeof AGENT_PLAN_SURFACE_KEYS)[number];

let registered = false;

/** Idempotent registration for production bootstrap + tests. */
export function registerPlanSurfaces(): void {
  if (registered) return;
  registered = true;

  registerAgentSurface('living_plan', {
    allowedPropKeys: [
      'planId',
      'revision',
      'mode',
      'viewport',
      'readiness',
      'adjustmentSummary',
      'compactSummary',
    ],
  });

  registerAgentSurface('plan_section', {
    allowedPropKeys: ['sectionKey', 'title', 'body'],
  });

  registerAgentSurface('plan_diff', {
    allowedPropKeys: [
      'planId',
      'fromRevision',
      'toRevision',
      'hasChanges',
      'adjustmentSummary',
    ],
  });

  registerAgentSurface('compact_plan', {
    allowedPropKeys: ['planId', 'revision', 'compactSummary', 'statusLine'],
  });

  registerAgentSurface('commit_strip', {
    allowedPropKeys: [
      'statusLine',
      'startDisabled',
      'startDisabledReason',
      'readiness',
    ],
  });
}

/** Test seam: allow re-register after registry reset. */
export function __resetPlanSurfaceRegistrationForTests(): void {
  registered = false;
}
