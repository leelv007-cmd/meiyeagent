/**
 * Ops Console P1 action-boundary tests (V31-22).
 * Seam: publish reject (missing pin) / rollback reason+evidence /
 * unauthorized deny / audit trail / tool-policy in-place block /
 * unlanded kill switch cannot enable.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { AgentControlLimits } from '@meiye/contracts';
import {
  hasProductCapability,
  requiredP1Capability,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { P1DomainError } from '../foundation/domain.js';
import {
  defaultPromptPackBindings,
  HARNESS_PROMPT_PACKS,
  promptKeysForAllPacks,
} from '../harness/prompt-packs.js';
import {
  HarnessReleaseService,
  MemoryHarnessReleaseStore,
  type PublishHarnessReleaseInput,
} from '../harness/harness-release.js';
import { MemoryOpsConsoleAuditStore } from './audit.js';
import { OpsConsoleFoundationModule } from './foundation-module.js';
import { OPS_KILL_SWITCH_IDS } from './kill-switches.js';
import { OpsConsoleService } from './ops-console-service.js';
import {
  MemoryOpsCandidateTrialStore,
  MemoryOpsKillSwitchStore,
  MemoryOpsRollbackDrillStore,
} from './state-stores.js';
import { MemoryToolPolicyStore } from './tool-policy.js';

const TS = '2026-08-08T18:00:00.000Z';

const CONTROL_LIMITS: AgentControlLimits = {
  maxLlmSteps: 6,
  maxToolCalls: 8,
  maxRetrievalCalls: 4,
  maxMerchantQuestions: 1,
  maxReplans: 3,
  maxSchemaRepairs: 1,
  maxContextTokens: 32_000,
  maxDelegations: 2,
};

function fullPromptBindings(): PublishHarnessReleaseInput['promptBindings'] {
  const bindings: PublishHarnessReleaseInput['promptBindings'] = {};
  for (const key of promptKeysForAllPacks()) {
    bindings[key] = { key, version: `${key}@v1` };
  }
  return bindings;
}

function basePublish(
  releaseId: string,
  overrides: Partial<PublishHarnessReleaseInput> = {},
): PublishHarnessReleaseInput {
  return {
    releaseId,
    version: 1,
    agentSessionHarnessVersion: 'session/1',
    makeHarnessVersion: 'make/1',
    middlewareBindings: [
      {
        policyId: 'tenant-gate',
        revision: '1',
        kind: 'wrap_tool_call',
        order: 0,
        allowedControlActions: ['continue', 'end_turn'],
      },
    ],
    controlLimits: { ...CONTROL_LIMITS },
    supervisorPolicyRef: { id: 'sup', revision: '1' },
    memoryPolicyRef: { id: 'mem', revision: '1' },
    contextCompilerRef: { id: 'ctx', revision: '1' },
    planSchemaRevision: 'plan-schema/v1',
    promptBindings: fullPromptBindings(),
    promptPackBindings: defaultPromptPackBindings(),
    schemaBindings: { notePlan: 'note-plan/v1' },
    skillBindings: {
      copy: [{ skillId: 'copy-skill', revision: '1' }],
    },
    toolPolicyRevision: 'tool/1',
    modelPolicyRevision: 'model/1',
    factPolicyRevision: 'fact/1',
    rightsPolicyRevision: 'rights/1',
    budgetPolicyRevision: 'budget/1',
    evalSuiteRevision: 'eval/1',
    createdAt: TS,
    ...overrides,
  };
}

function adminCtx(userId = 'platform-admin-1'): P1Context {
  return {
    workspaceId: 'ws-ops',
    userId,
    correlationId: 'ops-console-test',
    actor: 'admin',
  };
}

function operatorCtx(): P1Context {
  return {
    workspaceId: 'ws-ops',
    userId: 'merchant-op',
    correlationId: 'ops-console-test',
    actor: 'operator',
  };
}

function createHarness() {
  const store = new MemoryHarnessReleaseStore();
  const releases = new HarnessReleaseService(store);
  const audit = new MemoryOpsConsoleAuditStore();
  const toolPolicies = new MemoryToolPolicyStore();
  const killSwitches = new MemoryOpsKillSwitchStore();
  const trials = new MemoryOpsCandidateTrialStore();
  const drills = new MemoryOpsRollbackDrillStore();
  const service = new OpsConsoleService({
    releases,
    catalog: store,
    toolPolicies,
    audit,
    killSwitches,
    trials,
    drills,
    langfuseBaseUrl: 'https://langfuse.example.test',
  });
  const module = new OpsConsoleFoundationModule(service);
  return { store, releases, service, module, audit, toolPolicies };
}

test('capability map: ops-console admin actions require platform.manage; operator lacks it', () => {
  for (const action of [
    'publish_release',
    'rollback_production',
    'set_kill_switch',
    'create_tool_policy_revision',
    'promote_to_production',
  ] as const) {
    assert.equal(
      requiredP1Capability('command', 'ops-console', action),
      'platform.manage',
      action,
    );
  }
  for (const action of [
    'list_releases',
    'diff_releases',
    'list_kill_switches',
    'list_audit',
  ] as const) {
    assert.equal(
      requiredP1Capability('query', 'ops-console', action),
      'platform.manage',
      action,
    );
  }
  assert.equal(hasProductCapability('admin', 'platform.manage'), true);
  assert.equal(hasProductCapability('operator', 'platform.manage'), false);
  assert.equal(hasProductCapability('owner', 'platform.manage'), false);
});

test('non-admin actor is rejected at ops-console module boundary', async () => {
  const { module } = createHarness();
  await assert.rejects(
    module.query({
      context: operatorCtx(),
      input: { action: 'list_releases', payload: {} },
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'FORBIDDEN' &&
      error.message.includes('admin'),
  );
  await assert.rejects(
    module.execute({
      context: operatorCtx(),
      input: {
        action: 'set_kill_switch',
        payload: {
          switchId: 'disable_memory_write',
          enabled: true,
          reason: 'try',
        },
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'FORBIDDEN',
  );
});

test('publish_release rejects missing prompt pin and surfaces pack key', async () => {
  const { module } = createHarness();
  const bindings = fullPromptBindings();
  delete bindings.copyGeneration;
  await assert.rejects(
    module.execute({
      context: adminCtx(),
      input: {
        action: 'publish_release',
        payload: {
          ...basePublish('rel-missing-pin'),
          promptBindings: bindings,
          promptPackBindings: {
            ...defaultPromptPackBindings(),
            copy: [...HARNESS_PROMPT_PACKS.copy],
          },
          reason: 'try ship incomplete pack',
        },
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      error.message.includes('copyGeneration') &&
      error.message.includes('prompt publish rejected'),
  );
});

test('publish → canary allowlist → candidate trial → promote → rollback with audit', async () => {
  const { module, service, releases } = createHarness();

  const published = (await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'publish_release',
      payload: {
        ...basePublish('rel-prod'),
        reason: 'initial production candidate',
      },
    },
  })) as unknown as {
    artifact: { releaseId: string };
    audit: { operatorId: string; reason: string; action: string };
  };
  assert.equal(published.artifact.releaseId, 'rel-prod');
  assert.equal(published.audit.operatorId, 'ops-a');
  assert.equal(published.audit.action, 'publish_release');

  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'transition_lifecycle',
      payload: {
        releaseId: 'rel-prod',
        toStatus: 'evaluating',
        reason: 'start eval',
        now: TS,
      },
    },
  });
  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'transition_lifecycle',
      payload: {
        releaseId: 'rel-prod',
        toStatus: 'canary',
        reason: 'enter canary',
        now: TS,
      },
    },
  });
  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'set_canary_allowlist',
      payload: {
        releaseId: 'rel-prod',
        workspaceAllowlist: ['ws-canary-1'],
        reason: 'pilot store',
        now: TS,
      },
    },
  });
  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'promote_to_production',
      payload: {
        releaseId: 'rel-prod',
        reason: 'gates passed; human promote (U12)',
        now: TS,
      },
    },
  });

  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'publish_release',
      payload: {
        ...basePublish('rel-next', {
          version: 2,
          toolPolicyRevision: 'tool/2',
          createdAt: '2026-08-08T19:00:00.000Z',
        }),
        reason: 'next candidate',
      },
    },
  });

  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'set_candidate_trial',
      payload: {
        workspaceId: 'ws-trial',
        candidateReleaseId: 'rel-next',
        reason: 'single-merchant trial',
        now: TS,
      },
    },
  });

  const trials = (await module.query({
    context: adminCtx(),
    input: { action: 'list_candidate_trials', payload: {} },
  })) as { items: { workspaceId: string; candidateReleaseId: string }[] };
  assert.equal(trials.items.length, 1);
  assert.equal(trials.items[0]?.candidateReleaseId, 'rel-next');

  // Candidate resolve path still owned by release service (U10).
  const trialResolve = await releases.resolveForRun({
    workspaceId: 'ws-trial',
    candidateReleaseId: 'rel-next',
  });
  assert.equal(trialResolve.selection, 'candidate');

  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'transition_lifecycle',
      payload: {
        releaseId: 'rel-next',
        toStatus: 'evaluating',
        reason: 'eval next',
        now: TS,
      },
    },
  });
  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'transition_lifecycle',
      payload: {
        releaseId: 'rel-next',
        toStatus: 'canary',
        reason: 'canary next',
        now: TS,
      },
    },
  });
  await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'promote_to_production',
      payload: {
        releaseId: 'rel-next',
        reason: 'manual promote next',
        now: '2026-08-08T20:00:00.000Z',
      },
    },
  });

  // In-flight frozen on rel-next before rollback.
  const inFlight = await releases.resolveForRun({
    workspaceId: 'ws-x',
    frozenReleaseId: 'rel-next',
  });
  assert.equal(inFlight.releaseId, 'rel-next');

  await assert.rejects(
    module.execute({
      context: adminCtx('ops-a'),
      input: {
        action: 'rollback_production',
        payload: {
          toReleaseId: 'rel-prod',
          reason: 'incident',
          // missing evidence
        },
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.message.includes('evidence'),
  );

  const rolled = (await module.execute({
    context: adminCtx('ops-b'),
    input: {
      action: 'rollback_production',
      payload: {
        toReleaseId: 'rel-prod',
        reason: 'error rate spike',
        evidence: 'incident-ticket-42 + langfuse traces',
        now: '2026-08-08T21:00:00.000Z',
      },
    },
  })) as unknown as {
    production: { releaseId: string; status: string };
    previousProduction: { releaseId: string; status: string } | null;
    audit: {
      operatorId: string;
      reason: string;
      evidence: string | null;
      action: string;
    };
  };
  assert.equal(rolled.production.releaseId, 'rel-prod');
  assert.equal(rolled.previousProduction?.releaseId, 'rel-next');
  assert.equal(rolled.previousProduction?.status, 'retired');
  assert.equal(rolled.audit.operatorId, 'ops-b');
  assert.equal(rolled.audit.evidence, 'incident-ticket-42 + langfuse traces');
  assert.equal(rolled.audit.action, 'rollback_production');

  const newTask = await releases.resolveForRun({ workspaceId: 'ws-x' });
  assert.equal(newTask.releaseId, 'rel-prod');
  const stillFrozen = await releases.resolveForRun({
    workspaceId: 'ws-x',
    frozenReleaseId: 'rel-next',
  });
  assert.equal(stillFrozen.releaseId, 'rel-next');

  const list = (await module.query({
    context: adminCtx(),
    input: { action: 'list_releases', payload: {} },
  })) as {
    production: string | null;
    items: { releaseId: string; status: string }[];
  };
  assert.equal(list.production, 'rel-prod');
  assert.ok(list.items.some((item) => item.releaseId === 'rel-next'));

  const audit = (await module.query({
    context: adminCtx(),
    input: { action: 'list_audit', payload: { limit: 50 } },
  })) as { items: { action: string; operatorId: string; reason: string }[] };
  assert.ok(audit.items.length >= 5);
  assert.ok(
    audit.items.some(
      (entry) =>
        entry.action === 'rollback_production' &&
        entry.operatorId === 'ops-b' &&
        entry.reason.includes('error rate'),
    ),
  );

  const diff = (await module.query({
    context: adminCtx(),
    input: {
      action: 'diff_releases',
      payload: { leftReleaseId: 'rel-prod', rightReleaseId: 'rel-next' },
    },
  })) as { changes: { path: string }[] };
  assert.ok(diff.changes.some((change) => change.path === 'toolPolicyRevision'));

  const langfuse = (await module.query({
    context: adminCtx(),
    input: {
      action: 'langfuse_release_url',
      payload: { releaseId: 'rel-prod' },
    },
  })) as { url: string | null };
  assert.ok(langfuse.url?.includes('langfuse.example.test'));
  assert.ok(langfuse.url?.includes('releaseId'));

  // Rollback drill record (pre-publish drill surface).
  const drill = (await module.execute({
    context: adminCtx('ops-a'),
    input: {
      action: 'record_rollback_drill',
      payload: {
        releaseId: 'rel-prod',
        result: 'passed',
        reason: 'pre-publish drill',
        evidence: 'drill-run-1',
        notes: 'new tasks flipped; in-flight frozen',
      },
    },
  })) as unknown as { drill: { result: string }; audit: { action: string } };
  assert.equal(drill.drill.result, 'passed');
  assert.equal(drill.audit.action, 'record_rollback_drill');
  assert.equal((await service.listRollbackDrills()).length, 1);
});

test('tool policy edits only create new revisions; in-place update is blocked', async () => {
  const { module } = createHarness();

  const created = (await module.execute({
    context: adminCtx(),
    input: {
      action: 'create_tool_policy_revision',
      payload: {
        toolName: 'read_confirmed_store_facts',
        revision: 'tp-1',
        description: 'Read confirmed store facts',
        sideEffect: 'none',
        riskClass: 'read',
        approval: 'never',
        allowedPhases: ['intent', 'plan'],
        dataClasses: ['store_fact'],
        maxCallsPerRun: 4,
        timeoutMs: 5_000,
        recentDenialReasons: [],
        reason: 'bootstrap policy',
      },
    },
  })) as unknown as {
    policy: { revision: string; toolName: string };
    audit: { action: string };
  };
  assert.equal(created.policy.revision, 'tp-1');
  assert.equal(created.audit.action, 'create_tool_policy_revision');

  // Same revision again → immutable conflict.
  await assert.rejects(
    module.execute({
      context: adminCtx(),
      input: {
        action: 'create_tool_policy_revision',
        payload: {
          toolName: 'read_confirmed_store_facts',
          revision: 'tp-1',
          description: 'tamper',
          sideEffect: 'none',
          riskClass: 'read',
          approval: 'never',
          allowedPhases: ['intent'],
          dataClasses: [],
          maxCallsPerRun: 1,
          timeoutMs: 1_000,
          recentDenialReasons: [],
          reason: 'try overwrite',
        },
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'IDEMPOTENCY_CONFLICT' &&
      error.message.includes('immutable'),
  );

  // Explicit update action is constructively blocked.
  await assert.rejects(
    module.execute({
      context: adminCtx(),
      input: {
        action: 'update_tool_policy',
        payload: {
          toolName: 'read_confirmed_store_facts',
          revision: 'tp-1',
          reason: 'try in-place',
        },
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      error.message.includes('In-place mutation') &&
      error.message.includes('new revision'),
  );

  // New revision is the only legal edit path.
  const next = (await module.execute({
    context: adminCtx(),
    input: {
      action: 'create_tool_policy_revision',
      payload: {
        toolName: 'read_confirmed_store_facts',
        revision: 'tp-2',
        description: 'Read confirmed store facts (v2)',
        sideEffect: 'none',
        riskClass: 'read',
        approval: 'never',
        allowedPhases: ['intent', 'plan', 'make'],
        dataClasses: ['store_fact'],
        maxCallsPerRun: 6,
        timeoutMs: 5_000,
        recentDenialReasons: ['quota'],
        reason: 'raise call ceiling',
      },
    },
  })) as unknown as { policy: { revision: string } };
  assert.equal(next.policy.revision, 'tp-2');

  const listed = (await module.query({
    context: adminCtx(),
    input: { action: 'list_tool_policies', payload: {} },
  })) as {
    items: { toolName: string; revisions: { revision: string }[] }[];
  };
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.revisions.length, 2);
});

test('kill switch panel lists seven switches; unlanded cannot enable; toggle leaves audit', async () => {
  const { module } = createHarness();

  const listed = (await module.query({
    context: adminCtx(),
    input: { action: 'list_kill_switches', payload: {} },
  })) as {
    items: {
      switchId: string;
      landed: boolean;
      canEnable: boolean;
      unavailableReason: string | null;
      impactScope: string;
      enabled: boolean;
    }[];
  };
  assert.equal(listed.items.length, OPS_KILL_SWITCH_IDS.length);
  assert.equal(listed.items.length, 7);
  const byId = new Map(listed.items.map((item) => [item.switchId, item]));
  // Landed by provider tickets: force_legacy_five_stage (V31-14),
  // disable_make_steering (V31-16), disable_proactive_agent (V31-24),
  // disable_memory_* (V31-18; ops flip dual-write marked landed in V31-26a).
  const landedIds = new Set([
    'force_legacy_five_stage',
    'disable_make_steering',
    'disable_proactive_agent',
    'disable_memory_write',
    'disable_memory_read',
  ]);
  for (const item of listed.items) {
    assert.ok(item.impactScope.length > 0);
    assert.equal(item.enabled, false);
    if (landedIds.has(item.switchId)) {
      assert.equal(item.landed, true);
      assert.equal(item.canEnable, true);
      assert.equal(item.unavailableReason, null);
    } else {
      assert.equal(item.landed, false);
      assert.equal(item.canEnable, false);
      assert.equal(item.unavailableReason, '提供方票未落地');
    }
  }
  assert.ok(byId.has('disable_proactive_agent'));
  assert.ok(byId.get('disable_make_steering')?.landed);

  await assert.rejects(
    module.execute({
      context: adminCtx(),
      input: {
        action: 'set_kill_switch',
        payload: {
          switchId: 'disable_agent_planning',
          enabled: true,
          reason: 'incident response',
        },
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.message.includes('提供方票未落地'),
  );

  // Landed kill switch can enable.
  const enabled = (await module.execute({
    context: adminCtx('ops-steer'),
    input: {
      action: 'set_kill_switch',
      payload: {
        switchId: 'disable_make_steering',
        enabled: true,
        reason: 'incident: pause mid-run steering',
      },
    },
  })) as unknown as {
    switch: { enabled: boolean; switchId: string };
  };
  assert.equal(enabled.switch.switchId, 'disable_make_steering');
  assert.equal(enabled.switch.enabled, true);

  // Disabling an already-off unlanded switch is a no-op-safe write (allowed)
  // so audit can still record explicit "confirm off" actions.
  const off = (await module.execute({
    context: adminCtx('ops-k'),
    input: {
      action: 'set_kill_switch',
      payload: {
        switchId: 'disable_agent_planning',
        enabled: false,
        reason: 'confirm default off during panel ship',
      },
    },
  })) as unknown as {
    switch: { enabled: boolean; switchId: string };
    audit: { operatorId: string; reason: string; action: string };
  };
  assert.equal(off.switch.enabled, false);
  assert.equal(off.audit.operatorId, 'ops-k');
  assert.equal(off.audit.action, 'set_kill_switch');
  assert.ok(off.audit.reason.includes('confirm default'));
});

test('V31-26a U14: archive gate fails closed without inventory; export and flag list wired', async () => {
  const { module, service } = createHarness();

  // Inventory not wired on default harness → fail closed.
  const unWired = (await module.query({
    context: adminCtx(),
    input: { action: 'legacy_replay_archive_gate', payload: {} },
  })) as {
    gate: { archiveAllowed: boolean; blockingReasons: string[] };
    inventory: null;
  };
  assert.equal(unWired.gate.archiveAllowed, false);
  assert.equal(unWired.inventory, null);
  assert.ok(
    unWired.gate.blockingReasons.some((reason) =>
      reason.includes('not wired'),
    ),
  );

  // Wire inventory + passed drill → still need hold/buffer unless never-had-legacy.
  const {
    MemoryLegacyReplayInventory,
  } = await import('./legacy-replay-archive-gate.js');
  const inv = new MemoryLegacyReplayInventory({
    activePendingCount: 0,
    oldestActiveCreatedAt: null,
    sampleTaskIds: [],
    lastLegacyTerminalAt: null,
  });
  // Recreate service with inventory via private deps is hard; call service method with deps.
  // Instead re-build module with inventory.
  const {
    MemoryOpsConsoleAuditStore,
  } = await import('./audit.js');
  const {
    MemoryOpsCandidateTrialStore,
    MemoryOpsKillSwitchStore,
    MemoryOpsRollbackDrillStore,
  } = await import('./state-stores.js');
  const { MemoryToolPolicyStore } = await import('./tool-policy.js');
  const { MemoryHarnessReleaseStore, HarnessReleaseService } = await import(
    '../harness/harness-release.js'
  );
  const { OpsConsoleService } = await import('./ops-console-service.js');
  const { OpsConsoleFoundationModule } = await import('./foundation-module.js');

  const store = new MemoryHarnessReleaseStore();
  const drills = new MemoryOpsRollbackDrillStore();
  const auditStore = new MemoryOpsConsoleAuditStore();
  const validInstallationEvidence = JSON.stringify({
    deploymentId: 'v31-26a-legacy-replay-ledger-v1',
    migrationChecksum: createHash('sha256')
      .update('v31-26a-legacy-replay-ledger-v1')
      .digest('hex'),
    installedAt: '2026-08-01T00:00:00.000Z',
    initialLegacyCount: 0,
    legacyTerminalAuditCount: 0,
  });
  let installationEvidence = validInstallationEvidence;
  const wiredService = new OpsConsoleService({
    releases: new HarnessReleaseService(store),
    catalog: store,
    toolPolicies: new MemoryToolPolicyStore(),
    audit: auditStore,
    killSwitches: new MemoryOpsKillSwitchStore(),
    trials: new MemoryOpsCandidateTrialStore(),
    drills,
    legacyReplayInventory: inv,
    resolveLegacyReplayInstallationEvidence: async () => installationEvidence,
  });
  const wired = new OpsConsoleFoundationModule(wiredService);

  // No rollback drill → fail closed even with zero inventory.
  const noDrill = (await wired.query({
    context: adminCtx(),
    input: {
      action: 'legacy_replay_archive_gate',
      payload: { now: '2026-08-09T00:00:00.000Z' },
    },
  })) as { gate: { archiveAllowed: boolean } };
  assert.equal(noDrill.gate.archiveAllowed, false);

  await drills.appendRollbackDrill({
    id: 'drill-1',
    releaseId: 'rel-1',
    result: 'passed',
    notes: 'V31-26a gate drill',
    operatorId: 'ops',
    reason: 'prove rollback path',
    evidence: 'unit-test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });

  const withoutProof = (await wired.query({
    context: adminCtx(),
    input: {
      action: 'legacy_replay_archive_gate',
      payload: { now: '2026-08-09T00:00:00.000Z' },
    },
  })) as {
    gate: { archiveAllowed: boolean };
    inventory: { activePendingCount: number };
  };
  assert.equal(withoutProof.gate.archiveAllowed, false);

  installationEvidence = JSON.stringify({
    ...JSON.parse(validInstallationEvidence),
    initialLegacyCount: 1,
  });
  await assert.rejects(
    () =>
      wired.execute({
        context: adminCtx(),
        input: {
          action: 'record_legacy_no_history_proof',
          payload: {
            reason: 'tampered ledger',
            evidence: 'forged',
          },
        },
      }),
    /authoritative zero history and installation evidence/,
  );
  installationEvidence = validInstallationEvidence;

  const proof = (await wired.execute({
    context: adminCtx(),
    input: {
      action: 'record_legacy_no_history_proof',
      payload: {
        reason: 'Verified the authoritative inventory has no legacy history',
        evidence: 'query-result:zero-rows',
        now: '2026-08-09T00:00:00.000Z',
      },
    },
    idempotencyKey: 'audit-no-history-1',
  })) as unknown as {
    action: string;
    detail: { installationEvidence: string; inventorySource: string };
  };
  assert.equal(proof.action, 'record_legacy_no_history_proof');
  assert.match(proof.detail.installationEvidence, /migrationChecksum/);
  assert.equal(
    proof.detail.inventorySource,
    'harness_runtime.task_requests+p1_execution_plan_snapshots',
  );

  const open = (await wired.query({
    context: adminCtx(),
    input: {
      action: 'legacy_replay_archive_gate',
      payload: { now: '2026-08-09T00:00:00.000Z' },
    },
  })) as {
    gate: { archiveAllowed: boolean };
    inventory: { activePendingCount: number };
  };
  assert.equal(open.gate.archiveAllowed, true);
  assert.equal(open.inventory.activePendingCount, 0);

  const exported = (await wired.query({
    context: adminCtx(),
    input: { action: 'export_legacy_replay_audit', payload: { limit: 10 } },
  })) as unknown as {
    exportedAt: string;
    audit: unknown[];
    rollbackDrills: { id: string }[];
    gate: { archiveAllowed: boolean };
  };
  assert.ok(exported.exportedAt);
  assert.equal(exported.rollbackDrills.length, 1);
  assert.equal(exported.gate.archiveAllowed, true);

  const flags = (await module.query({
    context: adminCtx(),
    input: { action: 'list_v31_feature_flags', payload: {} },
  })) as { items: { key: string; landed: boolean }[]; landedCount: number };
  assert.ok(flags.items.length >= 10);
  assert.ok(flags.landedCount >= 5);
  assert.ok(
    flags.items.some((item) => item.key === 'force_legacy_five_stage'),
  );

  // Capability map covers new queries.
  for (const action of [
    'legacy_replay_archive_gate',
    'export_legacy_replay_audit',
    'list_v31_feature_flags',
  ] as const) {
    assert.equal(
      requiredP1Capability('query', 'ops-console', action),
      'platform.manage',
    );
  }

  void service;
});
