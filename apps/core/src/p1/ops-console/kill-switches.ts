/**
 * Kill Switch catalog (V3.1 §41.2 / V31-22).
 *
 * Switches are registered here as the unified panel surface; each becomes
 * effective only when its provider ticket lands. Unlanded switches cannot be
 * enabled from the ops console.
 */

export const OPS_KILL_SWITCH_IDS = [
  'disable_memory_write',
  'disable_memory_read',
  'disable_make_steering',
  'disable_proactive_agent',
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
 * Only controls with a runtime reader are exposed in the panel.
 */
export const OPS_KILL_SWITCH_CATALOG: Readonly<
  Record<OpsKillSwitchId, OpsKillSwitchLanded>
> = {
  disable_memory_write: {
    // V31-18 lands runtime hook (AgentMemoryPlatform admin-config hot-read).
    // V31-26a: ops panel dual-writes admin-config on flip.
    landed: true,
    providerTicket: 'V31-18',
    impactScope: 'Blocks memory candidate writes; existing memory remains readable.',
  },
  disable_memory_read: {
    // V31-18 lands runtime hook (AgentMemoryPlatform admin-config hot-read).
    // V31-26a: ops panel dual-writes admin-config on flip.
    landed: true,
    providerTicket: 'V31-18',
    impactScope: 'Blocks memory injection/read; agents run without shop experience recall.',
  },
  disable_make_steering: {
    // V31-16 lands the runtime hook (SteeringService gate + admin-config hot-read).
    landed: true,
    providerTicket: 'V31-16',
    impactScope: 'Disables mid-execution Make steering; in-flight plans finish without replan.',
  },
  disable_proactive_agent: {
    landed: true,
    providerTicket: 'V31-24',
    impactScope: 'Stops proactive opportunity proposals; merchant must initiate.',
  },
  force_legacy_five_stage: {
    // V31-14 lands the runtime hook (snapshot consume path + switch read).
    landed: true,
    providerTicket: 'V31-14',
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
