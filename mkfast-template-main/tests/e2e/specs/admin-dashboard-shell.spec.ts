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
 *   2. the hand-entry panel moves a three-bucket number through the governed
 *      admin-config API (CAS revision advances, reason lands in the audit) and
 *      a store registering afterwards is provisioned with that number, with
 *      nothing redeployed;
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
  ['/admin/supply', '供应运行'],
  ['/admin/supply/views/model', '供应关联视图'],
  ['/admin/supply/tasks/task-does-not-exist', '供应任务详情'],
  ['/admin/capabilities', '能力目录'],
  ['/admin/recipe-studio', 'Recipe Studio'],
  ['/admin/skills', 'Skills'],
  ['/admin/models', '模型供应'],
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

      // The token bridge keys off this class; without it every HeroUI surface
      // silently falls back to the library's own palette. Generous timeout:
      // the first admin hit compiles the route and the Glass sheet cold.
      await expect(
        page.locator('.meiye-heroui-glass'),
        `${path} lost the shell. Page errors so far:\n${pageErrors.join('\n')}`
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        page.locator('[data-slot="sidebar-menu-item"]').first()
      ).toBeVisible();
      // The merchant shell must not wrap 后台 any more (dev spec §56).
      await expect(page.locator('[data-shell-mode="admin"]')).toHaveCount(0);

      // Sample both themes and require them to actually differ. Asserting each
      // one is merely non-transparent is close to tautological — the shell root
      // carries bg-background, so it resolves to something whether or not the
      // Glass sheet loaded and whether or not the token bridge matched. Two
      // readings that come back equal mean dark mode never took, which is the
      // failure this assertion exists to catch.
      const backgrounds: Record<string, string> = {};
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        backgrounds[theme] = await page
          .locator('.meiye-heroui-glass')
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
 * Move the trial copy allowance through the governed path an operator uses, and
 * return once the CAS revision has advanced. Shared by the journey and by its
 * restore, so putting the shared number back cannot become a back door that
 * skips impact review.
 *
 * `pick` receives the currently stored value so callers can choose a target
 * relative to it; the stored value is only readable once the editor has settled.
 */
async function applyTrialCopyAllowance(
  page: Page,
  reason: string,
  pick: (stored: number) => number
) {
  await page.goto('/admin/plans');
  const copyField = page.locator('#plan-trial-copy');
  await expect(copyField).toBeVisible({ timeout: 30_000 });
  const trialForm = copyField.locator('xpath=ancestor::form[1]');

  // Settle the editor before typing. It re-runs form.reset when the
  // admin-config row lands, so a value entered beforehand is silently reverted
  // and the submit then writes the unchanged number — a no-op that never
  // advances the CAS revision, which surfaces 30s later as a product failure
  // rather than as the race it is. The audit meta line only renders once that
  // row is in hand, so it is the signal to wait on.
  const revisionLine = trialForm.getByText(/^v\d+ · /);
  await expect(revisionLine).toBeVisible({ timeout: 30_000 });
  const revisionBefore = await revisionLine.innerText();

  const stored = Number(await copyField.inputValue());
  const target = pick(stored);
  await copyField.fill(String(target));

  // Fail loudly rather than hang: the editor goes read-only when admin-config
  // carries no revision for the key, and a disabled button would otherwise just
  // burn the test timeout.
  const saveButton = trialForm.getByRole('button', { name: '审阅套餐变更' });
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  // Last check before the write: whatever we are about to submit is still the
  // number we typed.
  await expect(copyField).toHaveValue(String(target));

  await saveButton.click();

  // Every governed write goes through impact review, and the reason is what
  // lands in the audit trail — there is no un-audited path to the number.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByLabel('执行原因（写入审计）').fill(reason);
  // Plan changes override the dialog's generic confirm label, and the suite
  // sets no actionTimeout, so assert the button before clicking — otherwise a
  // label mismatch hangs the click until the test-level timeout instead of
  // failing here with something readable.
  const confirmButton = dialog.getByRole('button', { name: '确认配置变更' });
  await expect(confirmButton).toBeVisible({ timeout: 15_000 });
  await confirmButton.click();
  await expect(dialog).toBeHidden();

  // CAS revision advanced: the editor's audit meta line changed.
  await expect
    .poll(async () => revisionLine.innerText(), { timeout: 30_000 })
    .not.toBe(revisionBefore);

  return { stored, target };
}

/**
 * The governed key `plan.allowances.trial` feeds the catalog
 * (entitlement-catalog-source.ts); workspace-provision reads that catalog when
 * it activates the trial and materialises the number into the workspace's plan
 * event, which is what entitlement-service projects. Editing the config
 * therefore never rewrites an already-provisioned workspace — the hand-entered
 * number shows up for a store provisioned after the change. That is the chain
 * this journey walks.
 */
