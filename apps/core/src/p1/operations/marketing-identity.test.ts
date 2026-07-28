import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerMarketingIdentityCommandSchema,
  type MarketingIdentityAsset,
  type MarketingIdentityProjection,
} from '@meiye/contracts';

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
      fieldProvenance: {
        displayName: 'user',
        owner: 'user',
        professionalBoundaries: 'user',
        expressionSamples: 'user',
        realWorldRole: 'user',
        sourceRef: 'user',
        allowedPlatforms: 'user',
        allowedScenes: 'user',
        portraitAuthorization: 'user',
        voiceAuthorization: 'user',
      },
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
    () => '2026-07-18T01:00:00.000Z'
  );
  const created = (await module.execute({
    context,
    input: registration(),
    idempotencyKey: 'register-1',
  })) as MarketingIdentityAsset;
  assert.equal(created.version, 1);

  const departed = (await module.execute({
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
  })) as MarketingIdentityAsset;
  assert.equal(departed.version, 2);
  assert.equal(departed.status, 'departed');
  assert.deepEqual(
    await repository.listActive('workspace-1', '2026-07-18T02:00:00.000Z'),
    []
  );
  assert.equal(
    (
      await repository.list(
        'workspace-1',
        { identityId: 'identity-1', includeInactive: true },
        '2026-07-18T02:00:00.000Z'
      )
    )[0]?.version,
    2
  );
});

