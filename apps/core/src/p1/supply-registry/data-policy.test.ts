/**
 * G5 DataPolicyRevision hard-filter tests (D-064).
 *
 * medical/medical-health naming = content data sensitivity classification,
 * NOT the D-025 medical beauty (医美) product category boundary.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelDeployment } from '../model-supply/supply-contracts.js';
import {
  DataPolicyRegistry,
  DUAL_APPROVAL_REQUIRED_DATA_CLASSES,
  MEDICAL_HEALTH_CONTENT_SENSITIVITY_NOTE,
  evaluateDataPolicyHardFilter,
  failClosedWithoutCompliantCandidate,
  isMedicalHealthContentSensitivity,
  normalizeRequestedDataClasses,
  projectDataProcessingLevel,
  reclassifyDataClass,
  toPublicDataPolicyRevision,
} from './data-policy.js';
import { planModelSupplyCandidatesWithDataPolicy } from './supply-control-plane.js';
import type { CatalogModel } from '../model-supply/supply-contracts.js';

const domestic: ModelDeployment = {
  id: 'qwen-direct',
  catalogModelId: 'copy-domestic',
  apiFamily: 'openai',
  channel: 'direct',
  region: 'domestic',
  status: 'active',
  allowedDataClasses: ['public', 'contains_face', 'pii', 'medical'],
};

const overseas: ModelDeployment = {
  id: 'openai-direct',
  catalogModelId: 'copy-quality',
  apiFamily: 'openai',
  channel: 'direct',
  region: 'overseas',
  status: 'active',
};

const models: CatalogModel[] = [
  {
    id: 'copy-domestic',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Domestic',
    qualityRank: 70,
  },
  {
    id: 'copy-quality',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Quality',
    qualityRank: 90,
  },
];

test('medical/medical-health is content sensitivity, not D-025 medical beauty category', () => {
  assert.match(MEDICAL_HEALTH_CONTENT_SENSITIVITY_NOTE, /content data sensitivity/i);
  assert.match(MEDICAL_HEALTH_CONTENT_SENSITIVITY_NOTE, /NOT D-025/);
  assert.match(MEDICAL_HEALTH_CONTENT_SENSITIVITY_NOTE, /医美/);
  assert.equal(isMedicalHealthContentSensitivity('medical'), true);
  assert.equal(isMedicalHealthContentSensitivity('medical-health'), true);
  assert.equal(isMedicalHealthContentSensitivity('pii'), false);
  assert.deepEqual(
    DUAL_APPROVAL_REQUIRED_DATA_CLASSES,
    ['contains_face', 'pii', 'medical', 'medical-health'],
  );
});

test('dataClass hard filter negative: restricted class into non-whitelist Deployment is rejected', () => {
  // Overseas has no face whitelist → reject contains_face.
  const faceOverseas = evaluateDataPolicyHardFilter({
    deployment: overseas,
    requestedDataClasses: ['contains_face'],
  });
  assert.equal(faceOverseas.allowed, false);
  assert.ok(faceOverseas.reasons.includes('data_class_disallowed'));

  // Explicit DataPolicy that does not list pii → reject.
  const piiDenied = evaluateDataPolicyHardFilter({
    deployment: domestic,
    requestedDataClasses: ['pii'],
    dataPolicy: {
      sourceTrustLevel: 'contract_attested',
      processingRegion: 'domestic',
      allowedDataClasses: ['public', 'contains_face'],
      dualApprovalRequiredFor: ['contains_face'],
    },
    dataPolicyRevisionId: 'dp-1',
    dualApproval: {
      contractApproved: true,
      technicalApproved: true,
    },
  });
  assert.equal(piiDenied.allowed, false);
  assert.ok(piiDenied.reasons.includes('data_class_disallowed'));
});

test('medical-health content sensitivity requires dual-approved Deployment (not D-025 医美)', () => {
  const policy = {
    sourceTrustLevel: 'platform_verified',
    processingRegion: 'domestic' as const,
    retentionTrainingSubprocessor: 'no_training_subprocessor',
    allowedDataClasses: ['public', 'medical-health', 'medical'] as Array<
      'public' | 'medical-health' | 'medical'
    >,
    dualApprovalRequiredFor: ['medical-health', 'medical'] as Array<
      'medical-health' | 'medical'
    >,
  };

  const missingDual = evaluateDataPolicyHardFilter({
    deployment: domestic,
    requestedDataClasses: ['medical-health'],
    dataPolicy: policy,
    dataPolicyRevisionId: 'dp-med',
    dualApproval: { contractApproved: true, technicalApproved: false },
  });
  assert.equal(missingDual.allowed, false);
  assert.ok(missingDual.reasons.includes('dual_approval_missing'));
  assert.equal(missingDual.dualApprovalRequired, true);

  const dualOk = evaluateDataPolicyHardFilter({
    deployment: domestic,
    requestedDataClasses: ['medical-health'],
    dataPolicy: policy,
    dataPolicyRevisionId: 'dp-med',
    dualApproval: {
      contractApproved: true,
      technicalApproved: true,
      contractRevisionId: 'contract-1',
      technicalEvidenceRef: 'probe-1',
    },
  });
  assert.equal(dualOk.allowed, true);
  assert.deepEqual(dualOk.reasons, []);
});

test('contains_face/pii hard filter negatives require dual approval on whitelist', () => {
  const policy = {
    sourceTrustLevel: 'contract_attested',
    processingRegion: 'domestic' as const,
    allowedDataClasses: ['public', 'contains_face', 'pii'] as Array<
      'public' | 'contains_face' | 'pii'
    >,
  };

  for (const dataClass of ['contains_face', 'pii'] as const) {
    const denied = evaluateDataPolicyHardFilter({
      deployment: domestic,
      requestedDataClasses: [dataClass],
      dataPolicy: policy,
      dataPolicyRevisionId: 'dp-face',
      dualApproval: { contractApproved: false, technicalApproved: true },
    });
    assert.equal(denied.allowed, false, dataClass);
    assert.ok(denied.reasons.includes('dual_approval_missing'), dataClass);
  }
});

test('content-safety rejection does not vendor-switch', () => {
  const result = evaluateDataPolicyHardFilter({
    deployment: domestic,
    requestedDataClasses: ['public'],
    contentSafetyRejected: true,
  });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.reasons, ['content_safety_no_vendor_switch']);
});

test('no compliant candidate fails closed (no silent data-protection downgrade)', () => {
  assert.deepEqual(failClosedWithoutCompliantCandidate({ eligibleCount: 0 }), {
    failClosed: true,
    reason: 'no_compliant_candidate',
  });
  assert.deepEqual(failClosedWithoutCompliantCandidate({ eligibleCount: 2 }), {
    failClosed: false,
    reason: null,
  });

  const plan = planModelSupplyCandidatesWithDataPolicy({
    catalog: {
      modelById: new Map(models.map((m) => [m.id, m])),
      deployments: [overseas],
    },
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: ['pii'],
    dataPolicyByDeploymentId: new Map([
      [
        'openai-direct',
        {
          deploymentId: 'openai-direct',
          dataPolicyRevisionId: 'dp-x',
          dataPolicy: {
            sourceTrustLevel: 'self_declared',
            processingRegion: 'overseas',
            allowedDataClasses: ['public'],
          },
          dualApproval: null,
        },
      ],
    ]),
  });
  assert.equal(plan.plan.candidates.length, 0);
  assert.equal(plan.failClosed, true);
  assert.equal(plan.failClosedReason, 'no_compliant_candidate');
});

test('restricted class with explicit null DataPolicy binding fails closed', () => {
  const result = evaluateDataPolicyHardFilter({
    deployment: domestic,
    requestedDataClasses: ['pii'],
    dataPolicy: null,
    dataPolicyRevisionId: null,
  });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('data_policy_missing_for_restricted_class'));
});

test('manual reclassify records audit trail', () => {
  const registry = new DataPolicyRegistry();
  const audit = registry.recordReclassification({
    taskRef: 'task-1',
    fromDataClasses: ['public'],
    toDataClasses: ['pii'],
    actorId: 'ops-1',
    correlationId: 'corr-1',
    reason: 'customer uploaded ID document',
  });
  assert.equal(audit.kind, 'data_class_reclassification');
  assert.deepEqual(audit.fromDataClasses, ['public']);
  assert.deepEqual(audit.toDataClasses, ['pii']);
  assert.equal(registry.listReclassifications().length, 1);

  assert.throws(
    () =>
      reclassifyDataClass({
        taskRef: 't',
        fromDataClasses: ['public'],
        toDataClasses: ['pii'],
        actorId: 'a',
        correlationId: 'c',
        reason: '   ',
      }),
    /non-empty reason/,
  );
});

test('front data processing level copy never leaks vendor identity', () => {
  const protectedView = projectDataProcessingLevel(['medical-health']);
  assert.equal(protectedView.level, 'protected');
  assert.equal(protectedView.protectedChannel, true);
  assert.match(protectedView.copy, /受保护通道|数据处理/);
  assert.doesNotMatch(protectedView.copy, /openai|anthropic|qwen|vendor|供应商身份泄露/i);
  // Must not embed deployment/provider ids.
  assert.doesNotMatch(protectedView.copy, /openai-direct|qwen-direct/);

  const standard = projectDataProcessingLevel([]);
  assert.equal(standard.level, 'standard');
  assert.equal(standard.protectedChannel, false);
  assert.deepEqual(normalizeRequestedDataClasses([]), ['public']);
});

test('DataPolicyRegistry publishes public contract view', () => {
  const registry = new DataPolicyRegistry();
  const record = registry.create(
    {
      sourceTrustLevel: 'platform_verified',
      processingRegion: 'domestic',
      retentionTrainingSubprocessor: 'sub-a',
      allowedDataClasses: ['public', 'contains_face'],
      dualApprovalRequiredFor: ['contains_face'],
    },
    { actorId: 'admin', correlationId: 'c1', reason: 'seed' },
  );
  const pub = toPublicDataPolicyRevision(record);
  assert.equal(pub.processingRegion, 'domestic');
  assert.deepEqual(pub.allowedDataClasses, ['public', 'contains_face']);
  assert.match(pub.revisionId, /^data-policy:r/);
});

test('planning integrates DataPolicy dual-approval for medical content sensitivity', () => {
  const registry = new DataPolicyRegistry();
  const dp = registry.create({
    sourceTrustLevel: 'platform_verified',
    processingRegion: 'domestic',
    allowedDataClasses: ['public', 'medical', 'medical-health'],
    dualApprovalRequiredFor: ['medical', 'medical-health'],
  });

  const denied = planModelSupplyCandidatesWithDataPolicy({
    catalog: {
      modelById: new Map(models.map((m) => [m.id, m])),
      deployments: [domestic, overseas],
    },
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: ['medical-health'],
    dataPolicyByDeploymentId: new Map([
      [
        domestic.id,
        {
          deploymentId: domestic.id,
          dataPolicyRevisionId: dp.id,
          dataPolicy: dp.payload,
          dualApproval: { contractApproved: true, technicalApproved: false },
        },
      ],
      [
        overseas.id,
        {
          deploymentId: overseas.id,
          dataPolicyRevisionId: dp.id,
          dataPolicy: dp.payload,
          dualApproval: { contractApproved: true, technicalApproved: true },
        },
      ],
    ]),
    applyThreeLayerRanking: false,
  });
  // Domestic fails dual approval; overseas fails regional medical hard ceiling.
  assert.equal(denied.plan.candidates.length, 0);
  assert.equal(denied.failClosed, true);

  const allowed = planModelSupplyCandidatesWithDataPolicy({
    catalog: {
      modelById: new Map(models.map((m) => [m.id, m])),
      deployments: [domestic, overseas],
    },
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-domestic' },
    dataClass: ['medical-health'],
    dataPolicyByDeploymentId: new Map([
      [
        domestic.id,
        {
          deploymentId: domestic.id,
          dataPolicyRevisionId: dp.id,
          dataPolicy: dp.payload,
          dualApproval: { contractApproved: true, technicalApproved: true },
        },
      ],
    ]),
    applyThreeLayerRanking: false,
  });
  assert.deepEqual(
    allowed.plan.candidates.map((c) => c.deployment.id),
    ['qwen-direct'],
  );
  assert.equal(allowed.failClosed, false);
});
