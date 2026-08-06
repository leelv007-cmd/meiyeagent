import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const recipeRoute = await import('./recipe-studio');
const skillsRoute = await import('./skills');
const { AdminRecipeStudioControl } = await import(
  '@/p1/admin-recipe-studio-control'
);
const {
  AdminSkillsControl,
  buildSkillCommandPayload,
  buildSkillGovernanceStartPayload,
  buildSkillPublishPayload,
  createGovernanceActionIntentRegistry,
  governanceRunPollInterval,
  mapSkillBindFormError,
  SKILL_WORKFLOW_BINDING_INVALID_MESSAGE,
} = await import('@/p1/admin-skills-control');
const { p1QueryKeys } = await import('@/p1/query-keys');

/** Renders the control with a seeded catalog so the table has rows to show. */
function renderSkillsControl(rows: Record<string, unknown>[] = []) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('skills', 'skill_prompt_reference', {
      slot: 'intentNaming',
    }),
    {
      contentHash:
        '18766ea9d01f41c3f0127bd960e1e29aa34da1fa0e5a7f915e941eff811b7838',
      eligibleForAcceptance: true,
      isFallback: false,
      label: 'production',
      name: 'harness/intent-naming',
      source: 'langfuse',
      version: '42',
    }
  );
  queryClient.setQueryData(
    p1QueryKeys.request('skills', 'skill_catalog_list', { tier: '' }),
    {
      items: rows,
      stats: {
        industryTierCorroborated: rows.filter(
          (row) => row.tier === 'industry' && row.sourceKind === 'induced'
        ).length,
        industryTierTotal: rows.filter((row) => row.tier === 'industry').length,
        total: rows.length,
      },
    }
  );
  // #360 catalog fixture — bind/define dropdown shares this port (#362).
  queryClient.setQueryData(
    p1QueryKeys.request('skills', 'published_recipe_workflow_revision_refs', {}),
    {
      workflowRevisionRefs: ['workflow.copy@1', 'workflow.image_text@1'],
    }
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminSkillsControl />
    </QueryClientProvider>
  );
}

test('Recipe Studio admin route exposes the complete four-gate production chain', () => {
  assert.equal(typeof recipeRoute.Route.options.component, 'function');
  const html = renderToStaticMarkup(<AdminRecipeStudioControl />);

  assert.match(html, /data-testid="recipe-studio-control"/);
  assert.match(html, /1\. 编译/);
  assert.match(html, /2\. 校验/);
  assert.match(html, /3\. 记录评测/);
  assert.match(html, /4\. 内测试跑/);
  assert.match(html, /切换 production/);
  assert.match(html, /回滚 production/);
  // Spec D #374: eval / internal-test gates are disabled without server receipts.
  assert.match(html, /data-testid="recipe-studio-eval-gate-disabled"/);
  assert.match(html, /data-testid="recipe-studio-internal-test-gate-disabled"/);
  assert.match(html, /data-testid="recipe-studio-evidence-disabled-notice"/);
  assert.match(html, /evidence-unavailable/);
  assert.doesNotMatch(html, /"passed"\s*:\s*true/);
  assert.doesNotMatch(html, /evalRun/);
});

test('Skills admin route exposes all five structured lifecycle commands', () => {
  assert.equal(typeof skillsRoute.Route.options.component, 'function');
  const html = renderSkillsControl();

  assert.match(html, /data-testid="admin-skills-control"/);
  assert.match(html, /<h2[^>]*>Skill 目录<\/h2>/);
  for (const label of [
    '新建做法',
    '受理并冻结',
    '绑定阶段',
    '回滚绑定',
    '登记部署',
  ]) {
    assert.ok(html.includes(label), `missing lifecycle command: ${label}`);
  }
  assert.doesNotMatch(html, /skills-payload/);
  assert.doesNotMatch(html, /data-ops-control="raw-json"/);
  assert.doesNotMatch(html, /<pre/);
  assert.doesNotMatch(html, /<option value="store"/);
  assert.doesNotMatch(html, /maxChildEffects|redlinePolicy/);
});

