import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstBatchAdminCapabilities,
  hasProductCapability,
  normalizeProductRole,
  p1ModuleRequestSchema,
  requiredP1Capability,
  requiredProductCommandCapability,
  type ProductCapability,
  type ProductRole,
} from '@meiye/contracts';

const roles: ProductRole[] = ['admin', 'owner', 'operator', 'reviewer'];

test('the four product roles share read access and keep fixed authority boundaries', () => {
  for (const role of roles) {
    assert.equal(hasProductCapability(role, 'workspace.read'), true);
  }

  assert.equal(hasProductCapability('admin', 'platform.manage'), true);
  assert.equal(hasProductCapability('owner', 'platform.manage'), false);

  assert.equal(hasProductCapability('owner', 'workspace.connections.manage'), true);
  assert.equal(
    hasProductCapability('operator', 'workspace.connections.manage'),
    false
  );
  assert.equal(hasProductCapability('operator', 'content.create'), true);
  assert.equal(hasProductCapability('reviewer', 'content.create'), false);
  assert.equal(hasProductCapability('reviewer', 'content.review'), true);
});

test('legacy Product commands resolve to the fixed four-role capability matrix', () => {
  assert.equal(
    requiredProductCommandCapability('confirm_store'),
    'workspace.profile.manage'
  );
  assert.equal(
    requiredProductCommandCapability('generate_copy'),
    'content.create'
  );
  assert.equal(
    requiredProductCommandCapability('select_content'),
    'content.review'
  );
  assert.equal(
    requiredProductCommandCapability('create_handoff'),
    'publication.handoff'
  );
  assert.equal(
    requiredProductCommandCapability('create_lead'),
    'lead.manage'
  );
  assert.equal(requiredProductCommandCapability('claim_video'), undefined);
  assert.equal(requiredProductCommandCapability('apply_plan'), undefined);
});

test('P1 module actions resolve to the same role capabilities used by the UI', () => {
  assert.equal(
    p1ModuleRequestSchema.parse({
      action: 'list_adoptions',
      module: 'advanced-canvas',
      payload: { projectId: 'project-1' },
    }).module,
    'advanced-canvas'
  );
  assert.equal(
    requiredP1Capability(
      'command',
      'advanced-canvas',
      'adopt_advanced_canvas_output'
    ),
    'content.review'
  );
  assert.equal(
    requiredP1Capability('query', 'advanced-canvas', 'list_adoptions'),
    'workspace.read'
  );
  assert.equal(
    requiredP1Capability(
      'command',
      'asset-memory',
      'record_asset_intake_batch'
    ),
    'content.create'
  );
  assert.equal(
    requiredP1Capability('command', 'asset-memory', 'confirm_reusable_asset'),
    'content.review'
  );
  assert.equal(
    requiredP1Capability('command', 'asset-memory', 'confirm_preference'),
    'personal.preferences.manage'
  );
  assert.equal(
    requiredP1Capability('query', 'asset-memory', 'preference_view'),
    'workspace.read'
  );
  assert.equal(
    requiredP1Capability('command', 'operations', 'create_task'),
    'content.create'
  );
  assert.equal(
    requiredP1Capability('command', 'operations', 'transition_task'),
    'content.review'
  );
  assert.equal(
    requiredP1Capability(
      'command',
      'operations',
      'accept_creative_asset'
    ),
    'content.review'
  );
  assert.equal(
    requiredP1Capability(
      'command',
      'operations',
      'revoke_content_package_rights'
    ),
    'content.review'
  );
  assert.equal(
    requiredP1Capability(
      'command',
      'operations',
      'admin_create_template'
    ),
    'config.publish'
  );
  assert.equal(
    requiredP1Capability('command', 'integrations', 'create_connection'),
    'workspace.connections.manage'
  );
  assert.equal(
    requiredP1Capability(
      'command',
      'model-supply',
      'video_workflow_select_candidate',
    ),
    'content.review',
  );
  assert.equal(
    requiredP1Capability('query', 'operations', 'inbox'),
    'workspace.read'
  );
  assert.equal(
    requiredP1Capability('command', 'admin-config', 'config_apply'),
    'config.publish',
  );
  assert.equal(
    requiredP1Capability('query', 'admin-config', 'config_list'),
    'config.publish',
  );
  assert.equal(
    requiredP1Capability('query', 'admin-config', 'config_defaults'),
    'workspace.read',
  );
  assert.equal(
    requiredP1Capability('command', 'redemptions', 'redeem'),
    'workspace.billing.manage',
  );
  assert.equal(
    requiredP1Capability('command', 'redemptions', 'create'),
    'account.commerce.govern',
  );
  assert.equal(
    requiredP1Capability('query', 'redemptions', 'list'),
    'account.commerce.govern',
  );
  // #83 consumer surface — publication.handoff stays registered.
  assert.equal(
    requiredP1Capability('command', 'integrations', 'submit_douyin_publish'),
    'publication.handoff',
  );
  assert.equal(hasProductCapability('operator', 'publication.handoff'), true);
});

