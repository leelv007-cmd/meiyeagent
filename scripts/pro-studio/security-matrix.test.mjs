import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  resolveRepositoryEvidencePath,
  securityArtifactDigest,
  validateSecurityMatrixReleaseStatus,
  verifySecurityManifest,
} from './security-matrix.mjs';

const CONTROL_IDS = [
  'cross_workspace_idor',
  'forged_provider_routing',
  'idempotency_replay_conflict',
  'async_billing_settlement',
  'provider_reference_grant',
  'dns_redirect_ssrf',
  'agent_allowlist_authorization',
  'dual_session_cas',
  'browser_cache_isolation',
];

function evidence(type, overrides = {}) {
  return {
    command: 'node --test security.test.mjs',
    path: 'security.test.mjs',
    status: 'passed',
    type,
    ...overrides,
  };
}

function partialManifest() {
  const controls = CONTROL_IDS.map((id) => ({
    evidence: [evidence('unit')],
    id,
  }));
  controls[0].objectKinds = [
    'project',
    'revision',
    'asset',
    'job',
    'package',
    'grant',
    'confirmation',
  ];
  controls[0].rejectionAuditStatus = 'passed';
  controls[0].rejectionAuditEvidence = {
    adapterMode: 'fixture',
    command:
      'pnpm --dir mkfast-template-main exec playwright test tests/e2e/specs/pro-studio-security-boundaries.spec.ts --project=chromium',
    durableStore: 'pro_studio_audit_events',
    environment: 'local',
    grantMode: 'disabled_no_grant',
    objectKinds: [
      'project',
      'revision',
      'asset',
      'job',
      'package',
      'grant',
      'confirmation',
    ],
    opaqueNotFound: true,
    path: 'security.test.mjs',
    productionEquivalent: false,
    rawTargetIdsPersisted: false,
    status: 'passed',
    type: 'fixture_real_service',
    zeroBusinessSideEffects: true,
  };
  controls[0].evidence.push(
    evidence('fixture_real_service', {
      adapterMode: 'fixture',
      environment: 'local',
      productionEquivalent: false,
    })
  );
  controls[4].mode = 'disabled_no_grant';
  controls[4].evidence.push(
    evidence('production_drill', {
      adapterMode: 'production',
      environment: 'production',
      productionEquivalent: true,
      scope: 'provider_reference_transport_only',
    })
  );
  controls[7].evidence.push(
    evidence('fixture_real_service', {
      adapterMode: 'fixture',
      environment: 'local',
      productionEquivalent: false,
    })
  );
  controls[8].evidence.push(
    evidence('fixture_real_service', {
      adapterMode: 'fixture',
      environment: 'local',
      productionEquivalent: false,
    })
  );

  return {
    controls,
    matrixId: 'pro-studio-ticket-25',
    releaseGates: [
      {
        covers: CONTROL_IDS,
        environment: 'production',
        id: 'production_security_drill',
        scope: 'full_security_matrix',
        status: 'missing',
        type: 'production_drill',
      },
      {
        covers: CONTROL_IDS,
        id: 'manual_security_approval',
        status: 'missing',
        type: 'manual_approval',
      },
    ],
    schemaVersion: 1,
  };
}

function productionArtifact() {
  return {
    adapterMode: 'production',
    commitSha: 'a'.repeat(40),
    completedAt: '2026-07-16T11:00:00.000Z',
    controls: CONTROL_IDS.map((id) => ({ id, status: 'passed' })),
    deploymentId: 'pro-studio-production',
    environment: 'production',
    productionEquivalent: true,
    redacted: true,
    runId: 'production-security-run-1',
    schemaVersion: 1,
    secretsPersisted: false,
    testPlanDigest: 'b'.repeat(64),
  };
}

function approvalArtifact(decision = 'approved') {
  return {
    approvalId: 'security-approval-25',
    approvalSystem: 'protected_release_approval',
    approvedAt: '2026-07-16T12:00:00.000Z',
    approvedBy: 'security-owner',
    decision,
    productionDrillRunId: 'production-security-run-1',
    schemaVersion: 1,
  };
}

