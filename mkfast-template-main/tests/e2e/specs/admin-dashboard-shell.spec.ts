/**
 * T35 acceptance: 运营后台 on the D-130 template-dashboard shell.
 *
 * Journeys 1–4 run against the live stack and read the real admin-config /
 * model-supply / job-runtime projections. Journey 5 route-mocks only the Skills
 * query/command seam to prove browser dispatch shape; it is not live Core,
 * PostgreSQL, Langfuse, or provider evidence.
 *
 *   1. every admin page renders the new shell in both themes, and the merchant
 *      shell no longer wraps /admin;
 *   2. the credit-cycle coefficient moves through the governed admin-config
 *      API (CAS revision advances and the reason lands in its audit history);
 *   3. the model assembly page presents CatalogModel and ExecutionChannel as two
 *      layers, each separately operable.
 *   4. the wired merchant decision hold opens a bounded control and persists
 *      through the same reviewed, audited admin-config path.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const ADMIN_ROUTES = [
  ['/admin', '异常收口'],
  ['/admin/supply', '供给运行控制台'],
  ['/admin/supply/views/model', '供应关联视图'],
  ['/admin/supply/tasks/task-does-not-exist', '供应任务详情'],
  ['/admin/capabilities', '能力目录'],
  ['/admin/recipe-studio', 'Recipe Studio'],
  ['/admin/skills', 'Skills'],
  ['/admin/models', '模型资产与定价'],
  ['/admin/templates', '官方模板'],
  ['/admin/integrations', '集成治理'],
  ['/admin/plans', '套餐治理'],
  ['/admin/redemptions', '兑换治理'],
  ['/admin/users', '用户管理'],
  ['/admin/audit', '高影响操作审计'],
  ['/admin/cloudflare', 'Cloudflare 资源'],
] as const;

const ELIGIBLE_SKILL_PROMPT = {
  contentHash:
    '18766ea9d01f41c3f0127bd960e1e29aa34da1fa0e5a7f915e941eff811b7838',
  eligibleForAcceptance: true,
  isFallback: false,
  label: 'production',
  name: 'harness/intent-naming',
  source: 'langfuse',
  version: '42',
} as const;

interface CapturedSkillRequest {
  action: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((next) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

async function submitSkillAction(
  page: Page,
  action:
    | 'skill_define'
    | 'skill_accept'
    | 'skill_bind'
    | 'skill_rollback'
    | 'skill_deployment',
  values: Record<string, string>
) {
  await page.locator('#skills-action').selectOption(action);
  for (const [key, value] of Object.entries(values)) {
    const field = page.locator(`#skills-field-${key}`);
    await expect(field, `${action}.${key}`).toBeVisible();
    if ((await field.evaluate((node) => node.tagName)) === 'SELECT') {
      await field.selectOption(value);
    } else {
      await field.fill(value);
    }
  }
  const submit = page.getByRole('button', { name: '提交受控命令' });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  const responsePromise = page.waitForResponse((response) => {
    if (
      response.request().method() !== 'POST' ||
      !response.url().includes('/api/core/p1/commands')
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as
      | { action?: string; module?: string }
      | undefined;
    return body?.module === 'skills' && body.action === action;
  });
  await submit.click();
  const response = await responsePromise;
  const body = (await response.json()) as {
    error?: { code?: string; message?: string };
  };
  await expect(
    page.getByTestId('skills-operation-result').or(page.getByRole('alert'))
  ).toBeVisible({ timeout: 30_000 });
  return {
    accepted: response.ok(),
    action,
    errorCode: body.error?.code ?? null,
    errorMessage: body.error?.message ?? null,
    status: response.status(),
  };
}

async function installSkillDispatchMocks(page: Page) {
  const commands: CapturedSkillRequest[] = [];
  const queries: CapturedSkillRequest[] = [];
  let governanceRunStatus = 'awaiting_approval';
  let governanceWorkflowStatus = 'PENDING';

  await page.route('**/api/core/p1/query', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as
      | {
          action?: string;
          module?: string;
          payload?: Record<string, unknown>;
        }
      | undefined;
    if (body?.module !== 'skills' || !body.action) {
      await route.continue();
      return;
    }
    queries.push({
      action: body.action,
      payload: body.payload ?? {},
    });
    if (body.action === 'skill_prompt_reference') {
      await route.fulfill({
        contentType: 'application/json',
        status: 200,
        body: JSON.stringify({ data: ELIGIBLE_SKILL_PROMPT }),
      });
      return;
    }
    if (body.action === 'skill_catalog_list') {
      await route.fulfill({
        contentType: 'application/json',
        status: 200,
        body: JSON.stringify({
          data: {
            items: [
              {
                activeRevisionRef: 'skill.browser-published@1',
                description: 'Browser Published CAS fixture.',
                name: 'Browser Published',
                presentationPolicy: 'backend_only',
                publicationGeneration: 7,
                skillId: 'skill.browser-published',
                sourceKind: 'authored',
                tier: 'platform',
                updatedAt: '2026-07-30T12:00:00.000Z',
              },
            ],
            stats: {
              industryTierCorroborated: 0,
              industryTierTotal: 0,
              total: 1,
            },
          },
        }),
      });
      return;
    }
    if (body.action === 'skill_governance_run_get') {
      await route.fulfill({
        contentType: 'application/json',
        status: 200,
        body: JSON.stringify({
          data: {
            runId: body.payload?.runId,
            state: {
              result:
                governanceRunStatus === 'completed'
                  ? {
                      applied: true,
                      success: true,
                      validationResults: [
                        {
                          fieldPath: 'manifest.description',
                          reasonCode: 'field_applied',
                          status: 'applied',
                        },
                      ],
                    }
                  : governanceRunStatus === 'cancelled'
                    ? {
                        applied: false,
                        success: true,
                        validationResults: [
                          {
                            fieldPath: '$workflow',
                            reasonCode: 'governance_cancelled',
                            status: 'not_applied',
                          },
                        ],
                      }
                    : null,
              runId: body.payload?.runId,
              status: governanceRunStatus,
            },
            workflowStatus: governanceWorkflowStatus,
          },
        }),
      });
      return;
    }
    if (body.action === 'skill_reverse_dependencies') {
      const blocked =
        body.payload?.skillRevisionRef === 'skill.browser-blocked@1';
      await route.fulfill({
        contentType: 'application/json',
        status: 200,
        body: JSON.stringify({
          data: blocked
            ? {
                blocked: true,
                hiddenCount: 2,
                visibleDependencies: [
                  {
                    consumerId: 'binding-visible',
                    consumerKind: 'workflow_binding',
                    consumerLabel: '当前投放绑定',
                    scopeKind: 'workspace',
                  },
                  {
                    consumerId: 'published-visible',
                    consumerKind: 'published_lifecycle',
                    consumerLabel: '平台 Published 指针',
                    scopeKind: 'global',
                  },
                ],
                targetSkillRevisionRef: body.payload?.skillRevisionRef,
              }
            : {
                blocked: false,
                hiddenCount: 0,
                targetSkillRevisionRef: body.payload?.skillRevisionRef,
                visibleDependencies: [],
              },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      status: 400,
      body: JSON.stringify({
        error: {
          code: 'UNEXPECTED_SKILL_QUERY',
          message: `Unexpected Skill query: ${body.action}`,
        },
      }),
    });
  });

  await page.route('**/api/core/p1/commands', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as
      | {
          action?: string;
          module?: string;
          payload?: Record<string, unknown>;
        }
      | undefined;
    if (body?.module !== 'skills' || !body.action) {
      await route.continue();
      return;
    }
    commands.push({
      action: body.action,
      idempotencyKey: request.headers()['idempotency-key'],
      payload: body.payload ?? {},
    });
    if (body.action === 'skill_governance_start') {
      governanceRunStatus = 'awaiting_approval';
      governanceWorkflowStatus = 'PENDING';
    } else if (body.action === 'skill_governance_cancel') {
      governanceWorkflowStatus = 'CANCELLED';
    } else if (body.action === 'skill_governance_resume') {
      governanceWorkflowStatus = 'PENDING';
    } else if (body.action === 'skill_governance_business_cancel') {
      governanceRunStatus = 'cancelled';
      governanceWorkflowStatus = 'SUCCESS';
    } else if (body.action === 'skill_governance_approve') {
      governanceRunStatus = 'completed';
      governanceWorkflowStatus = 'SUCCESS';
    }
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({
        data:
          body.action === 'skill_publish'
            ? {
                applied: true,
                success: true,
                validationResults: [
                  {
                    fieldPath: 'activeRevisionRef',
                    reasonCode: 'field_applied',
                    status: 'applied',
                  },
                ],
              }
            : body.action === 'skill_retire'
              ? {
                  applied: false,
                  success: true,
                  validationResults: [
                    {
                      fieldPath: '$dependencies',
                      reasonCode: 'dependency_blocked',
                      status: 'not_applied',
                    },
                  ],
                }
              : {
                  accepted: true,
                  action: body.action,
                },
      }),
    });
  });

  return { commands, queries };
}

