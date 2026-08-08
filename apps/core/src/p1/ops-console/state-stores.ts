/**
 * Ops-console durable state ports (V31-22 durability fix).
 * Memory implementations are test-only; production uses Postgres.
 */

import {
  OPS_KILL_SWITCH_IDS,
  type OpsKillSwitchId,
  type OpsKillSwitchState,
} from './kill-switches.js';

export type OpsCandidateTrial = {
  workspaceId: string;
  candidateReleaseId: string;
  operatorId: string;
  reason: string;
  updatedAt: string;
};

export type OpsRollbackDrillRecord = {
  id: string;
  releaseId: string;
  operatorId: string;
  reason: string;
  evidence: string;
  result: 'passed' | 'failed';
  notes: string | null;
  createdAt: string;
};

export interface OpsKillSwitchStore {
  getKillSwitch(switchId: OpsKillSwitchId): Promise<OpsKillSwitchState | null>;
  putKillSwitch(state: OpsKillSwitchState): Promise<OpsKillSwitchState>;
  listKillSwitches(): Promise<OpsKillSwitchState[]>;
}

export interface OpsCandidateTrialStore {
  putCandidateTrial(trial: OpsCandidateTrial): Promise<OpsCandidateTrial>;
  listCandidateTrials(): Promise<OpsCandidateTrial[]>;
}

export interface OpsRollbackDrillStore {
  appendRollbackDrill(
    record: OpsRollbackDrillRecord,
  ): Promise<OpsRollbackDrillRecord>;
  listRollbackDrills(limit?: number): Promise<OpsRollbackDrillRecord[]>;
}

export function defaultKillSwitchState(
  switchId: OpsKillSwitchId,
): OpsKillSwitchState {
  return {
    switchId,
    enabled: false,
    updatedAt: '1970-01-01T00:00:00.000Z',
    updatedBy: null,
    reason: null,
  };
}

export class MemoryOpsKillSwitchStore implements OpsKillSwitchStore {
  private readonly byId = new Map<OpsKillSwitchId, OpsKillSwitchState>();

  constructor() {
    for (const switchId of OPS_KILL_SWITCH_IDS) {
      this.byId.set(switchId, defaultKillSwitchState(switchId));
    }
  }

  async getKillSwitch(
    switchId: OpsKillSwitchId,
  ): Promise<OpsKillSwitchState | null> {
    const value = this.byId.get(switchId);
    return value ? structuredClone(value) : null;
  }

  async putKillSwitch(state: OpsKillSwitchState): Promise<OpsKillSwitchState> {
    const copy = structuredClone(state);
    this.byId.set(state.switchId, copy);
    return structuredClone(copy);
  }

  async listKillSwitches(): Promise<OpsKillSwitchState[]> {
    return OPS_KILL_SWITCH_IDS.map((switchId) =>
      structuredClone(
        this.byId.get(switchId) ?? defaultKillSwitchState(switchId),
      ),
    );
  }
}

export class MemoryOpsCandidateTrialStore implements OpsCandidateTrialStore {
  private readonly byWorkspace = new Map<string, OpsCandidateTrial>();

  async putCandidateTrial(
    trial: OpsCandidateTrial,
  ): Promise<OpsCandidateTrial> {
    const copy = structuredClone(trial);
    this.byWorkspace.set(trial.workspaceId, copy);
    return structuredClone(copy);
  }

  async listCandidateTrials(): Promise<OpsCandidateTrial[]> {
    return [...this.byWorkspace.values()]
      .map((item) => structuredClone(item))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export class MemoryOpsRollbackDrillStore implements OpsRollbackDrillStore {
  private readonly records: OpsRollbackDrillRecord[] = [];

  async appendRollbackDrill(
    record: OpsRollbackDrillRecord,
  ): Promise<OpsRollbackDrillRecord> {
    const copy = structuredClone(record);
    this.records.unshift(copy);
    return structuredClone(copy);
  }

  async listRollbackDrills(limit = 100): Promise<OpsRollbackDrillRecord[]> {
    return this.records.slice(0, limit).map((item) => structuredClone(item));
  }
}