test('production drill and manual approval remain fail-closed after lower-tier evidence passes', () => {
  const verification = verifySecurityManifest(partialManifest(), {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      grantDecision: 'no_grant_required_direct_upload',
      grantEndpoint: null,
      grantUrlsProduced: false,
      releaseScope: 'verified_provider_model_operation_transport_tuple_only',
    }),
  });

  assert.equal(verification.status, 'partial');
  assert.deepEqual(verification.errors, []);
  assert.deepEqual(verification.blockers, [
    'production_security_drill: production_drill evidence is missing',
    'manual_security_approval: manual_approval evidence is missing',
  ]);
});

test('malformed control and release-gate collections return a machine-readable failure', () => {
  const verification = verifySecurityManifest({
    controls: {},
    matrixId: 'pro-studio-ticket-25',
    releaseGates: {},
    schemaVersion: 1,
  });

  assert.equal(verification.status, 'failed');
  assert.ok(verification.errors.includes('controls: array is required'));
  assert.ok(verification.errors.includes('releaseGates: array is required'));
});

test('repository evidence paths reject traversal and symlink escapes', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'security-matrix-'));
  const repository = join(temporary, 'repository');
  const outside = join(temporary, 'outside.json');
  mkdirSync(repository);
  writeFileSync(outside, '{}');
  symlinkSync(outside, join(repository, 'outside-link.json'));

  try {
    assert.throws(
      () => resolveRepositoryEvidencePath(repository, '../outside.json'),
      /must stay inside the repository/
    );
    assert.throws(
      () => resolveRepositoryEvidencePath(repository, outside),
      /must be repository-relative/
    );
    assert.throws(
      () => resolveRepositoryEvidencePath(repository, 'outside-link.json'),
      /must stay inside the repository/
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

test('cross-workspace rejection evidence cannot pass without rejection audit coverage', () => {
  const manifest = partialManifest();
  manifest.controls[0].rejectionAuditStatus = 'missing';

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      grantDecision: 'no_grant_required_direct_upload',
      grantEndpoint: null,
      grantUrlsProduced: false,
      releaseScope: 'verified_provider_model_operation_transport_tuple_only',
    }),
  });

  assert.equal(verification.status, 'partial');
  assert.ok(
    verification.blockers.includes(
      'cross_workspace_idor: rejection audit evidence is missing'
    )
  );
});

test('cross-workspace rejection audit status cannot self-attest without complete durable per-kind evidence', () => {
  const manifest = partialManifest();
  delete manifest.controls[0].rejectionAuditEvidence;

  const missing = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      grantDecision: 'no_grant_required_direct_upload',
      grantEndpoint: null,
      grantUrlsProduced: false,
      releaseScope: 'verified_provider_model_operation_transport_tuple_only',
    }),
  });

  assert.equal(missing.status, 'failed');
  assert.ok(
    missing.errors.includes(
      'cross_workspace_idor: complete durable rejection audit evidence is required'
    )
  );

  const incomplete = partialManifest();
  incomplete.controls[0].rejectionAuditEvidence.objectKinds = [
    'project',
    'revision',
    'asset',
    'job',
    'package',
    'confirmation',
  ];
  const verification = verifySecurityManifest(incomplete, {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      grantDecision: 'no_grant_required_direct_upload',
      grantEndpoint: null,
      grantUrlsProduced: false,
      releaseScope: 'verified_provider_model_operation_transport_tuple_only',
    }),
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'cross_workspace_idor: rejection audit evidence must cover project, revision, asset, job, package, grant, confirmation'
    )
  );
});

test('enabled grants require complete expiry and revocation lifecycle evidence', () => {
  const manifest = partialManifest();
  manifest.controls[4].mode = 'enabled_short_lived';
  manifest.controls[4].evidence[1].scope =
    'provider_reference_grant_lifecycle';

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      cacheControlNoStorePassed: true,
      expiryPassed: true,
      mode: 'enabled_short_lived',
      rightsRevocationPassed: true,
      schemaVersion: 1,
      taskWorkspaceBindingPassed: true,
    }),
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'provider_reference_grant: enabled branch lacks complete expiry and revocation evidence'
    )
  );
});

