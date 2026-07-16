import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from './application-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';

const owner = { workspaceId: 'ws-cutover', userId: 'owner', correlationId: 'corr' } as const;

describe('P1 expand-contract cutover', () => {
  it('requires reconciled evidence and rollback only changes future write ownership', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const service = new P1ApplicationService(repository);

    await assert.rejects(() => service.activateCutover(owner, {
      id: 'cutover-1', sourceRevision: 'legacy-7', targetRevision: 'p1-1',
      backupRef: 'backup://1', dryRunDifferenceCount: 1,
      inFlightDecision: 'legacy_drain'
    }, 'bad-cutover'), /differences/);

    const active = await service.activateCutover(owner, {
      id: 'cutover-1', sourceRevision: 'legacy-7', targetRevision: 'p1-1',
      backupRef: 'backup://1', dryRunDifferenceCount: 0,
      inFlightDecision: 'legacy_drain'
    }, 'good-cutover');
    assert.equal(active.futureWriteOwner, 'p1');

    const rolledBack = await service.rollbackFutureWrites(owner, {
      cutoverId: active.id, reason: 'runtime regression'
    }, 'rollback-cutover');
    assert.equal(rolledBack.futureWriteOwner, 'legacy');
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(rolledBack.targetRevision, 'p1-1');
  });
});
