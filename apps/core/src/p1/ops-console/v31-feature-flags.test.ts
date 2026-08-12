/**
 * V31-26a feature-flag flip + rollback drills.
 * Each landed control is flipped once and rolled back once with behavior proof.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKE_STEERING_FLAG,
  MAKE_STEERING_KILL_SWITCH,
  resolveMakeSteeringGate,
} from '../agent-session/steering-service.js';
import {
  AGENT_MEMORY_FLAGS,
  AGENT_MEMORY_KILL_SWITCH_KEYS,
  resolveAgentMemoryKillSwitch,
} from '../operations/agent-memory-platform.js';
import {
  PROACTIVE_KILL_SWITCH_KEYS,
  resolveProactiveGateConfig,
} from '../goal-proactive/evidence-gate.js';
import { resolveAgentSemanticEventAdapterEnabled } from '../agent-semantic-events/semantic-event-projector.js';
import { MemoryOpsKillSwitchStore } from './state-stores.js';
import { OpsConsoleService } from './ops-console-service.js';
import { MemoryOpsConsoleAuditStore } from './audit.js';
import { MemoryToolPolicyStore } from './tool-policy.js';
import {
  MemoryOpsCandidateTrialStore,
  MemoryOpsRollbackDrillStore,
} from './state-stores.js';
import {
  HarnessReleaseService,
  MemoryHarnessReleaseStore,
} from '../harness/harness-release.js';
import type { P1Context } from '../foundation/domain.js';
import {
  listLandedV31Flags,
  MemoryKillSwitchAdminConfigMirror,
  V31_FEATURE_FLAG_CATALOG,
  V31_KILL_SWITCHES_MIRROR_TO_ADMIN_CONFIG,
} from './v31-feature-flags.js';

function adminCtx(): P1Context {
  return {
    workspaceId: 'ws-flag',
    userId: 'ops-flag',
    correlationId: 'flag-drill',
    actor: 'admin',
  };
}

function memoryAdminReader(values: Map<string, unknown>) {
  return {
    async get(
      _scope: 'global' | 'workspace',
      _workspaceId: string,
      key: string,
    ) {
      if (!values.has(key)) return null;
      return { value: values.get(key) };
    },
  };
}

test('V31-26a catalog lists landed flags with flip paths', () => {
  const landed = listLandedV31Flags();
  assert.ok(landed.length >= 8);
  for (const entry of landed) {
    assert.ok(entry.flipPath, `${entry.key} landed without flipPath`);
    assert.ok(entry.legacyFallback.length > 0);
    assert.ok(entry.deleteCondition.length > 0);
  }
  // V31-26b executed 2026-08-12: the force-legacy switch left the catalog
  // together with the legacy five-stage runner it routed to.
  assert.ok(
    V31_FEATURE_FLAG_CATALOG.every(
      (entry) => entry.key !== 'force_legacy_five_stage',
    ),
  );
  assert.ok(V31_KILL_SWITCHES_MIRROR_TO_ADMIN_CONFIG.has('disable_make_steering'));
  assert.ok(V31_KILL_SWITCHES_MIRROR_TO_ADMIN_CONFIG.has('disable_memory_write'));
  assert.ok(
    V31_KILL_SWITCHES_MIRROR_TO_ADMIN_CONFIG.has('disable_proactive_agent'),
  );
});

test('drill: make_steering_v1 flag flip off then rollback restores enabled', async () => {
  const values = new Map<string, unknown>([[MAKE_STEERING_FLAG, true]]);
  const reader = memoryAdminReader(values);

  assert.equal((await resolveMakeSteeringGate(reader)).enabled, true);

  values.set(MAKE_STEERING_FLAG, false);
  assert.deepEqual(await resolveMakeSteeringGate(reader), {
    enabled: false,
    reason: 'feature_flag_off',
  });

  values.set(MAKE_STEERING_FLAG, true);
  assert.equal((await resolveMakeSteeringGate(reader)).enabled, true);
});

test('drill: disable_make_steering kill switch flip + rollback via admin-config mirror', async () => {
  const values = new Map<string, unknown>([
    [MAKE_STEERING_FLAG, true],
    [MAKE_STEERING_KILL_SWITCH, false],
  ]);
  const reader = memoryAdminReader(values);
  const mirror = new MemoryKillSwitchAdminConfigMirror();
  const killSwitches = new MemoryOpsKillSwitchStore();
  const service = new OpsConsoleService({
    releases: new HarnessReleaseService(new MemoryHarnessReleaseStore()),
    catalog: new MemoryHarnessReleaseStore(),
    toolPolicies: new MemoryToolPolicyStore(),
    audit: new MemoryOpsConsoleAuditStore(),
    killSwitches,
    trials: new MemoryOpsCandidateTrialStore(),
    drills: new MemoryOpsRollbackDrillStore(),
    killSwitchAdminConfigMirror: mirror,
  });

  assert.equal((await resolveMakeSteeringGate(reader)).enabled, true);

  const flipped = await service.setKillSwitch(
    adminCtx(),
    { switchId: 'disable_make_steering', enabled: true },
    { reason: 'drill flip on' },
  );
  assert.equal(flipped.switch.enabled, true);
  assert.equal(flipped.adminConfigMirrored, true);
  // Mirror applies to map used by runtime reader
  values.set(
    MAKE_STEERING_KILL_SWITCH,
    (await mirror.getBoolean(MAKE_STEERING_KILL_SWITCH)) === true,
  );
  assert.deepEqual(await resolveMakeSteeringGate(reader), {
    enabled: false,
    reason: 'kill_switch',
  });

  const rolled = await service.setKillSwitch(
    adminCtx(),
    { switchId: 'disable_make_steering', enabled: false },
    { reason: 'drill rollback off' },
  );
  assert.equal(rolled.switch.enabled, false);
  values.set(
    MAKE_STEERING_KILL_SWITCH,
    (await mirror.getBoolean(MAKE_STEERING_KILL_SWITCH)) === true,
  );
  assert.equal((await resolveMakeSteeringGate(reader)).enabled, true);
});

test('drill: disable_memory_write flip + rollback affects resolveAgentMemoryKillSwitch', async () => {
  const values = new Map<string, unknown>([
    [AGENT_MEMORY_FLAGS.read, true],
    [AGENT_MEMORY_FLAGS.candidateWrite, true],
    [AGENT_MEMORY_KILL_SWITCH_KEYS.disableWrite, false],
    [AGENT_MEMORY_KILL_SWITCH_KEYS.disableRead, false],
  ]);
  const reader = memoryAdminReader(values);
  const mirror = new MemoryKillSwitchAdminConfigMirror();
  const service = new OpsConsoleService({
    releases: new HarnessReleaseService(new MemoryHarnessReleaseStore()),
    catalog: new MemoryHarnessReleaseStore(),
    toolPolicies: new MemoryToolPolicyStore(),
    audit: new MemoryOpsConsoleAuditStore(),
    killSwitches: new MemoryOpsKillSwitchStore(),
    trials: new MemoryOpsCandidateTrialStore(),
    drills: new MemoryOpsRollbackDrillStore(),
    killSwitchAdminConfigMirror: mirror,
  });

  assert.equal(
    (await resolveAgentMemoryKillSwitch(reader)).disableMemoryWrite,
    false,
  );

  await service.setKillSwitch(
    adminCtx(),
    { switchId: 'disable_memory_write', enabled: true },
    { reason: 'drill memory write off' },
  );
  values.set(
    AGENT_MEMORY_KILL_SWITCH_KEYS.disableWrite,
    (await mirror.getBoolean('disable_memory_write')) === true,
  );
  assert.equal(
    (await resolveAgentMemoryKillSwitch(reader)).disableMemoryWrite,
    true,
  );

  await service.setKillSwitch(
    adminCtx(),
    { switchId: 'disable_memory_write', enabled: false },
    { reason: 'drill memory write rollback' },
  );
  values.set(
    AGENT_MEMORY_KILL_SWITCH_KEYS.disableWrite,
    (await mirror.getBoolean('disable_memory_write')) === true,
  );
  assert.equal(
    (await resolveAgentMemoryKillSwitch(reader)).disableMemoryWrite,
    false,
  );
});

test('drill: disable_proactive_agent flip + rollback', async () => {
  const values = new Map<string, unknown>([
    [PROACTIVE_KILL_SWITCH_KEYS.disableProactiveAgent, false],
    ['marketing_goal_v1', true],
  ]);
  const reader = memoryAdminReader(values);
  const mirror = new MemoryKillSwitchAdminConfigMirror();
  const service = new OpsConsoleService({
    releases: new HarnessReleaseService(new MemoryHarnessReleaseStore()),
    catalog: new MemoryHarnessReleaseStore(),
    toolPolicies: new MemoryToolPolicyStore(),
    audit: new MemoryOpsConsoleAuditStore(),
    killSwitches: new MemoryOpsKillSwitchStore(),
    trials: new MemoryOpsCandidateTrialStore(),
    drills: new MemoryOpsRollbackDrillStore(),
    killSwitchAdminConfigMirror: mirror,
  });

  let gate = await resolveProactiveGateConfig(reader, 'ws-1');
  assert.equal(gate.disableProactiveAgent, false);

  await service.setKillSwitch(
    adminCtx(),
    { switchId: 'disable_proactive_agent', enabled: true },
    { reason: 'drill proactive off' },
  );
  values.set(
    PROACTIVE_KILL_SWITCH_KEYS.disableProactiveAgent,
    (await mirror.getBoolean('disable_proactive_agent')) === true,
  );
  gate = await resolveProactiveGateConfig(reader, 'ws-1');
  assert.equal(gate.disableProactiveAgent, true);

  await service.setKillSwitch(
    adminCtx(),
    { switchId: 'disable_proactive_agent', enabled: false },
    { reason: 'drill proactive rollback' },
  );
  values.set(
    PROACTIVE_KILL_SWITCH_KEYS.disableProactiveAgent,
    (await mirror.getBoolean('disable_proactive_agent')) === true,
  );
  gate = await resolveProactiveGateConfig(reader, 'ws-1');
  assert.equal(gate.disableProactiveAgent, false);
});

test('drill: agent_semantic_event_adapter_v1 flip on then rollback off', async () => {
  const values = new Map<string, unknown>();
  const reader = memoryAdminReader(values);

  assert.equal(await resolveAgentSemanticEventAdapterEnabled(reader), false);

  values.set('agent_semantic_event_adapter_v1', true);
  assert.equal(await resolveAgentSemanticEventAdapterEnabled(reader), true);

  values.set('agent_semantic_event_adapter_v1', false);
  assert.equal(await resolveAgentSemanticEventAdapterEnabled(reader), false);
});

