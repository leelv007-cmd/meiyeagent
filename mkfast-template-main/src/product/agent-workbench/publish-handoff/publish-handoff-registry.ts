/**
 * Controlled Surface registrations for V31-17 publish handoff.
 */

import { registerAgentSurface } from '../controlled-surface-registry';

export const PUBLISH_HANDOFF_SURFACE_KEYS = [
  'publish_handoff_panel',
  'mobile_publish_handoff',
  'self_report_journey',
] as const;

export type PublishHandoffSurfaceKey =
  (typeof PUBLISH_HANDOFF_SURFACE_KEYS)[number];

let registered = false;

export function registerPublishHandoffSurfaces(): void {
  if (registered) return;
  registered = true;

  registerAgentSurface('publish_handoff_panel', {
    allowedPropKeys: [
      'contentPackageId',
      'contentPackageRevision',
      'platform',
      'capabilityMode',
      'showDirectPublish',
      'copyBlockCount',
      'workId',
    ],
  });

  registerAgentSurface('mobile_publish_handoff', {
    allowedPropKeys: [
      'handoffId',
      'token',
      'handoffUrl',
      'publishActor',
      'systemDrivenPublishAllowed',
    ],
  });

  registerAgentSurface('self_report_journey', {
    allowedPropKeys: [
      'workId',
      'contentPackageId',
      'contentPackageRevision',
      'prompt',
      'chipCount',
    ],
  });
}

export function __resetPublishHandoffSurfaceRegistrationForTests(): void {
  registered = false;
}

registerPublishHandoffSurfaces();
