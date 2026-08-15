import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WORKSPACE_PROVISIONING_BACKOFF_CAP_MS,
  WORKSPACE_PROVISIONING_MAX_ATTEMPTS,
  isWorkspaceProvisioningDegraded,
  nextWorkspaceProvisioningRetry,
  shouldAllowDegradedCoreForward,
} from './workspace-provisioning';

describe('workspace provisioning retry policy', () => {
  it('pushes available_at later on each attempt and dead-letters at the cap', () => {
    const delays: number[] = [];
    const statuses: Array<'retry' | 'dead_letter'> = [];
    for (
      let attemptCount = 1;
      attemptCount <= WORKSPACE_PROVISIONING_MAX_ATTEMPTS;
      attemptCount += 1
    ) {
      const next = nextWorkspaceProvisioningRetry(attemptCount);
      delays.push(next.delayMs);
      statuses.push(next.status);
    }

    assert.deepEqual(delays.slice(0, 4), [1_000, 2_000, 4_000, 8_000]);
    for (let index = 1; index < delays.length; index += 1) {
      assert.ok(
        delays[index]! >= delays[index - 1]!,
        `delay at attempt ${index + 1} should not shrink`
      );
    }
    assert.equal(delays.at(-1), WORKSPACE_PROVISIONING_BACKOFF_CAP_MS);
    assert.equal(statuses.at(-1), 'dead_letter');
    assert.ok(
      statuses.slice(0, -1).every((status) => status === 'retry'),
      'attempts below the cap stay retryable'
    );
  });

  it('allows Core forward after trial completes even when model-default is stuck', () => {
    assert.equal(
      shouldAllowDegradedCoreForward({
        modelDefaultStatus: 'pending',
        ownerEmail: 'owner@example.test',
        ownerName: 'Owner',
        ownerUserId: 'user-1',
        status: 'dead_letter',
        trialStatus: 'completed',
        workspaceId: 'ws_user-1',
        workspaceName: 'Owner',
        lastErrorCode: 'INVALID_STATE',
      }),
      true
    );
    assert.equal(
      shouldAllowDegradedCoreForward({
        modelDefaultStatus: 'pending',
        ownerEmail: 'owner@example.test',
        ownerName: 'Owner',
        ownerUserId: 'user-1',
        status: 'retry',
        trialStatus: 'pending',
        workspaceId: 'ws_user-1',
        workspaceName: 'Owner',
        lastErrorCode: 'INVALID_STATE',
      }),
      false
    );
    assert.equal(shouldAllowDegradedCoreForward(null), true);
  });

  it('treats retry and dead-letter model-default gaps as merchant-visible degradation', () => {
    assert.equal(
      isWorkspaceProvisioningDegraded({
        modelDefaultStatus: 'pending',
        status: 'dead_letter',
        trialStatus: 'completed',
      }),
      true
    );
    assert.equal(
      isWorkspaceProvisioningDegraded({
        modelDefaultStatus: 'completed',
        status: 'completed',
        trialStatus: 'completed',
      }),
      false
    );
  });
});
