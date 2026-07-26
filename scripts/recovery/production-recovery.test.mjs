import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_RECOVERY_FAILURE_SCENARIOS,
  REQUIRED_RECOVERY_INVARIANTS,
  verifyProductionRecoveryManifest,
} from './production-recovery.mjs';
import {
  expectedEnvironmentForPath,
  productionRecoveryCliUsage,
  runProductionRecoveryCli,
} from './production-recovery-cli.mjs';

function createCompleteFixture() {
  const root = mkdtempSync(join(tmpdir(), 'n2-production-recovery-'));
  const evidenceDirectory = join(
    root,
    'docs/evidence/n2-recovery/drills/drill-2026-07-16'
  );
  mkdirSync(evidenceDirectory, { recursive: true });

  const drillId = 'drill-2026-07-16';
  const recoveryPoint = '2026-07-16T01:45:00.000Z';
  const isolatedEnvironment = 'recovery-isolated-drill-2026-07-16';

  function artifact(name, contents) {
    const path = `docs/evidence/n2-recovery/drills/drill-2026-07-16/${name}`;
    writeFileSync(join(root, path), contents);
    return {
      path,
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  }

  function typedArtifact(name, kind, data = {}) {
    return artifact(
      name,
      `${JSON.stringify({
        schemaVersion: 1,
        kind,
        drillId,
        recoveryPoint,
        sourceEnvironment: 'production',
        isolatedEnvironment,
        provider: 'test-recovery-provider',
        receiptId: `receipt-${name}`,
        provenance: 'production-recovery-drill',
        data,
      })}\n`
    );
  }

  const objectEntries = [
    {
      key: 'assets/a.png',
      versionId: 'version-a',
      sha256: '1'.repeat(64),
      sizeBytes: 10,
    },
    {
      key: 'assets/b.png',
      versionId: 'version-b',
      sha256: '2'.repeat(64),
      sizeBytes: 20,
    },
  ];
  const recordEntries = [
    { id: 'record-a', sha256: '3'.repeat(64) },
    { id: 'record-b', sha256: '4'.repeat(64) },
  ];
  const digestRecords = (records) =>
    createHash('sha256')
      .update(
        JSON.stringify([...records].sort((a, b) => a.id.localeCompare(b.id)))
      )
      .digest('hex');
  const digestObjects = (objects) =>
    createHash('sha256')
      .update(
        JSON.stringify(
          [...objects].sort((a, b) =>
            `${a.key}\0${a.versionId}`.localeCompare(`${b.key}\0${b.versionId}`)
          )
        )
      )
      .digest('hex');
  const objectDigest = digestObjects(objectEntries);
  const factDigest = digestRecords(recordEntries);
  const failureScenarios = REQUIRED_RECOVERY_FAILURE_SCENARIOS.map(
    (scenarioId, index) => ({
      scenarioId,
      injectedCondition: `injected-${scenarioId}`,
      expectedResult: 'blocked',
      observedResult: 'blocked',
      instanceId: `recovery-instance-${index + 1}`,
      injectedAt: '2026-07-16T02:30:00.000Z',
      destroyedAt: '2026-07-16T02:35:00.000Z',
    })
  );
  const invariants = Object.fromEntries(
    REQUIRED_RECOVERY_INVARIANTS.map((id) => [
      id,
      {
        status: 'passed',
        sourceCount: 2,
        restoredCount: 2,
        sourceDigest: factDigest,
        restoredDigest: factDigest,
        evidence: typedArtifact(
          `invariant-${id}.json`,
          'recovery-invariant-report',
          {
            invariantId: id,
            sourceRecords: recordEntries,
            restoredRecords: recordEntries,
          }
        ),
      },
    ])
  );

  return {
    root,
    manifest: {
      schemaVersion: 1,
      status: 'passed',
      drill: {
        id: drillId,
        kind: 'production-recovery',
        sourceEnvironment: 'production',
        isolatedEnvironment,
        startedAt: '2026-07-16T02:00:00.000Z',
        verifiedAt: '2026-07-16T02:40:00.000Z',
        incidentReferenceTime: '2026-07-16T02:00:00.000Z',
        recoveryPoint,
        targetsDeclaredAt: '2026-07-16T01:30:00.000Z',
        declaredRpoMinutes: 30,
        declaredRtoMinutes: 60,
        evidence: typedArtifact(
          'production-recovery-drill.json',
          'production-recovery-drill-receipt',
          {
            targetsDeclaredAt: '2026-07-16T01:30:00.000Z',
            startedAt: '2026-07-16T02:00:00.000Z',
            verifiedAt: '2026-07-16T02:40:00.000Z',
            incidentReferenceTime: '2026-07-16T02:00:00.000Z',
            recoveryPoint,
            declaredRpoMinutes: 30,
            declaredRtoMinutes: 60,
            observedRpoMinutes: 15,
            observedRtoMinutes: 40,
          }
        ),
      },
      postgres: {
        method: 'postgresql-pitr',
        recoveryPoint,
        evidence: typedArtifact(
          'postgres-pitr.json',
          'postgresql-pitr-receipt',
          {
            restoreId: 'restore-2026-07-16',
            walRange: '000000010000000000000001-000000010000000000000002',
          }
        ),
      },
      objects: {
        format: 'object-hash-version-inventory/v1',
        versioningEnabled: true,
        recoveryPoint,
        sourceCount: 2,
        restoredCount: 2,
        sourceDigest: objectDigest,
        restoredDigest: objectDigest,
        sourceInventory: typedArtifact(
          'objects-source.json',
          'object-version-inventory',
          { inventoryRole: 'source', entries: objectEntries }
        ),
        restoredInventory: typedArtifact(
          'objects-restored.json',
          'object-version-inventory',
          { inventoryRole: 'restored', entries: objectEntries }
        ),
      },
      schema: {
        revision: 'schema-2026-07-16.1',
        artifact: typedArtifact('schema.json', 'schema-revision-artifact', {
          revision: 'schema-2026-07-16.1',
          immutableSnapshotRef: 'snapshot://production/schema/2026-07-16.1',
        }),
      },
      configuration: {
        revision: 'config-2026-07-16.1',
        artifact: typedArtifact(
          'configuration.json',
          'configuration-revision-artifact',
          { revision: 'config-2026-07-16.1' }
        ),
      },
      secrets: {
        mode: 'secretref-kms',
        kmsKeyRef: 'kms://production/recovery-key',
        secretRefs: ['secretref://production/model-provider'],
        valuesIncluded: false,
        restorationEvidence: typedArtifact(
          'secret-restoration.json',
          'secretref-kms-restoration-receipt',
          {
            kmsKeyRef: 'kms://production/recovery-key',
            secretRefs: ['secretref://production/model-provider'],
            valuesIncluded: false,
          }
        ),
      },
      isolation: {
        sourceWriteAccess: 'denied',
        productionTraffic: 'blocked',
        restoreEvidence: typedArtifact(
          'isolated-restore.json',
          'isolated-restore-receipt',
          { sourceWriteAccess: 'denied', productionTraffic: 'blocked' }
        ),
      },
      invariants,
      baseline: {
        snapshotId: 'snapshot-2026-07-16-0145',
        immutable: true,
        capturedAt: recoveryPoint,
        postgresSnapshotRef: 'snapshot://production/postgres/2026-07-16-0145',
        schemaRevision: 'schema-2026-07-16.1',
        objectInventoryDigest: objectDigest,
        evidence: typedArtifact(
          'immutable-baseline.json',
          'immutable-recovery-baseline',
          {
            snapshotId: 'snapshot-2026-07-16-0145',
            immutable: true,
            capturedAt: recoveryPoint,
            postgresSnapshotRef:
              'snapshot://production/postgres/2026-07-16-0145',
            schemaRevision: 'schema-2026-07-16.1',
            objectInventoryDigest: objectDigest,
          }
        ),
      },
      operations: {
        owner: 'production-platform',
        onCall: 'oncall://production-platform',
        cadence: 'quarterly',
        regionFailureIncluded: true,
        lastDrillAt: '2026-07-16T02:40:00.000Z',
        nextDrillDueAt: '2026-10-14T02:40:00.000Z',
        evidenceRetentionDays: 365,
        failedInstanceDeletionHours: 24,
        evidence: typedArtifact(
          'recovery-operations-policy.json',
          'recovery-operations-policy',
          {
            owner: 'production-platform',
            onCall: 'oncall://production-platform',
            cadence: 'quarterly',
            regionFailureIncluded: true,
            lastDrillAt: '2026-07-16T02:40:00.000Z',
            nextDrillDueAt: '2026-10-14T02:40:00.000Z',
            evidenceRetentionDays: 365,
            failedInstanceDeletionHours: 24,
          }
        ),
      },
      credentialInvalidation: {
        oldCredentialsRejected: true,
        evidence: typedArtifact(
          'credential-invalidation.json',
          'credential-invalidation-receipt',
          {
            oldCredentialsRejected: true,
            rotations: [
              {
                secretRef: 'secretref://production/model-provider',
                oldVersionRef:
                  'secretversion://production/model-provider/version-1',
                newVersionRef:
                  'secretversion://production/model-provider/version-2',
                rejectedAt: '2026-07-16T02:36:00.000Z',
                rejectionCode: 'AUTHENTICATION_REJECTED',
              },
            ],
          }
        ),
      },
      failureScenarios: {
        scenarios: failureScenarios,
        evidence: typedArtifact(
          'recovery-failure-scenarios.json',
          'recovery-failure-scenario-report',
          { scenarios: failureScenarios }
        ),
      },
      failureDisposal: {
        injectedFailureInstanceDestroyed: true,
        evidence: typedArtifact(
          'failed-instance-destruction.json',
          'failed-instance-destruction-receipt',
          {
            injectedFailureInstanceDestroyed: true,
            destroyedInstanceIds: failureScenarios.map(
              (scenario) => scenario.instanceId
            ),
          }
        ),
      },
      blockers: [],
    },
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
  };
}

const verificationNow = '2026-07-16T03:00:00.000Z';

function verifyFixture(fixture) {
  return verifyProductionRecoveryManifest(fixture.manifest, {
    root: fixture.root,
    now: verificationNow,
  });
}

function rewriteArtifact(fixture, artifact, update) {
  const absolute = join(fixture.root, artifact.path);
  const current = JSON.parse(readFileSync(absolute, 'utf8'));
  const next = update(current);
  const contents = `${JSON.stringify(next)}\n`;
  writeFileSync(absolute, contents);
  artifact.sha256 = createHash('sha256').update(contents).digest('hex');
}

function assertFailedWith(result, expectedIssues) {
  assert.equal(result.status, 'failed');
  for (const issue of expectedIssues) {
    assert.ok(result.issues.includes(issue), `missing issue: ${issue}`);
  }
}

test('production recovery manifest passes only with complete drill evidence', () => {
  const fixture = createCompleteFixture();
  try {
    assert.deepEqual(verifyFixture(fixture), {
      status: 'passed',
      issues: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test('typed evidence is parsed, bound to the drill, and recomputed', () => {
  const fixture = createCompleteFixture();
  try {
    rewriteArtifact(fixture, fixture.manifest.postgres.evidence, (receipt) => ({
      ...receipt,
      provenance: 'migration-cutover',
    }));
    rewriteArtifact(
      fixture,
      fixture.manifest.objects.sourceInventory,
      (inventory) => ({
        ...inventory,
        data: {
          ...inventory.data,
          entries: inventory.data.entries.slice(0, 1),
        },
      })
    );
    rewriteArtifact(
      fixture,
      fixture.manifest.invariants.asset.evidence,
      (report) => ({
        ...report,
        data: {
          ...report.data,
          restoredRecords: report.data.restoredRecords.slice(0, 1),
        },
      })
    );

    assertFailedWith(verifyFixture(fixture), [
      'postgres.evidence.provenance: production-recovery-drill is required',
      'objects.sourceInventory: manifest count does not match typed inventory',
      'objects.sourceInventory: manifest digest does not match typed inventory',
      'invariants.asset.evidence: restored count does not match typed report',
      'invariants.asset.evidence: restored digest does not match typed report',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('RPO and RTO targets are predeclared and the drill cannot be in the future', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.drill.targetsDeclaredAt = '2026-07-16T02:01:00.000Z';
    fixture.manifest.drill.verifiedAt = '2026-07-16T03:01:00.000Z';
    rewriteArtifact(fixture, fixture.manifest.drill.evidence, (receipt) => ({
      ...receipt,
      data: { ...receipt.data, declaredRpoMinutes: 999 },
    }));

    assertFailedWith(verifyFixture(fixture), [
      'drill.targetsDeclaredAt: must be at or before startedAt',
      'drill.verifiedAt: cannot be in the future',
      'drill.evidence.data.declaredRpoMinutes: must equal manifest contract',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('all required failure scenarios are blocked and their instances destroyed', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.failureScenarios.scenarios.pop();
    fixture.manifest.failureScenarios.scenarios[0].observedResult = 'allowed';
    fixture.manifest.failureScenarios.scenarios[0].injectedAt =
      '2026-07-16T02:51:00.000Z';
    fixture.manifest.failureScenarios.scenarios[1].destroyedAt =
      '2026-07-16T03:01:00.000Z';

    assertFailedWith(verifyFixture(fixture), [
      'failureScenarios.regional-failure: required scenario is missing',
      'failureScenarios.db-object-time-skew.observedResult: blocked is required',
      'failureScenarios.db-object-time-skew.destroyedAt: must be at or after injectedAt',
      'failureScenarios.missing-orphan-object.destroyedAt: cannot be in the future',
      'failureScenarios.evidence.data.scenarios: must equal manifest contract',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('public evidence rejects secret-shaped fields and duplicate facts', () => {
  const fixture = createCompleteFixture();
  try {
    rewriteArtifact(
      fixture,
      fixture.manifest.secrets.restorationEvidence,
      (receipt) => ({
        ...receipt,
        ['api' + 'Key']: 'redacted-test-value',
        data: {
          ...receipt.data,
          ['plaintext' + 'Secret']: 'redacted-test-value',
        },
      })
    );
    rewriteArtifact(
      fixture,
      fixture.manifest.objects.sourceInventory,
      (inventory) => ({
        ...inventory,
        data: {
          ...inventory.data,
          entries: [...inventory.data.entries, inventory.data.entries[0]],
        },
      })
    );
    rewriteArtifact(
      fixture,
      fixture.manifest.invariants.asset.evidence,
      (report) => ({
        ...report,
        data: {
          ...report.data,
          sourceRecords: [
            ...report.data.sourceRecords,
            report.data.sourceRecords[0],
          ],
        },
      })
    );
    fixture.manifest.secrets.secretRefs = 'secretref://invalid-shape';

    assertFailedWith(verifyFixture(fixture), [
      'secrets.secretRefs: an array of SecretRef values is required',
      'secrets.restorationEvidence.apiKey: field is not allowed',
      'secrets.restorationEvidence.data.plaintextSecret: field is not allowed',
      'objects.sourceInventory.data.entries: duplicate object version entry',
      'invariants.asset.evidence.data.sourceRecords: duplicate invariant record',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('credential invalidation covers every restored SecretRef without values', () => {
  const fixture = createCompleteFixture();
  try {
    rewriteArtifact(
      fixture,
      fixture.manifest.credentialInvalidation.evidence,
      (receipt) => ({
        ...receipt,
        data: {
          ...receipt.data,
          rotations: [
            {
              ...receipt.data.rotations[0],
              secretRef: 'secretref://production/unrelated',
              newVersionRef: receipt.data.rotations[0].oldVersionRef,
              rejectionCode: 'ACCEPTED',
            },
          ],
        },
      })
    );

    assertFailedWith(verifyFixture(fixture), [
      'credentialInvalidation.evidence.data.rotations: must cover every restored SecretRef',
      'credentialInvalidation.evidence.data.rotations[0].newVersionRef: must differ from oldVersionRef',
      'credentialInvalidation.evidence.data.rotations[0].rejectionCode: AUTHENTICATION_REJECTED is required',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('immutable baseline and current operational ownership are release gates', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.baseline.immutable = false;
    fixture.manifest.baseline.schemaRevision = 'stale-schema';
    fixture.manifest.baseline.objectInventoryDigest = '0'.repeat(64);
    rewriteArtifact(
      fixture,
      fixture.manifest.baseline.evidence,
      (baseline) => ({
        ...baseline,
        data: {
          ...baseline.data,
          capturedAt: '2026-07-16T01:44:00.000Z',
        },
      })
    );
    fixture.manifest.operations.owner = '';
    fixture.manifest.operations.onCall = '';
    fixture.manifest.operations.cadence = 'annual';
    fixture.manifest.operations.regionFailureIncluded = false;
    fixture.manifest.operations.nextDrillDueAt = '2026-07-16T02:59:59.000Z';
    fixture.manifest.operations.evidenceRetentionDays = 0;
    fixture.manifest.operations.failedInstanceDeletionHours = 0;
    rewriteArtifact(
      fixture,
      fixture.manifest.operations.evidence,
      (policy) => ({
        ...policy,
        data: { ...policy.data, cadence: 'monthly' },
      })
    );

    assertFailedWith(verifyFixture(fixture), [
      'baseline.immutable: true is required',
      'baseline.schemaRevision: must equal schema.revision',
      'baseline.objectInventoryDigest: must equal objects.sourceDigest',
      'baseline.evidence.data.capturedAt: must equal manifest contract',
      'operations.owner: owner is required',
      'operations.onCall: on-call reference is required',
      'operations.cadence: quarterly is required',
      'operations.regionFailureIncluded: true is required',
      'operations.nextDrillDueAt: recovery drill evidence is expired',
      'operations.evidenceRetentionDays: positive integer is required',
      'operations.failedInstanceDeletionHours: positive integer is required',
      'operations.evidence.data.cadence: must equal manifest contract',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('migration cutover evidence cannot pass as production recovery', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.drill.kind = 'migration-cutover';
    fixture.manifest.postgres.method = 'logical-backup';

    assert.deepEqual(verifyFixture(fixture), {
      status: 'failed',
      issues: [
        'drill.kind: production-recovery is required',
        'postgres.method: postgresql-pitr is required',
      ],
    });
  } finally {
    fixture.cleanup();
  }
});

test('recovery point, RPO, and RTO claims fail closed when inconsistent', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.postgres.recoveryPoint = '2026-07-16T01:44:00.000Z';
    fixture.manifest.objects.recoveryPoint = '2026-07-16T01:43:00.000Z';
    fixture.manifest.drill.incidentReferenceTime = '2026-07-16T02:30:00.000Z';
    fixture.manifest.drill.verifiedAt = '2026-07-16T03:30:00.000Z';

    assertFailedWith(verifyFixture(fixture), [
      'postgres.recoveryPoint: must equal drill.recoveryPoint',
      'objects.recoveryPoint: must equal drill.recoveryPoint',
      'drill.declaredRpoMinutes: observed recovery point exceeds 30 minutes',
      'drill.declaredRtoMinutes: observed recovery exceeds 60 minutes',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('object inventory and every domain invariant must reconcile', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.objects.format = 'object-key-list/v1';
    fixture.manifest.objects.versioningEnabled = false;
    fixture.manifest.objects.restoredCount = 3;
    fixture.manifest.objects.restoredDigest = 'b'.repeat(64);
    delete fixture.manifest.invariants.asset;
    fixture.manifest.invariants.configuration.restoredDigest = 'b'.repeat(64);

    assertFailedWith(verifyFixture(fixture), [
      'objects.format: object-hash-version-inventory/v1 is required',
      'objects.versioningEnabled: object versioning evidence is required',
      'objects: source/restored count mismatch',
      'objects: source/restored digest mismatch',
      'invariants.asset: recovery invariant is required',
      'invariants.configuration: source/restored digest mismatch',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('restore control plane requires revisioned artifacts and safe isolation', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.drill.sourceEnvironment = 'staging';
    fixture.manifest.drill.isolatedEnvironment = 'staging';
    fixture.manifest.schema.revision = '';
    fixture.manifest.configuration.revision = '';
    fixture.manifest.secrets.mode = 'plaintext';
    fixture.manifest.secrets.kmsKeyRef = '';
    fixture.manifest.secrets.secretRefs = [];
    fixture.manifest.secrets.valuesIncluded = true;
    fixture.manifest.isolation.sourceWriteAccess = 'allowed';
    fixture.manifest.isolation.productionTraffic = 'allowed';
    fixture.manifest.credentialInvalidation.oldCredentialsRejected = false;
    fixture.manifest.failureDisposal.injectedFailureInstanceDestroyed = false;
    fixture.manifest.blockers = ['production infrastructure is unavailable'];

    assertFailedWith(verifyFixture(fixture), [
      'drill.sourceEnvironment: production is required',
      'drill.isolatedEnvironment: must differ from sourceEnvironment',
      'schema.revision: schema artifact revision is required',
      'configuration.revision: configuration revision is required',
      'secrets.mode: secretref-kms is required',
      'secrets.kmsKeyRef: KMS key reference is required',
      'secrets.secretRefs: at least one SecretRef is required',
      'secrets.valuesIncluded: secret values must never be included',
      'isolation.sourceWriteAccess: denied is required',
      'isolation.productionTraffic: blocked is required',
      'credentialInvalidation.oldCredentialsRejected: evidence is required',
      'failureDisposal.injectedFailureInstanceDestroyed: evidence is required',
      'blockers: passed evidence cannot contain blockers',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('evidence artifacts stay in the redacted tree and match declared hashes', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.postgres.evidence.path = '../../.env';
    fixture.manifest.objects.sourceInventory.sha256 = '0'.repeat(64);
    fixture.manifest.objects.restoredInventory.path =
      'docs/_private/object-inventory.jsonl';
    fixture.manifest.schema.artifact = null;
    rmSync(join(fixture.root, fixture.manifest.configuration.artifact.path), {
      force: true,
    });

    assert.deepEqual(verifyFixture(fixture), {
      status: 'failed',
      issues: [
        'postgres.evidence.path: evidence must stay under docs/evidence/n2-recovery',
        'objects.sourceInventory.sha256: evidence hash does not match file',
        'objects.restoredInventory.path: evidence must stay under docs/evidence/n2-recovery',
        'schema.artifact: evidence artifact is required',
        'configuration.artifact.path: evidence file is missing',
      ],
    });
  } finally {
    fixture.cleanup();
  }
});

test('unknown recovery manifest schema versions are rejected', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.schemaVersion = 2;

    assert.deepEqual(verifyFixture(fixture), {
      status: 'failed',
      issues: ['schemaVersion: only version 1 is supported'],
    });
  } finally {
    fixture.cleanup();
  }
});

test('missing timestamps and reconciliation fields cannot pass by equality', () => {
  const fixture = createCompleteFixture();
  try {
    for (const field of [
      'recoveryPoint',
      'startedAt',
      'verifiedAt',
      'incidentReferenceTime',
      'declaredRpoMinutes',
      'declaredRtoMinutes',
    ]) {
      delete fixture.manifest.drill[field];
    }
    delete fixture.manifest.postgres.recoveryPoint;
    for (const field of [
      'recoveryPoint',
      'sourceCount',
      'restoredCount',
      'sourceDigest',
      'restoredDigest',
    ]) {
      delete fixture.manifest.objects[field];
    }
    const invariant = fixture.manifest.invariants['content-package'];
    invariant.status = 'partial';
    for (const field of [
      'sourceCount',
      'restoredCount',
      'sourceDigest',
      'restoredDigest',
    ]) {
      delete invariant[field];
    }

    assertFailedWith(verifyFixture(fixture), [
      'drill.recoveryPoint: canonical ISO timestamp is required',
      'drill.startedAt: canonical ISO timestamp is required',
      'drill.verifiedAt: canonical ISO timestamp is required',
      'drill.incidentReferenceTime: canonical ISO timestamp is required',
      'drill.declaredRpoMinutes: positive number is required',
      'drill.declaredRtoMinutes: positive number is required',
      'postgres.recoveryPoint: canonical ISO timestamp is required',
      'objects.recoveryPoint: canonical ISO timestamp is required',
      'objects.sourceCount: non-negative integer is required',
      'objects.restoredCount: non-negative integer is required',
      'objects.sourceDigest: exact sha256 is required',
      'objects.restoredDigest: exact sha256 is required',
      'invariants.content-package.status: passed is required',
      'invariants.content-package.sourceCount: non-negative integer is required',
      'invariants.content-package.restoredCount: non-negative integer is required',
      'invariants.content-package.sourceDigest: exact sha256 is required',
      'invariants.content-package.restoredDigest: exact sha256 is required',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('production recovery CLI exposes a deliberate verify-only seam', () => {
  assert.deepEqual(runProductionRecoveryCli(['--help']), {
    exitCode: 0,
    stdout: `${productionRecoveryCliUsage}\n`,
    stderr: '',
  });
  assert.deepEqual(runProductionRecoveryCli(['restore']), {
    exitCode: 1,
    stdout: '',
    stderr: 'Unknown production recovery action: restore\n',
  });
  // The drill performs a real restore, so it is only reachable through the async
  // entrypoint; the synchronous seam must never appear to have run one.
  assert.deepEqual(runProductionRecoveryCli(['drill']), {
    exitCode: 1,
    stdout: '',
    stderr:
      'The drill action performs a real restore and must run through runProductionRecoveryCliAsync.\n',
  });
});

test('production recovery CLI returns nonzero for explicit partial evidence', () => {
  const fixture = createCompleteFixture();
  const manifestPath = 'docs/evidence/n2-recovery/manifest.json';
  try {
    writeFileSync(
      join(fixture.root, manifestPath),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    );
    assert.deepEqual(
      runProductionRecoveryCli(['verify', manifestPath], {
        root: fixture.root,
        now: verificationNow,
      }),
      {
        exitCode: 0,
        stdout: `N2 production recovery evidence passed: ${manifestPath}\n`,
        stderr: '',
      }
    );

    fixture.manifest.status = 'partial';
    fixture.manifest.blockers = ['production infrastructure is unavailable'];
    writeFileSync(
      join(fixture.root, manifestPath),
      `${JSON.stringify(fixture.manifest, null, 2)}\n`
    );
    assert.deepEqual(
      runProductionRecoveryCli(['verify', manifestPath], {
        root: fixture.root,
        now: verificationNow,
      }),
      {
        exitCode: 1,
        stdout: '',
        stderr: [
          `N2 production recovery evidence is partial: ${manifestPath}`,
          '- status: production recovery evidence must be passed',
          '- blocker: production infrastructure is unavailable',
          '',
        ].join('\n'),
      }
    );
  } finally {
    fixture.cleanup();
  }
});

test('identity, time ordering, and secret references are explicit', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.status = 'green';
    fixture.manifest.drill.id = '';
    fixture.manifest.drill.isolatedEnvironment = '';
    fixture.manifest.drill.recoveryPoint = '2026-07-16T02:15:00.000Z';
    fixture.manifest.postgres.recoveryPoint =
      fixture.manifest.drill.recoveryPoint;
    fixture.manifest.objects.recoveryPoint =
      fixture.manifest.drill.recoveryPoint;
    fixture.manifest.drill.verifiedAt = '2026-07-16T01:59:00.000Z';
    fixture.manifest.secrets.kmsKeyRef = 'recovery-key';
    fixture.manifest.secrets.secretRefs = ['provider-key'];

    assertFailedWith(verifyFixture(fixture), [
      'status: passed or partial is required',
      'drill.id: recovery drill identifier is required',
      'drill.isolatedEnvironment: isolated environment is required',
      'drill.recoveryPoint: must be at or before incidentReferenceTime',
      'drill.verifiedAt: must be at or after startedAt',
      'secrets.kmsKeyRef: kms:// reference is required',
      'secrets.secretRefs: every reference must use secretref://',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('evidence cannot escape through a symlinked parent directory', () => {
  const fixture = createCompleteFixture();
  try {
    const outsideDirectory = join(fixture.root, 'outside-evidence');
    mkdirSync(outsideDirectory);
    const contents = 'outside evidence\n';
    writeFileSync(join(outsideDirectory, 'receipt.json'), contents);
    const linkPath = join(
      fixture.root,
      'docs/evidence/n2-recovery/drills/drill-2026-07-16/escape'
    );
    symlinkSync(outsideDirectory, linkPath, 'dir');
    fixture.manifest.postgres.evidence = {
      path: 'docs/evidence/n2-recovery/drills/drill-2026-07-16/escape/receipt.json',
      sha256: createHash('sha256').update(contents).digest('hex'),
    };

    assert.deepEqual(verifyFixture(fixture), {
      status: 'failed',
      issues: [
        'postgres.evidence.path: evidence must stay under docs/evidence/n2-recovery',
      ],
    });
  } finally {
    fixture.cleanup();
  }
});

const repositoryRoot = resolve(import.meta.dirname, '../..');

/** Every local recovery drill evidence set committed to the repository. */
function committedLocalDrillManifests() {
  const directory = join(repositoryRoot, 'docs/evidence/n2-recovery');
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith('local-drill-')
    )
    .map((entry) => {
      const path = `docs/evidence/n2-recovery/${entry.name}/manifest.json`;
      return {
        manifest: JSON.parse(readFileSync(join(repositoryRoot, path), 'utf8')),
        path,
      };
    });
}

test('the recovery contract a manifest must satisfy is decided by its path', () => {
  // The release rule reads the production manifest path, so what is required
  // there cannot be renegotiated by the document found there.
  assert.equal(
    expectedEnvironmentForPath('docs/evidence/n2-recovery/manifest.json', {
      environment: 'local',
    }),
    'production'
  );
  assert.equal(
    expectedEnvironmentForPath(
      'docs/evidence/n2-recovery/local-drill-2026-07-26/manifest.json',
      { environment: 'production' }
    ),
    'local'
  );
  assert.equal(
    expectedEnvironmentForPath(
      'docs/evidence/n2-recovery/drills/drill-2026-07-16/manifest.json',
      {}
    ),
    'production'
  );
});

test('local drill evidence can never stand in for production recovery evidence', () => {
  for (const { manifest } of committedLocalDrillManifests()) {
    const result = verifyProductionRecoveryManifest(manifest, {
      expectedEnvironment: 'production',
      now: manifest.operations.lastDrillAt,
      root: repositoryRoot,
    });
    assertFailedWith(result, [
      'environment: production evidence is required, manifest declares local',
      'drill.kind: production-recovery is required',
      'postgres.method: postgresql-pitr is required',
      'drill.sourceEnvironment: production is required',
      'secrets.mode: secretref-kms is required',
      'operations.onCall: on-call reference is required',
      'operations.regionFailureIncluded: true is required',
      'failureScenarios.regional-failure: required scenario is missing',
    ]);
  }
});

test('production evidence cannot declare a reduced scope', () => {
  const fixture = createCompleteFixture();
  try {
    fixture.manifest.scope = {
      infrastructure: 'local',
      notProven: ['production point-in-time recovery'],
      productionOnlyScenarios: ['regional-failure'],
      schemaSource: 'drill-fixture',
    };
    assertFailedWith(verifyFixture(fixture), [
      'scope: production evidence must not declare a reduced scope',
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('committed local drill evidence verifies at local strength', () => {
  const drills = committedLocalDrillManifests();
  assert.ok(
    drills.length > 0,
    'a local recovery drill evidence set must be committed'
  );
  for (const { manifest, path } of drills) {
    // Verified as of the drill: the evidence proves the recovery path was
    // exercised then, and the quarterly expiry is a separate operations rule.
    assert.deepEqual(
      runProductionRecoveryCli(['verify', path], {
        now: manifest.operations.lastDrillAt,
        root: repositoryRoot,
      }),
      {
        exitCode: 0,
        stdout: `N2 local recovery drill evidence passed: ${path}\n`,
        stderr: '',
      }
    );
  }
});

test('local drill evidence must declare what local infrastructure cannot prove', () => {
  const [drill] = committedLocalDrillManifests();
  const verifyMutated = (mutate) => {
    const candidate = structuredClone(drill.manifest);
    mutate(candidate);
    return verifyProductionRecoveryManifest(candidate, {
      expectedEnvironment: 'local',
      now: drill.manifest.operations.lastDrillAt,
      root: repositoryRoot,
    });
  };

  for (const [mutate, expectedIssue] of [
    [
      (manifest) => delete manifest.scope,
      'scope: local drill evidence must declare its scope',
    ],
    [
      (manifest) => {
        manifest.scope.notProven = [];
      },
      'scope.notProven: a non-empty list of unproven claims is required',
    ],
    [
      (manifest) => {
        manifest.scope.productionOnlyScenarios = [];
      },
      'scope.productionOnlyScenarios: must declare exactly ["regional-failure"]',
    ],
    [
      (manifest) => {
        manifest.scope.infrastructure = 'production';
      },
      'scope.infrastructure: local is required',
    ],
    [
      // Local evidence must not borrow production operations claims.
      (manifest) => {
        manifest.operations.onCall = 'oncall://release-engineering';
      },
      'operations.onCall: null is required for local drill evidence',
    ],
    [
      (manifest) => {
        manifest.operations.regionFailureIncluded = true;
      },
      'operations.regionFailureIncluded: false is required for local drill evidence',
    ],
    [
      (manifest) => {
        manifest.environment = 'production';
      },
      'environment: local evidence is required, manifest declares production',
    ],
  ]) {
    assertFailedWith(verifyMutated(mutate), [expectedIssue]);
  }
});
