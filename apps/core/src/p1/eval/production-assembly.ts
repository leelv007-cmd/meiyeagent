/**
 * Production assembly for eval layers (V31-23 hard acceptance: must be wired).
 * Binds Quick Checks + verdict store + release store + optional Langfuse
 * write path + rollback-drill readiness (reuses V31-22 ops-console store).
 */

import { P1DomainError } from '../foundation/domain.js';
import type { HarnessReleaseStore } from '../harness/harness-release.js';
import type { OpsRollbackDrillStore } from '../ops-console/state-stores.js';
import { EVAL_HIGHER_LAYER_BACKLOG } from './higher-layers.js';
import {
  listFrozenEvalDatasets,
  type FrozenEvalDataset,
} from './datasets.js';
import { listL0Gaps, listL0Inventory } from './l0-inventory.js';
import type { LangfuseEvalWriter } from './langfuse-eval-writer.js';
import {
  ProductionQuickCheckSampler,
  createDefaultProductionQuickCheckSampler,
} from './production-sampling.js';
import { EvalReleaseBinder } from './release-binding.js';
import type { EvalVerdictStore } from './verdict-store.js';

export type ProductionEvalLayersPorts = {
  releases: Pick<HarnessReleaseStore, 'getArtifact'>;
  verdicts: EvalVerdictStore;
  /**
   * Required production write path (OutboxLangfuseEvalWriter).
   * RecordingLangfuseEvalWriter is test-only — assembly does not default to it.
   */
  langfuseWriter: LangfuseEvalWriter;
  /** Reuse ops-console drill store; do not rebuild. */
  rollbackDrills?: OpsRollbackDrillStore;
};

export type CanaryReadinessReport = {
  harnessReleaseId: string;
  hasPassedRollbackDrill: boolean;
  latestDrillId: string | null;
  latestEvalVerdict: string | null;
  scoredOnlyCount: number;
  /** U12: scored never auto-promotes — operator must decide. */
  autoPromoteAllowed: false;
  higherLayers: typeof EVAL_HIGHER_LAYER_BACKLOG;
};

export type ProductionEvalLayersAssembly = {
  sampler: ProductionQuickCheckSampler;
  binder: EvalReleaseBinder;
  verdicts: EvalVerdictStore;
  langfuseWriter: LangfuseEvalWriter;
  listDatasets: () => readonly FrozenEvalDataset[];
  listL0Inventory: typeof listL0Inventory;
  listL0Gaps: typeof listL0Gaps;
  assessCanaryReadiness: (
    harnessReleaseId: string,
  ) => Promise<CanaryReadinessReport>;
  /** Persist result then write Langfuse scores (data path only). */
  recordAndEmit: (
    input: Parameters<EvalReleaseBinder['bindAndStore']>[0],
  ) => Promise<{ result: Awaited<ReturnType<EvalReleaseBinder['bindAndStore']>>; langfuseEvents: number }>;
};

function requirePort<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Production eval layers assembly missing required port: ${name}`,
    );
  }
  return value;
}

export function createProductionEvalLayersAssembly(
  ports: ProductionEvalLayersPorts,
): ProductionEvalLayersAssembly {
  const releases = requirePort(ports.releases, 'releases');
  const verdicts = requirePort(ports.verdicts, 'verdicts');
  const langfuseWriter = requirePort(ports.langfuseWriter, 'langfuseWriter');
  const rollbackDrills = ports.rollbackDrills;

  const sampler = createDefaultProductionQuickCheckSampler({
    releases,
    verdicts,
  });
  const binder = new EvalReleaseBinder({ releases, verdicts });

  return {
    sampler,
    binder,
    verdicts,
    langfuseWriter,
    listDatasets: () => listFrozenEvalDatasets(),
    listL0Inventory,
    listL0Gaps,
    async assessCanaryReadiness(harnessReleaseId) {
      const artifact = await releases.getArtifact(harnessReleaseId);
      if (!artifact) {
        throw new P1DomainError(
          'NOT_FOUND',
          `HarnessRelease not found for canary readiness: ${harnessReleaseId}`,
        );
      }
      const results = await verdicts.listByRelease(harnessReleaseId, 50);
      const scoredOnlyCount = results.filter(
        (item) => item.verdict === 'scored',
      ).length;
      let hasPassedRollbackDrill = false;
      let latestDrillId: string | null = null;
      if (rollbackDrills) {
        const drills = await rollbackDrills.listRollbackDrills(20);
        const forRelease = drills.filter(
          (item) => item.releaseId === harnessReleaseId,
        );
        const passed = forRelease.find((item) => item.result === 'passed');
        hasPassedRollbackDrill = Boolean(passed);
        latestDrillId = forRelease[0]?.id ?? null;
      }
      return {
        harnessReleaseId,
        hasPassedRollbackDrill,
        latestDrillId,
        latestEvalVerdict: results[0]?.verdict ?? null,
        scoredOnlyCount,
        autoPromoteAllowed: false,
        higherLayers: EVAL_HIGHER_LAYER_BACKLOG,
      };
    },
    async recordAndEmit(input) {
      const result = await binder.bindAndStore(input);
      const { eventCount } = await langfuseWriter.writeEvalResult(result);
      return { result, langfuseEvents: eventCount };
    },
  };
}
