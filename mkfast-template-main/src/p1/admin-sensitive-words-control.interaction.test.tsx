import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SensitiveWordRecord } from '@meiye/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminSensitiveWordsControl } from './admin-sensitive-words-control';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

const records: SensitiveWordRecord[] = [];

function seedRecord(overrides: Partial<SensitiveWordRecord> = {}) {
  const now = '2026-08-02T00:00:00.000Z';
  const record: SensitiveWordRecord = {
    id: 'sw-ui-1',
    word: '特效祛斑王',
    category: 'medical',
    replacements: ['色斑护理'],
    status: 'enabled',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  records.push(record);
  return record;
}

function renderWithQueryClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

async function openDeleteReview(
  user: ReturnType<typeof userEvent.setup>,
  id = 'sw-ui-1'
) {
  await user.click(screen.getByTestId(`admin-sensitive-words-delete-${id}`));
  return screen.findByRole('dialog', { name: '删除违禁词' });
}

beforeEach(() => {
  records.splice(0, records.length);
  p1Client.queryP1.mockReset();
  p1Client.commandP1.mockReset();
  p1Client.queryP1.mockImplementation(async () => ({
    items: structuredClone(records),
    total: records.length,
  }));
  p1Client.commandP1.mockImplementation(
    async (_module: string, request: { action: string; payload: any }) => {
      if (request.action === 'create') {
        const now = '2026-08-02T00:00:00.000Z';
        const created: SensitiveWordRecord = {
          id: 'sw-ui-1',
          word: request.payload.word,
          category: request.payload.category,
          replacements: request.payload.replacements,
          status: request.payload.status,
          createdAt: now,
          updatedAt: now,
        };
        records.push(created);
        return structuredClone(created);
      }
      const index = records.findIndex(({ id }) => id === request.payload.id);
      if (index < 0) throw new Error('not found');
      if (request.action === 'update') {
        records[index] = {
          ...records[index]!,
          ...request.payload,
          updatedAt: '2026-08-02T00:01:00.000Z',
        };
        return structuredClone(records[index]);
      }
      if (request.action === 'delete') {
        records.splice(index, 1);
        return { id: request.payload.id, deleted: true };
      }
      throw new Error(`unexpected action ${request.action}`);
    }
  );
});

describe('AdminSensitiveWordsControl CRUD', () => {
  it('creates, edits, disables, and deletes a word through the mounted controls', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<AdminSensitiveWordsControl />);

    await screen.findByText('暂无词条（空库会在 Core 启动时 seed 美业基线）。');
    await user.type(screen.getByLabelText('词条'), '特效祛斑王');
    await user.click(screen.getByTestId('admin-sensitive-words-category'));
    await user.click(await screen.findByRole('option', { name: '医疗用语' }));
    await user.type(screen.getByLabelText('替换建议（逗号分隔）'), '色斑护理');
    await user.click(screen.getByRole('button', { name: '新增' }));

    const createdRow = await screen.findByTestId(
      'admin-sensitive-words-row-sw-ui-1'
    );
    expect(createdRow).toHaveTextContent('特效祛斑王');
    expect(p1Client.commandP1).toHaveBeenCalledWith(
      'sensitive-words',
      expect.objectContaining({
        action: 'create',
        payload: expect.objectContaining({
          category: 'medical',
          replacements: ['色斑护理'],
          word: '特效祛斑王',
        }),
      })
    );

    await user.click(within(createdRow).getByRole('button', { name: '编辑' }));
    const wordInput = screen.getByLabelText('词条');
    await user.clear(wordInput);
    await user.type(wordInput, '祛斑特效王');
    const replacements = screen.getByLabelText('替换建议（逗号分隔）');
    await user.clear(replacements);
    await user.type(replacements, '专业肤色护理，因人而异');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    const updatedRow = await screen.findByTestId(
      'admin-sensitive-words-row-sw-ui-1'
    );
    await waitFor(() => expect(updatedRow).toHaveTextContent('祛斑特效王'));
    expect(updatedRow).toHaveTextContent('专业肤色护理，因人而异');
    expect(p1Client.commandP1).toHaveBeenCalledWith(
      'sensitive-words',
      expect.objectContaining({
        action: 'update',
        payload: expect.objectContaining({
          id: 'sw-ui-1',
          replacements: ['专业肤色护理', '因人而异'],
          word: '祛斑特效王',
        }),
      })
    );

    await user.click(within(updatedRow).getByRole('button', { name: '停用' }));
    await waitFor(() =>
      expect(
        within(
          screen.getByTestId('admin-sensitive-words-row-sw-ui-1')
        ).getByRole('button', { name: '启用' })
      ).toBeEnabled()
    );

    await openDeleteReview(user);
    await user.type(
      screen.getByLabelText('执行原因（写入审计）'),
      '删除错误词条验收'
    );
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() =>
      expect(
        screen.queryByTestId('admin-sensitive-words-row-sw-ui-1')
      ).not.toBeInTheDocument()
    );
  });
});

describe('AdminSensitiveWordsControl delete ImpactReviewDialog (#425)', () => {
  it('opens ImpactReviewDialog from the delete entry with blast-radius copy', async () => {
    const user = userEvent.setup();
    seedRecord();
    renderWithQueryClient(<AdminSensitiveWordsControl />);

    await screen.findByTestId('admin-sensitive-words-row-sw-ui-1');
    const dialog = await openDeleteReview(user);

    expect(dialog).toHaveTextContent('特效祛斑王');
    expect(dialog).toHaveTextContent(
      '生成链检查与红线门共用词库，删除会同步影响两处检查'
    );
    expect(p1Client.commandP1).not.toHaveBeenCalled();
  });

  it('cancels without calling delete mutation', async () => {
    const user = userEvent.setup();
    seedRecord();
    renderWithQueryClient(<AdminSensitiveWordsControl />);

    await screen.findByTestId('admin-sensitive-words-row-sw-ui-1');
    await openDeleteReview(user);
    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '删除违禁词' })
      ).not.toBeInTheDocument()
    );
    expect(p1Client.commandP1).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('admin-sensitive-words-row-sw-ui-1')
    ).toBeInTheDocument();
  });

  it('confirms through ImpactReviewDialog and calls delete mutation', async () => {
    const user = userEvent.setup();
    seedRecord({ word: '根治' });
    renderWithQueryClient(<AdminSensitiveWordsControl />);

    await screen.findByTestId('admin-sensitive-words-row-sw-ui-1');
    await openDeleteReview(user);
    await user.type(
      screen.getByLabelText('执行原因（写入审计）'),
      '误录词条，按验收删除'
    );
    await user.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() =>
      expect(p1Client.commandP1).toHaveBeenCalledWith(
        'sensitive-words',
        expect.objectContaining({
          action: 'delete',
          payload: { id: 'sw-ui-1' },
        })
      )
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('admin-sensitive-words-row-sw-ui-1')
      ).not.toBeInTheDocument()
    );
  });

  it('source has no window.confirm on the delete path', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, 'admin-sensitive-words-control.tsx'),
      'utf8'
    );
    expect(source).not.toMatch(/window\.confirm/);
  });
});