test('a hand-entered three-bucket number reaches the merchant through governed config', async ({
  baseURL,
  browser,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  // Unique per run: a fixed string would already be sitting in the audit trail
  // from an earlier run, so the audit assertion below would pass even if this
  // run never wrote anything.
  const reason = `T35 acceptance ${Date.now()}: move the trial copy allowance through admin-config`;
  let appliedFrom: number | undefined;
  try {
    await loginByForm(page, admin);

    // 71-79 collides with no seed: the shipped copy allowances are 5/30/100/300
    // and the add-on quantities 20/10, so a stale fallback cannot fake this
    // green. Always move off the stored value — this config is global and
    // outlives the run, so re-entering it would be a no-op write.
    const { stored, target } = await applyTrialCopyAllowance(
      page,
      reason,
      (current) => (current >= 71 && current < 79 ? current + 1 : 71)
    );
    appliedFrom = stored;

    // The other half of the acceptance: the reason reached the audit record,
    // not just the form. /admin/audit is the wrong surface for this — it is fed
    // by revision_rollback_audits and catalog_revisions, so it carries template
    // and catalog events only. admin-config keeps its trail per key, readable
    // through config_history behind the advanced-config disclosure, and that is
    // where an operator would go looking for who changed an allowance and why.
    await page.getByText('高级配置与版本历史').click();
    await page.selectOption(
      '#admin-runtime-config-key',
      'plan.allowances.trial'
    );
    await expect(page.getByText(reason, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // …and a store registering now is provisioned off the edited catalog, with
    // nothing redeployed. Its own context so the admin session stays intact.
    const merchant = await registerE2EUser(request);
    // newContext() does not inherit use.baseURL, so pass it through or the
    // relative goto below would throw on an invalid URL.
    const merchantContext = await browser.newContext({ baseURL });
    try {
      const merchantPage = await merchantContext.newPage();
      await loginByForm(merchantPage, merchant);
      await merchantPage.goto('/settings/account');
      // Assert on what the merchant actually reads, not an internal field.
      const merchantCopyAllowance = merchantPage
        .locator('section', {
          has: merchantPage.getByRole('heading', { name: '文案条数' }),
        })
        .getByText(/^套餐总量 \d+$/)
        .first();
      await expect(merchantCopyAllowance).toBeVisible({ timeout: 30_000 });
      await expect(merchantCopyAllowance).toHaveText(`套餐总量 ${target}`, {
        timeout: 30_000,
      });
    } finally {
      await merchantContext.close();
    }
  } finally {
    const restoreTo = appliedFrom;
    if (restoreTo !== undefined) {
      // Put the shared number back. This config is workspace-wide and outlives
      // the run, so without this every run walks the trial allowance upward for
      // every other lane and for anyone eyeballing the admin surface. Restoring
      // through the same governed path keeps it audited; its own catch so a
      // restore failure cannot mask the assertion that actually failed.
      await applyTrialCopyAllowance(
        page,
        `${reason} (restore to ${restoreTo})`,
        () => restoreTo
      ).catch(() => undefined);
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
  let original: number | undefined;

  const applyHold = async (value: number, auditReason: string) => {
    const advanced = page.locator('details', {
      hasText: '高级配置与版本历史',
    });
    if ((await advanced.getAttribute('open')) === null) {
      await advanced.getByText('高级配置与版本历史').click();
    }
    await advanced.locator('#admin-runtime-config-key').selectOption(key);
    const form = advanced.getByTestId(`admin-config-form-${key}`);
    await expect(form).toBeVisible({ timeout: 30_000 });
    const input = form.getByRole('textbox', {
      name: '商家决策保留期（秒）',
    });
    await expect(input).toBeVisible();
    await input.fill(String(value));
    await advanced.getByRole('button', { name: '审阅并记录' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('执行原因（写入审计）').fill(auditReason);
    await dialog.getByRole('button', { name: '确认记录配置' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(auditReason, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  };

  try {
    await loginByForm(page, admin);
    await page.goto('/admin/plans');
    const advanced = page.locator('details', {
      hasText: '高级配置与版本历史',
    });
    await advanced.getByText('高级配置与版本历史').click();
    await advanced.locator('#admin-runtime-config-key').selectOption(key);
    const form = advanced.getByTestId(`admin-config-form-${key}`);
    await expect(form).toBeVisible({ timeout: 30_000 });
    const input = form.getByRole('textbox', {
      name: '商家决策保留期（秒）',
    });
    original = Number((await input.inputValue()).replaceAll(',', ''));
    expect(original).toBeGreaterThanOrEqual(3_600);
    expect(original).toBeLessThanOrEqual(172_800);
    const target = original === 3_600 ? 3_601 : 3_600;
    await applyHold(target, reason);
  } finally {
    if (original !== undefined) {
      await applyHold(original, `${reason} (restore to ${original})`).catch(
        () => undefined
      );
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
