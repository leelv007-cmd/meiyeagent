/**
 * Owned-data proactive signals only (V31-24 / V3.1 §25).
 *
 * Sources limited to facts the platform already owns:
 * - goal_stalled (active goal with no recent delivered work / evidence)
 * - unpublished_duration (delivered ContentPackage, no publish mark)
 * - historical_performance (published ContentPackage, no active outcome signal)
 *
 * Does not invent external platform metrics.
 */

import type { MarketingGoal, ProactiveSignal } from '@meiye/contracts';

import {
  deriveContentPackageSignals,
  type ContentPackageFactsReader,
  type ContentPackageSignalOptions,
} from './content-package-facts.js';
import type { DeliveredWorkFact, OutcomeEvidenceFact } from './goal-progress.js';
import type { MarketingGoalStore } from './goal-store.js';
import type { ProactiveSignalSource } from './proactive-service.js';

export type OwnedSignalSourcePorts = {
  goals: Pick<MarketingGoalStore, 'list'>;
  listDeliveredWorks?(input: {
    resourceId: string;
  }): Promise<readonly DeliveredWorkFact[]> | readonly DeliveredWorkFact[];
  listOutcomeEvidence?(input: {
    resourceId: string;
  }): Promise<readonly OutcomeEvidenceFact[]> | readonly OutcomeEvidenceFact[];
  /** ContentPackage reader for unpublished / no-evidence signals. */
  contentPackages?: ContentPackageFactsReader;
  contentPackageSignalOptions?: ContentPackageSignalOptions;
  /** Days without delivery/evidence before goal_stalled (default 14). */
  stallDays?: number;
};

export class OwnedDataProactiveSignalSource implements ProactiveSignalSource {
  constructor(private readonly ports: OwnedSignalSourcePorts) {}

  async listSignals(input: {
    resourceId: string;
    now: string;
  }): Promise<readonly ProactiveSignal[]> {
    const out: ProactiveSignal[] = [];
    out.push(...(await this.goalStalledSignals(input)));

    if (this.ports.contentPackages) {
      const packages = await this.ports.contentPackages.listPackages({
        resourceId: input.resourceId,
      });
      out.push(
        ...deriveContentPackageSignals({
          resourceId: input.resourceId,
          packages,
          now: input.now,
          options: this.ports.contentPackageSignalOptions,
        }),
      );
    }

    return out;
  }

  private async goalStalledSignals(input: {
    resourceId: string;
    now: string;
  }): Promise<ProactiveSignal[]> {
    const goals = await this.ports.goals.list({
      resourceId: input.resourceId,
      status: 'active',
      limit: 20,
    });
    const delivered = this.ports.listDeliveredWorks
      ? await this.ports.listDeliveredWorks({ resourceId: input.resourceId })
      : [];
    const evidence = this.ports.listOutcomeEvidence
      ? await this.ports.listOutcomeEvidence({ resourceId: input.resourceId })
      : [];
    const stallMs = (this.ports.stallDays ?? 14) * 24 * 60 * 60 * 1000;
    const nowMs = Date.parse(input.now);
    const out: ProactiveSignal[] = [];

    for (const goal of goals) {
      const last = latestActivityAt(goal, delivered, evidence);
      const baseline = last ? Date.parse(last) : Date.parse(goal.createdAt);
      if (!Number.isFinite(baseline)) continue;
      if (nowMs - baseline < stallMs) continue;
      out.push({
        kind: 'goal_stalled',
        resourceId: input.resourceId,
        observedAt: input.now,
        summary: `目标「${goal.statement.slice(0, 40)}」已超过 ${this.ports.stallDays ?? 14} 天未推进`,
        evidenceRefs: [
          { kind: 'goal_stalled', ref: goal.goalId },
          ...(last
            ? [{ kind: 'last_activity', ref: last }]
            : [{ kind: 'goal_created', ref: goal.createdAt }]),
        ],
        goalId: goal.goalId,
        weight: goal.priority === 'high' ? 3 : goal.priority === 'normal' ? 2 : 1,
      } as ProactiveSignal);
    }
    return out;
  }
}

function latestActivityAt(
  goal: MarketingGoal,
  delivered: readonly DeliveredWorkFact[],
  evidence: readonly OutcomeEvidenceFact[],
): string | null {
  const times: string[] = [];
  for (const work of delivered) {
    if (work.goalId === goal.goalId) times.push(work.deliveredAt);
  }
  for (const row of evidence) {
    if (row.goalId === goal.goalId && !row.withdrawn) {
      times.push(row.observedAt);
    }
  }
  if (times.length === 0) return null;
  return times.sort().at(-1) ?? null;
}
