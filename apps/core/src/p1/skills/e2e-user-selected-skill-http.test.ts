import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { DiagnosticRun } from '@meiye/contracts';

import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

const seedResult = {
  ready: true as const,
  publicSkill: {
    skillId: 'skill.e2e-user-selected',
    skillRevisionRef: 'skill.e2e-user-selected@1',
    title: 'E2E story beat',
    promptName: 'harness/copy-candidate',
    promptVersion: '1',
    promptNameAtVersion: 'harness/copy-candidate@1',
  },
  tenantIsolatedSkill: null,
};

test('e2e user_selected skill fixture is service-only and trusts workspace headers', async (t) => {
  const seeded: Array<{ workspaceId: string; foreignWorkspaceId?: string }> =
    [];
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    e2eUserSelectedSkillFixture: {
      async seed(input) {
        seeded.push({
          workspaceId: input.workspaceId,
          ...(input.foreignWorkspaceId
            ? { foreignWorkspaceId: input.foreignWorkspaceId }
            : {}),
        });
        return seedResult;
      },
    },
    e2eFixtureEnabled: true,
    serviceToken: 'e2e-user-selected-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/e2e/user-selected-skill-fixture`;
  const headers = {
    'x-service-token': 'e2e-user-selected-token',
    'x-user-id': 'merchant-user',
    'x-workspace-id': 'merchant-workspace',
    'x-workspace-role': 'owner',
  };

  const response = await fetch(
    `${url}?foreignWorkspaceId=foreign-workspace`,
    { headers, method: 'POST' },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, seedResult);
  assert.deepEqual(seeded, [
    {
      workspaceId: 'merchant-workspace',
      foreignWorkspaceId: 'foreign-workspace',
    },
  ]);

  const unauthorized = await fetch(url, {
    headers: { ...headers, 'x-service-token': 'wrong-token' },
    method: 'POST',
  });
  assert.equal(unauthorized.status, 401);
});

test('e2e user_selected skill evidence is service-only and workspace-scoped', async (t) => {
  const reads: Array<{ workspaceId: string; taskId: string }> = [];
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    e2eUserSelectedSkillEvidence: {
      async read(input) {
        reads.push(input);
        return {
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          userSelectedSkillRefs: ['skill.e2e-user-selected@1'],
          skillStages: {
            intent_naming: [
              {
                skillRevisionRef: 'skill.e2e-user-selected@1',
                contentHash: 'hash-1',
                promptNameAtVersion: 'harness/copy-candidate@1',
              },
            ],
          },
          rootAxes: {
            skillRevision: null,
            promptVersion: null,
            catalogRevision: 'catalog-r1',
            scene: 'intent text',
          },
          assemblyAudits: [
            {
              primitiveId: 'harness-assembly:task_pin',
              skillRevision: null,
              promptVersion: null,
              catalogRevision: 'catalog-r1',
              scene: 'intent text',
              axisScope: 'task_root',
            },
          ],
          injectedSkillRevisionRefs: ['skill.e2e-user-selected@1'],
        };
      },
    },
    e2eFixtureEnabled: true,
    serviceToken: 'e2e-user-selected-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/e2e/user-selected-skill-evidence`;

  const response = await fetch(`${url}?taskId=task-382`, {
    headers: {
      'x-service-token': 'e2e-user-selected-token',
      'x-user-id': 'merchant-user',
      'x-workspace-id': 'merchant-workspace',
      'x-workspace-role': 'owner',
    },
    method: 'POST',
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { injectedSkillRevisionRefs: string[] };
  };
  assert.deepEqual(body.data.injectedSkillRevisionRefs, [
    'skill.e2e-user-selected@1',
  ]);
  assert.deepEqual(reads, [
    { workspaceId: 'merchant-workspace', taskId: 'task-382' },
  ]);
});

test('e2e user_selected skill routes fail closed when fixture flag is off', async (t) => {
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    e2eUserSelectedSkillFixture: {
      async seed() {
        return seedResult;
      },
    },
    e2eUserSelectedSkillEvidence: {
      async read() {
        return null;
      },
    },
    serviceToken: 'e2e-user-selected-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const headers = {
    'x-service-token': 'e2e-user-selected-token',
    'x-user-id': 'merchant-user',
    'x-workspace-id': 'merchant-workspace',
    'x-workspace-role': 'owner',
  };

  for (const path of [
    '/v1/e2e/user-selected-skill-fixture',
    '/v1/e2e/user-selected-skill-evidence?taskId=task-382',
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers,
      method: 'POST',
    });
    assert.equal(response.status, 404, path);
  }
});
