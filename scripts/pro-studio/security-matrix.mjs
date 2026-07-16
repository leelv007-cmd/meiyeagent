import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const IDOR_OBJECT_KINDS = [
  'project',
  'revision',
  'asset',
  'job',
  'package',
  'grant',
  'confirmation',
];

export const SECURITY_CONTROL_POLICY = {
  cross_workspace_idor: {
    evidenceTypes: ['unit', 'fixture_real_service'],
    objectKinds: IDOR_OBJECT_KINDS,
  },
  forged_provider_routing: { evidenceTypes: ['unit'] },
  idempotency_replay_conflict: { evidenceTypes: ['unit'] },
  async_billing_settlement: { evidenceTypes: ['unit'] },
  provider_reference_grant: {
    evidenceTypes: ['unit', 'production_drill'],
  },
  dns_redirect_ssrf: { evidenceTypes: ['unit'] },
  agent_allowlist_authorization: { evidenceTypes: ['unit'] },
  dual_session_cas: {
    evidenceTypes: ['unit', 'fixture_real_service'],
  },
  browser_cache_isolation: {
    evidenceTypes: ['unit', 'fixture_real_service'],
  },
};

const RELEASE_GATE_POLICY = {
  production_security_drill: {
    scope: 'full_security_matrix',
    type: 'production_drill',
  },
  manual_security_approval: { type: 'manual_approval' },
};

const ALLOWED_EVIDENCE_TYPES = new Set([
  'unit',
  'fixture_real_service',
  'production_drill',
  'manual_approval',
]);
const ALLOWED_STATUSES = new Set(['passed', 'blocked', 'missing']);

export function securityArtifactDigest(artifact) {
  return createHash('sha256')
    .update(JSON.stringify(artifact) ?? 'undefined')
    .digest('hex');
}

export function resolveRepositoryEvidencePath(root, evidencePath) {
  if (typeof evidencePath !== 'string' || isAbsolute(evidencePath)) {
    throw new Error('evidence path must be repository-relative');
  }
  const repositoryRoot = realpathSync(root);
  const candidate = resolve(repositoryRoot, evidencePath);
  const lexicalPath = relative(repositoryRoot, candidate);
  if (lexicalPath === '..' || lexicalPath.startsWith(`..${sep}`)) {
    throw new Error('evidence path must stay inside the repository');
  }
  const realPath = realpathSync(candidate);
  const realRelativePath = relative(repositoryRoot, realPath);
  if (
    realRelativePath === '..' ||
    realRelativePath.startsWith(`..${sep}`)
  ) {
    throw new Error('evidence path must stay inside the repository');
  }
  return realPath;
}

function sameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function validatePassedEvidence(evidence, label, options, errors) {
  if (!evidence.path) {
    errors.push(`${label}: passed evidence path is required`);
  } else if (!options.evidenceExists(evidence.path)) {
    errors.push(`${label}: evidence path does not exist: ${evidence.path}`);
  }
  if (evidence.type !== 'manual_approval' && !evidence.command) {
    errors.push(`${label}: verification command is required`);
  }
  if (evidence.type === 'fixture_real_service') {
    if (
      evidence.environment !== 'local' ||
      evidence.adapterMode !== 'fixture' ||
      evidence.productionEquivalent !== false
    ) {
      errors.push(
        `${label}: fixture evidence must stay local, fixture-adapter, and non-production`
      );
    }
  }
  if (evidence.type === 'production_drill') {
    if (evidence.environment !== 'production') {
      errors.push(`${label}: production drill must declare production environment`);
    }
    if (
      evidence.adapterMode !== 'production' ||
      evidence.productionEquivalent !== true
    ) {
      errors.push(
        `${label}: production drill requires the production adapter and production-equivalent evidence`
      );
    }
  }
}