test('unregistered module/action pairs default-deny (null required capability)', () => {
  assert.equal(
    requiredP1Capability('command', 'model-supply', 'totally_unknown_action'),
    null
  );
  assert.equal(
    requiredP1Capability('query', 'integrations', 'not_a_real_query'),
    null
  );
  assert.equal(
    requiredP1Capability('command', 'job-runtime', 'mystery_job_op'),
    null
  );
  assert.equal(
    requiredP1Capability('command', 'admin-config', 'config_delete_all'),
    null
  );
});

test('first-batch admin governance domains map and stay admin-only', () => {
  const domainSamples: Array<{
    capability: ProductCapability;
    kind: 'command' | 'query';
    module: Parameters<typeof requiredP1Capability>[1];
    action: string;
  }> = [
    {
      capability: 'system.capability.view',
      kind: 'query',
      module: 'job-runtime',
      action: 'observability',
    },
    {
      capability: 'task.recover',
      kind: 'command',
      module: 'model-supply',
      action: 'reconcile_cancelled_provider_terminal',
    },
    {
      capability: 'channel.lifecycle.manage',
      kind: 'command',
      module: 'model-supply',
      action: 'isolate_deployment',
    },
    {
      capability: 'config.publish',
      kind: 'command',
      module: 'admin-config',
      action: 'config_apply',
    },
    {
      capability: 'account.commerce.govern',
      kind: 'command',
      module: 'redemptions',
      action: 'create',
    },
    {
      capability: 'credential.govern',
      kind: 'command',
      module: 'integrations',
      action: 'admin_store_provider_credential',
    },
    {
      capability: 'audit.view',
      kind: 'query',
      module: 'integrations',
      action: 'audit',
    },
  ];

  assert.equal(firstBatchAdminCapabilities.length, 7);
  assert.deepEqual(
    [...firstBatchAdminCapabilities].sort(),
    domainSamples.map((sample) => sample.capability).sort()
  );

  for (const sample of domainSamples) {
    assert.equal(
      requiredP1Capability(sample.kind, sample.module, sample.action),
      sample.capability,
      `${sample.module}.${sample.action}`
    );
    assert.equal(
      hasProductCapability('admin', sample.capability),
      true,
      `admin has ${sample.capability}`
    );
    for (const role of ['owner', 'operator', 'reviewer'] as const) {
      assert.equal(
        hasProductCapability(role, sample.capability),
        false,
        `${role} lacks ${sample.capability}`
      );
    }
  }
});

test('Cloudflare write actions never resolve to a product capability', () => {
  for (const action of [
    'cloudflare_deploy',
    'cloudflare_rollback',
    'cloudflare_secret_put',
    'cloudflare_dns_write',
    'cloudflare_waf_write',
  ]) {
    assert.equal(
      requiredP1Capability('command', 'admin-config', action),
      null,
      action
    );
    assert.equal(
      requiredP1Capability('command', 'model-supply', action),
      null,
      action
    );
  }
});

test('global admin wins while workspace membership roles remain explicit', () => {
  assert.equal(
    normalizeProductRole({ platformRole: 'admin', workspaceRole: 'reviewer' }),
    'admin'
  );
  assert.equal(
    normalizeProductRole({ platformRole: 'user', workspaceRole: 'operator' }),
    'operator'
  );
  assert.equal(
    normalizeProductRole({ platformRole: 'user', workspaceRole: 'reviewer' }),
    'reviewer'
  );
  assert.equal(
    normalizeProductRole({ platformRole: 'user', workspaceRole: 'unknown' }),
    undefined
  );
});
