import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const DEFAULT_CONTRACT_PATH = fileURLToPath(
  new URL('../docs/production-network-boundary-contract.json', import.meta.url)
);

const REQUIRED_EVIDENCE = [
  'web-edge-entry-healthy',
  'canvas-edge-entry-healthy',
  'core-private-health',
  'canvas-private-health',
  'core-public-origin-denied',
  'canvas-public-origin-denied',
  'body-limits-enforced',
  'rate-limits-enforced',
  'timeouts-enforced',
  'service-auth-not-sole-boundary',
];

const REQUIRED_EDGE_CONTROLS = [
  'tls',
  'waf',
  'body-limit',
  'rate-limit',
  'connect-timeout',
  'read-timeout',
];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function validateContract(contract) {
  const errors = [];
  expect(errors, contract?.schemaVersion === 1, 'schemaVersion must be 1');
  expect(errors, contract?.decisionId === 'C-12', 'decisionId must be C-12');
  expect(
    errors,
    contract?.services?.core?.publicDirectAccess === false,
    'Core public direct access must be denied'
  );
  expect(
    errors,
    contract?.services?.canvas?.originPublicDirectAccess === false,
    'Canvas origin public direct access must be denied'
  );
  expect(
    errors,
    contract?.services?.canvas?.browserEntry === 'edge-protected-route-only',
    'Canvas browser entry must terminate at the protected edge'
  );
  expect(
    errors,
    sameSet(contract?.services?.web?.requiredEdgeControls, REQUIRED_EDGE_CONTROLS),
    'public ingress must retain TLS, WAF, limits, and timeout controls'
  );
  for (const service of ['core', 'canvas']) {
    const reachability = contract?.services?.[service]?.allowedReachability;
    expect(
      errors,
      Array.isArray(reachability) &&
        reachability.length > 0 &&
        reachability.every((value) =>
          ['cloudflare-service-binding', 'private-network'].includes(value)
        ),
      `${service} reachability must be private or service-bound`
    );
    expect(
      errors,
      contract?.services?.[service]?.health?.exposure === 'private-only',
      `${service} health must be private-only`
    );
    expect(
      errors,
      nonEmpty(contract?.services?.[service]?.health?.path),
      `${service} health path is required`
    );
  }
  expect(
    errors,
    contract?.serviceAuthentication?.required === true,
    'service authentication must remain required'
  );
  expect(
    errors,
    contract?.serviceAuthentication?.substitutesForNetworkBoundary === false &&
      contract?.serviceAuthentication?.substitutesForWafOrIngress === false,
    'service credentials must not substitute for network or edge controls'
  );
  for (const group of ['bodyBytes', 'ratePerMinute', 'timeoutsMs']) {
    const values = Object.values(contract?.limits?.[group] ?? {});
    expect(
      errors,
      values.length > 0 && values.every(isPositiveInteger),
      `${group} must contain positive integer limits`
    );
  }
  expect(
    errors,
    sameSet(contract?.requiredEvidence, REQUIRED_EVIDENCE),
    'requiredEvidence must retain every C-12 release probe'
  );
  return errors;
}