function validateGrantDecision(control, options, errors) {
  if (!['disabled_no_grant', 'enabled_short_lived'].includes(control.mode)) {
    errors.push(
      'provider_reference_grant: mode must be disabled_no_grant or enabled_short_lived'
    );
    return;
  }
  const evidence = control.evidence?.find(
    (item) => item.type === 'production_drill' && item.status === 'passed'
  );
  if (!evidence?.path) return;
  let result;
  try {
    result = options.readEvidenceJson(evidence.path);
  } catch {
    errors.push(
      'provider_reference_grant: scoped production evidence artifact is unreadable'
    );
    return;
  }
  if (control.mode === 'enabled_short_lived') {
    if (
      evidence.scope !== 'provider_reference_grant_lifecycle' ||
      result?.schemaVersion !== 1 ||
      result?.mode !== 'enabled_short_lived' ||
      result?.expiryPassed !== true ||
      result?.explicitRevocationPassed !== true ||
      result?.rightsRevocationPassed !== true ||
      result?.taskWorkspaceBindingPassed !== true ||
      result?.cacheControlNoStorePassed !== true
    ) {
      errors.push(
        'provider_reference_grant: enabled branch lacks complete expiry and revocation evidence'
      );
    }
    return;
  }
  if (
    evidence.scope !== 'provider_reference_transport_only' ||
    result?.grantDecision !== 'no_grant_required_direct_upload' ||
    result?.grantEndpoint !== null ||
    result?.grantUrlsProduced !== false ||
    result?.releaseScope !==
      'verified_provider_model_operation_transport_tuple_only'
  ) {
    errors.push(
      'provider_reference_grant: disabled branch lacks scoped no-grant production evidence'
    );
  }
}

function validateProductionDrillArtifact(gate, options, errors) {
  let artifact;
  try {
    artifact = options.readEvidenceJson(gate.path);
  } catch {
    errors.push('production_security_drill: evidence artifact is unreadable');
    return undefined;
  }
  const controls = Array.isArray(artifact?.controls) ? artifact.controls : [];
  const coversEveryControl =
    sameMembers(
      controls?.map((control) => control.id),
      Object.keys(SECURITY_CONTROL_POLICY)
    ) && controls.every((control) => control.status === 'passed');
  if (
    artifact?.schemaVersion !== 1 ||
    artifact?.environment !== 'production' ||
    artifact?.adapterMode !== 'production' ||
    !/^[0-9a-f]{40}$/i.test(artifact?.commitSha ?? '') ||
    !artifact?.completedAt ||
    Number.isNaN(Date.parse(artifact.completedAt)) ||
    !artifact?.deploymentId ||
    artifact?.productionEquivalent !== true ||
    artifact?.redacted !== true ||
    artifact?.secretsPersisted !== false ||
    !artifact?.runId ||
    !/^[0-9a-f]{64}$/i.test(artifact?.testPlanDigest ?? '') ||
    !coversEveryControl
  ) {
    errors.push(
      'production_security_drill: evidence artifact must be a redacted production run covering every control'
    );
  }
  if (
    options.trustedReceiptDigests.production_security_drill !==
    securityArtifactDigest(artifact)
  ) {
    errors.push('production_security_drill: trusted receipt digest is required');
  }
  return artifact?.runId;
}

function validateManualApprovalArtifact(
  gate,
  productionDrillRunId,
  options,
  errors
) {
  let artifact;
  try {
    artifact = options.readEvidenceJson(gate.path);
  } catch {
    errors.push('manual_security_approval: approval artifact is unreadable');
    return;
  }
  if (
    artifact?.schemaVersion !== 1 ||
    !artifact?.approvalId ||
    artifact?.approvalSystem !== 'protected_release_approval' ||
    artifact?.decision !== 'approved' ||
    artifact?.approvedBy !== gate.approvedBy ||
    artifact?.approvedAt !== gate.approvedAt ||
    !productionDrillRunId ||
    artifact?.productionDrillRunId !== productionDrillRunId
  ) {
    errors.push(
      'manual_security_approval: approval artifact must approve the verified production drill'
    );
  }
  if (
    options.trustedReceiptDigests.manual_security_approval !==
    securityArtifactDigest(artifact)
  ) {
    errors.push('manual_security_approval: trusted receipt digest is required');
  }
}