test('Skills admin route separates governed revision, Published, traffic, and retirement controls', () => {
  const html = renderSkillsControl([
    {
      skillId: 'skill.governed',
      name: '受控做法',
      description: '只允许修改已声明的两个槽位。',
      sourceKind: 'authored',
      tier: 'platform',
      presentationPolicy: 'explainable',
      activeRevisionRef: 'skill.governed@2',
      publicationGeneration: 2,
      updatedAt: '2026-07-30T00:00:00.000Z',
    },
  ]);

  assert.match(html, /受控修订/);
  assert.match(html, /Published（唯一）/);
  assert.match(html, /流量目标（新请求）/);
  assert.match(html, /反向依赖与退役/);
  assert.match(html, /治理运行/);
  assert.match(html, /管理取消（可恢复）/);
  assert.match(html, /业务终止（不可恢复）/);
  assert.match(html, /恢复管理取消/);
  assert.match(html, /只有“受控做法正文”和“一句话说明”可修改/);
  assert.match(
    html,
    /名称、来源、层级、治理预算、schema 与 prompt 引用保持只读/
  );
  assert.doesNotMatch(html, /data-ops-control="raw-json"/);
  assert.doesNotMatch(html, /skill_eval_run_fetch/);
  assert.doesNotMatch(html, /import|export|download/iu);
});

test('governed revision and Published payloads contain only their structured authority fields', () => {
  assert.deepEqual(
    buildSkillGovernanceStartPayload({
      baseSkillRevisionRef: 'skill.governed@2',
      description: '更新后的一句话说明。',
      expectedHeadRevision: '2',
      instruction: '只使用已确认事实。',
      runId: 'run-governed-3',
    }),
    {
      baseSkillRevisionRef: 'skill.governed@2',
      expectedHeadRevision: 2,
      patch: {
        instruction: '只使用已确认事实。',
        'manifest.description': '更新后的一句话说明。',
      },
      runId: 'run-governed-3',
    }
  );
  assert.deepEqual(
    buildSkillPublishPayload({
      expectedPublicationGeneration: '7',
      expectedPublishedRevisionRef: 'skill.governed@1',
      runId: 'run-publish-2',
      skillId: 'skill.governed',
      targetSkillRevisionRef: 'skill.governed@2',
    }),
    {
      expectedPublicationGeneration: 7,
      expectedPublishedRevisionRef: 'skill.governed@1',
      runId: 'run-publish-2',
      skillId: 'skill.governed',
      targetSkillRevisionRef: 'skill.governed@2',
    }
  );
  assert.deepEqual(
    buildSkillPublishPayload({
      expectedPublicationGeneration: '0',
      expectedPublishedRevisionRef: '',
      runId: 'run-publish-first',
      skillId: 'skill.first',
      targetSkillRevisionRef: 'skill.first@1',
    }),
    {
      expectedPublicationGeneration: 0,
      expectedPublishedRevisionRef: null,
      runId: 'run-publish-first',
      skillId: 'skill.first',
      targetSkillRevisionRef: 'skill.first@1',
    }
  );
});

test('a governance run keeps polling until it reaches a terminal status', () => {
  // An unreadable run disables every action button, so dropping the poll here
  // strands the panel until someone reloads the page.
  assert.equal(governanceRunPollInterval(undefined), 2_000);
  assert.equal(governanceRunPollInterval({ runId: 'run-poll' }), 2_000);
  assert.equal(
    governanceRunPollInterval({
      runId: 'run-poll',
      state: { status: 'awaiting_approval' },
    }),
    2_000
  );
  assert.equal(
    governanceRunPollInterval({
      runId: 'run-poll',
      state: { status: 'completed' },
    }),
    false
  );
  assert.equal(
    governanceRunPollInterval({
      runId: 'run-poll',
      workflowStatus: 'CANCELLED',
    }),
    false
  );
  assert.equal(
    governanceRunPollInterval({
      runId: 'run-poll',
      state: { status: 'cancelled' },
    }),
    false
  );
  assert.equal(
    governanceRunPollInterval({
      runId: 'run-poll',
      state: { status: 'awaiting_approval' },
      workflowStatus: 'ERROR',
    }),
    false
  );
  assert.equal(
    governanceRunPollInterval({
      runId: 'run-poll',
      state: { status: 'applying' },
      workflowStatus: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
    }),
    false
  );
});

