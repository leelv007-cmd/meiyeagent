import assert from 'node:assert/strict';
import test from 'node:test';

import { requiredP1Capability } from '@meiye/contracts';

import {
  GOVERNED_QUICK_ACTION_IDS,
  GOVERNED_QUICK_ACTIONS,
  buildGovernedActionContractPack,
  buildGovernedActionsPanelView,
  buildGovernedCommand,
  buildImpactPreview,
  getGovernedQuickAction,
  isValidImpactReason,
  resolveActionPermission,
  type GovernedActionTarget,
  type GovernedQuickActionId,
} from './admin-supply-quick-actions-model';

const REASON = 'Operator confirmed governed supply action after review';

function targetFor(id: GovernedQuickActionId): GovernedActionTarget {
  switch (id) {
    case 'publish':
    case 'rollback':
      return {
        resourceType: 'catalog_revision',
        resourceId: 'rev-42',
        expectedRevisionId: 'rev-41',
        idempotencyKey: `idem-${id}`,
      };
    case 'credential_rotate':
    case 'pre_revoke_impact_check':
      return {
        resourceType: 'credential_account',
        resourceId: 'cred-provider-ark',
        idempotencyKey: `idem-${id}`,
      };
    case 'route_simulate':
    case 'candidate_config_save':
    case 'candidate_config_validate':
      return {
        resourceType: 'operation',
        resourceId: 'copy.generate',
      };
    case 'health_balance_refresh':
      return {
        resourceType: 'pool',
        resourceId: 'pool-shared-default',
      };
    default:
      return {
        resourceType: 'channel',
        resourceId: 'channel-ark-direct',
        expectedRevisionId: 'ch-r1',
        idempotencyKey: `idem-${id}`,
      };
  }
}

test('full governed quick action set includes candidate authoring (13 actions)', () => {
  assert.equal(GOVERNED_QUICK_ACTION_IDS.length, 13);
  assert.equal(GOVERNED_QUICK_ACTIONS.length, 13);
  const panel = buildGovernedActionsPanelView();
  assert.equal(panel.count, 13);
  assert.equal(panel.forbids.secretEcho, true);
  assert.equal(panel.forbids.directDbWrite, true);
  assert.equal(panel.forbids.bypassPublishGate, true);
  assert.equal(panel.forbids.blindRetryAcceptedUnknownMedia, true);
});

test('action catalog no longer exposes retired stop_new_tasks (D6)', () => {
  assert.equal(
    (GOVERNED_QUICK_ACTION_IDS as readonly string[]).includes('stop_new_tasks'),
    false
  );
  assert.equal(
    GOVERNED_QUICK_ACTIONS.some(
      (action) => (action.id as string) === 'stop_new_tasks'
    ),
    false
  );
  assert.ok(GOVERNED_QUICK_ACTION_IDS.includes('channel_isolate'));
  assert.ok(GOVERNED_QUICK_ACTION_IDS.includes('drain'));
  assert.ok(GOVERNED_QUICK_ACTION_IDS.includes('channel_recover'));
});