test('an unreadable scoped grant artifact fails closed without throwing', () => {
  const verification = verifySecurityManifest(partialManifest(), {
    evidenceExists: () => true,
    readEvidenceJson: () => {
      throw new SyntaxError('invalid JSON');
    },
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'provider_reference_grant: scoped production evidence artifact is unreadable'
    )
  );
});

test('duplicate or unexpected release gates fail the frozen matrix', () => {
  const manifest = partialManifest();
  manifest.releaseGates.push(
    { ...manifest.releaseGates[0] },
    {
      covers: CONTROL_IDS,
      id: 'fixture_security_approval',
      status: 'missing',
      type: 'manual_approval',
    }
  );

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      grantDecision: 'no_grant_required_direct_upload',
      grantEndpoint: null,
      grantUrlsProduced: false,
      releaseScope: 'verified_provider_model_operation_transport_tuple_only',
    }),
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'production_security_drill: release gate is duplicated'
    )
  );
  assert.ok(
    verification.errors.includes(
      'fixture_security_approval: release gate is not part of the frozen Ticket 25 matrix'
    )
  );
});

test('fixture real-service evidence cannot be promoted to a production drill', () => {
  const manifest = partialManifest();
  manifest.releaseGates[0] = {
    ...manifest.releaseGates[0],
    adapterMode: 'fixture',
    command: 'playwright test pro-studio-security-boundaries.spec.ts',
    environment: 'production',
    path: 'fixture-security-report.json',
    productionEquivalent: false,
    status: 'passed',
  };

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      grantDecision: 'no_grant_required_direct_upload',
      grantEndpoint: null,
      grantUrlsProduced: false,
      releaseScope: 'verified_provider_model_operation_transport_tuple_only',
    }),
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'production_security_drill: production drill requires the production adapter and production-equivalent evidence'
    )
  );
});

test('production metadata cannot promote a fixture report artifact', () => {
  const manifest = partialManifest();
  manifest.releaseGates[0] = {
    ...manifest.releaseGates[0],
    adapterMode: 'production',
    command: 'playwright test production-security-matrix.spec.ts',
    path: 'production-security-report.json',
    productionEquivalent: true,
    status: 'passed',
  };

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: (path) =>
      path === 'production-security-report.json'
        ? {
            adapterMode: 'fixture',
            environment: 'local',
            productionEquivalent: false,
          }
        : {
            grantDecision: 'no_grant_required_direct_upload',
            grantEndpoint: null,
            grantUrlsProduced: false,
            releaseScope:
              'verified_provider_model_operation_transport_tuple_only',
          },
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'production_security_drill: evidence artifact must be a redacted production run covering every control'
    )
  );
});

test('manual approval cannot pass without an explicit approver and decision record', () => {
  const manifest = partialManifest();
  manifest.releaseGates[0] = {
    ...manifest.releaseGates[0],
    adapterMode: 'production',
    command: 'playwright test production-security-matrix.spec.ts',
    path: 'production-security-report.json',
    productionEquivalent: true,
    status: 'passed',
  };
  manifest.releaseGates[1] = {
    ...manifest.releaseGates[1],
    path: 'manual-security-approval.json',
    status: 'passed',
  };

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: () => ({
      grantDecision: 'no_grant_required_direct_upload',
      grantEndpoint: null,
      grantUrlsProduced: false,
      releaseScope: 'verified_provider_model_operation_transport_tuple_only',
    }),
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'manual_security_approval: passed approval requires decision=approved, approvedBy, and approvedAt'
    )
  );
});

test('manual approval metadata cannot override a rejected approval artifact', () => {
  const manifest = partialManifest();
  manifest.releaseGates[0] = {
    ...manifest.releaseGates[0],
    adapterMode: 'production',
    command: 'playwright test production-security-matrix.spec.ts',
    path: 'production-security-report.json',
    productionEquivalent: true,
    status: 'passed',
  };
  manifest.releaseGates[1] = {
    ...manifest.releaseGates[1],
    approvedAt: '2026-07-16T12:00:00.000Z',
    approvedBy: 'security-owner',
    decision: 'approved',
    path: 'manual-security-approval.json',
    status: 'passed',
  };

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: (path) => {
      if (path === 'production-security-report.json') return productionArtifact();
      if (path === 'manual-security-approval.json') {
        return approvalArtifact('rejected');
      }
      return {
        grantDecision: 'no_grant_required_direct_upload',
        grantEndpoint: null,
        grantUrlsProduced: false,
        releaseScope: 'verified_provider_model_operation_transport_tuple_only',
      };
    },
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'manual_security_approval: approval artifact must approve the verified production drill'
    )
  );
});