test('governance action intents rotate after success and survive an ambiguous failure', async () => {
  let createdKeys = 0;
  const registry = createGovernanceActionIntentRegistry(
    () => `attempt-${++createdKeys}`
  );
  const submittedKeys: string[] = [];
  const submit = async (idempotencyKey: string) => {
    submittedKeys.push(idempotencyKey);
  };

  await registry.execute('skill_governance_cancel', 'run-cycle', submit);
  await registry.execute('skill_governance_resume', 'run-cycle', submit);
  await registry.execute('skill_governance_cancel', 'run-cycle', submit);
  await registry.execute('skill_governance_resume', 'run-cycle', submit);

  assert.equal(new Set(submittedKeys).size, 4);

  await assert.rejects(
    registry.execute(
      'skill_governance_cancel',
      'run-ambiguous',
      async (idempotencyKey) => {
        submittedKeys.push(idempotencyKey);
        throw new Error('response lost');
      }
    )
  );
  await registry.execute('skill_governance_cancel', 'run-ambiguous', submit);
  assert.equal(submittedKeys.at(-1), submittedKeys.at(-2));

  const longRunId = 'r'.repeat(150);
  await registry.execute('skill_governance_start', longRunId, submit);
  await registry.execute('skill_governance_business_cancel', longRunId, submit);
  for (const idempotencyKey of submittedKeys.slice(-2)) {
    assert.ok(idempotencyKey.length <= 200);
    assert.equal(idempotencyKey.includes(longRunId), false);
  }
});

test('structured Skill forms build the revision and acceptance contracts', () => {
  const promptReference = {
    contentHash:
      '18766ea9d01f41c3f0127bd960e1e29aa34da1fa0e5a7f915e941eff811b7838',
    eligibleForAcceptance: true,
    isFallback: false,
    label: 'production',
    name: 'harness/intent-naming',
    source: 'langfuse',
    version: '42',
  } as const;
  const publishedWorkflowRevisionRefs = [
    'workflow.copy@1',
    'workflow.image_text@1',
  ] as const;
  const definition = buildSkillCommandPayload(
    'skill_define',
    {
      description: 'A controlled description.',
      expectedRevision: '',
      instruction: 'Use only confirmed facts.',
      name: 'Controlled Skill',
      packageName: 'controlled-skill',
      presentationPolicy: 'explainable',
      skillId: 'skill.controlled',
      sourceKind: 'authored',
      tier: 'platform',
      workflowRevisionRefs: 'workflow.image_text@1\nworkflow.copy@1',
    },
    { promptReference, publishedWorkflowRevisionRefs }
  );
  assert.deepEqual(definition, {
    description: 'A controlled description.',
    expectedRevision: null,
    frontmatter: {
      description: 'A controlled description.',
      name: 'controlled-skill',
    },
    governance: {
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 10_000,
      },
      contextScopes: [],
      executionMode: 'prompt_materialized',
      fallback: 'fail_closed',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none',
      // Sorted; no default single-copy fill (Spec B / #362).
      workflowRevisionRefs: ['workflow.copy@1', 'workflow.image_text@1'],
    },
    instruction: 'Use only confirmed facts.',
    name: 'Controlled Skill',
    packagePaths: ['SKILL.md'],
    presentationPolicy: 'explainable',
    promptReference: {
      contentHash:
        '18766ea9d01f41c3f0127bd960e1e29aa34da1fa0e5a7f915e941eff811b7838',
      name: 'harness/intent-naming',
      version: '42',
    },
    skillId: 'skill.controlled',
    sourceKind: 'authored',
    tier: 'platform',
  });

  const acceptance = buildSkillCommandPayload(
    'skill_accept',
    {
      evalRunId: 'eval-controlled-1',
      skillRevisionRef: 'skill.controlled@1',
    },
    {}
  );
  assert.deepEqual(acceptance, {
    evalRunId: 'eval-controlled-1',
    skillRevisionRef: 'skill.controlled@1',
  });
  assert.doesNotMatch(JSON.stringify(acceptance), /recorded_fixture|passed/u);
  assert.throws(
    () =>
      buildSkillCommandPayload('skill_define', {
        description: 'Missing authority.',
        expectedRevision: '',
        instruction: 'Must not be sent.',
        name: 'Missing authority',
        packageName: 'missing-authority',
        presentationPolicy: 'backend_only',
        skillId: 'skill.missing-authority',
        sourceKind: 'authored',
        tier: 'platform',
      }),
    /production prompt 引用尚未就绪/u
  );
  assert.throws(
    () =>
      buildSkillCommandPayload(
        'skill_define',
        {
          description: 'Fallback authority.',
          expectedRevision: '',
          instruction: 'Must not be sent.',
          name: 'Fallback authority',
          packageName: 'fallback-authority',
          presentationPolicy: 'backend_only',
          skillId: 'skill.fallback-authority',
          sourceKind: 'authored',
          tier: 'platform',
        },
        {
          promptReference: {
            ...promptReference,
            eligibleForAcceptance: false,
            isFallback: true,
            source: 'builtin',
          },
        }
      ),
    /production prompt 引用尚未就绪/u
  );
  assert.throws(
    () =>
      buildSkillCommandPayload(
        'skill_define',
        {
          description: 'Missing workflow selection.',
          expectedRevision: '',
          instruction: 'Must not be sent.',
          name: 'Missing workflow',
          packageName: 'missing-workflow',
          presentationPolicy: 'backend_only',
          skillId: 'skill.missing-workflow',
          sourceKind: 'authored',
          tier: 'platform',
        },
        { promptReference, publishedWorkflowRevisionRefs }
      ),
    /至少选择一个治理工作流/u
  );
  assert.throws(
    () =>
      buildSkillCommandPayload(
        'skill_bind',
        {
          bindingId: 'binding.outside-catalog',
          harnessStage: 'intent_naming',
          mode: 'required',
          skillRevisionRef: 'skill.controlled@1',
          workflowRevisionRef: 'workflow.not-published@1',
        },
        { publishedWorkflowRevisionRefs }
      ),
    new RegExp(SKILL_WORKFLOW_BINDING_INVALID_MESSAGE, 'u')
  );
  assert.equal(
    mapSkillBindFormError(
      `upstream: ${SKILL_WORKFLOW_BINDING_INVALID_MESSAGE}`
    ),
    SKILL_WORKFLOW_BINDING_INVALID_MESSAGE
  );
});

