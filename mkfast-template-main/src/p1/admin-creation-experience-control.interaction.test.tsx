import { cleanup, render, screen, within } from '@testing-library/react';
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
});
