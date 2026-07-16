export interface LegacyInFlightDecision {
  jobId: string;
  status: string;
  decision: 'legacy_drain' | 'new_owner_recovery' | 'manual';
  owner: string;
  reason: string;
  preserveOriginalTaskRef: true;
  allowRegeneration: false;
}

export interface LegacyInFlightDecisionPort {
  get(
    workspaceId: string,
    jobId: string
  ): Promise<LegacyInFlightDecision | null>;
}

export const noOpLegacyInFlightDecisionPort: LegacyInFlightDecisionPort = {
  async get() {
    return null;
  },
};