test('fallback prompt authority disables the Skill lifecycle', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('skills', 'skill_catalog_list', { tier: '' }),
    {
      items: [],
      stats: {
        industryTierCorroborated: 0,
        industryTierTotal: 0,
        total: 0,
      },
    }
  );
  queryClient.setQueryData(
    p1QueryKeys.request('skills', 'published_recipe_workflow_revision_refs', {}),
    { workflowRevisionRefs: ['workflow.copy@1'] }
  );
  queryClient.setQueryData(
    p1QueryKeys.request('skills', 'skill_prompt_reference', {
      slot: 'intentNaming',
    }),
    {
      contentHash: '0'.repeat(64),
      eligibleForAcceptance: false,
      isFallback: true,
      label: 'builtin',
      name: 'harness/intent-naming',
      reasonCode: 'fallback_prompt',
      source: 'builtin',
      version: 'builtin-v1',
    }
  );
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminSkillsControl />
    </QueryClientProvider>
  );
  assert.match(html, /生命周期操作已禁用/);
  assert.match(html, /<button[^>]*disabled=""/);
});

test('Skills catalog renders the source column and its description', () => {
  const html = renderSkillsControl([
    {
      skillId: 'skill.beauty-story',
      name: '美业故事结构',
      description: '为美业内容提供已受理的故事结构。',
      sourceKind: 'induced',
      tier: 'industry',
      presentationPolicy: 'explainable',
      activeRevisionRef: 'skill.beauty-story@1',
      publicationGeneration: 1,
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
    {
      skillId: 'skill.public-hook',
      name: '公开钩子范式',
      description: '从公开范本转译而来的开头钩子。',
      sourceKind: 'harvested',
      tier: 'industry',
      presentationPolicy: 'explainable',
      activeRevisionRef: null,
      publicationGeneration: 0,
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
  ]);

  assert.ok(html.includes('归纳'), 'induced source label missing');
  assert.ok(html.includes('收割转译'), 'harvested source label missing');
  assert.ok(html.includes('行业层'), 'tier label missing');
  assert.ok(
    html.includes('为美业内容提供已受理的故事结构。'),
    'description is a required catalog column'
  );
  // One of two industry entries is induced, so the corroboration ratio the
  // moat metric depends on has to be computable straight off this column.
  assert.ok(html.includes('50%'), 'corroboration ratio missing');
});
