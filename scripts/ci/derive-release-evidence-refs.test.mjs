import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BACKWARD_EVIDENCE_ARTIFACTS,
  FORWARD_EVIDENCE_JOBS,
  deriveReleaseEvidenceRefs,
} from './derive-release-evidence-refs.mjs';

const RUN_URL = 'https://github.com/acme/repo/actions/runs/12345';
const ALL_ARTIFACTS = [
  'root-required-quality-evidence',
  'production-main-journey-evidence-mainline',
  'v31-day0-gate-evidence',
  'unrelated-artifact',
];

test('every evidence ref derives from the minting run itself', () => {
  const { refs, errors } = deriveReleaseEvidenceRefs({
    artifactNames: ALL_ARTIFACTS,
    runUrl: RUN_URL,
  });
  assert.deepEqual(errors, []);
  for (const [env, artifact] of Object.entries(BACKWARD_EVIDENCE_ARTIFACTS)) {
    assert.equal(refs[env], `${RUN_URL}#artifact=${artifact}`);
  }
  for (const [env, job] of Object.entries(FORWARD_EVIDENCE_JOBS)) {
    assert.equal(refs[env], `${RUN_URL}#job=${job}`);
  }
  // The five release inputs are covered exactly — no slot is left for vars.*.
  assert.equal(Object.keys(refs).length, 5);
});

test('a missing evidence artifact fails closed and names both sides', () => {
  const { refs, errors } = deriveReleaseEvidenceRefs({
    artifactNames: ALL_ARTIFACTS.filter(
      (name) => name !== 'v31-day0-gate-evidence'
    ),
    runUrl: RUN_URL,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /RELEASE_JOURNEY_EVIDENCE_REF_IMAGE/u);
  assert.match(errors[0], /v31-day0-gate-evidence/u);
  assert.equal(refs.RELEASE_JOURNEY_EVIDENCE_REF_IMAGE, undefined);
});

test('two different runs can never mint identical references', () => {
  const first = deriveReleaseEvidenceRefs({
    artifactNames: ALL_ARTIFACTS,
    runUrl: 'https://github.com/acme/repo/actions/runs/111',
  });
  const second = deriveReleaseEvidenceRefs({
    artifactNames: ALL_ARTIFACTS,
    runUrl: 'https://github.com/acme/repo/actions/runs/222',
  });
  for (const env of Object.keys(first.refs)) {
    assert.notEqual(first.refs[env], second.refs[env]);
  }
});

test('a missing or relative run url is refused', () => {
  for (const runUrl of ['', '   ', 'actions/runs/1']) {
    const { errors } = deriveReleaseEvidenceRefs({
      artifactNames: ALL_ARTIFACTS,
      runUrl,
    });
    assert.ok(errors.some((error) => /runUrl/u.test(error)));
  }
});
