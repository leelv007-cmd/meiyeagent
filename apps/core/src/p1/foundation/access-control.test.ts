import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasProductCapability,
  normalizeProductRole,
  p1ModuleRequestSchema,
  requiredP1Capability,
  requiredProductCommandCapability,
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
    'platform.manage'
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
    'platform.manage',
  );
  assert.equal(
    requiredP1Capability('query', 'admin-config', 'config_list'),
    'platform.manage',
  );
  assert.equal(
    requiredP1Capability('query', 'admin-config', 'config_defaults'),
    'workspace.read',
  );
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
