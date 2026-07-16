import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CanvasAgentApplicationService,
  CanvasAgentError,
  MemoryCanvasAgentRepository,
  type CanvasAgentAuthorizationPort,
  type CanvasAgentOperation,
} from './canvas-agent.js';

const owner = {
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  correlationId: 'correlation-1',
};

function repository() {
  return new MemoryCanvasAgentRepository([
    {
      workspaceId: owner.workspaceId,
      projectId: 'project-1',
      revision: 3,
      nodes: [{ id: 'node-1', kind: 'text', data: { text: '原文案' } }],
      edges: [],
      assetVersions: { 'asset-1': 'asset-version-1' },
    },
  ]);
}

class MutableAgentAuthorization implements CanvasAgentAuthorizationPort {
  role: 'owner' | 'operator' | 'reviewer' = 'owner';
  roleRevision = 'role-v1';
  quotaRevision = 'quota-v1';
  capabilityRevision = 'capability-v1';
  assetGrantRevision = 'asset-grant-v1';

  async resolve(input: Parameters<CanvasAgentAuthorizationPort['resolve']>[0]) {
    return {
      assetGrantRevisions: Object.fromEntries(
        input.assetIds.map((assetId) => [assetId, this.assetGrantRevision]),
      ),
      operationCapabilityRevisions: Object.fromEntries(
        authorizationCapabilityKeys(input.operations).map((key) => [
          key,
          this.capabilityRevision,
        ]),
      ),
      quotaQuote: {
        id: 'agent-quota-1',
        maxCostMicros: input.maxCostMicros,
        maxGenerationCount: input.maxGenerationCount,
        operationHash: input.operationHash,
        revision: this.quotaRevision,
      },
      role: this.role,
      roleRevision: this.roleRevision,
    };
  }
}

function service(
  operations: CanvasAgentOperation[],
  repo = repository(),
  authorization = new MutableAgentAuthorization(),
) {
  return {
    authorization,
    repo,
    service: new CanvasAgentApplicationService(repo, {
      authorization,
      planner: { plan: async () => operations },
      clock: () => new Date('2026-07-16T10:00:00.000Z'),
      nonce: () => 'confirmation-nonce-1',
    }),
  };
}

test('confirmation read-set binds server-authoritative role, quota, capability and Asset grants', async () => {
  const { service: agent } = service([
    {
      tool: 'create_node',
      node: { id: 'node-2', kind: 'image', data: { assetId: 'asset-1' } },
    },
  ]);

  const plan = await agent.plan(owner, {
    sessionId: 'session-1',
    projectId: 'project-1',
    intent: '插入已授权素材',
    maxCostMicros: 0,
    maxGenerationCount: 0,
  });

  assert.deepEqual(plan.readSet, {
    assetVersions: { 'asset-1': 'asset-version-1' },
    authorization: {
      assetGrantRevisions: { 'asset-1': 'asset-grant-v1' },
      operationCapabilityRevisions: { create_node: 'capability-v1' },
      quotaQuote: {
        id: 'agent-quota-1',
        maxCostMicros: 0,
        maxGenerationCount: 0,
        operationHash: plan.operationHash,
        revision: 'quota-v1',
      },
      role: 'owner',
      roleRevision: 'role-v1',
    },
  });
});

test('delete confirmation exposes the removed node, edges and affected Assets', async () => {
  const repo = new MemoryCanvasAgentRepository([
    {
      assetVersions: { 'asset-1': 'asset-version-1' },
      edges: [{ from: 'node-1', id: 'edge-1', to: 'node-2' }],
      nodes: [
        { data: { text: '原文案' }, id: 'node-1', kind: 'text' },
        {
          data: { assetId: 'asset-1' },
          id: 'node-2',
          kind: 'image',
        },
      ],
      projectId: 'project-1',
      revision: 3,
      workspaceId: owner.workspaceId,
    },
  ]);
  const { service: agent } = service(
    [{ nodeId: 'node-2', tool: 'delete_node' }],
    repo,
  );

  const plan = await agent.plan(owner, {
    intent: '删除素材节点',
    maxCostMicros: 0,
    maxGenerationCount: 0,
    projectId: 'project-1',
    sessionId: 'session-1',
  });

  assert.deepEqual(plan.affectedAssetIds, ['asset-1']);
  assert.deepEqual(plan.diff[0], {
    after: null,
    before: {
      edges: [{ from: 'node-1', id: 'edge-1', to: 'node-2' }],
      node: {
        data: { assetId: 'asset-1' },
        id: 'node-2',
        kind: 'image',
      },
    },
    summary: '删除节点 node-2',
    tool: 'delete_node',
  });
});

