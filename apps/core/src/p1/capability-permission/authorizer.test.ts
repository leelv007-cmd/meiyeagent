import assert from 'node:assert/strict';
import test from 'node:test';
import { firstBatchAdminCapabilities } from '@meiye/contracts';
import {
  createPermissionAuthorizer,
  PermissionDeniedError,
} from './index.js';

const authorizer = createPermissionAuthorizer();

test('authorizer grants admin first-batch governance domains and denies owner', () => {
  const samples = [
    {
      capability: 'system.capability.view',
      kind: 'query' as const,
      module: 'job-runtime' as const,
      action: 'metrics',
    },
    {
      capability: 'task.recover',
      kind: 'command' as const,
      module: 'operations' as const,
      action: 'recover_task',
    },
    {
      capability: 'channel.lifecycle.manage',
      kind: 'command' as const,
      module: 'model-supply' as const,
      action: 'drain_channel',
    },
    {
      capability: 'config.publish',
      kind: 'command' as const,
      module: 'model-supply' as const,
      action: 'catalog_publish',
    },
    {
      capability: 'account.commerce.govern',
      kind: 'query' as const,
      module: 'redemptions' as const,
      action: 'list',
    },
    {
      capability: 'credential.govern',
      kind: 'command' as const,
      module: 'integrations' as const,
      action: 'admin_rotate_provider_credential',
    },
    {
      capability: 'audit.view',
      kind: 'query' as const,
      module: 'model-supply' as const,
      action: 'revision_rollback_audits',
    },
  ];

  assert.equal(samples.length, firstBatchAdminCapabilities.length);

  for (const sample of samples) {
    const admin = authorizer.decide({
      actor: 'admin',
      kind: sample.kind,
      module: sample.module,
      action: sample.action,
    });
    assert.equal(admin.allow, true);
    assert.equal(admin.required, sample.capability);

    const owner = authorizer.decide({
      actor: 'owner',
      kind: sample.kind,
      module: sample.module,
      action: sample.action,
    });
    assert.equal(owner.allow, false);
    assert.equal(owner.reason, 'capability_denied');
    assert.equal(owner.required, sample.capability);

    assert.throws(
      () =>
        authorizer.authorize({
          actor: 'owner',
          kind: sample.kind,
          module: sample.module,
          action: sample.action,
        }),
      (error: unknown) =>
        error instanceof PermissionDeniedError && error.code === 'FORBIDDEN'
    );
  }
});

test('authorizer default-denies unregistered module/action pairs', () => {
  const decision = authorizer.decide({
    actor: 'admin',
    kind: 'command',
    module: 'model-supply',
    action: 'not_registered_anywhere',
  });
  assert.deepEqual(decision, {
    allow: false,
    required: null,
    reason: 'unregistered',
  });

  assert.throws(
    () =>
      authorizer.authorize({
        actor: 'admin',
        kind: 'command',
        module: 'model-supply',
        action: 'not_registered_anywhere',
      }),
    (error: unknown) =>
      error instanceof PermissionDeniedError &&
      error.code === 'FORBIDDEN' &&
      /not registered/i.test(error.message)
  );
});

test('claimed capabilities cannot authorize unregistered propose or confirm actions', () => {
  for (const action of [
    'propose_unlisted_action',
    'confirm_unlisted_action',
    'confirm_creative_work_brief',
  ]) {
    const decision = authorizer.decide({
      actor: 'operator',
      kind: 'command',
      module: 'operations',
      action,
      permissions: ['content.create'],
    } as Parameters<typeof authorizer.decide>[0] & {
      permissions: string[];
    });
    assert.deepEqual(decision, {
      allow: false,
      required: null,
      reason: 'unregistered',
    });
  }

});

test('authorizer preserves publication.handoff for operators (#83 consumer)', () => {
  const decision = authorizer.decide({
    actor: 'operator',
    kind: 'command',
    module: 'integrations',
    action: 'submit_douyin_publish',
  });
  assert.equal(decision.allow, true);
  assert.equal(decision.required, 'publication.handoff');
});

test('authorizer keeps worker bypass and payment grant restriction', () => {
  assert.equal(
    authorizer.decide({
      actor: 'worker',
      kind: 'command',
      module: 'job-runtime',
      action: 'submit',
    }).allow,
    true
  );

  assert.equal(
    authorizer.decide({
      actor: 'payment',
      kind: 'command',
      module: 'entitlements',
      action: 'payment_grant',
    }).allow,
    true
  );

  const restricted = authorizer.decide({
    actor: 'payment',
    kind: 'command',
    module: 'entitlements',
    action: 'checkout_plan',
  });
  assert.equal(restricted.allow, false);
  assert.equal(restricted.reason, 'payment_actor_restricted');
});

test('StoreFact direct writes are browser-denied but remain available to workers', () => {
  for (const sample of [
    { module: 'context' as const, action: 'store_fact_append' },
    { module: 'asset-memory' as const, action: 'confirm_asset_intake_fact' },
  ]) {
    const browser = authorizer.decide({
      actor: 'owner',
      kind: 'command',
      module: sample.module,
      action: sample.action,
    });
    assert.deepEqual(browser, {
      allow: false,
      required: null,
      reason: 'unregistered',
    });
    assert.equal(
      authorizer.decide({
        actor: 'worker',
        kind: 'command',
        module: sample.module,
        action: sample.action,
      }).allow,
      true,
    );
  }
});

test('Cloudflare write verbs remain denied even for admin', () => {
  for (const action of [
    'cloudflare_deploy',
    'cloudflare_rollback',
    'cloudflare_secret_put',
  ]) {
    const decision = authorizer.decide({
      actor: 'admin',
      kind: 'command',
      module: 'admin-config',
      action,
    });
    assert.equal(decision.allow, false);
    assert.equal(decision.reason, 'unregistered');
  }
});

test('Cloudflare inventory is a registered read-only capability query', () => {
  assert.deepEqual(
    authorizer.decide({
      actor: 'admin',
      kind: 'query',
      module: 'admin-config',
      action: 'cloudflare_inventory',
    }),
    {
      allow: true,
      required: 'system.capability.view',
      reason: 'capability_granted',
    }
  );
  assert.deepEqual(
    authorizer.decide({
      actor: 'owner',
      kind: 'query',
      module: 'admin-config',
      action: 'cloudflare_inventory',
    }),
    {
      allow: false,
      required: 'system.capability.view',
      reason: 'capability_denied',
    }
  );
});

test('admin config reads require config publication capability', () => {
  assert.deepEqual(
    authorizer.decide({
      actor: 'admin',
      kind: 'query',
      module: 'admin-config',
      action: 'config_get',
    }),
    {
      allow: true,
      required: 'config.publish',
      reason: 'capability_granted',
    },
  );
  assert.deepEqual(
    authorizer.decide({
      actor: 'owner',
      kind: 'query',
      module: 'admin-config',
      action: 'config_get',
    }),
    {
      allow: false,
      required: 'config.publish',
      reason: 'capability_denied',
    },
  );
});