export function validateEvidence(
  evidence,
  contract,
  contractSha256,
  expectedCommitSha
) {
  const errors = [];
  expect(errors, evidence?.schemaVersion === 1, 'evidence schemaVersion must be 1');
  expect(errors, evidence?.decisionId === contract.decisionId, 'decisionId mismatch');
  expect(errors, evidence?.environment === 'production', 'environment must be production');
  expect(errors, nonEmpty(evidence?.deploymentId), 'deploymentId is required');
  expect(
    errors,
    /^[a-f0-9]{40}$/u.test(expectedCommitSha ?? ''),
    'expected release SHA must be a full SHA'
  );
  expect(errors, /^[a-f0-9]{40}$/u.test(evidence?.commitSha ?? ''), 'commitSha must be a full SHA');
  expect(
    errors,
    evidence?.commitSha === expectedCommitSha,
    'commitSha does not match the expected release SHA'
  );
  expect(
    errors,
    evidence?.contractSha256 === contractSha256,
    'contractSha256 does not match the checked-in contract'
  );
  expect(
    errors,
    Number.isFinite(Date.parse(evidence?.observedAt ?? '')),
    'observedAt must be an ISO timestamp'
  );
  expect(errors, isRecord(evidence?.probes), 'probes must be an object');
  for (const id of contract.requiredEvidence) {
    const probe = evidence?.probes?.[id];
    expect(errors, probe?.status === 'passed', `${id} must be passed`);
    expect(errors, nonEmpty(probe?.evidenceRef), `${id} needs a redacted evidenceRef`);
  }
  for (const leak of findSecretMaterial(evidence)) errors.push(leak);
  return errors;
}

export function findSecretMaterial(value, path = '$') {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      errors.push(...findSecretMaterial(entry, `${path}[${index}]`));
    });
    return errors;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[-_]/gu, '');
      if (
        ['authorization', 'cookie', 'password', 'secret', 'token', 'apikey', 'privatekey', 'databaseurl'].includes(
          normalized
        )
      ) {
        errors.push(`${path}.${key} must not be stored in release evidence`);
      }
      errors.push(...findSecretMaterial(entry, `${path}.${key}`));
    }
    return errors;
  }
  if (typeof value === 'string' && looksSecret(value)) {
    errors.push(`${path} appears to contain secret material`);
  }
  return errors;
}

function looksSecret(value) {
  return (
    /\bBearer\s+\S+/iu.test(value) ||
    /postgres(?:ql)?:\/\/[^:@/]+:[^@/]+@/iu.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+)\b/u.test(value)
  );
}

function sameSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function expect(errors, condition, message) {
  if (!condition) errors.push(message);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv) {
  const result = {
    contract: DEFAULT_CONTRACT_PATH,
    evidence: undefined,
    expectedCommitSha: undefined,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') continue;
    if (value === '--json') result.json = true;
    else if (value === '--contract') result.contract = requireValue(argv, ++index, value);
    else if (value === '--evidence') result.evidence = requireValue(argv, ++index, value);
    else if (value === '--expected-commit-sha')
      result.expectedCommitSha = requireStringValue(argv, ++index, value);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function requireValue(argv, index, flag) {
  return resolve(requireStringValue(argv, index, flag));
}

function requireStringValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function readJson(path) {
  const raw = readFileSync(path, 'utf8');
  return { raw, value: JSON.parse(raw) };
}

function run(argv) {
  const options = parseArgs(argv);
  const contractFile = readJson(options.contract);
  const contractErrors = validateContract(contractFile.value);
  const digest = sha256(contractFile.raw);
  let evidenceErrors = [];
  if (options.evidence) {
    const evidence = readJson(options.evidence).value;
    evidenceErrors = validateEvidence(
      evidence,
      contractFile.value,
      digest,
      options.expectedCommitSha
    );
  }
  const errors = [...contractErrors, ...evidenceErrors];
  const result = {
    contractSha256: digest,
    evidenceChecked: Boolean(options.evidence),
    expectedCommitSha: options.expectedCommitSha ?? null,
    status:
      errors.length > 0
        ? 'failed'
        : options.evidence
          ? 'deployment-valid'
          : 'contract-valid',
    errors,
  };
  process.stdout.write(`${options.json ? JSON.stringify(result) : formatResult(result)}\n`);
  if (errors.length > 0) process.exitCode = 1;
}

function formatResult(result) {
  if (result.status === 'deployment-valid')
    return `C-12 deployment evidence valid for ${result.expectedCommitSha} (${result.contractSha256})`;
  if (result.status === 'contract-valid')
    return `C-12 contract valid (${result.contractSha256}); production evidence was not checked`;
  return `C-12 gate failed:\n- ${result.errors.join('\n- ')}`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
