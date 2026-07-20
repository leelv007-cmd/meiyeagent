import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const REQUIRED_RECOVERY_INVARIANTS = [
  'content-package',
  'generation-job',
  'asset',
  'product-usage-ledger',
  'provider-cost-ledger',
  'configuration',
];

export const REQUIRED_RECOVERY_FAILURE_SCENARIOS = [
  'db-object-time-skew',
  'missing-orphan-object',
  'kms-key-unavailable',
  'schema-incompatibility',
  'regional-failure',
];

const TYPED_EVIDENCE_DATA_FIELDS = {
  'production-recovery-drill-receipt': [
    'targetsDeclaredAt',
    'startedAt',
    'verifiedAt',
    'incidentReferenceTime',
    'recoveryPoint',
    'declaredRpoMinutes',
    'declaredRtoMinutes',
    'observedRpoMinutes',
    'observedRtoMinutes',
  ],
  'postgresql-pitr-receipt': ['restoreId', 'walRange'],
  'object-version-inventory': ['inventoryRole', 'entries'],
  'schema-revision-artifact': ['revision', 'immutableSnapshotRef'],
  'configuration-revision-artifact': ['revision'],
  'secretref-kms-restoration-receipt': [
    'kmsKeyRef',
    'secretRefs',
    'valuesIncluded',
  ],
  'isolated-restore-receipt': ['sourceWriteAccess', 'productionTraffic'],
  'immutable-recovery-baseline': [
    'snapshotId',
    'immutable',
    'capturedAt',
    'postgresSnapshotRef',
    'schemaRevision',
    'objectInventoryDigest',
  ],
  'recovery-operations-policy': [
    'owner',
    'onCall',
    'cadence',
    'regionFailureIncluded',
    'lastDrillAt',
    'nextDrillDueAt',
    'evidenceRetentionDays',
    'failedInstanceDeletionHours',
  ],
  'credential-invalidation-receipt': ['oldCredentialsRejected', 'rotations'],
  'recovery-failure-scenario-report': ['scenarios'],
  'failed-instance-destruction-receipt': [
    'injectedFailureInstanceDestroyed',
    'destroyedInstanceIds',
  ],
  'recovery-invariant-report': [
    'invariantId',
    'sourceRecords',
    'restoredRecords',
  ],
};