test('every admin page renders the template-dashboard shell in both themes', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) =>
    pageErrors.push(`${page.url()} :: ${error.stack ?? error.message}`)
  );
  try {
    await loginByForm(page, admin);

    for (const [path] of ADMIN_ROUTES) {
      await page.goto(path);

      // 换到 ReUI 壳之后壳根是 shadcn SidebarProvider（admin 是本仓唯一的
      // `@/components/ui/sidebar` 消费方，所以这个 slot 就是「后台壳在位」）。
      // Generous timeout: the first admin hit compiles the route cold.
      await expect(
        page.locator('[data-slot="sidebar-wrapper"]'),
        `${path} lost the shell. Page errors so far:\n${pageErrors.join('\n')}`
      ).toBeAttached({ timeout: 60_000 });
      await expect(
        page.locator('[data-slot="sidebar-menu-item"]').first()
      ).toBeVisible();
      // The merchant shell must not wrap 后台 any more (dev spec §56).
      await expect(page.locator('[data-shell-mode="admin"]')).toHaveCount(0);

      // Sample both themes and require them to actually differ. Asserting each
      // one is merely non-transparent is close to tautological — the surface
      // carries a background token, so it resolves to something whether or not
      // the theme took. Two readings that come back equal mean dark mode never
      // took, which is the failure this assertion exists to catch. 读数取侧栏
      // 内层（bg-sidebar，壳把 --sidebar 映到 --color-background）。
      const backgrounds: Record<string, string> = {};
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        backgrounds[theme] = await page
          .locator('[data-slot="sidebar-inner"]')
          .evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(backgrounds[theme], `${path} @ ${theme}`).not.toBe(
          'rgba(0, 0, 0, 0)'
        );
      }
      expect(
        backgrounds.light,
        `${path}: the shell background did not change between themes`
      ).not.toBe(backgrounds.dark);
      await setTheme(page, 'light');
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});