test('self-declared production and approval receipts cannot satisfy release trust', () => {
  const manifest = partialManifest();
  manifest.releaseGates[0] = {
    ...manifest.releaseGates[0],
    adapterMode: 'production',
    command: 'playwright test production-security-matrix.spec.ts',
    path: 'production-security-report.json',
    productionEquivalent: true,
    status: 'passed',
  };
  manifest.releaseGates[1] = {
    ...manifest.releaseGates[1],
    approvedAt: '2026-07-16T12:00:00.000Z',
    approvedBy: 'security-owner',
    decision: 'approved',
    path: 'manual-security-approval.json',
    status: 'passed',
  };

  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: (path) =>
      path === 'production-security-report.json'
        ? productionArtifact()
        : path === 'manual-security-approval.json'
          ? approvalArtifact()
          : {
              grantDecision: 'no_grant_required_direct_upload',
              grantEndpoint: null,
              grantUrlsProduced: false,
              releaseScope:
                'verified_provider_model_operation_transport_tuple_only',
            },
  });

  assert.equal(verification.status, 'failed');
  assert.ok(
    verification.errors.includes(
      'production_security_drill: trusted receipt digest is required'
    )
  );
  assert.ok(
    verification.errors.includes(
      'manual_security_approval: trusted receipt digest is required'
    )
  );
});

test('the gate passes only with complete production evidence and its bound approval', () => {
  const manifest = partialManifest();
  manifest.releaseGates[0] = {
    ...manifest.releaseGates[0],
    adapterMode: 'production',
    command: 'playwright test production-security-matrix.spec.ts',
    path: 'production-security-report.json',
    productionEquivalent: true,
    status: 'passed',
  };
  manifest.releaseGates[1] = {
    ...manifest.releaseGates[1],
    approvedAt: '2026-07-16T12:00:00.000Z',
    approvedBy: 'security-owner',
    decision: 'approved',
    path: 'manual-security-approval.json',
    status: 'passed',
  };

  const productionReceipt = productionArtifact();
  const approvalReceipt = approvalArtifact();
  const verification = verifySecurityManifest(manifest, {
    evidenceExists: () => true,
    readEvidenceJson: (path) => {
      if (path === 'production-security-report.json') return productionReceipt;
      if (path === 'manual-security-approval.json') {
        return approvalReceipt;
      }
      return {
        grantDecision: 'no_grant_required_direct_upload',
        grantEndpoint: null,
        grantUrlsProduced: false,
        releaseScope: 'verified_provider_model_operation_transport_tuple_only',
      };
    },
    trustedReceiptDigests: {
      manual_security_approval: securityArtifactDigest(approvalReceipt),
      production_security_drill: securityArtifactDigest(productionReceipt),
    },
  });

  assert.deepEqual(verification, {
    blockers: [],
    errors: [],
    status: 'passed',
  });
});

test('release evidence cannot claim passed while the security manifest is partial', () => {
  assert.deepEqual(
    validateSecurityMatrixReleaseStatus(
      { securityMatrix: { status: 'passed' } },
      { blockers: ['production drill missing'], errors: [], status: 'partial' }
    ),
    [
      'securityMatrix: release evidence status passed does not match computed partial',
    ]
  );
});

test('the checked-in Ticket 25 manifest reports only the real current evidence level', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/evidence/pro-studio/security-manifest.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const verification = verifySecurityManifest(manifest, {
    evidenceExists: (path) =>
      existsSync(new URL(`../../${path}`, import.meta.url)),
    readEvidenceJson: (path) =>
      JSON.parse(
        readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
      ),
  });

  assert.equal(verification.status, 'partial');
  assert.deepEqual(verification.errors, []);
  assert.deepEqual(verification.blockers, [
    'production_security_drill: production_drill evidence is missing',
    'manual_security_approval: manual_approval evidence is missing',
  ]);
});
