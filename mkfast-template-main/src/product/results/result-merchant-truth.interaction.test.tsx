import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ResultTargetResolveOutcome,
  ResultWorkspaceKind,
} from '@meiye/contracts';

import { formatMerchantSupportReference } from './merchant-support-reference';
import { ResultCenterPage } from './result-center-page';

vi.mock('@/components/layout/dashboard-layout', () => ({
  DashboardLayout: ({
    children,
    description,
    title,
  }: {
    children: React.ReactNode;
    description: string;
    title: string;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </main>
  ),
}));

vi.mock('@/components/uiux/state-panel', () => ({
  StatePanel: ({
    children,
    description,
    title,
  }: {
    children?: React.ReactNode;
    description: string;
    title: string;
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  ),
}));

afterEach(cleanup);

const workId = 'work_9fef6e5d-1fd2-4a44-9ce1-8ea3b4e76a07';

function resolvedTarget(): ResultTargetResolveOutcome {
  return {
    kind: 'ok',
    mode: 'active',
    target: { workId },
    workspaceId: 'workspace_8c5d6f45-2f09-4d3e-bbd2-2e89adbd72d3',
  };
}

function renderReadyResult(workspaceKind: ResultWorkspaceKind) {
  return render(
    <ResultCenterPage
      workId={workId}
      resolveOutcome={resolvedTarget()}
      facts={{
        target: { workId },
        workspaceKind,
        progressState: 'success',
        hasUsableCandidate: true,
      }}
      onAction={() => undefined}
      supportedActionIds={['adopt_candidate', 'continue_adjust', 'deliver']}
    />
  );
}

describe('merchant Result Center truth', () => {
  it.each<ResultWorkspaceKind>([
    'copy',
    'image',
    'video',
  ])('keeps %s result text free from execution identifiers and unfinished actions', (workspaceKind) => {
    renderReadyResult(workspaceKind);

    const page = screen.getByRole('main');
    const text = page.textContent ?? '';
    expect(text).toContain('可发布');
    expect(text).not.toContain(workId);
    expect(text).not.toContain('workspace_8c5d6f45');
    expect(text).not.toMatch(/\b(?:ready|result|copy|image|video)\b/u);
    expect(screen.getAllByTestId('result-primary-action')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '版本与历史' })).toBeNull();
    expect(screen.queryByRole('button', { name: '运行详情' })).toBeNull();
  });

  it('replaces a technical resolution failure with merchant-safe next-step copy', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={{
          kind: 'not_found',
          code: 'NOT_FOUND',
          message:
            'Provider openai/model-alpha could not find workId=' + workId,
          requested: { workId },
        }}
        facts={{ workspaceKind: 'copy' }}
        onBack={() => undefined}
      />
    );

    const page = screen.getByRole('main');
    const text = page.textContent ?? '';
    expect(text).toContain('未找到该结果');
    expect(text).not.toContain('Provider');
    expect(text).not.toContain('openai/model-alpha');
    expect(text).not.toContain(workId);
  });

  it('offers a normal return and explains failed-result fee truth without an internal code', () => {
    const onBack = vi.fn();
    const supportReference = formatMerchantSupportReference(workId);
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId },
          workspaceKind: 'image',
          progressState: 'failed',
        }}
        onBack={onBack}
      />
    );

    const page = screen.getByRole('main');
    expect(page).toHaveTextContent('本次是否产生费用请以账单记录为准');
    expect(page).not.toHaveTextContent(workId);
    expect(screen.getByTestId('result-support-reference')).toHaveTextContent(
      supportReference
    );
    expect(page).not.toHaveTextContent(workId);
    fireEvent.click(screen.getByTestId('result-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('hides unfinished History and Run Detail after delivery', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId },
          workspaceKind: 'copy',
          progressState: 'success',
          hasAdoptedCandidate: true,
          deliveryAttempt: 'delivered',
        }}
        onAction={() => undefined}
        supportedActionIds={[
          'create_from_this',
          'continue_adjust',
          'open_history',
          'open_run_detail',
        ]}
      />
    );

    expect(screen.getByTestId('result-primary-action')).toHaveTextContent(
      '基于此再创作'
    );
    expect(screen.queryByRole('button', { name: '版本与历史' })).toBeNull();
    expect(screen.queryByRole('button', { name: '运行详情' })).toBeNull();
  });

  it('surfaces a short support reference on resolution errors without UUID leak', () => {
    const supportReference = formatMerchantSupportReference(workId);
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={{
          kind: 'not_found',
          code: 'NOT_FOUND',
          message: 'Provider openai could not find workId=' + workId,
          requested: { workId },
        }}
        facts={{ workspaceKind: 'copy' }}
      />
    );

    const page = screen.getByRole('main');
    expect(screen.getByTestId('result-support-reference')).toHaveTextContent(
      supportReference
    );
    expect(page).not.toHaveTextContent(workId);
    expect(page).not.toHaveTextContent('Provider');
  });
});
