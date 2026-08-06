import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminCreationExperienceControl,
  type CreationExperienceAdminApi,
} from './admin-creation-experience-control';

afterEach(cleanup);

function createLifecycleApi() {
  const histories = new Map<string, Array<Record<string, unknown>>>();
  const heads = new Map<string, Record<string, unknown>>();
  const keyFor = (kind: 'recipe' | 'surface', id: string) => `${kind}:${id}`;
  const api: CreationExperienceAdminApi = {
    query: vi.fn(async (action, payload) => {
      const kind = action.startsWith('recipe_') ? 'recipe' : 'surface';
      const id = String(payload[kind === 'recipe' ? 'recipeId' : 'surfaceId']);
      const key = keyFor(kind, id);
      if (action.endsWith('_history')) return histories.get(key) ?? [];
      if (action.endsWith('_validate')) return { ok: true, errors: [] };
      return heads.get(key) ?? null;
    }),
    command: vi.fn(async (action, payload) => {
      const kind = action.startsWith('recipe_') ? 'recipe' : 'surface';
      const idField = kind === 'recipe' ? 'recipeId' : 'surfaceId';
      const id = String(payload[idField]);
      const key = keyFor(kind, id);
      const previous = heads.get(key);
      const status = action.endsWith('_draft')
        ? 'draft'
        : action.endsWith('_preview')
          ? 'preview'
          : 'published';
      const revision = Number(previous?.revision ?? 0) + 1;
      const body = action.endsWith('_draft')
        ? (payload.body as Record<string, unknown>)
        : (previous ?? {});
      const record = {
        ...body,
        [idField]: id,
        revision,
        revisionId: `${id}@${revision}`,
        status,
        rolledBackToRevision: action.endsWith('_rollback')
          ? Number(payload.targetRevision)
          : null,
      };
      heads.set(key, record);
      histories.set(key, [...(histories.get(key) ?? []), record]);
      return record;
    }),
  };
  return api;
}