export function verifySecurityManifest(manifest, options = {}) {
  const normalized = {
    evidenceExists: options.evidenceExists ?? existsSync,
    readEvidenceJson:
      options.readEvidenceJson ??
      ((path) => JSON.parse(readFileSync(path, 'utf8'))),
    trustedReceiptDigests: options.trustedReceiptDigests ?? {},
  };
  const errors = [];
  const blockers = [];

  if (manifest?.schemaVersion !== 1) {
    errors.push('schemaVersion: expected 1');
  }
  if (manifest?.matrixId !== 'pro-studio-ticket-25') {
    errors.push('matrixId: expected pro-studio-ticket-25');
  }
  if (!Array.isArray(manifest?.controls)) {
    errors.push('controls: array is required');
  }

  const controls = new Map();
  const controlEntries = Array.isArray(manifest?.controls) ? manifest.controls : [];
  for (const control of controlEntries) {
    if (!control?.id) {
      errors.push('controls: every control requires an id');
      continue;
    }
    if (controls.has(control.id)) {
      errors.push(`${control.id}: control is duplicated`);
      continue;
    }
    controls.set(control.id, control);
  }

  for (const [id, policy] of Object.entries(SECURITY_CONTROL_POLICY)) {
    const control = controls.get(id);
    if (!control) {
      errors.push(`${id}: required control is missing`);
      continue;
    }
    if (policy.objectKinds && !sameMembers(control.objectKinds, policy.objectKinds)) {
      errors.push(`${id}: objectKinds must cover ${policy.objectKinds.join(', ')}`);
    }
    if (
      id === 'cross_workspace_idor' &&
      control.rejectionAuditStatus !== 'passed'
    ) {
      blockers.push(
        `${id}: rejection audit evidence is ${control.rejectionAuditStatus ?? 'missing'}`
      );
    }
    if (!Array.isArray(control.evidence)) {
      errors.push(`${id}: evidence array is required`);
      continue;
    }
    for (const item of control.evidence) {
      const label = `${id}/${item?.type ?? 'unknown'}`;
      if (!ALLOWED_EVIDENCE_TYPES.has(item?.type)) {
        errors.push(`${label}: unsupported evidence type`);
        continue;
      }
      if (!ALLOWED_STATUSES.has(item.status)) {
        errors.push(`${label}: unsupported evidence status`);
        continue;
      }
      if (item.status === 'passed') {
        validatePassedEvidence(item, label, normalized, errors);
      }
    }
    for (const type of policy.evidenceTypes) {
      const item = control.evidence.find((candidate) => candidate.type === type);
      if (!item || item.status !== 'passed') {
        blockers.push(`${id}: ${type} evidence is ${item?.status ?? 'missing'}`);
      }
    }
    if (id === 'provider_reference_grant') {
      validateGrantDecision(control, normalized, errors);
    }
  }

  for (const id of controls.keys()) {
    if (!SECURITY_CONTROL_POLICY[id]) {
      errors.push(`${id}: control is not part of the frozen Ticket 25 matrix`);
    }
  }

  if (!Array.isArray(manifest?.releaseGates)) {
    errors.push('releaseGates: array is required');
  }
  const releaseGates = new Map();
  const releaseGateEntries = Array.isArray(manifest?.releaseGates)
    ? manifest.releaseGates
    : [];
  for (const gate of releaseGateEntries) {
    if (!gate?.id) {
      errors.push('releaseGates: every gate requires an id');
      continue;
    }
    if (releaseGates.has(gate.id)) {
      errors.push(`${gate.id}: release gate is duplicated`);
      continue;
    }
    releaseGates.set(gate.id, gate);
  }
  for (const id of releaseGates.keys()) {
    if (!RELEASE_GATE_POLICY[id]) {
      errors.push(`${id}: release gate is not part of the frozen Ticket 25 matrix`);
    }
  }
  let productionDrillRunId;
  for (const [id, policy] of Object.entries(RELEASE_GATE_POLICY)) {
    const gate = releaseGates.get(id);
    if (!gate) {
      errors.push(`${id}: required release gate is missing`);
      continue;
    }
    if (gate.type !== policy.type) {
      errors.push(`${id}: evidence type must be ${policy.type}`);
    }
    if (policy.scope && gate.scope !== policy.scope) {
      errors.push(`${id}: scope must be ${policy.scope}`);
    }
    if (!sameMembers(gate.covers, Object.keys(SECURITY_CONTROL_POLICY))) {
      errors.push(`${id}: must cover every frozen Ticket 25 control`);
    }
    if (!ALLOWED_STATUSES.has(gate.status)) {
      errors.push(`${id}: unsupported evidence status`);
      continue;
    }
    if (gate.status === 'passed') {
      validatePassedEvidence(gate, id, normalized, errors);
      if (id === 'production_security_drill') {
        productionDrillRunId = validateProductionDrillArtifact(
          gate,
          normalized,
          errors
        );
      }
      if (
        gate.type === 'manual_approval' &&
        (gate.decision !== 'approved' || !gate.approvedBy || !gate.approvedAt)
      ) {
        errors.push(
          `${id}: passed approval requires decision=approved, approvedBy, and approvedAt`
        );
      }
      if (id === 'manual_security_approval') {
        validateManualApprovalArtifact(
          gate,
          productionDrillRunId,
          normalized,
          errors
        );
      }
    } else {
      blockers.push(`${id}: ${policy.type} evidence is ${gate.status}`);
    }
  }

  return {
    blockers,
    errors,
    status: errors.length > 0 ? 'failed' : blockers.length > 0 ? 'partial' : 'passed',
  };
}

