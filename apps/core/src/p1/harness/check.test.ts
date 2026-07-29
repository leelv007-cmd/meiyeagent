import assert from 'node:assert/strict';
import test from 'node:test';

import { check, checkHarnessRedlines, type CheckStrategy } from './check.js';
import type { HarnessPolicyInput } from './policy-gates.js';

test('check awaits every violation and only block prevents continuation', async () => {
  const expected = {
    block: { allowed: false, status: 'blocked' },
    detect: { allowed: true, status: 'detected' },
    warn: { allowed: true, status: 'warned' },
  } as const;

  for (const strategy of [
    'block',
    'warn',
    'detect',
  ] as const satisfies readonly CheckStrategy[]) {
    const observed: string[] = [];
    let releaseAudit: () => void = () =>
      assert.fail('audit release was not initialized');
    const auditRecorded = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    let settled = false;
    const pending = check({
      target: 'candidate-a',
      strategy,
      evaluate: () => [{ id: 'unsafe-claim' }],
      async onViolation(violation) {
        await auditRecorded;
        observed.push(violation.id);
      },
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    assert.equal(settled, false);
    releaseAudit();
    const result = await pending;
    assert.deepEqual(observed, ['unsafe-claim']);
    assert.equal(result.allowed, expected[strategy].allowed);
    assert.equal(result.status, expected[strategy].status);
    assert.deepEqual(result.violations, [{ id: 'unsafe-claim' }]);
  }
});

test('Harness redlines always block and report canonical gate violations', async () => {
  const input = safeHarnessPolicyInput();
  input.sourceRefs[0]!.workspaceId = 'workspace-foreign';
  const observed: string[] = [];

  const result = await checkHarnessRedlines({
    input,
    async onViolation(violation) {
      await Promise.resolve();
      observed.push(violation.gateId);
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.strategy, 'block');
  assert.deepEqual(observed, ['cross_workspace_lineage']);
  assert.deepEqual(
    result.violations.map(({ gateId }) => gateId),
    ['cross_workspace_lineage']
  );
});

function compileOnlyHarnessRedlineConstraints(input: HarnessPolicyInput) {
  void checkHarnessRedlines({
    input,
    onViolation() {},
    // @ts-expect-error Harness redlines are platform-owned and always block.
    strategy: 'warn',
  });
  void checkHarnessRedlines({
    input,
    onViolation() {},
    // @ts-expect-error Harness redlines cannot be sampled.
    sample: 0.5,
  });
}
void compileOnlyHarnessRedlineConstraints;

function safeHarnessPolicyInput(): HarnessPolicyInput {
  return {
    phase: 'execution',
    bundle: { revision: 1, workspaceId: 'workspace-a' },
    brief: {},
    candidate: {
      assetRefs: [],
      candidateId: 'candidate-a',
      factClaims: [],
      intendedUse: 'public_content',
      workspaceId: 'workspace-a',
    },
    identityRefs: [],
    rightsRefs: [],
    sourceRefs: [
      {
        id: 'source-a',
        revision: 1,
        status: 'current',
        workspaceId: 'workspace-a',
      },
    ],
  };
}
