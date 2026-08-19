import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bucketReleases,
  canSubmitRollback,
  shortHash,
  type OpsReleaseListView,
} from './admin-ops-console-model';

test('bucketReleases groups production / canary / draft / other', () => {
  const list: OpsReleaseListView = {
    production: 'r-prod',
    canary: 'r-canary',
    draft: ['r-draft'],
    items: [
      {
        releaseId: 'r-prod',
        version: 2,
        status: 'production',
        manifestHash: 'abc',
        createdAt: 't1',
        updatedAt: 't2',
        workspaceAllowlist: [],
        approvedBy: 'ops',
      },
      {
        releaseId: 'r-canary',
        version: 3,
        status: 'canary',
        manifestHash: 'def',
        createdAt: 't3',
        updatedAt: 't4',
        workspaceAllowlist: ['ws-1'],
        approvedBy: null,
      },
      {
        releaseId: 'r-draft',
        version: 1,
        status: 'draft',
        manifestHash: 'ghi',
        createdAt: 't0',
        updatedAt: null,
        workspaceAllowlist: [],
        approvedBy: null,
      },
      {
        releaseId: 'r-retired',
        version: 1,
        status: 'retired',
        manifestHash: 'jkl',
        createdAt: 't-1',
        updatedAt: 't0',
        workspaceAllowlist: [],
        approvedBy: null,
      },
    ],
  };
  const buckets = bucketReleases(list);
  assert.equal(buckets.production.length, 1);
  assert.equal(buckets.canary[0]?.releaseId, 'r-canary');
  assert.equal(buckets.draft.length, 1);
  assert.equal(buckets.other[0]?.status, 'retired');
});

test('canSubmitRollback requires both reason and evidence', () => {
  assert.equal(canSubmitRollback({ reason: '', evidence: 'e' }), false);
  assert.equal(canSubmitRollback({ reason: 'r', evidence: '' }), false);
  assert.equal(canSubmitRollback({ reason: 'r', evidence: 'e' }), true);
});

test('shortHash truncates long hashes', () => {
  assert.equal(shortHash('abcdef', 12), 'abcdef');
  assert.equal(shortHash('abcdefghijklmnop', 8), 'abcdefgh…');
});

test('Admin G/H list projects Artifact/Lifecycle/Rollout identity and does not fake get_release', () => {
  const list: OpsReleaseListView = {
    production: 'r-prod',
    canary: 'r-canary',
    draft: [],
    items: [
      {
        releaseId: 'r-prod',
        version: 2,
        status: 'production',
        manifestHash: 'artifact-digest',
        createdAt: 't1',
        updatedAt: 't2',
        workspaceAllowlist: [],
        approvedBy: 'ops',
      },
      {
        releaseId: 'r-canary',
        version: 3,
        status: 'canary',
        manifestHash: 'canary-digest',
        createdAt: 't3',
        updatedAt: 't4',
        workspaceAllowlist: ['ws-1'],
        approvedBy: null,
      },
    ],
  };
  const buckets = bucketReleases(list);
  assert.equal(buckets.production[0]?.manifestHash, 'artifact-digest');
  assert.equal(buckets.production[0]?.status, 'production');
  assert.deepEqual(buckets.canary[0]?.workspaceAllowlist, ['ws-1']);

  const control = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      'admin-ops-console-control.tsx'
    ),
    'utf8'
  );
  assert.ok(control.includes("action: 'list_releases'"));
  assert.ok(control.includes('item.manifestHash'));
  assert.ok(control.includes('item.status'));
  assert.ok(control.includes('item.workspaceAllowlist'));
  // Honest gap: Spec H desk reads the flattened three-object identity, not
  // a full per-binding Artifact console via get_release.
  assert.equal(control.includes("action: 'get_release'"), false);
});
