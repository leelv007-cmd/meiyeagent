import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessPolicyInput } from '../harness/policy-gates.js';
import { validateHarnessPolicy } from '../harness/policy-gates.js';
import {
  HarnessCheckTargetScope,
} from './harness-check-target-scope.js';

test('resolve returns the complete scoped policy without applying model-selected rulesets', async () => {
  const scope = new HarnessCheckTargetScope();
  const policyInput = policy('workspace-a', 'candidate-a');

  const resolved = await scope.withTarget(
    {
      policyInput,
      targetRef: 'candidate:candidate-a',
    },
    () =>
      scope.resolve({
        rulesets: ['critical_fact_source'],
        targetRef: 'candidate:candidate-a',
        workspaceId: 'workspace-a',
      }),
  );

  assert.deepEqual(resolved, policyInput);
  assert.deepEqual(
    validateHarnessPolicy(resolved).failures.map(({ gateId }) => gateId),
    ['cross_workspace_lineage', 'subject_asset_rights'],
  );
});

test('resolve fails closed outside a matching target and workspace scope', async () => {
  const scope = new HarnessCheckTargetScope();

  await assert.rejects(
    scope.resolve({
      targetRef: 'candidate:candidate-a',
      workspaceId: 'workspace-a',
    }),
    /No Harness check target is active/u,
  );

  await scope.withTarget(
    {
      policyInput: policy('workspace-a', 'candidate-a'),
      targetRef: 'candidate:candidate-a',
    },
    async () => {
      await assert.rejects(
        scope.resolve({
          targetRef: 'candidate:candidate-b',
          workspaceId: 'workspace-a',
        }),
        /does not match the active execution scope/u,
      );
      await assert.rejects(
        scope.resolve({
          targetRef: 'candidate:candidate-a',
          workspaceId: 'workspace-b',
        }),
        /does not belong to the active execution workspace/u,
      );
    },
  );
});

test('scope entry and each resolution are independent policy snapshots', async () => {
  const scope = new HarnessCheckTargetScope();
  const policyInput = policy('workspace-a', 'candidate-a');

  await scope.withTarget(
    {
      policyInput,
      targetRef: 'candidate:candidate-a',
    },
    async () => {
      policyInput.bundle.revision = 99;
      policyInput.candidate.candidateId = 'mutated-by-caller';

      const first = await scope.resolve({
        targetRef: 'candidate:candidate-a',
        workspaceId: 'workspace-a',
      });
      first.bundle.revision = 88;
      first.candidate.candidateId = 'mutated-resolved-copy';
      first.rightsRefs.length = 0;

      const second = await scope.resolve({
        targetRef: 'candidate:candidate-a',
        workspaceId: 'workspace-a',
      });
      assert.equal(second.bundle.revision, 1);
      assert.equal(second.candidate.candidateId, 'candidate-a');
      assert.equal(second.rightsRefs.length, 1);
      assert.notEqual(first, second);
    },
  );
});

test('concurrent workspace and target scopes never leak across asynchronous chains', async () => {
  const scope = new HarnessCheckTargetScope();
  let arrivals = 0;
  let release: () => void = () =>
    assert.fail('concurrency barrier was not initialized');
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrive = async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await barrier;
  };

  const [resolvedA, resolvedB] = await Promise.all([
    scope.withTarget(
      {
        policyInput: policy('workspace-a', 'candidate-a'),
        targetRef: 'candidate:candidate-a',
      },
      async () => {
        await arrive();
        return scope.resolve({
          targetRef: 'candidate:candidate-a',
          workspaceId: 'workspace-a',
        });
      },
    ),
    scope.withTarget(
      {
        policyInput: policy('workspace-b', 'candidate-b'),
        targetRef: 'candidate:candidate-b',
      },
      async () => {
        await arrive();
        return scope.resolve({
          targetRef: 'candidate:candidate-b',
          workspaceId: 'workspace-b',
        });
      },
    ),
  ]);

  assert.deepEqual(
    [resolvedA, resolvedB].map(({ bundle, candidate }) => ({
      candidateId: candidate.candidateId,
      workspaceId: bundle.workspaceId,
    })),
    [
      {
        candidateId: 'candidate-a',
        workspaceId: 'workspace-a',
      },
      {
        candidateId: 'candidate-b',
        workspaceId: 'workspace-b',
      },
    ],
  );
});

function policy(
  workspaceId: string,
  candidateId: string,
): HarnessPolicyInput {
  return {
    phase: 'execution',
    brief: {},
    bundle: {
      revision: 1,
      workspaceId,
    },
    candidate: {
      assetRefs: ['asset-foreign'],
      candidateId,
      factClaims: [],
      intendedUse: 'public_content',
      workspaceId,
    },
    identityRefs: [],
    rightsRefs: [
      {
        allowedUses: ['internal_draft'],
        assetId: 'asset-foreign',
        status: 'authorized',
        workspaceId: 'workspace-foreign',
      },
    ],
    sourceRefs: [],
  };
}
