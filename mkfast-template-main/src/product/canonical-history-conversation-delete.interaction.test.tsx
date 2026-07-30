import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RawCanonicalHistory } from './canonical-history-model';

const p1 = vi.hoisted(() => ({
  operationsCommand: vi.fn(),
}));

vi.mock('@/components/layout/dashboard-header', () => ({
  DashboardHeader: () => null,
}));

vi.mock('@/p1/client', () => ({
  operationsCommand: p1.operationsCommand,
}));

const { CanonicalHistoryList } = await import('./canonical-history-page');

const history: RawCanonicalHistory = {
  assets: [],
  canvasWorks: [],
  contents: [],
  creativeWorks: [],
  exportReceipts: [],
  imageJobs: [],
  jobs: [],
  sessions: [
    {
      createdAt: '2026-07-30T08:00:00.000Z',
      id: 'conversation-a',
      updatedAt: '2026-07-30T09:00:00.000Z',
      workIds: [],
    },
  ],
  tasks: [],
};

const items = [
  {
    detail: '0 份内容记录',
    href: '/dashboard/sessions/conversation-a',
    id: 'conversation-a',
    kind: 'session' as const,
    title: '创作过程',
    updatedAt: '2026-07-30T09:00:00.000Z',
  },
  {
    detail: '已完成',
    href: '/dashboard/results/work-a',
    id: 'work-a',
    kind: 'work' as const,
    title: '保留的内容记录',
    updatedAt: '2026-07-30T08:30:00.000Z',
  },
];

function renderList() {
  return render(
    <CanonicalHistoryList
      contentPackages={[]}
      hasStore
      history={history}
      items={items}
      mode="recent"
    />
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Composer conversation deletion from recent activity', () => {
  it('confirms the memory policy, sends the canonical command, and removes the conversation', async () => {
    p1.operationsCommand.mockResolvedValue({
      conversationId: 'conversation-a',
      deletedAt: '2026-07-30T10:00:00.000Z',
    });
    renderList();

    expect(
      screen.getByRole('button', { name: '删掉这次创作对话' })
    ).toBeVisible();

    await userEvent.click(
      screen.getByRole('button', { name: '删掉这次创作对话' })
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      '已经沉淀的记忆会保留，并标注“来源已删除”'
    );

    await userEvent.click(screen.getByRole('button', { name: '删掉对话' }));

    expect(p1.operationsCommand).toHaveBeenCalledWith(
      'delete_composer_conversation',
      { conversationId: 'conversation-a' }
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: '删掉这次创作对话' })
      ).not.toBeInTheDocument()
    );
    expect(screen.getByText('保留的内容记录')).toBeVisible();
  });

  it('closes the confirmation without sending a command', async () => {
    renderList();

    await userEvent.click(
      screen.getByRole('button', { name: '删掉这次创作对话' })
    );
    await userEvent.click(screen.getByRole('button', { name: '先不删' }));

    expect(p1.operationsCommand).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the conversation and shows a visible failure', async () => {
    p1.operationsCommand.mockRejectedValue(new TypeError('Failed to fetch'));
    renderList();

    await userEvent.click(
      screen.getByRole('button', { name: '删掉这次创作对话' })
    );
    await userEvent.click(screen.getByRole('button', { name: '删掉对话' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '没能删掉这次对话'
    );
    await userEvent.click(screen.getByRole('button', { name: '先不删' }));
    expect(
      screen.getByRole('button', { name: '删掉这次创作对话' })
    ).toBeVisible();
  });
});
