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
  applyPendingRecipeRevisionToRefs,
  parseRecipeRevisionId,
  type CreationExperienceAdminApi,
} from './admin-creation-experience-control';

afterEach(cleanup);

function createLifecycleApi() {
  const histories = new Map<string, Array<Record<string, unknown>>>();
  const heads = new Map<string, Record<string, unknown>>();
  const keyFor = (kind: 'recipe' | 'surface', id: string) => `${kind}:${id}`;

  const buildPublishedRevisions = (surfaceId: string, recipeIds: string[]) => {
    const merged = new Set<string>(
      recipeIds.map((id) => String(id).trim()).filter(Boolean)
    );
    const surface = heads.get(keyFor('surface', surfaceId));
    const refs = Array.isArray(surface?.recipeRefs)
      ? (surface.recipeRefs as Array<{ recipeRevisionId?: string }>)
      : [];
    for (const ref of refs) {
      const parsed = parseRecipeRevisionId(String(ref.recipeRevisionId ?? ''));
      if (parsed) merged.add(parsed.recipeId);
    }
    const groups = [...merged]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((recipeId) => {
        const history = histories.get(keyFor('recipe', recipeId)) ?? [];
        const candidates = history
          .filter((entry) => entry.status === 'published')
          .map((entry) => ({
            recipeId,
            revisionId: String(entry.revisionId),
            revision: Number(entry.revision),
            title: String(
              (entry.presentation as { title?: string } | undefined)?.title ??
                recipeId
            ),
            lensId: (entry.lensId as string) ?? 'image_text',
            publishedAt: '2026-08-06T00:00:00.000Z',
          }))
          .sort((a, b) => b.revision - a.revision);
        return { recipeId, candidates };
      });
    const latestByRecipe = new Map<
      string,
      {
        recipeId: string;
        revisionId: string;
        revision: number;
        title: string;
        lensId: string;
        publishedAt: string;
      }
    >();
    for (const [key, history] of histories.entries()) {
      if (!key.startsWith('recipe:')) continue;
      const published = history.filter((entry) => entry.status === 'published');
      const latest = published[published.length - 1];
      if (!latest) continue;
      const recipeId = String(latest.recipeId ?? key.slice('recipe:'.length));
      latestByRecipe.set(recipeId, {
        recipeId,
        revisionId: String(latest.revisionId),
        revision: Number(latest.revision),
        title: String(
          (latest.presentation as { title?: string } | undefined)?.title ??
            recipeId
        ),
        lensId: (latest.lensId as string) ?? 'image_text',
        publishedAt: '2026-08-06T00:00:00.000Z',
      });
    }
    const availableRecipeHeads = [...latestByRecipe.values()].sort((a, b) =>
      a.recipeId < b.recipeId ? -1 : a.recipeId > b.recipeId ? 1 : 0
    );
    return { groups, availableRecipeHeads };
  };

  const emptyEvidenceStatus = (recipeId: string, recipeRevision: number) => ({
    recipeId,
    recipeRevision,
    currentPromptRevisionRef: '',
    evaluation: {
      evidenceKind: 'recipe_evaluation' as const,
      status: 'none' as const,
      receiptId: null,
      runId: null,
      passed: null,
      expiresAt: null,
      promptRevisionRef: null,
      failedCases: [],
    },
    internalTest: {
      evidenceKind: 'recipe_internal_test' as const,
      status: 'none' as const,
      receiptId: null,
      runId: null,
      passed: null,
      expiresAt: null,
      promptRevisionRef: null,
      failedCases: [],
    },
  });

  const api: CreationExperienceAdminApi = {
    query: vi.fn(async (action, payload) => {
      if (action === 'recipe_published_revisions') {
        return buildPublishedRevisions(
          String(payload.surfaceId ?? ''),
          Array.isArray(payload.recipeIds)
            ? (payload.recipeIds as string[])
            : []
        );
      }
      if (action === 'recipe_evidence_status') {
        const recipeId = String(payload.recipeId ?? '');
        const recipeRevision = Number(payload.recipeRevision ?? 0);
        return emptyEvidenceStatus(recipeId, recipeRevision);
      }
      const kind = action.startsWith('recipe_') ? 'recipe' : 'surface';
      const id = String(payload[kind === 'recipe' ? 'recipeId' : 'surfaceId']);
      const key = keyFor(kind, id);
      if (action.endsWith('_history')) return histories.get(key) ?? [];
      if (action.endsWith('_validate')) return { ok: true, errors: [] };
      return heads.get(key) ?? null;
    }),
    command: vi.fn(async (action, payload) => {
      if (action === 'recipe_evidence_run_evaluation') {
        const recipeId = String(payload.recipeId ?? '');
        const recipeRevision = Number(payload.expectedRevision ?? 0);
        return {
          ...emptyEvidenceStatus(recipeId, recipeRevision),
          receipt: {
            receiptId: 'rcpt_lifecycle_eval',
            evidenceKind: 'recipe_evaluation',
            runId: 'run-lifecycle',
            recipeId,
            recipeRevision,
            passed: true,
          },
          run: {
            runId: 'run-lifecycle',
            suiteId: 'recipe-governance',
            suiteRevision: 'recipe-governance@1',
            passed: true,
          },
          failedCases: [],
          evaluation: {
            ...emptyEvidenceStatus(recipeId, recipeRevision).evaluation,
            status: 'ready',
            receiptId: 'rcpt_lifecycle_eval',
            passed: true,
          },
        };
      }
      const kind = action.startsWith('recipe_') ? 'recipe' : 'surface';
      const idField = kind === 'recipe' ? 'recipeId' : 'surfaceId';
      const id = String(payload[idField]);
      const key = keyFor(kind, id);
      const previous = heads.get(key);
      const status = action.endsWith('_draft')
        ? 'draft'
        : action.endsWith('_preview')
          ? 'preview'
          : action.endsWith('_rollback')
            ? 'published'
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
  return { api, histories, heads, keyFor, buildPublishedRevisions };
}

describe('Recipe / Surface visual lifecycle editor', () => {
  it('drafts, previews, publishes and rolls back a Recipe through the public API', async () => {
    const user = userEvent.setup();
    const { api } = createLifecycleApi();
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
    await user.click(screen.getByLabelText('Recipe 回滚版本'));
    await user.click(await screen.findByRole('option', { name: 'r3' }));
    await user.click(screen.getByRole('button', { name: '回滚 Recipe' }));
    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('published · r7');
    expect(api.command).toHaveBeenCalledWith(
      'recipe_rollback',
      expect.objectContaining({ targetRevision: 3, expectedRevision: 6 }),
      expect.any(String)
    );
  }, 30_000);

  it('enters Recipe preview before publish validation passes', async () => {
    const user = userEvent.setup();
    const { api } = createLifecycleApi();
    const query = api.query as ReturnType<typeof vi.fn>;
    query.mockImplementation(
      async (action: string, _payload: Record<string, unknown>) => {
        if (action === 'recipe_validate') {
          return { ok: false, errors: ['publish contract is incomplete'] };
        }
        if (action === 'recipe_published_revisions') {
          return { groups: [], availableRecipeHeads: [] };
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
    await user.click(screen.getByRole('button', { name: '治理保存 Recipe' }));

    expect(
      await screen.findByTestId('recipe-lifecycle-status')
    ).toHaveTextContent('draft · r2');
    expect(
      screen.getByTestId('recipe-compilation-receipt')
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: '治理保存 Recipe' }));

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
    await user.click(screen.getByRole('button', { name: '治理保存 Recipe' }));

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

  it('visually edits a Surface from published revision candidates (no free-text fallback)', async () => {
    const user = userEvent.setup();
    const { api, histories, heads, keyFor } = createLifecycleApi();
    // Seed a published Recipe so the Surface card can pick a candidate.
    const recipeId = 'recipe.admin.demo';
    const publishedRecipe = {
      recipeId,
      revision: 3,
      revisionId: `${recipeId}@3`,
      status: 'published',
      lensId: 'image_text',
      presentation: {
        title: '门店活动图文',
        summary: 'demo',
        actionLabel: '选择图文并套用',
      },
    };
    histories.set(keyFor('recipe', recipeId), [publishedRecipe]);
    heads.set(keyFor('recipe', recipeId), publishedRecipe);

    // Seed an empty-ish surface head so candidates query can merge refs later.
    const surfaceId = 'surface.admin.demo';
    const surfaceHead = {
      surfaceId,
      revision: 0,
      revisionId: `${surfaceId}@0`,
      status: 'draft',
      recipeRefs: [] as Array<Record<string, unknown>>,
    };
    // surface_get returns null for brand-new IDs in real Core; seed for load path.
    heads.set(keyFor('surface', surfaceId), {
      ...surfaceHead,
      revision: 1,
      revisionId: `${surfaceId}@1`,
      recipeRefs: [
        {
          recipeRevisionId: `${recipeId}@3`,
          lensId: 'image_text',
          order: 1,
          featured: true,
          visible: true,
        },
      ],
    });
    histories.set(keyFor('surface', surfaceId), [
      heads.get(keyFor('surface', surfaceId))!,
    ]);

    render(<AdminCreationExperienceControl api={api} />);
    await user.click(screen.getByRole('tab', { name: 'Surface 编辑' }));

    const editor = screen.getByTestId('surface-editor');
    // Free-text version input must not exist (#376 / Spec D5).
    expect(
      within(editor).queryByLabelText('Recipe revision ID')
    ).not.toBeInTheDocument();
    expect(
      within(editor).queryByRole('textbox', { name: /Recipe revision/i })
    ).not.toBeInTheDocument();

    await user.type(within(editor).getByLabelText('Surface ID'), surfaceId);
    await user.click(
      within(editor).getByRole('button', { name: '加载 Surface' })
    );
    expect(
      await screen.findByTestId('surface-lifecycle-status')
    ).toHaveTextContent('draft · r1');

    const revisionSelect = await within(editor).findByTestId(
      'surface-recipe-revision-0'
    );
    expect(revisionSelect).toHaveAttribute('role', 'combobox');
    await waitFor(() => expect(revisionSelect).toBeEnabled());
    await user.click(revisionSelect);
    const publishedOption = await screen.findByRole('option', {
      name: /r3 · 门店活动图文/,
    });
    expect(publishedOption).toHaveTextContent(`${recipeId}@3`);
    expect(
      screen.queryByRole('option', { name: new RegExp(`${recipeId}@1`) })
    ).toBeNull(); // draft never listed
    await user.click(publishedOption);

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
    ).toHaveTextContent('draft · r2');
    expect(screen.getByTestId('surface-visual-preview')).toHaveTextContent(
      `${recipeId}@3`
    );
    await user.click(
      within(editor).getByRole('button', { name: '生成 Surface 预览' })
    );
    await user.click(
      within(editor).getByRole('button', { name: '发布 Surface' })
    );
    expect(
      await screen.findByTestId('surface-lifecycle-status')
    ).toHaveTextContent('published · r4');
    expect(api.command).toHaveBeenCalledWith(
      'surface_draft',
      expect.objectContaining({
        body: expect.objectContaining({
          recipeRefs: expect.arrayContaining([
            expect.objectContaining({ recipeRevisionId: `${recipeId}@3` }),
          ]),
        }),
      }),
      expect.any(String)
    );
    expect(api.query).toHaveBeenCalledWith(
      'recipe_published_revisions',
      expect.objectContaining({ surfaceId })
    );
  });

  it('serializes Surface publish validation and rollback commands', async () => {
    const user = userEvent.setup();
    const { api, histories, heads, keyFor } = createLifecycleApi();
    const recipeId = 'recipe.admin.demo';
    const publishedRecipe = {
      recipeId,
      revision: 3,
      revisionId: `${recipeId}@3`,
      status: 'published',
      lensId: 'image_text',
      presentation: {
        title: '门店活动图文',
        summary: 'demo',
        actionLabel: 'Go',
      },
    };
    histories.set(keyFor('recipe', recipeId), [publishedRecipe]);
    heads.set(keyFor('recipe', recipeId), publishedRecipe);
    const surfaceId = 'surface.admin.race';
    heads.set(keyFor('surface', surfaceId), {
      surfaceId,
      revision: 1,
      revisionId: `${surfaceId}@1`,
      status: 'draft',
      recipeRefs: [
        {
          recipeRevisionId: `${recipeId}@3`,
          lensId: 'image_text',
          order: 1,
          featured: true,
          visible: true,
        },
      ],
    });
    histories.set(keyFor('surface', surfaceId), [
      heads.get(keyFor('surface', surfaceId))!,
    ]);

    render(<AdminCreationExperienceControl api={api} />);
    await user.click(screen.getByRole('tab', { name: 'Surface 编辑' }));

    const editor = screen.getByTestId('surface-editor');
    await user.type(within(editor).getByLabelText('Surface ID'), surfaceId);
    await user.click(
      within(editor).getByRole('button', { name: '加载 Surface' })
    );
    {
      const revisionSelect = await within(editor).findByTestId(
        'surface-recipe-revision-0'
      );
      await waitFor(() => expect(revisionSelect).toBeEnabled());
      await user.click(revisionSelect);
      await user.click(
        await screen.findByRole('option', {
          name: /r3 · 门店活动图文/,
        })
      );
    }
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
    ).toHaveTextContent('published · r4');

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
    await user.click(within(editor).getByLabelText('Surface 回滚版本'));
    await user.click(await screen.findByRole('option', { name: 'r4' }));
    expect(
      within(editor).getByRole('button', { name: '回滚 Surface' })
    ).toBeDisabled();

    releaseValidation?.();
    await waitFor(() =>
      expect(screen.getByTestId('surface-lifecycle-status')).toHaveTextContent(
        'published · r7'
      )
    );
    await user.click(
      within(editor).getByRole('button', { name: '回滚 Surface' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('surface-lifecycle-status')).toHaveTextContent(
        'published · r8'
      )
    );
    expect(within(editor).getByText(/回滚自 r4/)).toBeInTheDocument();
  });

  it('lists only published revisions descending per card and blocks empty save (#376)', async () => {
    const user = userEvent.setup();
    const { api, histories, heads, keyFor } = createLifecycleApi();
    const recipeId = 'recipe.candidate.sort';
    const surfaceId = 'surface.candidate.sort';
    const rows = [
      {
        recipeId,
        revision: 1,
        revisionId: `${recipeId}@1`,
        status: 'draft',
        lensId: 'image_text',
        presentation: { title: 'Draft', summary: 'd', actionLabel: 'Go' },
      },
      {
        recipeId,
        revision: 2,
        revisionId: `${recipeId}@2`,
        status: 'preview',
        lensId: 'image_text',
        presentation: { title: 'Preview', summary: 'p', actionLabel: 'Go' },
      },
      {
        recipeId,
        revision: 3,
        revisionId: `${recipeId}@3`,
        status: 'published',
        lensId: 'image_text',
        presentation: { title: 'Live v1', summary: 'l1', actionLabel: 'Go' },
      },
      {
        recipeId,
        revision: 4,
        revisionId: `${recipeId}@4`,
        status: 'retired',
        lensId: 'image_text',
        presentation: { title: 'Retired', summary: 'r', actionLabel: 'Go' },
      },
      {
        recipeId,
        revision: 5,
        revisionId: `${recipeId}@5`,
        status: 'published',
        lensId: 'image_text',
        presentation: { title: 'Live v2', summary: 'l2', actionLabel: 'Go' },
      },
    ];
    histories.set(keyFor('recipe', recipeId), rows);
    heads.set(keyFor('recipe', recipeId), rows[rows.length - 1]!);
    heads.set(keyFor('surface', surfaceId), {
      surfaceId,
      revision: 1,
      revisionId: `${surfaceId}@1`,
      status: 'draft',
      recipeRefs: [
        {
          recipeRevisionId: `${recipeId}@3`,
          lensId: 'image_text',
          order: 1,
          featured: true,
          visible: true,
        },
      ],
    });

    render(<AdminCreationExperienceControl api={api} />);
    await user.click(screen.getByRole('tab', { name: 'Surface 编辑' }));
    const editor = screen.getByTestId('surface-editor');
    await user.type(within(editor).getByLabelText('Surface ID'), surfaceId);
    await user.click(
      within(editor).getByRole('button', { name: '加载 Surface' })
    );

    const revisionSelect = await within(editor).findByTestId(
      'surface-recipe-revision-0'
    );
    await waitFor(() => expect(revisionSelect).toBeEnabled());
    await user.click(revisionSelect);
    const optionNames = (await screen.findAllByRole('option')).map((option) =>
      (option.textContent ?? '').replace(/\s+/g, ' ').trim()
    );
    expect(optionNames).toEqual([
      `r5 · Live v2 (${recipeId}@5)`,
      `r3 · Live v1 (${recipeId}@3)`,
    ]);
    expect(optionNames.some((name) => name.includes(`${recipeId}@1`))).toBe(
      false
    );
    expect(optionNames.some((name) => name.includes(`${recipeId}@2`))).toBe(
      false
    );
    expect(optionNames.some((name) => name.includes(`${recipeId}@4`))).toBe(
      false
    );
    await user.keyboard('{Escape}');

    // Empty-candidate card cannot save: inject a head with zero published revisions.
    const emptyRecipeId = 'recipe.never.published';
    const query = api.query as ReturnType<typeof vi.fn>;
    const original =
      query.getMockImplementation() as CreationExperienceAdminApi['query'];
    query.mockImplementation(async (action, payload) => {
      if (action === 'recipe_published_revisions') {
        const base = (await original(action, payload)) as {
          groups: Array<{ recipeId: string; candidates: unknown[] }>;
          availableRecipeHeads: Array<{
            recipeId: string;
            revisionId: string;
            revision: number;
            title: string;
            lensId: string;
            publishedAt: string;
          }>;
        };
        return {
          groups: [
            ...base.groups.filter((group) => group.recipeId !== emptyRecipeId),
            { recipeId: emptyRecipeId, candidates: [] },
          ],
          availableRecipeHeads: [
            ...base.availableRecipeHeads.filter(
              (head) => head.recipeId !== emptyRecipeId
            ),
            {
              recipeId: emptyRecipeId,
              revisionId: `${emptyRecipeId}@1`,
              revision: 1,
              title: 'Never live',
              lensId: 'copy',
              publishedAt: '2026-08-06T00:00:00.000Z',
            },
          ],
        };
      }
      return original(action, payload);
    });
    // Reload so availableRecipeHeads includes the empty-candidate recipe.
    await user.click(
      within(editor).getByRole('button', { name: '加载 Surface' })
    );
    await user.click(
      within(editor).getByRole('button', { name: '添加 Recipe' })
    );
    await user.click(
      await within(editor).findByTestId('surface-recipe-pick-1')
    );
    await user.click(
      await screen.findByRole('option', {
        name: `Never live (${emptyRecipeId})`,
      })
    );
    expect(
      await within(editor).findByTestId('surface-recipe-empty-1')
    ).toHaveTextContent('暂无已发布版本');
    expect(within(editor).getByTestId('surface-draft-button')).toBeDisabled();
  });

  it('shows same-page publish success panel and bridges Surface ref update (#376)', async () => {
    const user = userEvent.setup();
    const { api, histories, heads, keyFor } = createLifecycleApi();
    const recipeId = 'recipe.bridge.demo';
    const surfaceId = 'surface.bridge.demo';

    // Preload surface with two matching refs + one other recipe.
    const otherRecipeId = 'recipe.other';
    histories.set(keyFor('recipe', otherRecipeId), [
      {
        recipeId: otherRecipeId,
        revision: 1,
        revisionId: `${otherRecipeId}@1`,
        status: 'published',
        lensId: 'copy',
        presentation: { title: 'Other', summary: 'o', actionLabel: 'Go' },
      },
    ]);
    heads.set(keyFor('recipe', otherRecipeId), {
      recipeId: otherRecipeId,
      revision: 1,
      revisionId: `${otherRecipeId}@1`,
      status: 'published',
      lensId: 'copy',
      presentation: { title: 'Other', summary: 'o', actionLabel: 'Go' },
    });
    heads.set(keyFor('surface', surfaceId), {
      surfaceId,
      revision: 2,
      revisionId: `${surfaceId}@2`,
      status: 'published',
      recipeRefs: [
        {
          recipeRevisionId: `${recipeId}@3`,
          lensId: 'image_text',
          order: 1,
          featured: true,
          visible: true,
        },
        {
          recipeRevisionId: `${recipeId}@3`,
          lensId: 'image_text',
          order: 2,
          featured: false,
          visible: false,
        },
        {
          recipeRevisionId: `${otherRecipeId}@1`,
          lensId: 'copy',
          order: 3,
          featured: false,
          visible: true,
        },
      ],
    });
    histories.set(keyFor('surface', surfaceId), [
      heads.get(keyFor('surface', surfaceId))!,
    ]);

    // Seed published r3 history for the recipe so publish can advance to r6.
    const seedRecipe = {
      recipeId,
      revision: 3,
      revisionId: `${recipeId}@3`,
      status: 'published',
      lensId: 'image_text',
      presentation: {
        title: '桥接配方',
        summary: '旧版本',
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
      modelPolicy: { mode: 'auto' },
      promptRevisionRef: 'prompt.bridge@1',
      skillRevisionRefs: [],
      factTypes: [],
      targetWorkspaceKind: 'image_text',
    };
    histories.set(keyFor('recipe', recipeId), [seedRecipe]);
    heads.set(keyFor('recipe', recipeId), seedRecipe);

    const hrefBefore = window.location.href;
    render(<AdminCreationExperienceControl api={api} />);

    // Prefill path: load Surface first so success panel can prefill surfaceId.
    await user.click(screen.getByRole('tab', { name: 'Surface 编辑' }));
    const editor = screen.getByTestId('surface-editor');
    await user.type(within(editor).getByLabelText('Surface ID'), surfaceId);
    await user.click(
      within(editor).getByRole('button', { name: '加载 Surface' })
    );
    await waitFor(() =>
      expect(screen.getByTestId('surface-lifecycle-status')).toHaveTextContent(
        'published · r2'
      )
    );

    await user.click(screen.getByRole('tab', { name: 'Recipe 编辑' }));
    await user.type(screen.getByLabelText('Recipe ID'), recipeId);
    await user.click(screen.getByRole('button', { name: '加载 Recipe' }));
    await waitFor(() =>
      expect(screen.getByTestId('recipe-lifecycle-status')).toHaveTextContent(
        'published · r3'
      )
    );
    await user.clear(screen.getByLabelText('摘要'));
    await user.type(screen.getByLabelText('摘要'), '新版本摘要');
    await user.type(screen.getByLabelText('变更原因'), '发布后更新 Surface');
    await user.click(screen.getByRole('button', { name: '保存 Recipe 草稿' }));
    await user.click(screen.getByRole('button', { name: '生成 Recipe 预览' }));
    await user.click(screen.getByRole('button', { name: '发布 Recipe' }));

    const panel = await screen.findByTestId('recipe-publish-success-panel');
    expect(panel).toBeInTheDocument();
    expect(
      screen.getByTestId('recipe-publish-success-revision')
    ).toHaveTextContent(`${recipeId}@6`);
    // Prefill target surface from loaded Surface editor.
    expect(screen.getByTestId('publish-success-surface-id')).toHaveValue(
      surfaceId
    );
    // No new route navigation — same page control remains mounted.
    expect(window.location.href).toBe(hrefBefore);
    expect(
      screen.getByTestId('creation-experience-control')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('update-surface-refs-button'));

    const surfaceEditor = await screen.findByTestId('surface-editor');
    expect(
      await within(surfaceEditor).findByTestId('surface-ref-update-notice')
    ).toHaveTextContent('已更新 2 处匹配的 Recipe 引用');
    expect(within(surfaceEditor).getByLabelText('Surface ID')).toHaveValue(
      surfaceId
    );
    // Matching refs upgraded; lens/order/featured/visible preserved in form state.
    const preview = within(surfaceEditor).getByTestId('surface-visual-preview');
    expect(preview).toHaveTextContent(`${recipeId}@6`);
    expect(preview).toHaveTextContent(`${otherRecipeId}@1`);
    expect(
      within(surfaceEditor).getByTestId('surface-ref-update-notice')
    ).toHaveTextContent(`${recipeId}@6`);
    expect(
      within(surfaceEditor).getByLabelText('顺序', {
        selector: '#surface-recipe-order-0',
      })
    ).toHaveValue(1);
    expect(
      within(surfaceEditor).getByLabelText('顺序', {
        selector: '#surface-recipe-order-1',
      })
    ).toHaveValue(2);

    await user.type(
      within(surfaceEditor).getByLabelText('变更原因'),
      '同步新 revision'
    );
    await user.click(
      within(surfaceEditor).getByRole('button', { name: '保存 Surface 草稿' })
    );
    await waitFor(() =>
      expect(api.command).toHaveBeenCalledWith(
        'surface_draft',
        expect.objectContaining({
          surfaceId,
          body: expect.objectContaining({
            recipeRefs: [
              expect.objectContaining({
                recipeRevisionId: `${recipeId}@6`,
                lensId: 'image_text',
                order: 1,
                featured: true,
                visible: true,
              }),
              expect.objectContaining({
                recipeRevisionId: `${recipeId}@6`,
                lensId: 'image_text',
                order: 2,
                featured: false,
                visible: false,
              }),
              expect.objectContaining({
                recipeRevisionId: `${otherRecipeId}@1`,
                lensId: 'copy',
                order: 3,
              }),
            ],
          }),
        }),
        expect.any(String)
      )
    );
  });

  it('shows explicit notice when Surface does not reference the published Recipe (#376)', async () => {
    const user = userEvent.setup();
    const { api, histories, heads, keyFor } = createLifecycleApi();
    const recipeId = 'recipe.unreferenced';
    const surfaceId = 'surface.unreferenced';
    const otherRecipeId = 'recipe.other.only';
    histories.set(keyFor('recipe', otherRecipeId), [
      {
        recipeId: otherRecipeId,
        revision: 1,
        revisionId: `${otherRecipeId}@1`,
        status: 'published',
        lensId: 'copy',
        presentation: { title: 'Only', summary: 'o', actionLabel: 'Go' },
      },
    ]);
    heads.set(keyFor('surface', surfaceId), {
      surfaceId,
      revision: 1,
      revisionId: `${surfaceId}@1`,
      status: 'published',
      recipeRefs: [
        {
          recipeRevisionId: `${otherRecipeId}@1`,
          lensId: 'copy',
          order: 1,
          featured: true,
          visible: true,
        },
      ],
    });
    histories.set(keyFor('surface', surfaceId), [
      heads.get(keyFor('surface', surfaceId))!,
    ]);
    const seedRecipe = {
      recipeId,
      revision: 1,
      revisionId: `${recipeId}@1`,
      status: 'preview',
      lensId: 'image_text',
      presentation: {
        title: '未挂接',
        summary: 's',
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
      modelPolicy: { mode: 'auto' },
      promptRevisionRef: 'prompt.u@1',
      skillRevisionRefs: [],
      factTypes: [],
      targetWorkspaceKind: 'image_text',
    };
    histories.set(keyFor('recipe', recipeId), [seedRecipe]);
    heads.set(keyFor('recipe', recipeId), seedRecipe);

    render(<AdminCreationExperienceControl api={api} />);
    await user.type(screen.getByLabelText('Recipe ID'), recipeId);
    await user.click(screen.getByRole('button', { name: '加载 Recipe' }));
    await user.type(screen.getByLabelText('变更原因'), 'publish unreferenced');
    await user.click(screen.getByRole('button', { name: '发布 Recipe' }));
    // preview → publish: status is preview, publish button enabled.
    // Wait - head status is preview so publish is enabled without re-preview.
    const panel = await screen.findByTestId('recipe-publish-success-panel');
    expect(panel).toBeInTheDocument();
    await user.type(
      screen.getByTestId('publish-success-surface-id'),
      surfaceId
    );
    await user.click(screen.getByTestId('update-surface-refs-button'));
    expect(
      await screen.findByTestId('surface-ref-update-notice')
    ).toHaveTextContent('该 Surface 未引用此 Recipe');
  });

  it('applyPendingRecipeRevisionToRefs updates only matching recipeIds', () => {
    const pending = 'recipe.a@9';
    const { refs, matchedCount } = applyPendingRecipeRevisionToRefs(
      [
        {
          recipeRevisionId: 'recipe.a@3',
          lensId: 'image_text',
          order: 1,
          featured: true,
          visible: true,
        },
        {
          recipeRevisionId: 'recipe.b@1',
          lensId: 'copy',
          order: 2,
          featured: false,
          visible: true,
        },
        {
          recipeRevisionId: 'recipe.a@3',
          lensId: 'video',
          order: 3,
          featured: false,
          visible: false,
        },
      ],
      pending
    );
    expect(matchedCount).toBe(2);
    expect(refs[0]).toEqual({
      recipeRevisionId: pending,
      lensId: 'image_text',
      order: 1,
      featured: true,
      visible: true,
    });
    expect(refs[1]?.recipeRevisionId).toBe('recipe.b@1');
    expect(refs[2]).toEqual({
      recipeRevisionId: pending,
      lensId: 'video',
      order: 3,
      featured: false,
      visible: false,
    });
  });

  describe('Recipe evaluation evidence panel (#397)', () => {
    function evidenceGate(
      status: 'none' | 'expired' | 'prompt_mismatch' | 'ready',
      extras: {
        receiptId?: string | null;
        failedCases?: Array<{ caseId: string; reason: string }>;
        evidenceKind?: 'recipe_evaluation' | 'recipe_internal_test';
      } = {}
    ) {
      return {
        evidenceKind: extras.evidenceKind ?? 'recipe_evaluation',
        status,
        receiptId: extras.receiptId ?? null,
        runId: extras.receiptId ? `run-${extras.receiptId}` : null,
        passed: status === 'ready' ? true : status === 'none' ? false : null,
        expiresAt: null,
        promptRevisionRef: null,
        failedCases: extras.failedCases ?? [],
      };
    }

    function seedRecipeHead(
      recipeId: string,
      revision: number,
      promptRevisionRef = 'prompt.ev@1'
    ) {
      return {
        recipeId,
        revision,
        revisionId: `${recipeId}@${revision}`,
        status: 'draft',
        lensId: 'image_text',
        presentation: {
          title: 'Evidence recipe',
          summary: 'status panel',
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
        modelPolicy: { mode: 'auto' },
        promptRevisionRef,
        skillRevisionRefs: [],
        factTypes: [],
        targetWorkspaceKind: 'image_text',
        studioRelease: {
          phase: 'validated',
          compilationReceipt: {
            receiptId: `compile-${recipeId}-${revision}`,
            industryKey: 'beauty_general',
            promptRevisionRef,
            skillRevisionRefs: [],
          },
          validation: { passed: true, checkedAt: '2026-08-06T12:00:00.000Z' },
        },
      };
    }

    it.each([
      {
        status: 'none' as const,
        label: '无证据',
        receiptId: null as string | null,
      },
      {
        status: 'expired' as const,
        label: '证据已过期',
        receiptId: 'rcpt_expired',
      },
      {
        status: 'prompt_mismatch' as const,
        label: '证据与当前 Prompt 不符',
        receiptId: 'rcpt_prompt',
      },
      {
        status: 'ready' as const,
        label: '已具备',
        receiptId: 'rcpt_ready',
      },
    ])('presents evaluation evidence status $status ($label)', async ({
      status,
      label,
      receiptId,
    }) => {
      const user = userEvent.setup();
      const recipeId = `recipe.ev.${status}`;
      const head = seedRecipeHead(recipeId, 3);
      const api: CreationExperienceAdminApi = {
        query: vi.fn(async (action, payload) => {
          if (action === 'recipe_get') return head;
          if (action === 'recipe_history') return [head];
          if (action === 'recipe_evidence_status') {
            return {
              recipeId: String(payload.recipeId),
              recipeRevision: Number(payload.recipeRevision),
              currentPromptRevisionRef: head.promptRevisionRef,
              evaluation: evidenceGate(status, { receiptId }),
              internalTest: evidenceGate('none', {
                evidenceKind: 'recipe_internal_test',
              }),
            };
          }
          return null;
        }),
        command: vi.fn(async () => {
          throw new Error('unexpected command');
        }),
      };

      render(<AdminCreationExperienceControl api={api} />);
      await user.type(screen.getByLabelText('Recipe ID'), recipeId);
      await user.click(screen.getByRole('button', { name: '加载 Recipe' }));

      const panel = await screen.findByTestId('recipe-evidence-panel');
      expect(panel).toBeInTheDocument();
      expect(screen.getByTestId('recipe-evidence-evaluation')).toHaveAttribute(
        'data-status',
        status
      );
      expect(
        screen.getByTestId('recipe-evidence-evaluation-status')
      ).toHaveTextContent(`状态: ${label}`);
      expect(
        screen.getByTestId('recipe-evidence-evaluation-receipt')
      ).toHaveTextContent(
        receiptId ? `receiptId: ${receiptId}` : 'receiptId: —'
      );
      expect(screen.getByTestId('recipe-evidence-revision')).toHaveTextContent(
        'revision: r3'
      );
    });

    it('does not expose any pass-state submit controls for evidence', async () => {
      const user = userEvent.setup();
      const recipeId = 'recipe.ev.no-pass-controls';
      const head = seedRecipeHead(recipeId, 1);
      const api: CreationExperienceAdminApi = {
        query: vi.fn(async (action) => {
          if (action === 'recipe_get') return head;
          if (action === 'recipe_history') return [head];
          if (action === 'recipe_evidence_status') {
            return {
              recipeId,
              recipeRevision: 1,
              currentPromptRevisionRef: head.promptRevisionRef,
              evaluation: evidenceGate('none'),
              internalTest: evidenceGate('none', {
                evidenceKind: 'recipe_internal_test',
              }),
            };
          }
          return null;
        }),
        command: vi.fn(async () => head),
      };

      render(<AdminCreationExperienceControl api={api} />);
      await user.type(screen.getByLabelText('Recipe ID'), recipeId);
      await user.click(screen.getByRole('button', { name: '加载 Recipe' }));
      await screen.findByTestId('recipe-evidence-panel');

      const panel = screen.getByTestId('recipe-evidence-panel');
      expect(
        within(panel).queryByRole('checkbox', { name: /pass|通过|passed/i })
      ).not.toBeInTheDocument();
      expect(
        within(panel).queryByRole('textbox', { name: /evalRun|runId|passed/i })
      ).not.toBeInTheDocument();
      expect(
        within(panel).queryByLabelText(/passed|evalRun|通过态|评测通过/i)
      ).not.toBeInTheDocument();
      expect(
        within(panel).queryByRole('button', {
          name: /提交通过|record eval|record_eval|标记通过/i,
        })
      ).not.toBeInTheDocument();
      // Only the server-side run trigger is allowed — not a pass toggle.
      expect(
        within(panel).getByTestId('recipe-evidence-run-evaluation')
      ).toBeInTheDocument();
    });

    it('shows failed case ids and reasons after a failed evaluation run', async () => {
      const user = userEvent.setup();
      const recipeId = 'recipe.ev.fail-cases';
      const head = seedRecipeHead(recipeId, 2);
      const api: CreationExperienceAdminApi = {
        query: vi.fn(async (action) => {
          if (action === 'recipe_get') return head;
          if (action === 'recipe_history') return [head];
          if (action === 'recipe_evidence_status') {
            return {
              recipeId,
              recipeRevision: 2,
              currentPromptRevisionRef: head.promptRevisionRef,
              evaluation: evidenceGate('none'),
              internalTest: evidenceGate('none', {
                evidenceKind: 'recipe_internal_test',
              }),
            };
          }
          return null;
        }),
        command: vi.fn(async (action, payload) => {
          if (action !== 'recipe_evidence_run_evaluation') {
            throw new Error(`unexpected ${action}`);
          }
          expect(payload).toEqual(
            expect.objectContaining({
              recipeId,
              expectedRevision: 2,
            })
          );
          // Browser must not be required to send EvalRun/passed.
          expect(payload).not.toHaveProperty('evalRun');
          expect(payload).not.toHaveProperty('passed');
          expect(payload).not.toHaveProperty('evidenceReceiptId');
          return {
            recipeId,
            recipeRevision: 2,
            currentPromptRevisionRef: head.promptRevisionRef,
            receipt: {
              receiptId: 'rcpt_fail_run',
              evidenceKind: 'recipe_evaluation',
              runId: 'run-fail',
              passed: false,
            },
            run: {
              runId: 'run-fail',
              suiteId: 'recipe-governance',
              suiteRevision: 'recipe-governance@1',
              passed: false,
            },
            failedCases: [
              {
                caseId: 'redline-invented-critical-fact',
                reason: 'output invents a critical price fact',
              },
            ],
            evaluation: evidenceGate('none', {
              receiptId: 'rcpt_fail_run',
              failedCases: [
                {
                  caseId: 'redline-invented-critical-fact',
                  reason: 'output invents a critical price fact',
                },
              ],
            }),
            internalTest: evidenceGate('none', {
              evidenceKind: 'recipe_internal_test',
            }),
          };
        }),
      };

      render(<AdminCreationExperienceControl api={api} />);
      await user.type(screen.getByLabelText('Recipe ID'), recipeId);
      await user.click(screen.getByRole('button', { name: '加载 Recipe' }));
      await screen.findByTestId('recipe-evidence-panel');
      await user.click(
        screen.getByRole('button', { name: '运行评测并签发证据' })
      );

      const failed = await screen.findByTestId('recipe-evidence-failed-cases');
      expect(failed).toHaveTextContent('redline-invented-critical-fact');
      expect(failed).toHaveTextContent('output invents a critical price fact');
      expect(screen.getByTestId('recipe-evidence-failed-case')).toHaveAttribute(
        'data-case-id',
        'redline-invented-critical-fact'
      );
      expect(
        screen.getByTestId('recipe-evidence-evaluation-receipt')
      ).toHaveTextContent('rcpt_fail_run');
      expect(api.command).toHaveBeenCalledWith(
        'recipe_evidence_run_evaluation',
        expect.objectContaining({
          recipeId,
          expectedRevision: 2,
        }),
        expect.any(String)
      );
    });

    it('triggers evaluation only via server command (never browser-built evidence)', async () => {
      const user = userEvent.setup();
      const recipeId = 'recipe.ev.server-path';
      const head = seedRecipeHead(recipeId, 4);
      const api: CreationExperienceAdminApi = {
        query: vi.fn(async (action) => {
          if (action === 'recipe_get') return head;
          if (action === 'recipe_history') return [head];
          if (action === 'recipe_evidence_status') {
            return {
              recipeId,
              recipeRevision: 4,
              currentPromptRevisionRef: head.promptRevisionRef,
              evaluation: evidenceGate('none'),
              internalTest: evidenceGate('none', {
                evidenceKind: 'recipe_internal_test',
              }),
            };
          }
          return null;
        }),
        command: vi.fn(async (action, payload) => {
          if (action !== 'recipe_evidence_run_evaluation') {
            throw new Error(`unexpected ${action}`);
          }
          // Server issues receipt — browser only sent identity + CAS.
          expect(Object.keys(payload).sort()).toEqual(
            expect.arrayContaining(['expectedRevision', 'recipeId', 'reason'])
          );
          expect(payload).not.toHaveProperty('evalRun');
          expect(payload).not.toHaveProperty('passed');
          expect(payload).not.toHaveProperty('runId');
          expect(payload).not.toHaveProperty('suiteId');
          expect(payload).not.toHaveProperty('evidenceReceiptId');
          return {
            recipeId,
            recipeRevision: 4,
            currentPromptRevisionRef: head.promptRevisionRef,
            receipt: {
              receiptId: 'rcpt_server_issued',
              evidenceKind: 'recipe_evaluation',
              runId: 'run-server',
              passed: true,
            },
            run: {
              runId: 'run-server',
              suiteId: 'recipe-governance',
              suiteRevision: 'recipe-governance@1',
              passed: true,
            },
            failedCases: [],
            evaluation: evidenceGate('ready', {
              receiptId: 'rcpt_server_issued',
            }),
            internalTest: evidenceGate('none', {
              evidenceKind: 'recipe_internal_test',
            }),
          };
        }),
      };

      render(<AdminCreationExperienceControl api={api} />);
      await user.type(screen.getByLabelText('Recipe ID'), recipeId);
      await user.click(screen.getByRole('button', { name: '加载 Recipe' }));
      await user.click(
        await screen.findByRole('button', { name: '运行评测并签发证据' })
      );

      await waitFor(() => {
        expect(
          screen.getByTestId('recipe-evidence-evaluation')
        ).toHaveAttribute('data-status', 'ready');
      });
      expect(
        screen.getByTestId('recipe-evidence-evaluation-status')
      ).toHaveTextContent('状态: 已具备');
      expect(
        screen.getByTestId('recipe-evidence-evaluation-receipt')
      ).toHaveTextContent('rcpt_server_issued');
      expect(api.command).toHaveBeenCalledTimes(1);
      expect(api.command).toHaveBeenCalledWith(
        'recipe_evidence_run_evaluation',
        expect.objectContaining({
          recipeId,
          expectedRevision: 4,
        }),
        expect.any(String)
      );
    });

    it('refreshes evidence status when the loaded revision changes', async () => {
      const user = userEvent.setup();
      const recipeId = 'recipe.ev.revision-refresh';
      const rev1 = seedRecipeHead(recipeId, 1, 'prompt.ev@1');
      const rev2 = seedRecipeHead(recipeId, 2, 'prompt.ev@2');
      const statusByRevision = new Map([
        [
          1,
          {
            recipeId,
            recipeRevision: 1,
            currentPromptRevisionRef: 'prompt.ev@1',
            evaluation: evidenceGate('ready', { receiptId: 'rcpt_r1' }),
            internalTest: evidenceGate('none', {
              evidenceKind: 'recipe_internal_test',
            }),
          },
        ],
        [
          2,
          {
            recipeId,
            recipeRevision: 2,
            currentPromptRevisionRef: 'prompt.ev@2',
            evaluation: evidenceGate('none'),
            internalTest: evidenceGate('none', {
              evidenceKind: 'recipe_internal_test',
            }),
          },
        ],
      ]);
      let head = rev1;
      const api: CreationExperienceAdminApi = {
        query: vi.fn(async (action, payload) => {
          if (action === 'recipe_get') return head;
          if (action === 'recipe_history') return [rev1, rev2];
          if (action === 'recipe_evidence_status') {
            const revision = Number(payload.recipeRevision);
            return statusByRevision.get(revision) ?? null;
          }
          return null;
        }),
        command: vi.fn(async (action) => {
          if (action === 'recipe_governance_save') {
            head = rev2;
            return rev2;
          }
          throw new Error(`unexpected ${action}`);
        }),
      };

      render(<AdminCreationExperienceControl api={api} />);
      await user.type(screen.getByLabelText('Recipe ID'), recipeId);
      await user.click(screen.getByRole('button', { name: '加载 Recipe' }));

      await waitFor(() => {
        expect(
          screen.getByTestId('recipe-evidence-evaluation')
        ).toHaveAttribute('data-status', 'ready');
      });
      expect(screen.getByTestId('recipe-evidence-revision')).toHaveTextContent(
        'revision: r1'
      );
      expect(
        screen.getByTestId('recipe-evidence-evaluation-receipt')
      ).toHaveTextContent('rcpt_r1');

      await user.clear(screen.getByLabelText('变更原因'));
      await user.type(screen.getByLabelText('变更原因'), 'bump revision');
      await user.click(screen.getByRole('button', { name: '治理保存 Recipe' }));

      await waitFor(() => {
        expect(
          screen.getByTestId('recipe-evidence-revision')
        ).toHaveTextContent('revision: r2');
      });
      expect(screen.getByTestId('recipe-evidence-evaluation')).toHaveAttribute(
        'data-status',
        'none'
      );
      expect(
        screen.getByTestId('recipe-evidence-evaluation-status')
      ).toHaveTextContent('状态: 无证据');
      expect(
        screen.getByTestId('recipe-evidence-evaluation-receipt')
      ).toHaveTextContent('receiptId: —');

      expect(api.query).toHaveBeenCalledWith(
        'recipe_evidence_status',
        expect.objectContaining({ recipeId, recipeRevision: 1 })
      );
      expect(api.query).toHaveBeenCalledWith(
        'recipe_evidence_status',
        expect.objectContaining({ recipeId, recipeRevision: 2 })
      );
    });
  });
});