export function verifyProductionRecoveryManifest(manifest, options = {}) {
  const issues = [];
  if (manifest?.schemaVersion !== 1) {
    issues.push('schemaVersion: only version 1 is supported');
  }
  if (!['passed', 'partial'].includes(manifest?.status)) {
    issues.push('status: passed or partial is required');
  }
  if (!isNonEmptyString(manifest?.drill?.id)) {
    issues.push('drill.id: recovery drill identifier is required');
  }
  if (manifest?.drill?.kind !== 'production-recovery') {
    issues.push('drill.kind: production-recovery is required');
  }
  if (manifest?.postgres?.method !== 'postgresql-pitr') {
    issues.push('postgres.method: postgresql-pitr is required');
  }
  if (manifest?.drill?.sourceEnvironment !== 'production') {
    issues.push('drill.sourceEnvironment: production is required');
  }
  if (!isNonEmptyString(manifest?.drill?.isolatedEnvironment)) {
    issues.push('drill.isolatedEnvironment: isolated environment is required');
  } else if (
    manifest?.drill?.isolatedEnvironment === manifest?.drill?.sourceEnvironment
  ) {
    issues.push(
      'drill.isolatedEnvironment: must differ from sourceEnvironment'
    );
  }
  for (const [label, value] of [
    ['drill.recoveryPoint', manifest?.drill?.recoveryPoint],
    ['drill.targetsDeclaredAt', manifest?.drill?.targetsDeclaredAt],
    ['drill.startedAt', manifest?.drill?.startedAt],
    ['drill.verifiedAt', manifest?.drill?.verifiedAt],
    ['drill.incidentReferenceTime', manifest?.drill?.incidentReferenceTime],
  ]) {
    if (!isCanonicalIsoTimestamp(value)) {
      issues.push(`${label}: canonical ISO timestamp is required`);
    }
  }
  for (const [label, value] of [
    ['drill.declaredRpoMinutes', manifest?.drill?.declaredRpoMinutes],
    ['drill.declaredRtoMinutes', manifest?.drill?.declaredRtoMinutes],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      issues.push(`${label}: positive number is required`);
    }
  }
  if (
    Date.parse(manifest?.drill?.recoveryPoint) >
    Date.parse(manifest?.drill?.incidentReferenceTime)
  ) {
    issues.push(
      'drill.recoveryPoint: must be at or before incidentReferenceTime'
    );
  }
  if (
    Date.parse(manifest?.drill?.verifiedAt) <
    Date.parse(manifest?.drill?.startedAt)
  ) {
    issues.push('drill.verifiedAt: must be at or after startedAt');
  }
  if (
    Date.parse(manifest?.drill?.targetsDeclaredAt) >
    Date.parse(manifest?.drill?.startedAt)
  ) {
    issues.push('drill.targetsDeclaredAt: must be at or before startedAt');
  }
  const verificationTime = Date.parse(options.now ?? new Date().toISOString());
  for (const [label, value] of [
    ['drill.targetsDeclaredAt', manifest?.drill?.targetsDeclaredAt],
    ['drill.recoveryPoint', manifest?.drill?.recoveryPoint],
    ['drill.startedAt', manifest?.drill?.startedAt],
    ['drill.verifiedAt', manifest?.drill?.verifiedAt],
    ['drill.incidentReferenceTime', manifest?.drill?.incidentReferenceTime],
  ]) {
    if (
      Number.isFinite(verificationTime) &&
      isCanonicalIsoTimestamp(value) &&
      Date.parse(value) > verificationTime
    ) {
      issues.push(`${label}: cannot be in the future`);
    }
  }
  if (!isCanonicalIsoTimestamp(manifest?.postgres?.recoveryPoint)) {
    issues.push('postgres.recoveryPoint: canonical ISO timestamp is required');
  }
  if (!isCanonicalIsoTimestamp(manifest?.objects?.recoveryPoint)) {
    issues.push('objects.recoveryPoint: canonical ISO timestamp is required');
  }
  const recoveryPoint = manifest?.drill?.recoveryPoint;
  if (manifest?.postgres?.recoveryPoint !== recoveryPoint) {
    issues.push('postgres.recoveryPoint: must equal drill.recoveryPoint');
  }
  if (manifest?.objects?.recoveryPoint !== recoveryPoint) {
    issues.push('objects.recoveryPoint: must equal drill.recoveryPoint');
  }
  const observedRpoMinutes = minutesBetween(
    recoveryPoint,
    manifest?.drill?.incidentReferenceTime
  );
  if (observedRpoMinutes > manifest?.drill?.declaredRpoMinutes) {
    issues.push(
      `drill.declaredRpoMinutes: observed recovery point exceeds ${manifest.drill.declaredRpoMinutes} minutes`
    );
  }
  const observedRtoMinutes = minutesBetween(
    manifest?.drill?.startedAt,
    manifest?.drill?.verifiedAt
  );
  if (observedRtoMinutes > manifest?.drill?.declaredRtoMinutes) {
    issues.push(
      `drill.declaredRtoMinutes: observed recovery exceeds ${manifest.drill.declaredRtoMinutes} minutes`
    );
  }
  if (manifest?.objects?.format !== 'object-hash-version-inventory/v1') {
    issues.push('objects.format: object-hash-version-inventory/v1 is required');
  }
  if (manifest?.objects?.versioningEnabled !== true) {
    issues.push(
      'objects.versioningEnabled: object versioning evidence is required'
    );
  }
  issues.push(...validateReconciliationFields('objects', manifest?.objects));
  if (manifest?.objects?.sourceCount !== manifest?.objects?.restoredCount) {
    issues.push('objects: source/restored count mismatch');
  }
  if (manifest?.objects?.sourceDigest !== manifest?.objects?.restoredDigest) {
    issues.push('objects: source/restored digest mismatch');
  }
  for (const id of REQUIRED_RECOVERY_INVARIANTS) {
    const invariant = manifest?.invariants?.[id];
    if (!invariant) {
      issues.push(`invariants.${id}: recovery invariant is required`);
      continue;
    }
    if (invariant.status !== 'passed') {
      issues.push(`invariants.${id}.status: passed is required`);
    }
    issues.push(...validateReconciliationFields(`invariants.${id}`, invariant));
    if (invariant.sourceCount !== invariant.restoredCount) {
      issues.push(`invariants.${id}: source/restored count mismatch`);
    }
    if (invariant.sourceDigest !== invariant.restoredDigest) {
      issues.push(`invariants.${id}: source/restored digest mismatch`);
    }
  }
  if (!manifest?.schema?.revision) {
    issues.push('schema.revision: schema artifact revision is required');
  }
  if (!manifest?.configuration?.revision) {
    issues.push('configuration.revision: configuration revision is required');
  }
  if (manifest?.secrets?.mode !== 'secretref-kms') {
    issues.push('secrets.mode: secretref-kms is required');
  }
  if (!manifest?.secrets?.kmsKeyRef) {
    issues.push('secrets.kmsKeyRef: KMS key reference is required');
  } else if (!manifest.secrets.kmsKeyRef.startsWith('kms://')) {
    issues.push('secrets.kmsKeyRef: kms:// reference is required');
  }
  if (!Array.isArray(manifest?.secrets?.secretRefs)) {
    issues.push('secrets.secretRefs: an array of SecretRef values is required');
  } else if (manifest.secrets.secretRefs.length === 0) {
    issues.push('secrets.secretRefs: at least one SecretRef is required');
  } else if (
    manifest.secrets.secretRefs.some(
      (reference) =>
        typeof reference !== 'string' || !reference.startsWith('secretref://')
    )
  ) {
    issues.push('secrets.secretRefs: every reference must use secretref://');
  }
  if (manifest?.secrets?.valuesIncluded !== false) {
    issues.push('secrets.valuesIncluded: secret values must never be included');
  }
  if (manifest?.isolation?.sourceWriteAccess !== 'denied') {
    issues.push('isolation.sourceWriteAccess: denied is required');
  }
  if (manifest?.isolation?.productionTraffic !== 'blocked') {
    issues.push('isolation.productionTraffic: blocked is required');
  }
  if (manifest?.credentialInvalidation?.oldCredentialsRejected !== true) {
    issues.push(
      'credentialInvalidation.oldCredentialsRejected: evidence is required'
    );
  }
  if (manifest?.failureDisposal?.injectedFailureInstanceDestroyed !== true) {
    issues.push(
      'failureDisposal.injectedFailureInstanceDestroyed: evidence is required'
    );
  }
  if (!isNonEmptyString(manifest?.baseline?.snapshotId)) {
    issues.push(
      'baseline.snapshotId: immutable snapshot identifier is required'
    );
  }
  if (manifest?.baseline?.immutable !== true) {
    issues.push('baseline.immutable: true is required');
  }
  if (!isCanonicalIsoTimestamp(manifest?.baseline?.capturedAt)) {
    issues.push('baseline.capturedAt: canonical ISO timestamp is required');
  } else if (
    isCanonicalIsoTimestamp(recoveryPoint) &&
    Date.parse(manifest.baseline.capturedAt) > Date.parse(recoveryPoint)
  ) {
    issues.push(
      'baseline.capturedAt: must be at or before drill.recoveryPoint'
    );
  }
  if (!manifest?.baseline?.postgresSnapshotRef?.startsWith('snapshot://')) {
    issues.push(
      'baseline.postgresSnapshotRef: snapshot:// reference is required'
    );
  }
  if (manifest?.baseline?.schemaRevision !== manifest?.schema?.revision) {
    issues.push('baseline.schemaRevision: must equal schema.revision');
  }
  if (
    manifest?.baseline?.objectInventoryDigest !==
    manifest?.objects?.sourceDigest
  ) {
    issues.push(
      'baseline.objectInventoryDigest: must equal objects.sourceDigest'
    );
  }
  issues.push(
    ...validateOperations(manifest?.operations, manifest?.drill, options)
  );
  issues.push(
    ...validateFailureScenarios(
      manifest?.failureScenarios?.scenarios,
      verificationTime,
      manifest?.operations?.failedInstanceDeletionHours,
      manifest?.drill
    )
  );
  if ((manifest?.blockers?.length ?? 0) > 0 && manifest?.status === 'passed') {
    issues.push('blockers: passed evidence cannot contain blockers');
  }
  if (manifest?.status === 'partial') {
    for (const blocker of manifest?.blockers ?? []) {
      issues.push(`blocker: ${blocker}`);
    }
  }
  const root = resolve(options.root ?? process.cwd());
  const typedEvidence = new Map();
  for (const [label, artifact, kind] of [
    [
      'drill.evidence',
      manifest?.drill?.evidence,
      'production-recovery-drill-receipt',
    ],
    [
      'postgres.evidence',
      manifest?.postgres?.evidence,
      'postgresql-pitr-receipt',
    ],
    [
      'objects.sourceInventory',
      manifest?.objects?.sourceInventory,
      'object-version-inventory',
    ],
    [
      'objects.restoredInventory',
      manifest?.objects?.restoredInventory,
      'object-version-inventory',
    ],
    ['schema.artifact', manifest?.schema?.artifact, 'schema-revision-artifact'],
    [
      'configuration.artifact',
      manifest?.configuration?.artifact,
      'configuration-revision-artifact',
    ],
    [
      'secrets.restorationEvidence',
      manifest?.secrets?.restorationEvidence,
      'secretref-kms-restoration-receipt',
    ],
    [
      'isolation.restoreEvidence',
      manifest?.isolation?.restoreEvidence,
      'isolated-restore-receipt',
    ],
    [
      'baseline.evidence',
      manifest?.baseline?.evidence,
      'immutable-recovery-baseline',
    ],
    [
      'operations.evidence',
      manifest?.operations?.evidence,
      'recovery-operations-policy',
    ],
    [
      'credentialInvalidation.evidence',
      manifest?.credentialInvalidation?.evidence,
      'credential-invalidation-receipt',
    ],
    [
      'failureScenarios.evidence',
      manifest?.failureScenarios?.evidence,
      'recovery-failure-scenario-report',
    ],
    [
      'failureDisposal.evidence',
      manifest?.failureDisposal?.evidence,
      'failed-instance-destruction-receipt',
    ],
  ]) {
    const result = readTypedArtifact(label, artifact, root, kind, manifest);
    issues.push(...result.issues);
    if (result.document) typedEvidence.set(label, result.document);
  }
  for (const id of REQUIRED_RECOVERY_INVARIANTS) {
    if (!manifest?.invariants?.[id]) continue;
    const label = `invariants.${id}.evidence`;
    const result = readTypedArtifact(
      label,
      manifest?.invariants?.[id]?.evidence,
      root,
      'recovery-invariant-report',
      manifest
    );
    issues.push(...result.issues);
    if (result.document) typedEvidence.set(label, result.document);
  }
  issues.push(...validateTypedEvidenceContents(manifest, typedEvidence));
  if (manifest?.status === 'passed' && issues.length === 0) {
    return { status: 'passed', issues };
  }
  return {
    status: manifest?.status === 'partial' ? 'partial' : 'failed',
    issues:
      manifest?.status === 'partial'
        ? ['status: production recovery evidence must be passed', ...issues]
        : issues,
  };
}

