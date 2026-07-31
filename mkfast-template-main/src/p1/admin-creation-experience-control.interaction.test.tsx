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

  it('visually edits a Surface and only offers capability-verified Pro Studio', async () => {
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
    expect(within(editor).getByText('Pro Studio 无限画布')).toBeInTheDocument();
    await user.click(within(editor).getByLabelText('展示 Pro Studio'));

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
          toolEntryRefs: [
            { toolEntryId: 'tool.pro_studio', order: 10, visible: true },
          ],
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
