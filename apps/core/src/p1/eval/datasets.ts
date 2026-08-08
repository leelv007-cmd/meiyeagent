/**
 * L1 node datasets — fixtures primary + desensitized history samples (U3).
 * Freezes dataset revision / source / license for audit.
 */

import {
  EVAL_DATASET_MANIFEST_SCHEMA_VERSION,
  evalDatasetManifestSchema,
  type EvalDatasetManifest,
  type EvalDatasetNode,
} from '@meiye/contracts';

export type EvalDatasetCase = {
  caseId: string;
  node: EvalDatasetNode;
  /** Fixture inputs only — never raw unredacted history. */
  input: Record<string, unknown>;
  expected?: Record<string, unknown>;
  tags?: readonly string[];
};

export type FrozenEvalDataset = {
  manifest: EvalDatasetManifest;
  cases: readonly EvalDatasetCase[];
};

const FROZEN_AT = '2026-08-08T00:00:00.000Z';

function freezeDataset(input: {
  datasetId: string;
  revision: string;
  source: EvalDatasetManifest['source'];
  license: string;
  node: EvalDatasetNode;
  cases: readonly EvalDatasetCase[];
  provenanceNote?: string;
}): FrozenEvalDataset {
  const caseIds = input.cases.map((item) => item.caseId);
  const manifest = evalDatasetManifestSchema.parse({
    schemaVersion: EVAL_DATASET_MANIFEST_SCHEMA_VERSION,
    datasetId: input.datasetId,
    revision: input.revision,
    source: input.source,
    license: input.license,
    frozenAt: FROZEN_AT,
    node: input.node,
    caseIds,
    provenanceNote: input.provenanceNote,
  });
  return { manifest, cases: input.cases };
}

/** Intent node baseline fixtures (U3 cold start). */
export const L1_INTENT_FIXTURE_DATASET: FrozenEvalDataset = freezeDataset({
  datasetId: 'l1-intent-baseline',
  revision: 'l1-intent@1',
  source: 'fixture',
  license: 'internal-fixture-v1',
  node: 'intent',
  cases: [
    {
      caseId: 'intent-goal-classify-copy',
      node: 'intent',
      input: {
        utterance: '帮我写一条本周美甲活动文案',
        expectedGoalClass: 'copy_generation',
      },
      expected: { goalClass: 'copy_generation', shouldAsk: false },
      tags: ['goal', 'fixture'],
    },
    {
      caseId: 'intent-should-ask-ambiguous-offer',
      node: 'intent',
      input: {
        utterance: '做个促销',
        expectedGoalClass: 'ambiguous_promotion',
      },
      expected: { shouldAsk: true },
      tags: ['ambiguity', 'fixture'],
    },
  ],
  provenanceNote: 'Synthetic fixtures; no production history.',
});

/** Plan node baseline fixtures. */
export const L1_PLAN_FIXTURE_DATASET: FrozenEvalDataset = freezeDataset({
  datasetId: 'l1-plan-baseline',
  revision: 'l1-plan@1',
  source: 'fixture',
  license: 'internal-fixture-v1',
  node: 'plan',
  cases: [
    {
      caseId: 'plan-fact-citation-ok',
      node: 'plan',
      input: {
        authorizedFactRefs: ['fact:price:1'],
        proposedClaimRefs: ['fact:price:1'],
      },
      expected: { unauthorizedFactRate: 0 },
      tags: ['fidelity', 'fixture'],
    },
  ],
});

/**
 * Desensitized history sample (cold start U3) — synthetic redacted shapes only.
 * Historical data must never enter replay write paths.
 */
export const L1_MAKE_DESENSITIZED_SAMPLE: FrozenEvalDataset = freezeDataset({
  datasetId: 'l1-make-desensitized-sample',
  revision: 'l1-make-desensitized@1',
  source: 'desensitized_history',
  license: 'desensitized-history-readonly-v1',
  node: 'make',
  cases: [
    {
      caseId: 'make-schema-pass-sample-1',
      node: 'make',
      input: {
        schemaName: 'copy_candidate',
        firstPassValid: true,
        repairCount: 0,
        // Desensitized — no real merchant names / phones.
        merchantLabel: '店家A',
      },
      expected: { firstSchemaPass: true },
      tags: ['desensitized', 'make'],
    },
  ],
  provenanceNote:
    'Synthetic desensitized shapes for cold start; not live history export.',
});

const ALL_DATASETS: readonly FrozenEvalDataset[] = [
  L1_INTENT_FIXTURE_DATASET,
  L1_PLAN_FIXTURE_DATASET,
  L1_MAKE_DESENSITIZED_SAMPLE,
];

export function listFrozenEvalDatasets(): readonly FrozenEvalDataset[] {
  return ALL_DATASETS;
}

export function getFrozenEvalDataset(
  datasetId: string,
  revision?: string,
): FrozenEvalDataset | null {
  const match = ALL_DATASETS.find((item) => {
    if (item.manifest.datasetId !== datasetId) return false;
    if (revision && item.manifest.revision !== revision) return false;
    return true;
  });
  return match ? structuredClone(match) : null;
}

/** Audit projection: revision + source + license are always readable. */
export function projectDatasetFreezeAudit(
  dataset: FrozenEvalDataset,
): Pick<
  EvalDatasetManifest,
  'datasetId' | 'revision' | 'source' | 'license' | 'frozenAt' | 'node'
> {
  const { datasetId, revision, source, license, frozenAt, node } =
    dataset.manifest;
  return { datasetId, revision, source, license, frozenAt, node };
}