describe('Recipe / Surface visual lifecycle editor', () => {
  it('drafts, previews, publishes and rolls back a Recipe through the public API', async () => {
    const user = userEvent.setup();
    const api = createLifecycleApi();
    render(<AdminCreationExperienceControl api={api} />);

    await user.type(screen.getByLabelText('Recipe ID'), 'recipe.admin.demo');
    await user.type(screen.getByLabelText('标题'), '门店活动图文');
    await user.type(screen.getByLabelText('摘要'), '生成活动笔记与封面');
    await user.type(
      screen.getByLabelText('Prompt revision'),
      'prompt.admin.demo@1'
    );
    await user.type(screen.getByLabelText('变更原因'), '首次发布');

    await user.click(screen.getByRole('button', { name: '保存 Recipe 草稿' }));
    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('draft · r1');
    expect(screen.getByTestId('recipe-visual-preview')).toHaveTextContent(
      '门店活动图文'
    );
    expect(api.command).toHaveBeenCalledWith(
      'recipe_draft',
      expect.objectContaining({
        body: expect.objectContaining({
          delivery: {
            aspectRatio: '3:4',
            contentPackagePlatform: 'xiaohongshu',
            deliverableKind: 'note',
            distributionTarget: 'export',
            notePageBound: 3,
            quantity: 1,
          },
        }),
      }),
      expect.any(String)
    );

    await user.click(screen.getByRole('button', { name: '生成 Recipe 预览' }));
    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('preview · r2');
    await user.click(screen.getByRole('button', { name: '发布 Recipe' }));
    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('published · r3');

    await user.clear(screen.getByLabelText('摘要'));
    await user.type(screen.getByLabelText('摘要'), '第二版摘要');
    await user.click(screen.getByRole('button', { name: '保存 Recipe 草稿' }));
    await user.click(screen.getByRole('button', { name: '生成 Recipe 预览' }));
    await user.click(screen.getByRole('button', { name: '发布 Recipe' }));
    await user.selectOptions(screen.getByLabelText('Recipe 回滚版本'), '3');
    await user.click(screen.getByRole('button', { name: '回滚 Recipe' }));
    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('published · r7');
    expect(api.command).toHaveBeenCalledWith(
      'recipe_rollback',
      expect.objectContaining({ targetRevision: 3, expectedRevision: 6 }),
      expect.any(String)
    );
  });

  it('enters Recipe preview before publish validation passes', async () => {
    const user = userEvent.setup();
    const api = createLifecycleApi();
    const query = api.query as ReturnType<typeof vi.fn>;
    query.mockImplementation(
      async (action: string, _payload: Record<string, unknown>) => {
        if (action === 'recipe_validate') {
          return { ok: false, errors: ['publish contract is incomplete'] };
        }
        if (action.endsWith('_history')) return [];
        return null;
      }
    );
    render(<AdminCreationExperienceControl api={api} />);

    await user.type(screen.getByLabelText('Recipe ID'), 'recipe.preview.first');
    await user.type(screen.getByLabelText('标题'), '预览先行');
    await user.type(screen.getByLabelText('摘要'), '发布前检查可以稍后完成');
    await user.type(
      screen.getByLabelText('Prompt revision'),
      'prompt.preview@1'
    );
    await user.type(screen.getByLabelText('变更原因'), '验收预览顺序');
    await user.click(screen.getByRole('button', { name: '保存 Recipe 草稿' }));
    await user.click(screen.getByRole('button', { name: '生成 Recipe 预览' }));

    expect(api.command).toHaveBeenCalledWith(
      'recipe_preview',
      expect.objectContaining({ expectedRevision: 1 }),
      expect.any(String)
    );
    expect(api.query).not.toHaveBeenCalledWith(
      'recipe_validate',
      expect.anything()
    );
  });

  it('submits recipe_governance_save with form payload and renders compilation receipt (#372)', async () => {
    const user = userEvent.setup();
    const api: CreationExperienceAdminApi = {
      query: vi.fn(async () => null),
      command: vi.fn(async (action, payload) => {
        if (action !== 'recipe_governance_save') {
          throw new Error(`unexpected action ${action}`);
        }
        const recipeId = String(payload.recipeId);
        return {
          recipeId,
          revision: 2,
          revisionId: `${recipeId}@2`,
          status: 'draft',
          lensId: 'image_text',
          presentation: payload.presentation,
          delivery: {
            contentPackagePlatform: (
              payload.platform as { contentPackagePlatform: string }
            ).contentPackagePlatform,
            distributionTarget: (
              payload.platform as { distributionTarget: string }
            ).distributionTarget,
            deliverableKind: 'note',
            quantity: 1,
            aspectRatio: '3:4',
            notePageBound: 3,
          },
          contextPatches: {
            recipeStudioPlan: {
              industryKey: payload.industryKey,
              intentTypes: payload.intentTypes,
              storySegments: payload.storySegments,
            },
          },
          factTypes: payload.factTypes,
          sourceRequirements: payload.sourceRequirements,
          modelPolicy: payload.modelPolicy,
          settingsPatches: {
            candidateStrategy: payload.candidateStrategy,
            outputKind: (payload.output as { outputKind: string }).outputKind,
          },
          outputContractRef: payload.outputContractRef,
          quotePolicyRevisionRef: payload.quotePolicyRevisionRef,
          workflowRevisionRef: payload.workflowRevisionRef,
          promptRevisionRef: payload.promptRevisionRef,
          skillRevisionRefs: payload.skillRevisionRefs,
          targetWorkspaceKind: 'image_text',
          rolledBackToRevision: null,
          studioRelease: {
            phase: 'validated',
            compilationReceipt: {
              receiptId: 'receipt-gov-demo-1',
              compiledAt: '2026-08-06T12:00:00.000Z',
              industryKey: String(payload.industryKey),
              promptRevisionRef: String(payload.promptRevisionRef),
              skillRevisionRefs: payload.skillRevisionRefs as string[],
              workflowRevisionRef: String(payload.workflowRevisionRef),
              outputContractRef: String(payload.outputContractRef),
              quotePolicyRevisionRef: String(payload.quotePolicyRevisionRef),
            },
            validation: {
              checkedAt: '2026-08-06T12:00:01.000Z',
              passed: true,
            },
          },
        };
      }),
    };

    render(<AdminCreationExperienceControl api={api} />);

    await user.type(screen.getByLabelText('Recipe ID'), 'recipe.gov.demo');
    await user.type(screen.getByLabelText('标题'), '治理保存示例');
    await user.type(screen.getByLabelText('摘要'), '结构化表单提交治理保存');
    await user.type(
      screen.getByLabelText('Prompt revision'),
      'prompt.gov.demo@1'
    );
    await user.type(screen.getByLabelText('变更原因'), '验收治理保存回执');
    await user.click(
      screen.getByRole('button', { name: '治理保存 Recipe' })
    );

    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('draft · r2');
    expect(screen.getByTestId('recipe-compilation-receipt')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-studio-phase')).toHaveTextContent(
      'phase: validated'
    );
    expect(screen.getByTestId('recipe-validation-passed')).toHaveTextContent(
      'validation: passed'
    );
    expect(screen.getByTestId('recipe-compilation-receipt')).toHaveTextContent(
      'receipt-gov-demo-1'
    );
    expect(screen.getByTestId('recipe-compilation-receipt')).toHaveTextContent(
      'beauty_general'
    );

    expect(api.command).toHaveBeenCalledWith(
      'recipe_governance_save',
      expect.objectContaining({
        recipeId: 'recipe.gov.demo',
        expectedRevision: null,
        reason: '验收治理保存回执',
        industryKey: 'beauty_general',
        presentation: expect.objectContaining({
          title: '治理保存示例',
          summary: '结构化表单提交治理保存',
        }),
        modelPolicy: { mode: 'auto' },
        promptRevisionRef: 'prompt.gov.demo@1',
        skillRevisionRefs: [],
        workflowRevisionRef: 'workflow.recipe-studio@1',
        outputContractRef: 'output.image-text-note@1',
        quotePolicyRevisionRef: 'quote.policy@1',
        factTypes: [],
        sourceRequirements: [],
        intentTypes: ['daily_exposure'],
        storySegments: [
          'pain_point',
          'professional_insight',
          'service_solution',
          'cta',
        ],
        output: expect.objectContaining({
          outputKind: 'image_text_note',
          quantity: 1,
          deliverableKind: 'note',
          aspectRatio: '3:4',
          notePageBound: 3,
        }),
        candidateStrategy: 'dual_style_user_choice',
        platform: {
          contentPackagePlatform: 'xiaohongshu',
          distributionTarget: 'export',
        },
      }),
      expect.any(String)
    );

    const submitted = (api.command as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(submitted).not.toHaveProperty('studioRelease');
    expect(submitted).not.toHaveProperty('passed');
    expect(submitted).not.toHaveProperty('hiddenPromptBody');
    expect(submitted).not.toHaveProperty('blocks');
    expect(submitted).not.toHaveProperty('evalRun');
    expect(submitted).not.toHaveProperty('body');
  });

  it('surfaces a stable Core error when recipe_governance_save fails (#372)', async () => {
    const user = userEvent.setup();
    const stableMessage =
      'Skill revision skill.missing@1 is not frozen for production.';
    const api: CreationExperienceAdminApi = {
      query: vi.fn(async () => null),
      command: vi.fn(async (action) => {
        if (action === 'recipe_governance_save') {
          throw new Error(stableMessage);
        }
        throw new Error(`unexpected action ${action}`);
      }),
    };

    render(<AdminCreationExperienceControl api={api} />);

    await user.type(screen.getByLabelText('Recipe ID'), 'recipe.gov.fail');
    await user.type(screen.getByLabelText('标题'), '失败路径');
    await user.type(screen.getByLabelText('摘要'), '稳定错误应显示在表单');
    await user.type(
      screen.getByLabelText('Prompt revision'),
      'prompt.gov.fail@1'
    );
    await user.type(screen.getByLabelText('变更原因'), '验收错误表面');
    await user.click(
      screen.getByRole('button', { name: '治理保存 Recipe' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(stableMessage);
    expect(
      screen.queryByTestId('recipe-compilation-receipt')
    ).not.toBeInTheDocument();
    expect(api.command).toHaveBeenCalledWith(
      'recipe_governance_save',
      expect.objectContaining({
        recipeId: 'recipe.gov.fail',
        industryKey: 'beauty_general',
      }),
      expect.any(String)
    );
  });

  it('hydrates governance fields from Recipe head before governed save (#372)', async () => {
    const user = userEvent.setup();
    const recipeId = 'recipe.gov.hydrate';
    const seedHead = {
      recipeId,
      revision: 5,
      revisionId: `${recipeId}@5`,
      status: 'draft',
      lensId: 'image_text',
      familyId: 'education_note',
      presentation: {
        title: '已有治理配方',
        summary: '从 head 回填',
        actionLabel: '选择图文并套用',
      },
      delivery: {
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'export',
        deliverableKind: 'note',
        quantity: 1,
        aspectRatio: '3:4',
        notePageBound: 3,
      },
      contextPatches: {
        tone: 'professional',
        recipeStudioPlan: {
          industryKey: 'hair_care',
          intentTypes: ['conversion'],
          storySegments: ['pain_point', 'cta'],
        },
      },
      factTypes: ['service'],
      sourceRequirements: [{ slot: 'store_facts', required: true }],
      modelPolicy: { mode: 'auto' },
      settingsPatches: {
        locale: 'zh-CN',
        candidateStrategy: 'single_primary',
        outputKind: 'image_text_note',
      },
      outputContractRef: 'output.image-text-note@4',
      quotePolicyRevisionRef: 'quote.policy@5',
      workflowRevisionRef: 'workflow.recipe-studio@2',
      promptRevisionRef: 'prompt.hydrate@12',
      skillRevisionRefs: ['skill.bound@3'],
      targetWorkspaceKind: 'image_text',
      rolledBackToRevision: null,
      studioRelease: {
        phase: 'validated',
        compilationReceipt: {
          receiptId: 'receipt-hydrate-5',
          industryKey: 'hair_care',
          promptRevisionRef: 'prompt.hydrate@12',
          skillRevisionRefs: ['skill.bound@3'],
        },
        validation: { passed: true, checkedAt: '2026-08-06T10:00:00.000Z' },
      },
    };

    const histories = new Map<string, Array<Record<string, unknown>>>([
      [`recipe:${recipeId}`, [seedHead]],
    ]);
    const heads = new Map<string, Record<string, unknown>>([
      [`recipe:${recipeId}`, seedHead],
    ]);
    const api: CreationExperienceAdminApi = {
      query: vi.fn(async (action, payload) => {
        const id = String(payload.recipeId);
        const key = `recipe:${id}`;
        if (action === 'recipe_history') return histories.get(key) ?? [];
        if (action === 'recipe_validate') return { ok: true, errors: [] };
        return heads.get(key) ?? null;
      }),
      command: vi.fn(async (action, payload) => {
        if (action !== 'recipe_governance_save') {
          throw new Error(`unexpected action ${action}`);
        }
        const id = String(payload.recipeId);
        const key = `recipe:${id}`;
        const previous = heads.get(key);
        const revision = Number(previous?.revision ?? 0) + 2;
        const record = {
          ...seedHead,
          presentation: payload.presentation,
          factTypes: payload.factTypes,
          skillRevisionRefs: payload.skillRevisionRefs,
          promptRevisionRef: payload.promptRevisionRef,
          industryKey: payload.industryKey,
          revision,
          revisionId: `${id}@${revision}`,
          status: 'draft',
          studioRelease: {
            phase: 'validated',
            compilationReceipt: {
              receiptId: 'receipt-hydrate-next',
              industryKey: String(payload.industryKey),
              promptRevisionRef: String(payload.promptRevisionRef),
              skillRevisionRefs: payload.skillRevisionRefs as string[],
            },
            validation: { passed: true },
          },
        };
        heads.set(key, record);
        return record;
      }),
    };

    render(<AdminCreationExperienceControl api={api} />);

    await user.type(screen.getByLabelText('Recipe ID'), recipeId);
    await user.click(screen.getByRole('button', { name: '加载 Recipe' }));
    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('draft · r5');
    expect(screen.getByTestId('recipe-compilation-receipt')).toHaveTextContent(
      'hair_care'
    );

    await user.clear(screen.getByLabelText('标题'));
    await user.type(screen.getByLabelText('标题'), '回填后改标题');
    await user.type(screen.getByLabelText('变更原因'), '治理保存回填验收');
    await user.click(
      screen.getByRole('button', { name: '治理保存 Recipe' })
    );

    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('draft · r7');

    expect(api.command).toHaveBeenCalledWith(
      'recipe_governance_save',
      expect.objectContaining({
        recipeId,
        expectedRevision: 5,
        industryKey: 'hair_care',
        familyId: 'education_note',
        presentation: expect.objectContaining({ title: '回填后改标题' }),
        promptRevisionRef: 'prompt.hydrate@12',
        skillRevisionRefs: ['skill.bound@3'],
        workflowRevisionRef: 'workflow.recipe-studio@2',
        outputContractRef: 'output.image-text-note@4',
        quotePolicyRevisionRef: 'quote.policy@5',
        factTypes: ['service'],
        sourceRequirements: [{ slot: 'store_facts', required: true }],
        intentTypes: ['conversion'],
        storySegments: ['pain_point', 'cta'],
        candidateStrategy: 'single_primary',
        contextPatches: expect.objectContaining({
          tone: 'professional',
          recipeStudioPlan: expect.objectContaining({
            industryKey: 'hair_care',
          }),
        }),
        settingsPatches: expect.objectContaining({
          candidateStrategy: 'single_primary',
        }),
      }),
      expect.any(String)
    );
  });

  it('keeps factTypes and skillRevisionRefs when only the Recipe title changes (#361)', async () => {
    const user = userEvent.setup();
    const recipeId = 'recipe.roundtrip.bindings';
    const existingFactTypes = ['service', 'price'];
    const existingSkillRevisionRefs = ['skill.bound@1', 'skill.extra@2'];
    const seedHead = {
      recipeId,
      revision: 3,
      revisionId: `${recipeId}@3`,
      status: 'published',
      lensId: 'image_text',
      familyId: 'xhs-case-note',
      presentation: {
        title: '原标题保留绑定',
        summary: '既有摘要',
        actionLabel: '选择图文并套用',
      },
      delivery: {
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'export',
        deliverableKind: 'note',
        quantity: 1,
        aspectRatio: '3:4',
        notePageBound: 3,
      },
      contextPatches: { tone: '专业亲和' },
      factTypes: existingFactTypes,
      sourceRequirements: [
        { slot: 'case_image', required: true, kinds: ['image'] },
      ],
      modelPolicy: { mode: 'auto' },
      settingsPatches: { count: 1 },
      outputContractRef: 'output.note.v1',
      quotePolicyRevisionRef: 'quote.policy@1',
      workflowRevisionRef: 'workflow.image_text@1',
      promptRevisionRef: 'prompt.roundtrip@1',
      skillRevisionRefs: existingSkillRevisionRefs,
      targetWorkspaceKind: 'image_text',
      rolledBackToRevision: null,
    };

    // Seed external fixture only — bindings enter state via load/hydrate, not test presets.
    const histories = new Map<string, Array<Record<string, unknown>>>([
      [`recipe:${recipeId}`, [seedHead]],
    ]);
    const heads = new Map<string, Record<string, unknown>>([
      [`recipe:${recipeId}`, seedHead],
    ]);
    const api: CreationExperienceAdminApi = {
      query: vi.fn(async (action, payload) => {
        const id = String(payload.recipeId);
        const key = `recipe:${id}`;
        if (action === 'recipe_history') return histories.get(key) ?? [];
        if (action === 'recipe_validate') return { ok: true, errors: [] };
        return heads.get(key) ?? null;
      }),
      command: vi.fn(async (_action, payload) => {
        const id = String(payload.recipeId);
        const key = `recipe:${id}`;
        const previous = heads.get(key);
        const revision = Number(previous?.revision ?? 0) + 1;
        const body = (payload.body as Record<string, unknown>) ?? {};
        // External revision = body + identity/lifecycle (mirrors catalog append shape).
        const record = {
          ...body,
          recipeId: id,
          revision,
          revisionId: `${id}@${revision}`,
          status: 'draft',
          rolledBackToRevision: null,
        };
        heads.set(key, record);
        histories.set(key, [...(histories.get(key) ?? []), record]);
        return record;
      }),
    };

    render(<AdminCreationExperienceControl api={api} />);

    await user.type(screen.getByLabelText('Recipe ID'), recipeId);
    await user.click(screen.getByRole('button', { name: '加载 Recipe' }));
    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('published · r3');
    expect(screen.getByLabelText('标题')).toHaveValue('原标题保留绑定');
    expect(screen.getByLabelText('摘要')).toHaveValue('既有摘要');

    await user.clear(screen.getByLabelText('标题'));
    await user.type(screen.getByLabelText('标题'), '只改标题');
    await user.type(screen.getByLabelText('变更原因'), '标题微调不得丢绑定');
    await user.click(screen.getByRole('button', { name: '保存 Recipe 草稿' }));

    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('draft · r4');

    expect(api.command).toHaveBeenCalledWith(
      'recipe_draft',
      expect.objectContaining({
        recipeId,
        expectedRevision: 3,
        body: expect.objectContaining({
          presentation: expect.objectContaining({ title: '只改标题' }),
          factTypes: existingFactTypes,
          skillRevisionRefs: existingSkillRevisionRefs,
        }),
      }),
      expect.any(String)
    );

    // Assert external saved revision (fixture head after command), not internal state.
    const saved = heads.get(`recipe:${recipeId}`);
    expect(saved).toEqual(
      expect.objectContaining({
        revision: 4,
        status: 'draft',
        factTypes: existingFactTypes,
        skillRevisionRefs: existingSkillRevisionRefs,
        presentation: expect.objectContaining({ title: '只改标题' }),
      })
    );
  });

  it('visually edits a Surface without retired Pro Studio tool offers', async () => {
    const user = userEvent.setup();
    const api = createLifecycleApi();
    render(<AdminCreationExperienceControl api={api} />);
    await user.click(screen.getByRole('tab', { name: 'Surface 编辑' }));

    const editor = screen.getByTestId('surface-editor');
    await user.type(
      within(editor).getByLabelText('Surface ID'),
      'surface.admin.demo'
    );
    await user.type(
      within(editor).getByLabelText('Recipe revision ID'),
      'recipe.admin.demo@3'
    );
    await user.type(within(editor).getByLabelText('变更原因'), '上线首页入口');
    expect(within(editor).queryByText('批量去背景')).not.toBeInTheDocument();
    expect(
      within(editor).queryByText('Pro Studio 无限画布')
    ).not.toBeInTheDocument();
    expect(
      within(editor).queryByLabelText('展示 Pro Studio')
    ).not.toBeInTheDocument();

    await user.click(
      within(editor).getByRole('button', { name: '保存 Surface 草稿' })
    );
    expect(
      await screen.findByTestId('surface-lifecycle-status')
    ).toHaveTextContent('draft · r1');
    expect(screen.getByTestId('surface-visual-preview')).toHaveTextContent(
      'recipe.admin.demo@3'
    );
    await user.click(
      within(editor).getByRole('button', { name: '生成 Surface 预览' })
    );
    await user.click(
      within(editor).getByRole('button', { name: '发布 Surface' })
    );
    expect(
      await screen.findByTestId('surface-lifecycle-status')
    ).toHaveTextContent('published · r3');
    expect(api.command).toHaveBeenCalledWith(
      'surface_draft',
      expect.objectContaining({
        body: expect.objectContaining({
          recipeRefs: expect.any(Array),
        }),
      }),
      expect.any(String)
    );
  });

  it('serializes Surface publish validation and rollback commands', async () => {
    const user = userEvent.setup();
    const api = createLifecycleApi();
    render(<AdminCreationExperienceControl api={api} />);
    await user.click(screen.getByRole('tab', { name: 'Surface 编辑' }));

    const editor = screen.getByTestId('surface-editor');
    await user.type(
      within(editor).getByLabelText('Surface ID'),
      'surface.admin.race'
    );
    await user.type(
      within(editor).getByLabelText('Recipe revision ID'),
      'recipe.admin.demo@3'
    );
    await user.type(
      within(editor).getByLabelText('变更原因'),
      '验证发布与回滚串行执行'
    );

    await user.click(
      within(editor).getByRole('button', { name: '保存 Surface 草稿' })
    );
    await user.click(
      within(editor).getByRole('button', { name: '生成 Surface 预览' })
    );
    await user.click(
      within(editor).getByRole('button', { name: '发布 Surface' })
    );
    expect(
      await screen.findByTestId('surface-lifecycle-status')
    ).toHaveTextContent('published · r3');

    await user.click(
      within(editor).getByRole('button', { name: '保存 Surface 草稿' })
    );
    await user.click(
      within(editor).getByRole('button', { name: '生成 Surface 预览' })
    );

    let releaseValidation: (() => void) | undefined;
    const validationPending = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const query = api.query as ReturnType<typeof vi.fn>;
    const queryImplementation =
      query.getMockImplementation() as CreationExperienceAdminApi['query'];
    query.mockImplementation(
      async (action: string, payload: Record<string, unknown>) => {
        if (action === 'surface_validate') {
          await validationPending;
          return { ok: true, errors: [] };
        }
        return queryImplementation(action, payload);
      }
    );

    await user.click(
      within(editor).getByRole('button', { name: '发布 Surface' })
    );
    await user.selectOptions(
      within(editor).getByLabelText('Surface 回滚版本'),
      '3'
    );
    expect(
      within(editor).getByRole('button', { name: '回滚 Surface' })
    ).toBeDisabled();

    releaseValidation?.();
    await waitFor(() =>
      expect(screen.getByTestId('surface-lifecycle-status')).toHaveTextContent(
        'published · r6'
      )
    );
    await user.click(
      within(editor).getByRole('button', { name: '回滚 Surface' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('surface-lifecycle-status')).toHaveTextContent(
        'published · r7'
      )
    );
    expect(within(editor).getByText(/回滚自 r3/)).toBeInTheDocument();
  });
});
