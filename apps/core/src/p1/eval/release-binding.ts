/**
 * Bind eval results to HarnessRelease (V31-23 acceptance: 评估结果绑定 release).
 */

import { randomUUID } from 'node:crypto';

import {
  EVAL_LAYER_RESULT_SCHEMA_VERSION,
  evalLayerResultSchema,
  type EvalLayerId,
  type EvalLayerResult,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type { HarnessReleaseStore } from '../harness/harness-release.js';
import { computeEvalVerdict } from './verdict.js';
import type { EvalVerdictStore } from './verdict-store.js';

export type BindEvalResultInput = {
  harnessReleaseId: string;
  layer: EvalLayerId;
  gates: EvalLayerResult['gates'];
  thresholds?: EvalLayerResult['thresholds'];
  datasetRevision?: string;
  sampleTraceId?: string;
  quickCheckIds?: string[];
  evalSuiteRevision?: string;
  resultId?: string;
  createdAt?: string;
};

export class EvalReleaseBinder {
  constructor(
    private readonly deps: {
      releases: Pick<HarnessReleaseStore, 'getArtifact'>;
      verdicts: EvalVerdictStore;
    },
  ) {}

  /**
   * Compute verdict, require release exists, freeze evalSuiteRevision from
   * artifact when not overridden, persist immutable result.
   */
  async bindAndStore(input: BindEvalResultInput): Promise<EvalLayerResult> {
    const artifact = await this.deps.releases.getArtifact(
      input.harnessReleaseId,
    );
    if (!artifact) {
      throw new P1DomainError(
        'NOT_FOUND',
        `HarnessRelease not found for eval binding: ${input.harnessReleaseId}`,
      );
    }

    const computed = computeEvalVerdict({
      gates: input.gates,
      thresholds: input.thresholds,
    });

    const result = evalLayerResultSchema.parse({
      schemaVersion: EVAL_LAYER_RESULT_SCHEMA_VERSION,
      resultId: input.resultId ?? randomUUID(),
      layer: input.layer,
      harnessReleaseId: input.harnessReleaseId,
      evalSuiteRevision:
        input.evalSuiteRevision ?? artifact.evalSuiteRevision,
      datasetRevision: input.datasetRevision,
      gates: computed.gates,
      thresholds: computed.thresholds,
      verdict: computed.verdict,
      scoredBookkept: computed.scoredBookkept,
      releasable: computed.releasable,
      createdAt: input.createdAt ?? new Date().toISOString(),
      sampleTraceId: input.sampleTraceId,
      quickCheckIds: input.quickCheckIds,
    });

    return this.deps.verdicts.putImmutable(result);
  }

  async listForRelease(
    harnessReleaseId: string,
    limit?: number,
  ): Promise<EvalLayerResult[]> {
    return this.deps.verdicts.listByRelease(harnessReleaseId, limit);
  }
}
