/**
 * L0.5 production sampling path (V31-23).
 * Reuses the fixed V31-08 Session behavior checks.
 */

import { randomUUID } from 'node:crypto';

import {
  EVAL_LAYER_RESULT_SCHEMA_VERSION,
  evalLayerResultSchema,
  type EvalLayerResult,
} from '@meiye/contracts';

import {
  runSessionBehaviorQuickChecks,
  type QuickCheckTrace,
  type QuickCheckVerdict,
} from '../agent-session/quick-checks.js';
import { P1DomainError } from '../foundation/domain.js';
import type { HarnessReleaseStore } from '../harness/harness-release.js';
import { assertNoEvalTraceLeaks } from './trace-fields.js';
import type { EvalVerdictStore } from './verdict-store.js';

export type ProductionSampleInput = {
  harnessReleaseId: string;
  trace: QuickCheckTrace;
  /** Optional sample identity for storage / Langfuse correlation. */
  sampleTraceId?: string;
  /** Defaults to artifact.evalSuiteRevision when omitted. */
  evalSuiteRevision?: string;
  /**
   * Tag filter on registry.
   * Default: include l0.5, exclude readonly (make-path production sample).
   * Readonly Session samples should pass includeTags:['l0.5','readonly'].
   */
  includeTags?: readonly string[];
  excludeTags?: readonly string[];
  /** @deprecated prefer includeTags; kept as single-tag shorthand. */
  tag?: string;
  createdAt?: string;
  resultId?: string;
};

export type ProductionSampleOutcome = {
  result: EvalLayerResult;
  quickCheckVerdicts: QuickCheckVerdict[];
};

/**
 * Map binary Quick Check verdicts into the three gate slots so L0.5 samples
 * still obey 缺一即 failed for the shared verdict engine when elevated to L1.
 * L0.5 itself records layer=l0.5 with empty thresholds and gate proxies:
 * all quick checks pass → three synthetic gates pass; any fail → fidelity fails.
 */
export function quickChecksToProxyGates(
  verdicts: readonly QuickCheckVerdict[],
): EvalLayerResult['gates'] {
  const allPassed = verdicts.every((item) => item.passed);
  const failedIds = verdicts
    .filter((item) => !item.passed)
    .map((item) => item.id);
  const reason = allPassed
    ? undefined
    : `quick checks failed: ${failedIds.join(',')}`;
  return [
    {
      id: 'l0.5.proxy.fidelity',
      kind: 'fidelity',
      passed: allPassed,
      reason,
    },
    {
      id: 'l0.5.proxy.rights',
      kind: 'rights',
      passed: true,
    },
    {
      id: 'l0.5.proxy.redline',
      kind: 'redline',
      passed: true,
    },
  ];
}

export class ProductionQuickCheckSampler {
  constructor(
    private readonly deps: {
      releases: Pick<HarnessReleaseStore, 'getArtifact'>;
      verdicts: EvalVerdictStore;
    },
  ) {}

  async sample(input: ProductionSampleInput): Promise<ProductionSampleOutcome> {
    // Trace payload must not carry forbidden secrets into storage.
    assertNoEvalTraceLeaks({
      harnessReleaseId: input.harnessReleaseId,
      sampleTraceId: input.sampleTraceId,
      tags: input.trace.tags,
      toolNames: input.trace.toolCalls.map((call) => call.toolName),
      llmCallCount: input.trace.llmCallCount,
    });

    const artifact = await this.deps.releases.getArtifact(
      input.harnessReleaseId,
    );
    if (!artifact) {
      throw new P1DomainError(
        'NOT_FOUND',
        `HarnessRelease not found for production sampling: ${input.harnessReleaseId}`,
      );
    }

    const includeTags = input.includeTags ?? (input.tag ? [input.tag] : ['l0.5']);
    const excludeTags =
      input.excludeTags ??
      // Default production sample is make-path; skip read-only Session assertions.
      (input.includeTags?.includes('readonly') || input.tag === 'readonly'
        ? []
        : ['readonly']);
    const quickCheckVerdicts = runSessionBehaviorQuickChecks(input.trace, {
      includeTags,
      excludeTags,
    });
    const gates = quickChecksToProxyGates(quickCheckVerdicts);
    const allPassed = quickCheckVerdicts.every((item) => item.passed);

    const result = evalLayerResultSchema.parse({
      schemaVersion: EVAL_LAYER_RESULT_SCHEMA_VERSION,
      resultId: input.resultId ?? randomUUID(),
      layer: 'l0.5',
      harnessReleaseId: input.harnessReleaseId,
      evalSuiteRevision:
        input.evalSuiteRevision ?? artifact.evalSuiteRevision,
      gates,
      thresholds: [],
      verdict: allPassed ? 'passed' : 'failed',
      scoredBookkept: false,
      releasable: allPassed,
      createdAt: input.createdAt ?? new Date().toISOString(),
      sampleTraceId: input.sampleTraceId,
      quickCheckIds: quickCheckVerdicts.map((item) => item.id),
    });

    const stored = await this.deps.verdicts.putImmutable(result);
    return { result: stored, quickCheckVerdicts };
  }
}

export function createDefaultProductionQuickCheckSampler(deps: {
  releases: Pick<HarnessReleaseStore, 'getArtifact'>;
  verdicts: EvalVerdictStore;
}): ProductionQuickCheckSampler {
  return new ProductionQuickCheckSampler({
    releases: deps.releases,
    verdicts: deps.verdicts,
  });
}