test('identity commands reject stale expected versions', async () => {
  const repository = new MemoryMarketingIdentityRepository();
  await repository.register({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    occurredAt: '2026-07-18T01:00:00.000Z',
    command: registerMarketingIdentityCommandSchema.parse(
      registration().payload
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
    MarketingIdentityVersionConflictError
  );
});

test('assistant registration consumes an exact server draft revision', async () => {
  const repository = new MemoryMarketingIdentityRepository();
  const module = new MarketingIdentityFoundationModule(
    repository,
    () => '2026-07-18T01:00:00.000Z',
    {
      async suggest() {
        return {
          status: 'suggested',
          suggestion: {
            displayName: {
              value: '小美染发师',
              provenance: 'ai_suggestion',
            },
            owner: null,
            primaryClaimOrRole: null,
            professionalBoundaries: null,
            expressionSamples: null,
            forbiddenClaims: null,
            visualPrinciples: null,
            seriesAnchors: null,
          },
          errorCode: null,
        };
      },
    }
  );
  const draft = (await module.execute({
    context,
    input: {
      action: 'draft_marketing_identity',
      payload: {
        kind: 'person',
        background: '小美是店里的染发师',
      },
    },
    idempotencyKey: 'draft-1',
  })) as {
    draftId: string;
    revision: number;
  };
  const exact = registration('identity-assisted');
  exact.payload.displayName = '小美染发师';
  exact.payload.fieldProvenance.displayName = 'ai_suggestion';
  Object.assign(exact.payload, {
    assistantDraft: {
      draftId: draft.draftId,
      revision: draft.revision,
      confirmedFields: ['displayName'],
    },
  });

  const created = (await module.execute({
    context,
    input: exact,
    idempotencyKey: 'register-assisted',
  })) as MarketingIdentityAsset;
  assert.equal(created.displayName, '小美染发师');

  const tampered = registration('identity-tampered');
  tampered.payload.displayName = '系统替商家改的名字';
  tampered.payload.fieldProvenance.displayName = 'ai_suggestion';
  Object.assign(tampered.payload, {
    assistantDraft: {
      draftId: draft.draftId,
      revision: draft.revision,
      confirmedFields: ['displayName'],
    },
  });
  await assert.rejects(
    module.execute({
      context,
      input: tampered,
      idempotencyKey: 'register-tampered',
    }),
    /does not match draft revision/
  );
});

test('session selection is ledgered without changing the remembered default', async () => {
  const repository = new MemoryMarketingIdentityRepository();
  const module = new MarketingIdentityFoundationModule(
    repository,
    () => '2026-07-18T01:00:00.000Z'
  );
  await module.execute({
    context,
    input: registration('identity-brand'),
    idempotencyKey: 'register-brand',
  });
  await module.execute({
    context,
    input: registration('identity-person'),
    idempotencyKey: 'register-person',
  });

  await module.execute({
    context,
    input: {
      action: 'set_default_marketing_identity',
      payload: {
        expectedDecisionRevision: 0,
        identity: { identityId: 'identity-brand', version: 1 },
        reason: 'Remember the brand voice.',
      },
    },
    idempotencyKey: 'default-brand',
  });
  await module.execute({
    context,
    input: {
      action: 'select_marketing_identity_for_session',
      payload: {
        identity: { identityId: 'identity-person', version: 1 },
        reason: 'Use the owner voice for this session.',
        sessionId: 'composer-session-1',
      },
    },
    idempotencyKey: 'session-person',
  });

  const projection = (await module.query({
    context,
    input: {
      action: 'marketing_identity_projection',
      payload: {},
    },
  })) as MarketingIdentityProjection;
  assert.deepEqual(projection.defaultIdentity, {
    identityId: 'identity-brand',
    version: 1,
  });
  assert.equal(projection.decisionRevision, 2);
  assert.deepEqual(projection.defaultDecision, {
    decisionId: 'default-brand',
    decisionRevision: 1,
    identity: { identityId: 'identity-brand', version: 1 },
  });
  assert.deepEqual(
    (await repository.listDecisions(context.workspaceId, context.userId)).map(
      (event) => event.action
    ),
    ['set_default_marketing_identity', 'select_marketing_identity_for_session']
  );
});

test('a stale or inactive default is omitted from the canonical projection', async () => {
  const repository = new MemoryMarketingIdentityRepository();
  const module = new MarketingIdentityFoundationModule(
    repository,
    () => '2026-07-18T01:00:00.000Z'
  );
  await module.execute({
    context,
    input: registration(),
    idempotencyKey: 'register-identity',
  });
  await module.execute({
    context,
    input: {
      action: 'set_default_marketing_identity',
      payload: {
        expectedDecisionRevision: 0,
        identity: { identityId: 'identity-1', version: 1 },
        reason: 'Remember the owner voice.',
      },
    },
    idempotencyKey: 'default-identity',
  });
  await module.execute({
    context,
    input: {
      action: 'transition_marketing_identity',
      payload: {
        identityId: 'identity-1',
        expectedVersion: 1,
        transition: 'revoke',
        reason: '授权撤回',
      },
    },
    idempotencyKey: 'revoke-identity',
  });

  const projection = (await module.query({
    context,
    input: { action: 'marketing_identity_projection', payload: {} },
  })) as MarketingIdentityProjection;
  assert.equal(projection.defaultIdentity, null);
  assert.deepEqual(projection.defaultDecision, {
    decisionId: 'default-identity',
    decisionRevision: 1,
    identity: { identityId: 'identity-1', version: 1 },
  });
  assert.deepEqual(projection.identities, []);
});

test('default decisions use CAS and retain actor, time, before/after and rollback audit', async () => {
  const repository = new MemoryMarketingIdentityRepository();
  const module = new MarketingIdentityFoundationModule(
    repository,
    () => '2026-07-18T01:00:00.000Z'
  );
  await module.execute({
    context,
    input: registration('identity-brand'),
    idempotencyKey: 'register-brand',
  });
  await module.execute({
    context,
    input: registration('identity-person'),
    idempotencyKey: 'register-person',
  });

  const first = await repository.setDefault({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    occurredAt: '2026-07-18T01:01:00.000Z',
    decisionId: 'default-brand',
    command: {
      expectedDecisionRevision: 0,
      identity: { identityId: 'identity-brand', version: 1 },
      reason: 'Remember the brand voice.',
    },
  });
  const second = await repository.setDefault({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    occurredAt: '2026-07-18T01:02:00.000Z',
    decisionId: 'default-person',
    command: {
      expectedDecisionRevision: first.decisionRevision,
      identity: { identityId: 'identity-person', version: 1 },
      reason: 'Remember the owner voice.',
    },
  });
  await assert.rejects(
    repository.setDefault({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      occurredAt: '2026-07-18T01:03:00.000Z',
      decisionId: 'stale-default',
      command: {
        expectedDecisionRevision: first.decisionRevision,
        identity: { identityId: 'identity-brand', version: 1 },
        reason: 'Stale browser choice.',
      },
    }),
    /default changed/u
  );
  const rollback = await repository.rollbackDefault({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    occurredAt: '2026-07-18T01:04:00.000Z',
    decisionId: 'rollback-brand',
    command: {
      expectedDecisionRevision: second.decisionRevision,
      reason: 'Restore the prior brand voice.',
      targetDecisionRevision: first.decisionRevision,
    },
  });

  assert.deepEqual(rollback, {
    decisionId: 'rollback-brand',
    decisionRevision: 3,
    workspaceId: context.workspaceId,
    actorId: context.userId,
    action: 'rollback_default_marketing_identity',
    identity: { identityId: 'identity-brand', version: 1 },
    previousIdentity: { identityId: 'identity-person', version: 1 },
    reason: 'Restore the prior brand voice.',
    rolledBackToDecisionRevision: 1,
    sessionId: null,
    occurredAt: '2026-07-18T01:04:00.000Z',
  });
});
