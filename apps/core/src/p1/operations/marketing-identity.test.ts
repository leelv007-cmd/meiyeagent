import assert from 'node:assert/strict';
import test from 'node:test';
import { registerMarketingIdentityCommandSchema } from '@meiye/contracts';

import {
  MarketingIdentityFoundationModule,
  MarketingIdentityVersionConflictError,
  MemoryMarketingIdentityRepository,
} from './marketing-identity.js';

const context = {
  workspaceId: 'workspace-1',
  userId: 'owner-1',
  correlationId: 'correlation-1',
} as const;

function registration(identityId = 'identity-1') {
  return {
    action: 'register_marketing_identity',
    payload: {
      identityId,
      kind: 'person',
      expectedVersion: 0,
      displayName: '小美老师',
      owner: '张小美',
      professionalBoundaries: ['只分享染发与护发经验'],
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['brand_personal_ip'],
      expressionSamples: ['先看发质，再选发色。'],
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expiresAt: null,
      departureHandling: '离职后停止生成新内容。',
      sourceRef: 'authorization-1',
      realWorldRole: '染发师',
      portraitAuthorization: 'authorized',
      voiceAuthorization: 'not_authorized',
      historicalContentPermission: 'retain_published',
    },
  };
}

test('identity lifecycle is append-only and withdrawn identities are not active', async () => {
  const repository = new MemoryMarketingIdentityRepository();
  const module = new MarketingIdentityFoundationModule(
    repository,
    () => '2026-07-18T01:00:00.000Z',
  );
  const created = await module.execute({
    context,
    input: registration(),
    idempotencyKey: 'register-1',
  });
  assert.equal(created.version, 1);

  const departed = await module.execute({
    context,
    input: {
      action: 'transition_marketing_identity',
      payload: {
        identityId: 'identity-1',
        expectedVersion: 1,
        transition: 'depart',
        reason: '已离职',
      },
    },
    idempotencyKey: 'depart-1',
  });
  assert.equal(departed.version, 2);
  assert.equal(departed.status, 'departed');
  assert.deepEqual(
    await repository.listActive('workspace-1', '2026-07-18T02:00:00.000Z'),
    [],
  );
  assert.equal(
    (
      await repository.list(
        'workspace-1',
        { identityId: 'identity-1', includeInactive: true },
        '2026-07-18T02:00:00.000Z',
      )
    )[0]?.version,
    2,
  );
});

test('identity commands reject stale expected versions', async () => {
  const repository = new MemoryMarketingIdentityRepository();
  await repository.register({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    occurredAt: '2026-07-18T01:00:00.000Z',
    command: registerMarketingIdentityCommandSchema.parse(
      registration().payload,
    ),
  });

  await assert.rejects(
    repository.transition({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      occurredAt: '2026-07-18T02:00:00.000Z',
      command: {
        identityId: 'identity-1',
        expectedVersion: 2,
        transition: 'revoke',
        reason: '授权撤回',
      },
    }),
    MarketingIdentityVersionConflictError,
  );
});
