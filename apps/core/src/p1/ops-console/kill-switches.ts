/**
 * Kill Switch catalog (V3.1 §41.2 / V31-22).
 *
 * Switches are registered here as the unified panel surface; each becomes
 * effective only when its provider ticket lands. Unlanded switches cannot be
 * enabled from the ops console.
 */

export const OPS_KILL_SWITCH_IDS = [
  'disable_agent_planning',
  'disable_memory_write',
  'disable_memory_read',
  'disable_make_steering',
  'disable_proactive_agent',
  'force_manual_plan_confirmation',
  'force_legacy_five_stage',
] as const;

export type OpsKillSwitchId = (typeof OPS_KILL_SWITCH_IDS)[number];

export type OpsKillSwitchLanded = {
  landed: boolean;
  /** Provider ticket that introduces the runtime effect. */
  providerTicket: string;
  /** Blast-radius summary shown on the panel. */
  impactScope: string;
};

/**
 * Landing map is static per ops-console ship. When a provider ticket lands,
 * flip `landed: true` in a follow-up PR; the panel then allows enable.
 * V31-22 ships the panel only — none of the seven runtime hooks are claimed.
 */
export const OPS_KILL_SWITCH_CATALOG: Readonly<
  Record<OpsKillSwitchId, OpsKillSwitchLanded>
> = {
  disable_agent_planning: {
    landed: false,
    providerTicket: 'V31-06/V31-09',
    impactScope:
      'Stops agent planning / specialist delegation; Session Harness falls back to non-planning path.',
  },
  disable_memory_write: {
    landed: false,
    providerTicket: 'V31-18',
    impactScope: 'Blocks memory candidate writes; existing memory remains readable.',
  },
  disable_memory_read: {
    landed: false,
    providerTicket: 'V31-18',
    impactScope: 'Blocks memory injection/read; agents run without shop experience recall.',
  },
  disable_make_steering: {
    landed: false,
    providerTicket: 'V31-16',
    impactScope: 'Disables mid-execution Make steering; in-flight plans finish without replan.',
  },
  disable_proactive_agent: {
    landed: true,
    providerTicket: 'V31-24',
    impactScope: 'Stops proactive opportunity proposals; merchant must initiate.',
  },
  force_manual_plan_confirmation: {
    landed: false,
    providerTicket: 'V31-11',
    impactScope:
      'Forces plan confirmation even for policy-exempt copy paths (holds before Make).',
  },
  force_legacy_five_stage: {
    landed: false,
    providerTicket: 'V31-14/V31-26',
    impactScope:
      'Routes new Make work through legacy five-stage path instead of snapshot consume.',
  },
};

export type OpsKillSwitchState = {
  switchId: OpsKillSwitchId;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
  reason: string | null;
};

export function isOpsKillSwitchId(value: string): value is OpsKillSwitchId {
  return (OPS_KILL_SWITCH_IDS as readonly string[]).includes(value);
}