export function validateSecurityMatrixReleaseStatus(
  releaseEvidence,
  verification
) {
  const declared = releaseEvidence?.securityMatrix?.status;
  if (declared === verification.status) return [];
  return [
    `securityMatrix: release evidence status ${declared ?? 'missing'} does not match computed ${verification.status}`,
  ];
}

export function verifySecurityManifestFile(path, options = {}) {
  const absolute = resolve(path);
  const root = options.root ?? process.cwd();
  const evidencePath = (path) => resolveRepositoryEvidencePath(root, path);
  return verifySecurityManifest(JSON.parse(readFileSync(absolute, 'utf8')), {
    evidenceExists: (path) => {
      try {
        return existsSync(evidencePath(path));
      } catch {
        return false;
      }
    },
    readEvidenceJson: (path) =>
      JSON.parse(readFileSync(evidencePath(path), 'utf8')),
    trustedReceiptDigests:
      options.trustedReceiptDigests ??
      {
        manual_security_approval:
          process.env.PRO_STUDIO_MANUAL_APPROVAL_RECEIPT_SHA256,
        production_security_drill:
          process.env.PRO_STUDIO_PRODUCTION_SECURITY_RECEIPT_SHA256,
      },
  });
}

function run() {
  const json = process.argv.includes('--json');
  const path = process.argv.find((argument) => argument.endsWith('.json')) ??
    'docs/evidence/pro-studio/security-manifest.json';
  let verification;
  try {
    verification = verifySecurityManifestFile(path);
  } catch (error) {
    verification = {
      blockers: [],
      errors: [error instanceof Error ? error.message : String(error)],
      status: 'failed',
    };
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  } else {
    process.stdout.write(`Pro Studio security matrix: ${verification.status}\n`);
    for (const issue of [...verification.errors, ...verification.blockers]) {
      process.stderr.write(`- ${issue}\n`);
    }
  }
  return verification.status === 'passed' ? 0 : verification.status === 'partial' ? 1 : 2;
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) process.exitCode = run();