test('apply rejects a changed authoritative role with zero canvas writes', async () => {
  const { service: agent, repo, authorization } = service([
    {
      tool: 'update_node',
      nodeId: 'node-1',
      patch: { text: '不应落盘' },
    },
  ]);
  const plan = await agent.plan(owner, {
    sessionId: 'session-1',
    projectId: 'project-1',
    intent: '修改文案',
    maxCostMicros: 0,
    maxGenerationCount: 0,
  });
  const confirmation = await agent.confirm(owner, {
    sessionId: 'session-1',
    planId: plan.id,
  });
  authorization.roleRevision = 'role-v2';

  await assert.rejects(
    agent.apply(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      credentialId: confirmation.credentialId,
      expectedRevision: 3,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'READ_SET_CHANGED',
  );
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.graphs[0]?.revision, 3);
  assert.equal(state.graphs[0]?.nodes[0]?.data.text, '原文案');
  assert.equal(state.outbox.length, 0);
  assert.equal(
    state.confirmations.find((item) => item.id === confirmation.credentialId)
      ?.usedAt,
    undefined,
  );
});

test('confirm refuses a plan after its authoritative quota quote changes', async () => {
  const { service: agent, repo, authorization } = service([
    {
      tool: 'update_node',
      nodeId: 'node-1',
      patch: { text: '新文案' },
    },
  ]);
  const plan = await agent.plan(owner, {
    sessionId: 'session-1',
    projectId: 'project-1',
    intent: '修改文案',
    maxCostMicros: 0,
    maxGenerationCount: 0,
  });
  authorization.quotaRevision = 'quota-v2';

  await assert.rejects(
    agent.confirm(owner, {
      sessionId: 'session-1',
      planId: plan.id,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'READ_SET_CHANGED',
  );
  assert.equal(repo.snapshot(owner.workspaceId).confirmations.length, 0);
});

test('apply rejects changed capability, quota or Asset grant facts without consuming confirmation', async (t) => {
  const cases: Array<{
    name: string;
    mutate(authorization: MutableAgentAuthorization): void;
  }> = [
    {
      name: 'operation capability',
      mutate(authorization) {
        authorization.capabilityRevision = 'capability-v2';
      },
    },
    {
      name: 'quota quote',
      mutate(authorization) {
        authorization.quotaRevision = 'quota-v2';
      },
    },
    {
      name: 'Asset grant',
      mutate(authorization) {
        authorization.assetGrantRevision = 'asset-grant-v2';
      },
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const { service: agent, repo, authorization } = service([
        {
          tool: 'create_node',
          node: {
            id: 'node-2',
            kind: 'image',
            data: { assetId: 'asset-1' },
          },
        },
      ]);
      const plan = await agent.plan(owner, {
        sessionId: 'session-1',
        projectId: 'project-1',
        intent: '插入素材',
        maxCostMicros: 0,
        maxGenerationCount: 0,
      });
      const confirmation = await agent.confirm(owner, {
        sessionId: 'session-1',
        planId: plan.id,
      });
      item.mutate(authorization);

      await assert.rejects(
        agent.apply(owner, {
          sessionId: 'session-1',
          projectId: 'project-1',
          credentialId: confirmation.credentialId,
          expectedRevision: 3,
        }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'READ_SET_CHANGED',
      );
      const state = repo.snapshot(owner.workspaceId);
      assert.equal(state.graphs[0]?.revision, 3);
      assert.equal(state.graphs[0]?.nodes.length, 1);
      assert.equal(state.outbox.length, 0);
      assert.equal(
        state.confirmations.find(
          (candidate) => candidate.id === confirmation.credentialId,
        )?.usedAt,
        undefined,
      );
    });
  }
});

test('apply rejects a changed Asset version with zero canvas writes', async () => {
  const { service: agent, repo } = service([
    {
      tool: 'create_node',
      node: { id: 'node-2', kind: 'image', data: { assetId: 'asset-1' } },
    },
  ]);
  const plan = await agent.plan(owner, {
    sessionId: 'session-1',
    projectId: 'project-1',
    intent: '插入素材',
    maxCostMicros: 0,
    maxGenerationCount: 0,
  });
  const confirmation = await agent.confirm(owner, {
    sessionId: 'session-1',
    planId: plan.id,
  });
  await repo.transact(owner.workspaceId, (state) => {
    const graph = state.graphs.find(
      (candidate) => candidate.projectId === 'project-1',
    );
    if (graph) graph.assetVersions['asset-1'] = 'asset-version-2';
  });

  await assert.rejects(
    agent.apply(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      credentialId: confirmation.credentialId,
      expectedRevision: 3,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'READ_SET_CHANGED',
  );
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.graphs[0]?.revision, 3);
  assert.equal(state.graphs[0]?.nodes.length, 1);
  assert.equal(state.outbox.length, 0);
});

test('a configured planner remains inactive when server authorization is not wired', async () => {
  const repo = repository();
  let plannerCalls = 0;
  const agent = new CanvasAgentApplicationService(repo, {
    planner: {
      async plan() {
        plannerCalls += 1;
        return [
          { tool: 'update_node', nodeId: 'node-1', patch: { text: '新文案' } },
        ];
      },
    },
  });

  await assert.rejects(
    agent.plan(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      intent: '修改文案',
      maxCostMicros: 0,
      maxGenerationCount: 0,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AGENT_AUTHORITY_UNAVAILABLE',
  );
  assert.equal(plannerCalls, 0);
  assert.equal(repo.snapshot(owner.workspaceId).plans.length, 0);
});

test('an unavailable planner remains the explicit inactive reason', async () => {
  const repo = repository();
  const agent = new CanvasAgentApplicationService(repo, {
    authorization: new MutableAgentAuthorization(),
    planner: {
      async plan() {
        throw new CanvasAgentError(
          'AGENT_PLANNER_UNAVAILABLE',
          'Canvas Agent is unavailable until a planner is configured.',
        );
      },
    },
  });

  await assert.rejects(
    agent.plan(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      intent: '修改文案',
      maxCostMicros: 0,
      maxGenerationCount: 0,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AGENT_PLANNER_UNAVAILABLE',
  );
  assert.equal(repo.snapshot(owner.workspaceId).plans.length, 0);
});

test('unknown tools are rejected before a confirmation can be issued', async () => {
  const { service: agent, repo } = service([
    { tool: 'run_shell' } as unknown as CanvasAgentOperation,
  ]);

  await assert.rejects(
    agent.plan(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      intent: '读取本地文件后修改画布',
      maxCostMicros: 0,
      maxGenerationCount: 0,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AGENT_TOOL_FORBIDDEN',
  );
  assert.equal(repo.snapshot(owner.workspaceId).confirmations.length, 0);
});

test('plans reject Asset references outside the workspace-scoped graph', async () => {
  const { service: agent, repo } = service([
    {
      tool: 'create_node',
      node: {
        id: 'node-foreign',
        kind: 'image',
        data: { assetId: 'foreign-asset-1' },
      },
    },
  ]);

  await assert.rejects(
    agent.plan(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      intent: '插入外部素材',
      maxCostMicros: 0,
      maxGenerationCount: 0,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'ASSET_NOT_FOUND',
  );
  assert.equal(repo.snapshot(owner.workspaceId).plans.length, 0);
});

test('confirmed operations are applied once and persist an immutable audit trail', async () => {
  const { service: agent, repo } = service([
    {
      tool: 'update_node',
      nodeId: 'node-1',
      patch: { text: '确认后的新文案' },
    },
    {
      tool: 'create_node',
      node: { id: 'node-2', kind: 'image', data: { assetId: 'asset-1' } },
    },
    { tool: 'connect_nodes', from: 'node-1', to: 'node-2' },
  ]);
  const plan = await agent.plan(owner, {
    sessionId: 'session-1',
    projectId: 'project-1',
    intent: '改文案并连接素材',
    maxCostMicros: 0,
    maxGenerationCount: 0,
  });
  assert.equal(plan.baseRevision, 3);
  assert.equal(plan.diff.length, 3);
  assert.deepEqual(plan.diff[0], {
    after: {
      data: { text: '确认后的新文案' },
      id: 'node-1',
      kind: 'text',
    },
    before: { data: { text: '原文案' }, id: 'node-1', kind: 'text' },
    summary: '修改节点 node-1',
    tool: 'update_node',
  });
  assert.deepEqual(plan.affectedAssetIds, ['asset-1']);
  assert.deepEqual(plan.readSet.assetVersions, {
    'asset-1': 'asset-version-1',
  });

  const confirmation = await agent.confirm(owner, {
    sessionId: 'session-1',
    planId: plan.id,
  });
  assert.equal(confirmation.maxCostMicros, 0);
  assert.deepEqual(confirmation.affectedAssetIds, ['asset-1']);
  assert.deepEqual(confirmation.diff, plan.diff);
  const result = await agent.apply(owner, {
    sessionId: 'session-1',
    projectId: 'project-1',
    credentialId: confirmation.credentialId,
    expectedRevision: 3,
  });

  assert.deepEqual(result, { status: 'changed', revision: 4 });
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.graphs[0]?.nodes.length, 2);
  assert.equal(state.graphs[0]?.edges.length, 1);
  assert.deepEqual(
    state.auditEvents.map((event) => event.outcome),
    ['changed', 'changed', 'changed'],
  );
  assert.deepEqual(
    state.auditEvents.map((event) => ({
      operationIndex: event.operationIndex,
      tool: event.tool,
    })),
    [
      { operationIndex: 0, tool: 'update_node' },
      { operationIndex: 1, tool: 'create_node' },
      { operationIndex: 2, tool: 'connect_nodes' },
    ],
  );

  await assert.rejects(
    agent.apply(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      credentialId: confirmation.credentialId,
      expectedRevision: 4,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'CONFIRMATION_ALREADY_USED',
  );
});

test('caller idempotency keys replay Agent plan, confirmation and apply', async () => {
  let plannerCalls = 0;
  const repo = repository();
  const agent = new CanvasAgentApplicationService(repo, {
    authorization: new MutableAgentAuthorization(),
    planner: {
      async plan() {
        plannerCalls += 1;
        return [
          { tool: 'update_node', nodeId: 'node-1', patch: { text: '幂等修改' } },
        ] satisfies CanvasAgentOperation[];
      },
    },
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
    nonce: () => 'confirmation-nonce-1',
  });
  const planInput = {
    idempotencyKey: 'plan-intent-1',
    intent: '修改文案',
    maxCostMicros: 0,
    maxGenerationCount: 0,
    projectId: 'project-1',
    sessionId: 'session-1',
  };
  const plan = await agent.plan(owner, planInput);
  assert.deepEqual(
    await agent.plan({ ...owner, correlationId: 'retry-correlation' }, planInput),
    plan,
  );
  assert.equal(plannerCalls, 1);
  const confirmationInput = {
    idempotencyKey: 'confirm-intent-1',
    planId: plan.id,
    sessionId: 'session-1',
  };
  const confirmation = await agent.confirm(owner, confirmationInput);
  assert.deepEqual(await agent.confirm(owner, confirmationInput), confirmation);
  const applyInput = {
    credentialId: confirmation.credentialId,
    expectedRevision: 3,
    idempotencyKey: 'apply-intent-1',
    projectId: 'project-1',
    sessionId: 'session-1',
  };
  const applied = await agent.apply(owner, applyInput);
  assert.deepEqual(await agent.apply(owner, applyInput), applied);
  await assert.rejects(
    agent.apply(owner, { ...applyInput, expectedRevision: 4 }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('concurrent Agent plan requests claim one caller before invoking the planner', async () => {
  const repo = repository();
  let plannerCalls = 0;
  let releasePlanner!: () => void;
  const plannerGate = new Promise<void>((resolve) => {
    releasePlanner = resolve;
  });
  const agent = new CanvasAgentApplicationService(repo, {
    authorization: new MutableAgentAuthorization(),
    planner: {
      async plan() {
        plannerCalls += 1;
        await plannerGate;
        return [
          { tool: 'update_node', nodeId: 'node-1', patch: { text: '并发幂等修改' } },
        ];
      },
    },
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });
  const input = {
    idempotencyKey: 'plan-concurrent-1',
    intent: '并发修改文案',
    maxCostMicros: 0,
    maxGenerationCount: 0,
    projectId: 'project-1',
    sessionId: 'session-1',
  };

  const first = agent.plan(owner, input);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    agent.plan(owner, input),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'IDEMPOTENCY_IN_PROGRESS',
  );
  assert.equal(plannerCalls, 1);
  releasePlanner();
  const planned = await first;
  assert.deepEqual(await agent.plan(owner, input), planned);
  assert.equal(plannerCalls, 1);
});

test('an expired plan claim can be reclaimed and the stale claimant cannot complete', async () => {
  const repo = repository();
  let currentTime = new Date('2026-07-16T10:00:00.000Z');
  let plannerCalls = 0;
  let releaseFirst!: () => void;
  const firstPlannerGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const agent = new CanvasAgentApplicationService(repo, {
    authorization: new MutableAgentAuthorization(),
    planner: {
      async plan() {
        plannerCalls += 1;
        const call = plannerCalls;
        if (call === 1) await firstPlannerGate;
        return [
          {
            tool: 'update_node',
            nodeId: 'node-1',
            patch: { text: `lease-${call}` },
          },
        ];
      },
    },
    clock: () => currentTime,
  });
  const input = {
    idempotencyKey: 'plan-expired-claim-1',
    intent: '修改文案',
    maxCostMicros: 0,
    maxGenerationCount: 0,
    projectId: 'project-1',
    sessionId: 'session-1',
  };

  const staleRequest = agent.plan(owner, input);
  await new Promise((resolve) => setImmediate(resolve));
  currentTime = new Date('2026-07-16T10:05:00.001Z');
  const recovered = await agent.plan(owner, input);
  assert.equal(recovered.diff[0]?.summary, '修改节点 node-1');
  assert.equal(plannerCalls, 2);

  releaseFirst();
  await assert.rejects(
    staleRequest,
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'IDEMPOTENCY_CLAIM_LOST',
  );
  assert.equal(repo.snapshot(owner.workspaceId).plans.length, 1);
});

test('a failed Agent planner releases its idempotency claim for a safe retry', async () => {
  const repo = repository();
  let plannerCalls = 0;
  const agent = new CanvasAgentApplicationService(repo, {
    authorization: new MutableAgentAuthorization(),
    planner: {
      async plan() {
        plannerCalls += 1;
        if (plannerCalls === 1) throw new Error('planner unavailable');
        return [
          { tool: 'update_node', nodeId: 'node-1', patch: { text: '重试成功' } },
        ];
      },
    },
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });
  const input = {
    idempotencyKey: 'plan-retry-1',
    intent: '修改文案',
    maxCostMicros: 0,
    maxGenerationCount: 0,
    projectId: 'project-1',
    sessionId: 'session-1',
  };

  await assert.rejects(agent.plan(owner, input), /planner unavailable/u);
  const planned = await agent.plan(owner, input);
  assert.equal(planned.diff[0]?.summary, '修改节点 node-1');
  assert.equal(plannerCalls, 2);
});

test('stale concurrent confirmation loses with zero canvas or generation writes', async () => {
  const repo = repository();
  const first = service(
    [
      {
        tool: 'update_node',
        nodeId: 'node-1',
        patch: { text: '会话 A' },
      },
    ],
    repo,
  ).service;
  const second = service(
    [
      {
        tool: 'update_node',
        nodeId: 'node-1',
        patch: { text: '会话 B' },
      },
    ],
    repo,
  ).service;

  const planA = await first.plan(owner, {
    sessionId: 'session-a',
    projectId: 'project-1',
    intent: '会话 A 修改',
    maxCostMicros: 0,
    maxGenerationCount: 0,
  });
  const planB = await second.plan(owner, {
    sessionId: 'session-b',
    projectId: 'project-1',
    intent: '会话 B 修改',
    maxCostMicros: 0,
    maxGenerationCount: 0,
  });
  const confirmationA = await first.confirm(owner, {
    sessionId: 'session-a',
    planId: planA.id,
  });
  const confirmationB = await second.confirm(owner, {
    sessionId: 'session-b',
    planId: planB.id,
  });
  await first.apply(owner, {
    sessionId: 'session-a',
    projectId: 'project-1',
    credentialId: confirmationA.credentialId,
    expectedRevision: 3,
  });

  await assert.rejects(
    second.apply(owner, {
      sessionId: 'session-b',
      projectId: 'project-1',
      credentialId: confirmationB.credentialId,
      expectedRevision: 3,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'REVISION_CONFLICT',
  );
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.graphs[0]?.revision, 4);
  assert.equal(state.outbox.length, 0);
  assert.equal(state.confirmations.find((item) => item.id === confirmationB.credentialId)?.usedAt, undefined);
});

test('an invalid batch is rejected before a confirmation can be issued', async () => {
  const { service: agent, repo } = service([
    {
      tool: 'create_node',
      node: { id: 'node-2', kind: 'text', data: { text: '暂存' } },
    },
    { tool: 'delete_node', nodeId: 'missing-node' },
  ]);
  await assert.rejects(
    agent.plan(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      intent: '创建后删除不存在节点',
      maxCostMicros: 0,
      maxGenerationCount: 0,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'NODE_NOT_FOUND',
  );
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.graphs[0]?.revision, 3);
  assert.equal(state.graphs[0]?.nodes.length, 1);
  assert.equal(state.plans.length, 0);
  assert.equal(state.confirmations.length, 0);
});

test('run_generation is rejected before confirmation while canonical dispatch is unavailable', async () => {
  const { service: agent, repo } = service([
    {
      tool: 'run_generation',
      operation: 'image.generate',
      prompt: '生成美甲成片',
      inputAssets: [],
    },
  ]);
  await assert.rejects(
    agent.plan(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      intent: '生成一张图',
      maxCostMicros: 1_500_000,
      maxGenerationCount: 1,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AGENT_GENERATION_UNAVAILABLE',
  );
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.plans.length, 0);
  assert.equal(state.confirmations.length, 0);
  assert.equal(state.outbox.length, 0);
});

test('run_generation applies through a once-only transactional outbox', async () => {
  const repo = repository();
  const authorization = new MutableAgentAuthorization();
  const agent = new CanvasAgentApplicationService(repo, {
    authorization,
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
    generationOutbox: {
      revisions: { 'image.generate': 'canvas-generation-outbox-v1' },
    },
    nonce: () => 'generation-confirmation-nonce',
    planner: {
      async plan() {
        return [
          {
            operation: 'image.generate' as const,
            prompt: '生成真实美甲成片',
            inputAssets: [],
            tool: 'run_generation' as const,
          },
        ];
      },
    },
  });
  const plan = await agent.plan(owner, {
    intent: '生成一张图',
    maxCostMicros: 1_500_000,
    maxGenerationCount: 1,
    projectId: 'project-1',
    sessionId: 'session-generation',
  });
  const confirmation = await agent.confirm(owner, {
    planId: plan.id,
    sessionId: 'session-generation',
  });
  const input = {
    credentialId: confirmation.credentialId,
    expectedRevision: 3,
    idempotencyKey: 'apply-generation-once',
    projectId: 'project-1',
    sessionId: 'session-generation',
  };

  assert.deepEqual(await agent.apply(owner, input), {
    revision: 4,
    status: 'executed',
  });
  assert.deepEqual(await agent.apply(owner, input), {
    revision: 4,
    status: 'executed',
  });
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.outbox.length, 1);
  const { batchId, id, idempotencyKey, revisionId, ...outboxItem } = state.outbox[0]!;
  assert.deepEqual(outboxItem, {
    attemptCount: 0,
    attemptEvents: [],
    assetGrantRevisions: {},
    assetVersions: {},
    availableAt: '2026-07-16T10:00:00.000Z',
    capabilityRevision: 'capability-v1',
    createdAt: '2026-07-16T10:00:00.000Z',
    dispatchRevision: 'canvas-generation-outbox-v1',
    inputAssets: [],
    operation: 'image.generate',
    projectId: 'project-1',
    prompt: '生成真实美甲成片',
    quotaQuote: { id: 'agent-quota-1', revision: 'quota-v1' },
    status: 'pending',
    userId: owner.userId,
    workspaceId: owner.workspaceId,
  });
  assert.match(id, /^agent-outbox-[a-f0-9]{32}$/u);
  assert.match(batchId, /^agent-generation-batch-[a-f0-9]{32}$/u);
  assert.match(idempotencyKey, /^agent-generation-[a-f0-9]{32}$/u);
  assert.match(revisionId, /^agent-revision-[a-f0-9]{32}$/u);
  assert.deepEqual(state.generationBatches, [
    {
      id: batchId,
      maxCostMicros: 1_500_000,
      maxGenerationCount: 1,
      reservations: [],
    },
  ]);
  assert.equal(
    state.confirmations.find(
      (candidate) => candidate.id === confirmation.credentialId,
    )?.usedAt,
    '2026-07-16T10:00:00.000Z',
  );
});

test('stale generation confirmation produces no second outbox item', async () => {
  const repo = repository();
  const createAgent = () =>
    new CanvasAgentApplicationService(repo, {
      authorization: new MutableAgentAuthorization(),
      clock: () => new Date('2026-07-16T10:00:00.000Z'),
      generationOutbox: {
        revisions: { 'image.generate': 'canvas-generation-outbox-v1' },
      },
      planner: {
        async plan() {
          return [
            {
              operation: 'image.generate' as const,
              prompt: '生成一张图',
              inputAssets: [],
              tool: 'run_generation' as const,
            },
          ];
        },
      },
    });
  const first = createAgent();
  const second = createAgent();
  const planA = await first.plan(owner, {
    intent: '会话 A',
    maxCostMicros: 1_000_000,
    maxGenerationCount: 1,
    projectId: 'project-1',
    sessionId: 'session-a',
  });
  const planB = await second.plan(owner, {
    intent: '会话 B',
    maxCostMicros: 1_000_000,
    maxGenerationCount: 1,
    projectId: 'project-1',
    sessionId: 'session-b',
  });
  const confirmationA = await first.confirm(owner, {
    planId: planA.id,
    sessionId: 'session-a',
  });
  const confirmationB = await second.confirm(owner, {
    planId: planB.id,
    sessionId: 'session-b',
  });
  await first.apply(owner, {
    credentialId: confirmationA.credentialId,
    expectedRevision: 3,
    projectId: 'project-1',
    sessionId: 'session-a',
  });

  await assert.rejects(
    second.apply(owner, {
      credentialId: confirmationB.credentialId,
      expectedRevision: 3,
      projectId: 'project-1',
      sessionId: 'session-b',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'REVISION_CONFLICT',
  );
  const state = repo.snapshot(owner.workspaceId);
  assert.equal(state.outbox.length, 1);
  assert.equal(
    state.confirmations.find(
      (candidate) => candidate.id === confirmationB.credentialId,
    )?.usedAt,
    undefined,
  );
});

test('run_generation binds and freezes explicit role-bearing Asset facts', async () => {
  const repo = repository();
  const authorization = new MutableAgentAuthorization();
  const agent = new CanvasAgentApplicationService(repo, {
    authorization,
    generationOutbox: {
      revisions: { 'image.edit': 'core-dispatch-image-edit-v3' },
    },
    planner: {
      async plan() {
        return [
          {
            inputAssets: [
              { assetId: 'asset-1', role: 'reference_image' as const },
            ],
            operation: 'image.edit' as const,
            prompt: 'Use the confirmed reference',
            tool: 'run_generation' as const,
          },
        ];
      },
    },
  });
  const plan = await agent.plan(owner, {
    intent: 'Edit from reference',
    maxCostMicros: 800_000,
    maxGenerationCount: 1,
    projectId: 'project-1',
    sessionId: 'session-role-assets',
  });

  assert.deepEqual(plan.affectedAssetIds, ['asset-1']);
  assert.deepEqual(plan.readSet.assetVersions, {
    'asset-1': 'asset-version-1',
  });
  assert.deepEqual(plan.readSet.authorization.assetGrantRevisions, {
    'asset-1': 'asset-grant-v1',
  });
  const confirmation = await agent.confirm(owner, {
    planId: plan.id,
    sessionId: 'session-role-assets',
  });
  await agent.apply(owner, {
    credentialId: confirmation.credentialId,
    expectedRevision: 3,
    projectId: 'project-1',
    sessionId: 'session-role-assets',
  });
  const outbox = repo.snapshot(owner.workspaceId).outbox[0];
  assert.deepEqual(outbox?.inputAssets, [
    { assetId: 'asset-1', role: 'reference_image' },
  ]);
  assert.equal(outbox?.capabilityRevision, 'capability-v1');
  assert.equal(outbox?.dispatchRevision, 'core-dispatch-image-edit-v3');
  assert.deepEqual(outbox?.assetVersions, {
    'asset-1': 'asset-version-1',
  });
  assert.deepEqual(outbox?.assetGrantRevisions, {
    'asset-1': 'asset-grant-v1',
  });
});

function authorizationCapabilityKeys(operations: CanvasAgentOperation[]) {
  return [
    ...new Set(
      operations.map((operation) =>
        operation.tool === 'run_generation'
          ? `run_generation:${operation.operation}`
          : operation.tool,
      ),
    ),
  ].sort();
}
