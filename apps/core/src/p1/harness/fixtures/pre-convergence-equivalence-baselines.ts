/**
 * V31-25: frozen PRE-CONVERGENCE equivalence baselines.
 *
 * Captured by running the exact fixture task set through the
 * pre-convergence runHarnessWorkflow entry (prelude + descriptor.execute
 * direct dispatch) at git commit 64bdaded8^ (V31-16 head, before V31-25
 * runner convergence). Extraction mirrors runner-equivalence.ts.
 *
 * Regeneration:
 *   scripts/generate-v31-25-pre-convergence-baselines.sh <output.json>
 * The script checks out the fixed commit in a temporary worktree and leaves
 * workflow-core.ts at that commit while copying in only the fixture exporter.
 *
 * Provenance: 64bdaded8^, captured 2026-08-09, DBOS-free fixture run.
 */

import type { RunnerEquivalenceSnapshot } from '../runner-equivalence.js';

/** Pre-convergence (64bdaded8^) baseline per fixture task id. */
export const PRE_CONVERGENCE_BASELINES: Record<
  'copy-legacy' | 'note-legacy' | 'media-legacy' |
  'copy-snapshot' | 'note-snapshot' | 'media-snapshot',
  RunnerEquivalenceSnapshot
> = {
  "copy-legacy": { "deliverable": { "outcome": "delivered", "delivery": { "packageId": "package-1", "versionId": "version-3", "revision": 3 }, "deliveryLayer": "copy", "recommendationDeliverables": ["copy_revision:3"], "merchantReportPresent": false, "billingReceiptPresent": false }, "settlement": { "cancelled": false, "hasBillingReceipt": false }, "recovery": { "effectKeys": ["skill:resolve:intent", "wf:v31-25-copy-legacy:s1:intent:0", "wf:v31-25-copy-legacy:s2:context:0", "wf:v31-25-copy-legacy:s2:fence:r1", "wf:v31-25-copy-legacy:s3:copy:0", "wf:v31-25-copy-legacy:s4:copy:selection", "wf:v31-25-copy-legacy:s5:package:0"], "progressSequence": ["intent_naming:success", "context_injection:success", "brief_compilation:success", "execution_selection:success", "assembly_delivery:success"], "traceStages": ["intent_naming", "context_injection", "brief_compilation", "execution_selection", "assembly_delivery"] } },
  "note-legacy": { "deliverable": { "outcome": "delivered", "delivery": { "packageId": "package-1", "versionId": "note-version-1", "revision": 3 }, "deliveryLayer": "finished_media", "recommendationDeliverables": ["image_text_note_revision:3"], "merchantReportPresent": false, "billingReceiptPresent": true }, "settlement": { "cancelled": false, "hasBillingReceipt": true }, "recovery": { "effectKeys": ["skill:resolve:intent", "wf:v31-25-note-legacy:s1:intent:0", "wf:v31-25-note-legacy:s2:context:0", "wf:v31-25-note-legacy:s2:fence:r1", "wf:v31-25-note-legacy:s3:image_text_note:0", "wf:v31-25-note-legacy:s4:image_text_note:selection", "wf:v31-25-note-legacy:s5:package:0"], "progressSequence": ["intent_naming:success", "context_injection:success", "brief_compilation:suspended", "brief_compilation:success", "execution_selection:success", "assembly_delivery:success"], "traceStages": ["intent_naming", "context_injection", "brief_compilation", "execution_selection", "assembly_delivery"] } },
  "media-legacy": { "deliverable": { "outcome": "delivered", "delivery": { "packageId": "package-1", "versionId": "media-version-1", "revision": 3 }, "deliveryLayer": "finished_media", "recommendationDeliverables": ["image_revision:3"], "merchantReportPresent": false, "billingReceiptPresent": false }, "settlement": { "cancelled": false, "hasBillingReceipt": false }, "recovery": { "effectKeys": ["skill:resolve:intent", "wf:v31-25-media-legacy:s1:intent:0", "wf:v31-25-media-legacy:s2:context:0", "wf:v31-25-media-legacy:s2:fence:r1", "wf:v31-25-media-legacy:s3:image:0", "wf:v31-25-media-legacy:s4:image:selection", "wf:v31-25-media-legacy:s5:package:0"], "progressSequence": ["intent_naming:success", "context_injection:success", "brief_compilation:success", "execution_selection:success", "assembly_delivery:success"], "traceStages": ["intent_naming", "context_injection", "brief_compilation", "execution_selection", "assembly_delivery"] } },
  "copy-snapshot": { "deliverable": { "outcome": "delivered", "delivery": { "packageId": "package-1", "versionId": "version-3", "revision": 3 }, "deliveryLayer": "copy", "recommendationDeliverables": ["copy_revision:3"], "merchantReportPresent": false, "billingReceiptPresent": false }, "settlement": { "cancelled": false, "hasBillingReceipt": false }, "recovery": { "effectKeys": ["skill:resolve:intent", "wf:v31-25-copy-snapshot:s1:intent:0", "wf:v31-25-copy-snapshot:s2:context:0", "wf:v31-25-copy-snapshot:s2:fence:r1", "wf:v31-25-copy-snapshot:s3:copy:0", "wf:v31-25-copy-snapshot:s4:copy:selection", "wf:v31-25-copy-snapshot:s5:package:0"], "progressSequence": ["intent_naming:success", "context_injection:success", "brief_compilation:success", "execution_selection:success", "assembly_delivery:success"], "traceStages": ["intent_naming", "context_injection", "brief_compilation", "execution_selection", "assembly_delivery"] } },
  "note-snapshot": { "deliverable": { "outcome": "delivered", "delivery": { "packageId": "package-1", "versionId": "note-version-1", "revision": 3 }, "deliveryLayer": "finished_media", "recommendationDeliverables": ["image_text_note_revision:3"], "merchantReportPresent": false, "billingReceiptPresent": true }, "settlement": { "cancelled": false, "hasBillingReceipt": true }, "recovery": { "effectKeys": ["skill:resolve:intent", "wf:v31-25-note-snapshot:s1:intent:0", "wf:v31-25-note-snapshot:s2:context:0", "wf:v31-25-note-snapshot:s2:fence:r1", "wf:v31-25-note-snapshot:s3:image_text_note:0", "wf:v31-25-note-snapshot:s4:image_text_note:selection", "wf:v31-25-note-snapshot:s5:package:0"], "progressSequence": ["intent_naming:success", "context_injection:success", "brief_compilation:suspended", "brief_compilation:success", "execution_selection:success", "assembly_delivery:success"], "traceStages": ["intent_naming", "context_injection", "brief_compilation", "execution_selection", "assembly_delivery"] } },
  "media-snapshot": { "deliverable": { "outcome": "delivered", "delivery": { "packageId": "package-1", "versionId": "media-version-1", "revision": 3 }, "deliveryLayer": "finished_media", "recommendationDeliverables": ["image_revision:3"], "merchantReportPresent": false, "billingReceiptPresent": false }, "settlement": { "cancelled": false, "hasBillingReceipt": false }, "recovery": { "effectKeys": ["skill:resolve:intent", "wf:v31-25-media-snapshot:s1:intent:0", "wf:v31-25-media-snapshot:s2:context:0", "wf:v31-25-media-snapshot:s2:fence:r1", "wf:v31-25-media-snapshot:s3:image:0", "wf:v31-25-media-snapshot:s4:image:selection", "wf:v31-25-media-snapshot:s5:package:0"], "progressSequence": ["intent_naming:success", "context_injection:success", "brief_compilation:success", "execution_selection:success", "assembly_delivery:success"], "traceStages": ["intent_naming", "context_injection", "brief_compilation", "execution_selection", "assembly_delivery"] } },
};