test('admin Skill catalog dispatches structured lifecycle and governance commands', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  const commandOutcomes: Array<{
    accepted: boolean;
    action: string;
    errorCode: string | null;
    errorMessage: string | null;
    status: number;
  }> = [];
  try {
    await loginByForm(page, admin);
    const dispatch = await installSkillDispatchMocks(page);
    await page.goto('/admin/skills');
    await expect(page.getByRole('heading', { name: 'Skill 目录' })).toBeVisible(
      {
        timeout: 30_000,
      }
    );
    await expect(page.locator('#skills-payload')).toHaveCount(0);
    await expect(page.locator('[data-ops-control="raw-json"]')).toHaveCount(0);
    await expect(
      page.getByTestId('capability-drilldown-banner')
    ).toHaveAttribute('data-page-id', 'skills');

    const suffix = Date.now().toString();
    const skillId = `skill.browser-${suffix}`;
    const packageName = `browser-${suffix}`;
    const skillRevisionRef = `${skillId}@1`;
    const workflowRevisionRef = 'workflow.copy@1';
    const bindingId = `binding-browser-${suffix}`;

    commandOutcomes.push(
      await submitSkillAction(page, 'skill_define', {
        description: '第一版结构化浏览器验收做法。',
        expectedRevision: '',
        instruction: '只使用已确认的门店事实。',
        name: `浏览器验收 ${suffix}`,
        packageName,
        presentationPolicy: 'explainable',
        skillId,
        sourceKind: 'authored',
        tier: 'platform',
      })
    );
    commandOutcomes.push(
      await submitSkillAction(page, 'skill_accept', {
        evalRunId: `eval-browser-${suffix}`,
        skillRevisionRef,
      })
    );
    commandOutcomes.push(
      await submitSkillAction(page, 'skill_bind', {
        bindingId,
        harnessStage: 'intent_naming',
        mode: 'required',
        skillRevisionRef,
        workflowRevisionRef,
      })
    );
    commandOutcomes.push(
      await submitSkillAction(page, 'skill_rollback', {
        bindingId: `binding-browser-${suffix}-rollback`,
        sourceBindingId: bindingId,
        targetSkillRevisionRef: skillRevisionRef,
        workflowRevisionRef,
      })
    );
    commandOutcomes.push(
      await submitSkillAction(page, 'skill_deployment', {
        channel: 'prompt-materialization',
        deploymentId: `deployment-browser-${suffix}`,
        nativeSkillId: `native-browser-${suffix}`,
        nativeVersion: '2',
        provider: 'core-harness',
        skillRevisionRef,
      })
    );

    await page.locator('#skills-governance-run-id').fill(`run-${suffix}`);
    await page.locator('#skills-governance-base-ref').fill(skillRevisionRef);
    await page.locator('#skills-governance-head').fill('1');
    await page
      .locator('#skills-governance-description')
      .fill('只更新受控的一句话说明。');
    await page
      .locator('#skills-governance-instruction')
      .fill('只使用已确认事实。');
    await page.getByRole('button', { name: '启动修订运行' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      'awaiting_approval'
    );
    await page.getByRole('button', { name: '管理取消（可恢复）' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      '管理取消（可恢复）'
    );
    await page.getByRole('button', { name: '恢复管理取消' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      'awaiting_approval'
    );
    await page.getByRole('button', { name: '管理取消（可恢复）' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      '管理取消（可恢复）'
    );
    await page.getByRole('button', { name: '恢复管理取消' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      'awaiting_approval'
    );
    await page.getByRole('button', { name: '批准并继续' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      'completed'
    );
    await expect(page.getByTestId('skill-governance-result')).toContainText(
      'manifest.description · field_applied · applied'
    );
    await page.reload();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      `run-${suffix} · completed`
    );
    await expect(page.getByTestId('skill-governance-result')).toContainText(
      'manifest.description · field_applied · applied'
    );
    await page
      .locator('#skills-governance-run-id')
      .fill(`run-business-cancel-${suffix}`);
    await page.locator('#skills-governance-base-ref').fill(skillRevisionRef);
    await page.locator('#skills-governance-head').fill('1');
    await page
      .locator('#skills-governance-description')
      .fill('业务终止不应用这次说明。');
    await page
      .locator('#skills-governance-instruction')
      .fill('业务终止不应用这次正文。');
    await page.getByRole('button', { name: '启动修订运行' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      `run-business-cancel-${suffix} · awaiting_approval`
    );
    await page.getByRole('button', { name: '业务终止（不可恢复）' }).click();
    await expect(page.getByTestId('skills-governance-run')).toContainText(
      '业务终止（不可恢复）'
    );
    await expect(page.getByTestId('skill-governance-result')).toContainText(
      '$workflow · governance_cancelled · not_applied'
    );
    await expect(
      page.getByRole('button', { name: '恢复管理取消' })
    ).toBeDisabled();

    await page.locator('#skills-publish-runId').fill(`publish-${suffix}`);
    await page
      .locator('#skills-publish-skillId')
      .fill('skill.browser-published');
    await page
      .locator('#skills-publish-targetSkillRevisionRef')
      .fill(skillRevisionRef);
    await page.getByRole('button', { name: '切换 Published' }).click();

    await page
      .locator('#skills-dependency-ref')
      .fill('skill.browser-blocked@1');
    await page.getByRole('button', { name: '查看反向依赖' }).click();
    await expect(page.getByTestId('skills-reverse-dependencies')).toContainText(
      '当前投放绑定'
    );
    await expect(page.getByTestId('skills-reverse-dependencies')).toContainText(
      '平台 Published 指针'
    );
    await expect(page.getByTestId('skills-reverse-dependencies')).toContainText(
      '其他工作区依赖 2'
    );
    await expect(
      page.getByRole('button', { name: '退役这个版本' })
    ).toBeDisabled();

    await page.locator('#skills-dependency-ref').fill(skillRevisionRef);
    await page.getByRole('button', { name: '查看反向依赖' }).click();
    await expect(page.getByTestId('skills-reverse-dependencies')).toContainText(
      '未发现依赖'
    );
    await page.locator('#skills-retire-run-id').fill(`retire-${suffix}`);
    await page.getByRole('button', { name: '退役这个版本' }).click();
    await expect(
      page.getByTestId('skill-governance-result').last()
    ).toContainText('success=true · applied=false');
    await expect(
      page.getByTestId('skill-governance-result').last()
    ).toContainText('$dependencies · dependency_blocked · not_applied');

    const promptQuery = dispatch.queries.find(
      (query) => query.action === 'skill_prompt_reference'
    );
    expect(promptQuery?.payload).toEqual({ slot: 'intentNaming' });

    const definition = dispatch.commands.find(
      (command) => command.action === 'skill_define'
    );
    expect(definition?.payload.promptReference).toEqual({
      contentHash: ELIGIBLE_SKILL_PROMPT.contentHash,
      name: ELIGIBLE_SKILL_PROMPT.name,
      version: ELIGIBLE_SKILL_PROMPT.version,
    });

    const acceptance = dispatch.commands.find(
      (command) => command.action === 'skill_accept'
    );
    expect(acceptance?.payload).toEqual({
      evalRunId: `eval-browser-${suffix}`,
      skillRevisionRef,
    });
    expect(acceptance?.payload).not.toHaveProperty('evalRun');
    expect(acceptance?.payload).not.toHaveProperty('passed');
    expect(acceptance?.payload).not.toHaveProperty('results');
    expect(acceptance?.payload).not.toHaveProperty('scorerRevision');

    expect(
      dispatch.commands.find(
        (command) => command.action === 'skill_governance_start'
      )?.payload
    ).toEqual({
      baseSkillRevisionRef: skillRevisionRef,
      expectedHeadRevision: 1,
      patch: {
        instruction: '只使用已确认事实。',
        'manifest.description': '只更新受控的一句话说明。',
      },
      runId: `run-${suffix}`,
    });
    expect(
      dispatch.commands.find((command) => command.action === 'skill_publish')
        ?.payload
    ).toEqual({
      expectedPublicationGeneration: 7,
      expectedPublishedRevisionRef: 'skill.browser-published@1',
      runId: `publish-${suffix}`,
      skillId: 'skill.browser-published',
      targetSkillRevisionRef: skillRevisionRef,
    });
    expect(
      dispatch.commands.find(
        (command) => command.action === 'skill_governance_cancel'
      )?.payload
    ).toEqual({
      runId: `run-${suffix}`,
    });
    expect(
      dispatch.commands.find(
        (command) => command.action === 'skill_governance_resume'
      )?.payload
    ).toEqual({
      runId: `run-${suffix}`,
    });
    const administrativeActionKeys = dispatch.commands
      .filter(
        (command) =>
          command.action === 'skill_governance_cancel' ||
          command.action === 'skill_governance_resume'
      )
      .map((command) => command.idempotencyKey);
    expect(administrativeActionKeys).toHaveLength(4);
    expect(administrativeActionKeys.every(Boolean)).toBe(true);
    expect(new Set(administrativeActionKeys).size).toBe(4);
    expect(
      dispatch.commands.find(
        (command) => command.action === 'skill_governance_business_cancel'
      )?.payload
    ).toEqual({
      runId: `run-business-cancel-${suffix}`,
    });
    expect(
      dispatch.commands.find((command) => command.action === 'skill_retire')
        ?.payload
    ).toEqual({
      runId: `retire-${suffix}`,
      skillRevisionRef,
    });

    const commandActions = dispatch.commands.map((command) => command.action);
    const queryActions = dispatch.queries.map((query) => query.action);
    for (const action of [
      'skill_define',
      'skill_accept',
      'skill_bind',
      'skill_rollback',
      'skill_deployment',
    ]) {
      expect(
        commandActions.filter((candidate) => candidate === action).length
      ).toBeGreaterThanOrEqual(1);
    }
    for (const action of [
      'skill_governance_start',
      'skill_governance_approve',
      'skill_governance_business_cancel',
      'skill_governance_cancel',
      'skill_governance_resume',
      'skill_publish',
      'skill_retire',
    ]) {
      expect(commandActions).toContain(action);
    }
    expect(queryActions).toContain('skill_catalog_list');
    expect(queryActions).toContain('skill_prompt_reference');
    expect(queryActions).toContain('skill_governance_run_get');
    expect(queryActions).toContain('skill_reverse_dependencies');
    expect(queryActions).not.toContain('skill_eval_run_fetch');
    for (const request of [...dispatch.commands, ...dispatch.queries].filter(
      ({ action }) =>
        action.startsWith('skill_governance_') ||
        [
          'skill_publish',
          'skill_retire',
          'skill_reverse_dependencies',
        ].includes(action)
    )) {
      expect(request.payload).not.toHaveProperty('workspaceId');
      expect(request.payload).not.toHaveProperty('viewerWorkspaceId');
      expect(request.payload).not.toHaveProperty('actorId');
    }
    expect(
      commandActions.some((action) => /export|download/u.test(action))
    ).toBe(false);
    expect(queryActions.some((action) => /export|download/u.test(action))).toBe(
      false
    );
    await expect(page.locator('[download]')).toHaveCount(0);
    expect(commandOutcomes).toHaveLength(5);
    expect(commandOutcomes.every((outcome) => outcome.accepted)).toBe(true);
  } finally {
    await cleanupE2EUsers(request);
  }
});

/**
 * Adjust one governed number step through the production admin form.
 */
interface ConfigHistoryItem {
  revision: number | null;
}

async function selectConfig(page: Page, key: string) {
  const historyResponse = page.waitForResponse((response) => {
    if (
      response.request().method() !== 'POST' ||
      !response.url().includes('/api/core/p1/query')
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as
      | {
          action?: string;
          module?: string;
          payload?: { key?: string };
        }
      | undefined;
    return (
      body?.module === 'admin-config' &&
      body.action === 'config_history' &&
      body.payload?.key === key
    );
  });
  await page.locator('#admin-runtime-config-key').selectOption(key);
  const response = await historyResponse;
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { data: ConfigHistoryItem[] };
  return payload.data.at(-1)?.revision ?? null;
}

async function applyConfigStepper(
  page: Page,
  key: string,
  stepperTestId: string,
  direction: 'decrement' | 'increment',
  reason: string
) {
  await page.goto('/admin/plans');
  const originalRevision = await selectConfig(page, key);
  const form = page.getByTestId(`admin-config-form-${key}`);
  const stepper = form.getByTestId(stepperTestId);
  await expect(stepper).toBeVisible({ timeout: 30_000 });
  const button = stepper.locator(
    `[data-slot="number-stepper-${direction}-button"]`
  );
  await expect(button).toBeEnabled();
  await button.click();
  await page.getByRole('button', { name: '审阅并记录' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('执行原因（写入审计）').fill(reason);
  await dialog.getByRole('button', { name: '确认记录配置' }).click();
  await expect(dialog).toBeHidden();
  return originalRevision;
}

async function recordConfigBaseline(page: Page, key: string, reason: string) {
  await page.goto('/admin/plans');
  const existingRevision = await selectConfig(page, key);
  if (existingRevision !== null) return existingRevision;
  await page.getByRole('button', { name: '审阅并记录' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('执行原因（写入审计）').fill(reason);
  await dialog.getByRole('button', { name: '确认记录配置' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(reason, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto('/admin/plans');
  const createdRevision = await selectConfig(page, key);
  expect(createdRevision).not.toBeNull();
  return createdRevision;
}

async function rollbackConfig(
  page: Page,
  key: string,
  targetRevision: number,
  reason: string
) {
  await page.goto('/admin/plans');
  await selectConfig(page, key);
  const historyRow = page
    .getByRole('row')
    .filter({
      has: page.getByText(String(targetRevision), { exact: true }),
    })
    .filter({
      has: page.getByRole('button', { name: '回滚存储配置' }),
    });
  await expect(historyRow).toHaveCount(1);
  const rollback = historyRow.getByRole('button', {
    name: '回滚存储配置',
  });
  await expect(rollback).toHaveCount(1);
  const commandResponse = page.waitForResponse((response) => {
    if (
      response.request().method() !== 'POST' ||
      !response.url().includes('/api/core/p1/commands')
    ) {
      return false;
    }
    const body = response.request().postDataJSON() as
      | {
          action?: string;
          module?: string;
          payload?: { targetRevision?: number };
        }
      | undefined;
    return (
      body?.module === 'admin-config' &&
      body.action === 'config_rollback' &&
      body.payload?.targetRevision === targetRevision
    );
  });
  await rollback.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('执行原因（写入审计）').fill(reason);
  await dialog.getByRole('button', { name: '确认回滚版本' }).click();
  expect((await commandResponse).ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(reason, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test('a credit-cycle coefficient reaches its governed revision and audit trail', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  const reason = `CB-01 acceptance ${Date.now()}: change monthly cycle coefficient`;
  let originalRevision: number | null = null;
  let changed = false;
  try {
    await loginByForm(page, admin);
    originalRevision = await applyConfigStepper(
      page,
      'plan.credits.cycle_coefficients',
      'admin-config-plan-credits-cycle_coefficients-monthly',
      'increment',
      reason
    );
    changed = true;
    expect(originalRevision).not.toBeNull();
    await expect(page.getByText(reason, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    if (changed && originalRevision !== null) {
      await rollbackConfig(
        page,
        'plan.credits.cycle_coefficients',
        originalRevision,
        `${reason} (restore)`
      );
    }
    await cleanupE2EUsers(request);
  }
});

test('the wired merchant decision hold is editable through governed config', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  const key = 'harness.confirmation_card.hold_timeout_seconds';
  const reason = `C1 acceptance ${Date.now()}: change merchant decision hold`;
  let originalRevision: number | null = null;
  let changed = false;

  try {
    await loginByForm(page, admin);
    originalRevision = await recordConfigBaseline(
      page,
      key,
      `${reason} (baseline)`
    );
    await applyConfigStepper(
      page,
      key,
      'admin-config-harness-confirmation_card-hold_timeout_seconds-value',
      'decrement',
      reason
    );
    changed = true;
    await expect(page.getByText(reason, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    if (changed && originalRevision !== null) {
      await rollbackConfig(page, key, originalRevision, `${reason} (restore)`);
    }
    await cleanupE2EUsers(request);
  }
});

test('model assembly separates the catalog layer from the channel layer', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  try {
    await loginByForm(page, admin);
    await page.goto('/admin/models');

    const catalogLayer = page.getByTestId('admin-models-catalog-layer');
    const channelLayer = page.getByTestId('admin-models-channel-layer');
    await expect(catalogLayer).toBeVisible();
    await expect(channelLayer).toBeVisible();

    // Separately operable: each layer carries its own governed-config control,
    // and neither offers the other layer's keys.
    for (const [layer, own, foreign] of [
      [catalogLayer, 'platform.defaultModel.copy', 'model.execution.mode'],
      [channelLayer, 'model.execution.mode', 'platform.defaultModel.copy'],
    ] as const) {
      await expect(
        layer.getByText(own, { exact: false }).first()
      ).toBeVisible();
      await expect(layer.getByText(foreign, { exact: false })).toHaveCount(0);
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});
