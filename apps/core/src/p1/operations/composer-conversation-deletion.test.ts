import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requiredP1Capability } from '@meiye/contracts';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';

import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  OperationsError,
  OperationsFoundationModule,
  type ComposerConversationDeletedFact,
  type OperationContext,
} from './index.js';

const owner: OperationContext = {
  actor: 'owner',
  correlationId: 'corr-delete-conversation',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

function setup() {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(owner.userId, owner.workspaceId);
  const notifications: ComposerConversationDeletedFact[] = [];
  const service = new OperationsApplicationService(repository, {
    canvasExporter: {
      async export() {
        throw new Error('not used');
      },
    },
    creationExecutor: {
      async inspect() {},
      async submit() {
        throw new Error('not used');
      },
      async verify(input) {
        return { ...input, status: 'unknown' as const };
      },
    },
    imageGenerator: {
      async submit() {
        throw new Error('not used');
      },
    },
    notifier: { async send() {} },
  });
  service.attachComposerConversationDeletionNotifier({
    async notify(fact) {
      notifications.push(structuredClone(fact));
    },
  });
  return { notifications, repository, service };
}

describe('canonical Composer conversation deletion', () => {
  it('tombstones the conversation, retains its Works, emits one audit fact, and notifies memory idempotently', async () => {
    const { notifications, repository, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '为门店写一条真实内容',
      mode: 'agent',
      sessionId: 'composer:conversation-a',
      sourceReferences: [],
    });

    const first = await service.deleteComposerConversation(
      owner,
      'composer:conversation-a'
    );
    const second = await service.deleteComposerConversation(
      { ...owner, correlationId: 'corr-delete-conversation-retry' },
      'composer:conversation-a'
    );

    assert.deepEqual(first, second);
    assert.deepEqual(first, {
      action: 'composer_conversation.deleted',
      actorId: owner.userId,
      auditId: first.auditId,
      conversationId: 'composer:conversation-a',
      correlationId: owner.correlationId,
      deletedAt: first.deletedAt,
      workspaceId: owner.workspaceId,
    });
    assert.equal(notifications.length, 2);
    assert.deepEqual(notifications[0], first);
    assert.deepEqual(notifications[1], first);

    const state = await repository.loadWorkspace(owner.workspaceId);
    assert.equal(
      state?.creativeWorks.some(({ id }) => id === work.id),
      true
    );
    assert.equal(state?.composerConversations.length, 1);
    assert.equal(state?.composerConversations[0]?.deletedAt, first.deletedAt);
    assert.deepEqual(
      state?.auditEvents.filter(
        ({ action }) => action === 'composer_conversation.deleted'
      ),
      [
        {
          action: first.action,
          actorId: first.actorId,
          correlationId: first.correlationId,
          createdAt: first.deletedAt,
          details: { retainedWorkIds: [work.id] },
          entityId: first.conversationId,
          entityType: 'composer_conversation',
          id: first.auditId,
          workspaceId: first.workspaceId,
        },
      ]
    );
    assert.equal((await service.getCanonicalHistory(owner)).sessions.length, 0);
  });

  it('rejects a caller without membership before deleting another workspace conversation', async () => {
    const { notifications, repository, service } = setup();
    await service.createCreativeWork(owner, {
      intent: '为门店写一条真实内容',
      mode: 'agent',
      sessionId: 'composer:conversation-private',
      sourceReferences: [],
    });

    await assert.rejects(
      service.deleteComposerConversation(
        {
          actor: 'owner',
          correlationId: 'corr-attacker',
          userId: 'attacker',
          workspaceId: owner.workspaceId,
        },
        'composer:conversation-private'
      ),
      (error: unknown) => {
        assert.ok(error instanceof OperationsError);
        assert.equal(error.code, 'WORKSPACE_FORBIDDEN');
        assert.equal(error.status, 403);
        return true;
      }
    );

    assert.equal(notifications.length, 0);
    const state = await repository.loadWorkspace(owner.workspaceId);
    assert.equal(state?.composerConversations[0]?.deletedAt, undefined);
  });

  it('is reachable through the authorized Operations foundation command', async () => {
    const { service } = setup();
    await service.createCreativeWork(owner, {
      intent: '为门店写一条真实内容',
      mode: 'agent',
      sessionId: 'composer:conversation-foundation',
      sourceReferences: [],
    });
    const module = new OperationsFoundationModule(service);
    const foundation = new MemoryFoundationRepository();
    foundation.grantOwner(owner.workspaceId, owner.userId);
    const application = new P1ApplicationService(foundation, {
      operations: [module],
      writeOwnershipReader: async () => 'p1',
    });

    assert.equal(
      requiredP1Capability(
        'command',
        'operations',
        'delete_composer_conversation'
      ),
      'content.create'
    );
    const result = await application.executeModule<
      Record<string, unknown>,
      ComposerConversationDeletedFact
    >(
      owner,
      'operations',
      {
        action: 'delete_composer_conversation',
        payload: { conversationId: 'composer:conversation-foundation' },
      },
      'delete-composer-conversation-foundation'
    );

    assert.equal(result.action, 'composer_conversation.deleted');
    assert.equal(result.conversationId, 'composer:conversation-foundation');
  });
});