/**
 * Post-convergence compiled-primitive effect keys per fixture task, pinned as
 * literals on purpose.
 *
 * The convergence added one durable topology marker per execution unit. Those
 * keys are the post-convergence half of the recovery axis, so the expectation
 * used to be derived by calling `resolveCompiledCarrierExecution` — the
 * production resolver — which made the axis self-comparing: any change to the
 * carrier recipes moved the expectation along with the code and the test could
 * not fail. Pinning them here means a plan-topology change fails this test and
 * has to be acknowledged by editing this list.
 *
 * Each entry is `compiled-primitive:<workflowId>:<unitId>` in plan order and is
 * checkable by eye against the carrier recipes in carrier-unit-recipes.ts.
 */
export const POST_CONVERGENCE_PRIMITIVE_EFFECT_KEYS: Record<
  keyof typeof PRE_CONVERGENCE_BASELINES,
  readonly string[]
> = {
  'copy-legacy': [
    'compiled-primitive:v31-25-copy-legacy:unit-copy-context',
    'compiled-primitive:v31-25-copy-legacy:unit-copy-brief',
    'compiled-primitive:v31-25-copy-legacy:unit-copy-select',
    'compiled-primitive:v31-25-copy-legacy:unit-copy-check',
    'compiled-primitive:v31-25-copy-legacy:unit-copy-assemble',
  ],
  'note-legacy': [
    'compiled-primitive:v31-25-note-legacy:unit-note-context',
    'compiled-primitive:v31-25-note-legacy:unit-note-brief',
    'compiled-primitive:v31-25-note-legacy:unit-note-style-ask',
    'compiled-primitive:v31-25-note-legacy:unit-note-pages',
    'compiled-primitive:v31-25-note-legacy:unit-note-check',
    'compiled-primitive:v31-25-note-legacy:unit-note-revise',
    'compiled-primitive:v31-25-note-legacy:unit-note-assemble',
  ],
  'media-legacy': [
    'compiled-primitive:v31-25-media-legacy:unit-media-context',
    'compiled-primitive:v31-25-media-legacy:unit-media-brief',
    'compiled-primitive:v31-25-media-legacy:unit-media-select',
    'compiled-primitive:v31-25-media-legacy:unit-media-check',
    'compiled-primitive:v31-25-media-legacy:unit-media-assemble',
  ],
  'copy-snapshot': [
    'compiled-primitive:v31-25-copy-snapshot:unit-copy-context',
    'compiled-primitive:v31-25-copy-snapshot:unit-copy-brief',
    'compiled-primitive:v31-25-copy-snapshot:unit-copy-select',
    'compiled-primitive:v31-25-copy-snapshot:unit-copy-check',
    'compiled-primitive:v31-25-copy-snapshot:unit-copy-assemble',
  ],
  'note-snapshot': [
    'compiled-primitive:v31-25-note-snapshot:unit-note-context',
    'compiled-primitive:v31-25-note-snapshot:unit-note-brief',
    'compiled-primitive:v31-25-note-snapshot:unit-note-style-ask',
    'compiled-primitive:v31-25-note-snapshot:unit-note-pages',
    'compiled-primitive:v31-25-note-snapshot:unit-note-check',
    'compiled-primitive:v31-25-note-snapshot:unit-note-revise',
    'compiled-primitive:v31-25-note-snapshot:unit-note-assemble',
  ],
  'media-snapshot': [
    'compiled-primitive:v31-25-media-snapshot:unit-media-context',
    'compiled-primitive:v31-25-media-snapshot:unit-media-brief',
    'compiled-primitive:v31-25-media-snapshot:unit-media-select',
    'compiled-primitive:v31-25-media-snapshot:unit-media-check',
    'compiled-primitive:v31-25-media-snapshot:unit-media-assemble',
  ],
};
