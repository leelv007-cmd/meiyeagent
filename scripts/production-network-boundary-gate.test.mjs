import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  findSecretMaterial,
  sha256,
  validateContract,
  validateEvidence,
} from './production-network-boundary-gate.mjs';

const contractPath = fileURLToPath(
  new URL('../docs/production-network-boundary-contract.json', import.meta.url)
);
const contractRaw = readFileSync(contractPath, 'utf8');
const contract = JSON.parse(contractRaw);

test('checked-in C-12 contract keeps Core and Canvas behind a network boundary', () => {
  assert.deepEqual(validateContract(contract), []);
});

test('rejects a weakened edge or origin boundary', () => {
  const weakened = structuredClone(contract);
  weakened.services.core.publicDirectAccess = true;
  weakened.services.web.requiredEdgeControls = ['tls'];
  assert.match(validateContract(weakened).join('\n'), /Core public direct access/u);
  assert.match(validateContract(weakened).join('\n'), /public ingress must retain/u);
});

test('accepts complete SHA-bound redacted production evidence', () => {
  const evidence = validEvidence();
  assert.deepEqual(
    validateEvidence(
      evidence,
      contract,
      sha256(contractRaw),
      evidence.commitSha
    ),
    []
  );
});

test('rejects production evidence from a different release candidate', () => {
  const evidence = validEvidence();
  assert.match(
    validateEvidence(
      evidence,
      contract,
      sha256(contractRaw),
      'b'.repeat(40)
    ).join('\n'),
    /commitSha does not match the expected release SHA/u
  );
});

test('rejects missing public-origin denial evidence', () => {
  const evidence = validEvidence();
  delete evidence.probes['core-public-origin-denied'];
  assert.match(
    validateEvidence(
      evidence,
      contract,
      sha256(contractRaw),
      evidence.commitSha
    ).join('\n'),
    /core-public-origin-denied must be passed/u
  );
});

test('rejects secret-bearing evidence', () => {
  assert.deepEqual(findSecretMaterial({ authorization: 'redacted' }), [
    '$.authorization must not be stored in release evidence',
  ]);
  assert.match(findSecretMaterial({ note: 'Bearer should-not-be-here' })[0], /secret material/u);
});

function validEvidence() {
  return {
    schemaVersion: 1,
    decisionId: 'C-12',
    environment: 'production',
    deploymentId: 'production-example-001',
    commitSha: 'a'.repeat(40),
    contractSha256: sha256(contractRaw),
    observedAt: '2026-07-22T00:00:00.000Z',
    probes: Object.fromEntries(
      contract.requiredEvidence.map((id) => [
        id,
        { status: 'passed', evidenceRef: `redacted-evidence/${id}.json` },
      ])
    ),
  };
}