function minutesBetween(start, end) {
  return (Date.parse(end) - Date.parse(start)) / 60_000;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function validateReconciliationFields(label, record) {
  const issues = [];
  for (const field of ['sourceCount', 'restoredCount']) {
    const value = record?.[field];
    if (!Number.isInteger(value) || value < 0) {
      issues.push(`${label}.${field}: non-negative integer is required`);
    }
  }
  for (const field of ['sourceDigest', 'restoredDigest']) {
    if (!/^[a-f0-9]{64}$/u.test(record?.[field] ?? '')) {
      issues.push(`${label}.${field}: exact sha256 is required`);
    }
  }
  return issues;
}

function validateOperations(operations, drill, options) {
  const issues = [];
  if (!isNonEmptyString(operations?.owner)) {
    issues.push('operations.owner: owner is required');
  }
  if (!isNonEmptyString(operations?.onCall)) {
    issues.push('operations.onCall: on-call reference is required');
  } else if (!operations.onCall.startsWith('oncall://')) {
    issues.push('operations.onCall: oncall:// reference is required');
  }
  if (operations?.cadence !== 'quarterly') {
    issues.push('operations.cadence: quarterly is required');
  }
  if (operations?.regionFailureIncluded !== true) {
    issues.push('operations.regionFailureIncluded: true is required');
  }
  if (!isCanonicalIsoTimestamp(operations?.lastDrillAt)) {
    issues.push('operations.lastDrillAt: canonical ISO timestamp is required');
  } else if (operations.lastDrillAt !== drill?.verifiedAt) {
    issues.push('operations.lastDrillAt: must equal drill.verifiedAt');
  }
  if (!isCanonicalIsoTimestamp(operations?.nextDrillDueAt)) {
    issues.push(
      'operations.nextDrillDueAt: canonical ISO timestamp is required'
    );
  } else {
    const now = Date.parse(options.now ?? new Date().toISOString());
    const lastDrill = Date.parse(operations?.lastDrillAt);
    const nextDrill = Date.parse(operations.nextDrillDueAt);
    if (Number.isFinite(now) && nextDrill <= now) {
      issues.push(
        'operations.nextDrillDueAt: recovery drill evidence is expired'
      );
    }
    if (
      Number.isFinite(lastDrill) &&
      (nextDrill <= lastDrill || nextDrill - lastDrill > 93 * 24 * 60 * 60_000)
    ) {
      issues.push(
        'operations.nextDrillDueAt: must be within one quarter of lastDrillAt'
      );
    }
  }
  for (const field of [
    'evidenceRetentionDays',
    'failedInstanceDeletionHours',
  ]) {
    if (!Number.isInteger(operations?.[field]) || operations[field] <= 0) {
      issues.push(`operations.${field}: positive integer is required`);
    }
  }
  return issues;
}

function validateFailureScenarios(
  scenarios,
  verificationTime,
  failedInstanceDeletionHours,
  drill
) {
  if (!Array.isArray(scenarios)) {
    return ['failureScenarios.scenarios: scenario array is required'];
  }
  const issues = [];
  const ids = scenarios.map((scenario) => scenario?.scenarioId);
  for (const required of REQUIRED_RECOVERY_FAILURE_SCENARIOS) {
    if (!ids.includes(required)) {
      issues.push(`failureScenarios.${required}: required scenario is missing`);
    }
  }
  if (new Set(ids).size !== ids.length) {
    issues.push(
      'failureScenarios.scenarios: duplicate scenario is not allowed'
    );
  }
  const instanceIds = scenarios.map((scenario) => scenario?.instanceId);
  if (new Set(instanceIds).size !== instanceIds.length) {
    issues.push(
      'failureScenarios.scenarios: duplicate instanceId is not allowed'
    );
  }
  for (const scenario of scenarios) {
    const label = `failureScenarios.${scenario?.scenarioId ?? 'unknown'}`;
    issues.push(
      ...validateClosedRecord(label, scenario ?? {}, [
        'scenarioId',
        'injectedCondition',
        'expectedResult',
        'observedResult',
        'instanceId',
        'injectedAt',
        'destroyedAt',
      ])
    );
    if (!REQUIRED_RECOVERY_FAILURE_SCENARIOS.includes(scenario?.scenarioId)) {
      issues.push(`${label}.scenarioId: unsupported scenario`);
    }
    if (!isNonEmptyString(scenario?.injectedCondition)) {
      issues.push(`${label}.injectedCondition: condition is required`);
    }
    if (scenario?.expectedResult !== 'blocked') {
      issues.push(`${label}.expectedResult: blocked is required`);
    }
    if (scenario?.observedResult !== 'blocked') {
      issues.push(`${label}.observedResult: blocked is required`);
    }
    if (!isNonEmptyString(scenario?.instanceId)) {
      issues.push(`${label}.instanceId: recovery instance is required`);
    }
    if (!isCanonicalIsoTimestamp(scenario?.injectedAt)) {
      issues.push(`${label}.injectedAt: canonical ISO timestamp is required`);
    } else if (
      Date.parse(scenario.injectedAt) < Date.parse(drill?.startedAt) ||
      Date.parse(scenario.injectedAt) > Date.parse(drill?.verifiedAt)
    ) {
      issues.push(`${label}.injectedAt: must be within the recovery drill`);
    }
    if (!isCanonicalIsoTimestamp(scenario?.destroyedAt)) {
      issues.push(`${label}.destroyedAt: canonical ISO timestamp is required`);
    } else {
      const destroyedAt = Date.parse(scenario.destroyedAt);
      const injectedAt = Date.parse(scenario?.injectedAt);
      if (Number.isFinite(verificationTime) && destroyedAt > verificationTime) {
        issues.push(`${label}.destroyedAt: cannot be in the future`);
      }
      if (
        destroyedAt < Date.parse(drill?.startedAt) ||
        destroyedAt > Date.parse(drill?.verifiedAt)
      ) {
        issues.push(`${label}.destroyedAt: must be within the recovery drill`);
      }
      if (Number.isFinite(injectedAt) && destroyedAt < injectedAt) {
        issues.push(`${label}.destroyedAt: must be at or after injectedAt`);
      }
      if (
        Number.isInteger(failedInstanceDeletionHours) &&
        failedInstanceDeletionHours > 0 &&
        Number.isFinite(injectedAt) &&
        destroyedAt - injectedAt > failedInstanceDeletionHours * 60 * 60_000
      ) {
        issues.push(`${label}.destroyedAt: exceeds deletion policy`);
      }
    }
  }
  return issues;
}

function readTypedArtifact(label, artifact, root, expectedKind, manifest) {
  const issues = validateArtifact(label, artifact, root);
  if (issues.length > 0) return { issues, document: null };
  let document;
  try {
    document = JSON.parse(
      readFileSync(resolve(root, artifact.path), { encoding: 'utf8' })
    );
  } catch {
    return {
      issues: [`${label}.content: typed JSON evidence is required`],
      document: null,
    };
  }
  if (!document || Array.isArray(document) || typeof document !== 'object') {
    return {
      issues: [`${label}.content: typed JSON evidence is required`],
      document: null,
    };
  }
  issues.push(
    ...validateClosedRecord(label, document, [
      'schemaVersion',
      'kind',
      'drillId',
      'recoveryPoint',
      'sourceEnvironment',
      'isolatedEnvironment',
      'provider',
      'receiptId',
      'provenance',
      'data',
    ])
  );
  for (const [field, expected, message] of [
    ['schemaVersion', 1, 'schemaVersion 1 is required'],
    ['kind', expectedKind, `${expectedKind} is required`],
    ['drillId', manifest?.drill?.id, 'must equal drill.id'],
    [
      'recoveryPoint',
      manifest?.drill?.recoveryPoint,
      'must equal drill.recoveryPoint',
    ],
    [
      'sourceEnvironment',
      manifest?.drill?.sourceEnvironment,
      'must equal drill.sourceEnvironment',
    ],
    [
      'isolatedEnvironment',
      manifest?.drill?.isolatedEnvironment,
      'must equal drill.isolatedEnvironment',
    ],
    [
      'provenance',
      'production-recovery-drill',
      'production-recovery-drill is required',
    ],
  ]) {
    if (document[field] !== expected) {
      issues.push(`${label}.${field}: ${message}`);
    }
  }
  for (const field of ['provider', 'receiptId']) {
    if (!isNonEmptyString(document[field])) {
      issues.push(
        `${label}.${field}: non-empty provider receipt field is required`
      );
    }
  }
  if (
    !document.data ||
    Array.isArray(document.data) ||
    typeof document.data !== 'object'
  ) {
    issues.push(`${label}.data: typed evidence payload is required`);
  } else {
    issues.push(
      ...validateClosedRecord(
        `${label}.data`,
        document.data,
        TYPED_EVIDENCE_DATA_FIELDS[expectedKind] ?? []
      )
    );
  }
  return { issues, document };
}

function validateTypedEvidenceContents(manifest, evidence) {
  const issues = [];
  for (const field of [
    'targetsDeclaredAt',
    'startedAt',
    'verifiedAt',
    'incidentReferenceTime',
    'recoveryPoint',
    'declaredRpoMinutes',
    'declaredRtoMinutes',
  ]) {
    validateTypedDataField(
      issues,
      evidence,
      'drill.evidence',
      field,
      manifest?.drill?.[field]
    );
  }
  validateTypedDataField(
    issues,
    evidence,
    'drill.evidence',
    'observedRpoMinutes',
    minutesBetween(
      manifest?.drill?.recoveryPoint,
      manifest?.drill?.incidentReferenceTime
    )
  );
  validateTypedDataField(
    issues,
    evidence,
    'drill.evidence',
    'observedRtoMinutes',
    minutesBetween(manifest?.drill?.startedAt, manifest?.drill?.verifiedAt)
  );
  const postgres = evidence.get('postgres.evidence')?.data;
  for (const field of ['restoreId', 'walRange']) {
    if (postgres && !isNonEmptyString(postgres[field])) {
      issues.push(
        `postgres.evidence.data.${field}: PITR receipt field is required`
      );
    }
  }

  for (const [label, countField, digestField, expectedRole] of [
    ['objects.sourceInventory', 'sourceCount', 'sourceDigest', 'source'],
    [
      'objects.restoredInventory',
      'restoredCount',
      'restoredDigest',
      'restored',
    ],
  ]) {
    const data = evidence.get(label)?.data;
    if (!data) continue;
    if (data.inventoryRole !== expectedRole) {
      issues.push(`${label}.data.inventoryRole: ${expectedRole} is required`);
    }
    const computed = computeObjectInventory(data.entries, label, issues);
    if (!computed) continue;
    if (manifest?.objects?.[countField] !== computed.count) {
      issues.push(`${label}: manifest count does not match typed inventory`);
    }
    if (manifest?.objects?.[digestField] !== computed.digest) {
      issues.push(`${label}: manifest digest does not match typed inventory`);
    }
  }

  for (const id of REQUIRED_RECOVERY_INVARIANTS) {
    const label = `invariants.${id}.evidence`;
    const data = evidence.get(label)?.data;
    if (!data) continue;
    if (data.invariantId !== id) {
      issues.push(`${label}.data.invariantId: ${id} is required`);
    }
    for (const [role, countField, digestField] of [
      ['source', 'sourceCount', 'sourceDigest'],
      ['restored', 'restoredCount', 'restoredDigest'],
    ]) {
      const computed = computeInvariantRecords(
        data[`${role}Records`],
        `${label}.data.${role}Records`,
        issues
      );
      if (!computed) continue;
      if (manifest?.invariants?.[id]?.[countField] !== computed.count) {
        issues.push(`${label}: ${role} count does not match typed report`);
      }
      if (manifest?.invariants?.[id]?.[digestField] !== computed.digest) {
        issues.push(`${label}: ${role} digest does not match typed report`);
      }
    }
  }

  validateTypedDataField(
    issues,
    evidence,
    'schema.artifact',
    'revision',
    manifest?.schema?.revision
  );
  validateTypedDataField(
    issues,
    evidence,
    'configuration.artifact',
    'revision',
    manifest?.configuration?.revision
  );
  validateTypedDataField(
    issues,
    evidence,
    'secrets.restorationEvidence',
    'kmsKeyRef',
    manifest?.secrets?.kmsKeyRef
  );
  validateTypedDataField(
    issues,
    evidence,
    'secrets.restorationEvidence',
    'valuesIncluded',
    false
  );
  const secretData = evidence.get('secrets.restorationEvidence')?.data;
  if (
    secretData &&
    JSON.stringify(secretData.secretRefs) !==
      JSON.stringify(manifest?.secrets?.secretRefs)
  ) {
    issues.push(
      'secrets.restorationEvidence.data.secretRefs: must equal manifest SecretRefs'
    );
  }
  issues.push(...validateCredentialRotations(manifest, evidence));
  for (const [label, field, expected] of [
    ['isolation.restoreEvidence', 'sourceWriteAccess', 'denied'],
    ['isolation.restoreEvidence', 'productionTraffic', 'blocked'],
    ['credentialInvalidation.evidence', 'oldCredentialsRejected', true],
    ['failureDisposal.evidence', 'injectedFailureInstanceDestroyed', true],
  ]) {
    validateTypedDataField(issues, evidence, label, field, expected);
  }
  for (const [field, expected] of [
    ['snapshotId', manifest?.baseline?.snapshotId],
    ['immutable', true],
    ['capturedAt', manifest?.baseline?.capturedAt],
    ['postgresSnapshotRef', manifest?.baseline?.postgresSnapshotRef],
    ['schemaRevision', manifest?.baseline?.schemaRevision],
    ['objectInventoryDigest', manifest?.baseline?.objectInventoryDigest],
  ]) {
    validateTypedDataField(
      issues,
      evidence,
      'baseline.evidence',
      field,
      expected
    );
  }
  for (const field of [
    'owner',
    'onCall',
    'cadence',
    'regionFailureIncluded',
    'lastDrillAt',
    'nextDrillDueAt',
    'evidenceRetentionDays',
    'failedInstanceDeletionHours',
  ]) {
    validateTypedDataField(
      issues,
      evidence,
      'operations.evidence',
      field,
      manifest?.operations?.[field]
    );
  }
  const scenarios = manifest?.failureScenarios?.scenarios;
  const scenarioData = evidence.get('failureScenarios.evidence')?.data;
  if (
    scenarioData &&
    JSON.stringify(scenarioData.scenarios) !== JSON.stringify(scenarios)
  ) {
    issues.push(
      'failureScenarios.evidence.data.scenarios: must equal manifest contract'
    );
  }
  const destroyedInstanceIds = evidence.get('failureDisposal.evidence')?.data
    ?.destroyedInstanceIds;
  const expectedInstanceIds = Array.isArray(scenarios)
    ? scenarios.map((scenario) => scenario.instanceId)
    : [];
  if (
    evidence.get('failureDisposal.evidence')?.data &&
    JSON.stringify(destroyedInstanceIds) !== JSON.stringify(expectedInstanceIds)
  ) {
    issues.push(
      'failureDisposal.evidence.data.destroyedInstanceIds: must list every scenario instance'
    );
  }
  return issues;
}

function validateCredentialRotations(manifest, evidence) {
  const rotations = evidence.get('credentialInvalidation.evidence')?.data
    ?.rotations;
  if (!Array.isArray(rotations)) {
    return [
      'credentialInvalidation.evidence.data.rotations: rotation array is required',
    ];
  }
  const issues = [];
  const restoredSecretRefs = Array.isArray(manifest?.secrets?.secretRefs)
    ? [...manifest.secrets.secretRefs].sort()
    : [];
  const rotationSecretRefs = rotations
    .map((rotation) => rotation?.secretRef)
    .sort();
  if (
    JSON.stringify(restoredSecretRefs) !== JSON.stringify(rotationSecretRefs)
  ) {
    issues.push(
      'credentialInvalidation.evidence.data.rotations: must cover every restored SecretRef'
    );
  }
  for (const [index, rotation] of rotations.entries()) {
    const label = `credentialInvalidation.evidence.data.rotations[${index}]`;
    issues.push(
      ...validateClosedRecord(label, rotation ?? {}, [
        'secretRef',
        'oldVersionRef',
        'newVersionRef',
        'rejectedAt',
        'rejectionCode',
      ])
    );
    if (!rotation?.secretRef?.startsWith('secretref://')) {
      issues.push(`${label}.secretRef: secretref:// reference is required`);
    }
    for (const field of ['oldVersionRef', 'newVersionRef']) {
      if (!rotation?.[field]?.startsWith('secretversion://')) {
        issues.push(
          `${label}.${field}: secretversion:// reference is required`
        );
      }
    }
    if (rotation?.oldVersionRef === rotation?.newVersionRef) {
      issues.push(`${label}.newVersionRef: must differ from oldVersionRef`);
    }
    if (rotation?.rejectionCode !== 'AUTHENTICATION_REJECTED') {
      issues.push(
        `${label}.rejectionCode: AUTHENTICATION_REJECTED is required`
      );
    }
    if (!isCanonicalIsoTimestamp(rotation?.rejectedAt)) {
      issues.push(`${label}.rejectedAt: canonical ISO timestamp is required`);
    } else if (
      Date.parse(rotation.rejectedAt) <
        Date.parse(manifest?.drill?.startedAt) ||
      Date.parse(rotation.rejectedAt) > Date.parse(manifest?.drill?.verifiedAt)
    ) {
      issues.push(`${label}.rejectedAt: must be within the recovery drill`);
    }
  }
  return issues;
}

function validateTypedDataField(issues, evidence, label, field, expected) {
  const data = evidence.get(label)?.data;
  if (data && data[field] !== expected) {
    issues.push(`${label}.data.${field}: must equal manifest contract`);
  }
}

function validateClosedRecord(label, record, allowedFields) {
  const issues = [];
  for (const field of Object.keys(record)) {
    if (!allowedFields.includes(field)) {
      issues.push(`${label}.${field}: field is not allowed`);
    }
  }
  return issues;
}

function computeObjectInventory(entries, label, issues) {
  if (!Array.isArray(entries)) {
    issues.push(`${label}.data.entries: object version entries are required`);
    return null;
  }
  const issueCount = issues.length;
  for (const [index, entry] of entries.entries()) {
    issues.push(
      ...validateClosedRecord(`${label}.data.entries[${index}]`, entry ?? {}, [
        'key',
        'versionId',
        'sha256',
        'sizeBytes',
      ])
    );
  }
  if (issues.length > issueCount) return null;
  if (
    entries.some(
      (entry) =>
        !isNonEmptyString(entry?.key) ||
        !isNonEmptyString(entry?.versionId) ||
        !/^[a-f0-9]{64}$/u.test(entry?.sha256 ?? '') ||
        !Number.isInteger(entry?.sizeBytes) ||
        entry.sizeBytes < 0
    )
  ) {
    issues.push(`${label}.data.entries: invalid object version entry`);
    return null;
  }
  const identities = entries.map((entry) => `${entry.key}\0${entry.versionId}`);
  if (new Set(identities).size !== identities.length) {
    issues.push(`${label}.data.entries: duplicate object version entry`);
    return null;
  }
  const sorted = [...entries].sort((a, b) =>
    `${a.key}\0${a.versionId}`.localeCompare(`${b.key}\0${b.versionId}`)
  );
  return { count: sorted.length, digest: sha256Json(sorted) };
}

function computeInvariantRecords(records, label, issues) {
  if (!Array.isArray(records)) {
    issues.push(`${label}: invariant records are required`);
    return null;
  }
  const issueCount = issues.length;
  for (const [index, record] of records.entries()) {
    issues.push(
      ...validateClosedRecord(`${label}[${index}]`, record ?? {}, [
        'id',
        'sha256',
      ])
    );
  }
  if (issues.length > issueCount) return null;
  if (
    records.some(
      (record) =>
        !isNonEmptyString(record?.id) ||
        !/^[a-f0-9]{64}$/u.test(record?.sha256 ?? '')
    )
  ) {
    issues.push(`${label}: invalid invariant record`);
    return null;
  }
  const identities = records.map((record) => record.id);
  if (new Set(identities).size !== identities.length) {
    issues.push(`${label}: duplicate invariant record`);
    return null;
  }
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  return { count: sorted.length, digest: sha256Json(sorted) };
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateArtifact(label, artifact, root) {
  if (!artifact) return [`${label}: evidence artifact is required`];
  if (typeof artifact.path !== 'string') {
    return [`${label}.path: evidence path is required`];
  }
  const absolute = resolve(root, artifact.path);
  const relativePath = relative(root, absolute).replaceAll('\\', '/');
  if (!relativePath.startsWith('docs/evidence/n2-recovery/')) {
    return [
      `${label}.path: evidence must stay under docs/evidence/n2-recovery`,
    ];
  }
  if (!/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? '')) {
    return [`${label}.sha256: exact sha256 is required`];
  }
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return [`${label}.path: evidence must be a regular file`];
    }
    const evidenceRoot = realpathSync(
      resolve(root, 'docs/evidence/n2-recovery')
    );
    const actualRelativePath = relative(
      evidenceRoot,
      realpathSync(absolute)
    ).replaceAll('\\', '/');
    if (actualRelativePath === '..' || actualRelativePath.startsWith('../')) {
      return [
        `${label}.path: evidence must stay under docs/evidence/n2-recovery`,
      ];
    }
    const digest = createHash('sha256')
      .update(readFileSync(absolute))
      .digest('hex');
    if (digest !== artifact.sha256) {
      return [`${label}.sha256: evidence hash does not match file`];
    }
  } catch {
    return [`${label}.path: evidence file is missing`];
  }
  return [];
}