test('each governed action: command + permission + preview + audit contract', () => {
  for (const id of GOVERNED_QUICK_ACTION_IDS) {
    const pack = buildGovernedActionContractPack({
      id,
      target: targetFor(id),
      reason: REASON,
      actorUserId: 'admin-1',
      correlationId: `corr-${id}`,
      before: { status: 'before' },
      after: { status: 'after' },
    });

    // command
    assert.equal(pack.command.module, pack.definition.module);
    assert.equal(pack.command.action, pack.definition.action);
    assert.equal(pack.command.kind, pack.definition.kind);
    assert.ok(pack.command.payload);
    assert.doesNotMatch(JSON.stringify(pack.command), /sk-[A-Za-z0-9]{8,}/);
    assert.doesNotMatch(
      JSON.stringify(pack.command.payload),
      /"(apiKey|password|authorization)"\s*:/
    );

    // permission (impact-review-dialog precedent + K1 registry)
    assert.equal(pack.permission, pack.definition.requiredPermission);
    const registry = requiredP1Capability(
      pack.definition.kind,
      pack.definition.module,
      pack.definition.action
    );
    if (registry !== null) {
      assert.equal(registry, pack.definition.requiredPermission);
      assert.equal(pack.permissionMatchesRegistry, true);
    }
    assert.equal(
      resolveActionPermission(pack.definition),
      pack.definition.requiredPermission
    );

    // preview
    if (pack.definition.requiresImpactPreview) {
      assert.ok(pack.preview.changes.length >= 1);
      assert.ok(pack.preview.scope.includes(pack.definition.label));
    }
    assert.ok(pack.preview.warnings.some((w) => w.includes('不暴露密钥')));
    assert.ok(pack.preview.warnings.some((w) => w.includes('不直写数据库')));
    assert.ok(pack.preview.warnings.some((w) => w.includes('不绕过发布门')));
    assert.ok(
      pack.preview.warnings.some((w) =>
        w.includes('accepted / acceptance_unknown')
      )
    );

    // audit
    assert.equal(pack.audit.permission, pack.permission);
    assert.equal(pack.audit.actor.userId, 'admin-1');
    assert.equal(pack.audit.target.action, pack.definition.action);
    assert.equal(pack.audit.reason, REASON);
    assert.equal(pack.audit.correlationId, `corr-${id}`);
    assert.ok(Date.parse(pack.audit.occurredAt));
    assert.equal(pack.definition.immutableAudit, true);

    // CAS / reversible flags preserved
    if (pack.definition.casIdempotency) {
      assert.ok(pack.command.idempotencyKey);
    }
    assert.equal(pack.preview.reversible, pack.definition.reversibleDrain);
  }
});

test('impact reason schema gate (impact-review-dialog precedent)', () => {
  assert.equal(isValidImpactReason(''), false);
  assert.equal(isValidImpactReason('short'), false);
  assert.equal(isValidImpactReason('   '), false);
  assert.equal(isValidImpactReason(REASON), true);

  const def = getGovernedQuickAction('publish');
  assert.throws(
    () => buildGovernedCommand(def, targetFor('publish'), 'nope'),
    /reason|8/i
  );
  assert.doesNotThrow(() =>
    buildGovernedCommand(def, targetFor('publish'), REASON)
  );
});

test('credential rotate command never carries secret values', () => {
  const pack = buildGovernedActionContractPack({
    id: 'credential_rotate',
    target: targetFor('credential_rotate'),
    reason: REASON,
  });
  assert.equal(pack.command.payload.rotate, true);
  assert.equal(pack.command.payload.credentialAccountId, 'cred-provider-ark');
  assert.equal('value' in pack.command.payload, false);
  assert.equal('credential' in pack.command.payload, false);
  assert.equal(pack.permission, 'credential.govern');
});

test('drain and isolate are reversible; publish is not', () => {
  assert.equal(getGovernedQuickAction('drain').reversibleDrain, true);
  assert.equal(getGovernedQuickAction('channel_isolate').reversibleDrain, true);
  assert.equal(getGovernedQuickAction('channel_recover').reversibleDrain, true);
  assert.equal(getGovernedQuickAction('publish').reversibleDrain, false);

  const drainPreview = buildImpactPreview(
    getGovernedQuickAction('drain'),
    targetFor('drain')
  );
  assert.equal(drainPreview.reversible, true);
  assert.ok(drainPreview.changes.some((c) => /排空|drain/i.test(c)));

  const isolatePreview = buildImpactPreview(
    getGovernedQuickAction('channel_isolate'),
    targetFor('channel_isolate')
  );
  assert.equal(isolatePreview.reversible, true);
  assert.ok(
    isolatePreview.changes.some((c) => /隔离|isolate|停新/i.test(c))
  );
});

test('pre-revoke impact check does not execute revoke', () => {
  const pack = buildGovernedActionContractPack({
    id: 'pre_revoke_impact_check',
    target: targetFor('pre_revoke_impact_check'),
    reason: REASON,
  });
  assert.equal(pack.command.payload.impactCheck, 'pre_revoke');
  assert.ok(pack.preview.changes.some((c) => c.includes('不执行撤销')));
  assert.equal(pack.command.kind, 'query');
});
