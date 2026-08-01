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

  it('describes terminal video failure without promising a recovery action', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId },
          workspaceKind: 'video',
          progressState: 'failed',
        }}
      />
    );

    const page = screen.getByRole('main');
    expect(page).toHaveTextContent('上游结果接收失败');
    expect(page).toHaveTextContent('可返回工作台查看运行详情');
    expect(page).not.toHaveTextContent('可恢复接收上游结果');
    expect(page).not.toHaveTextContent('重新生成');
  });

  it('exposes real version timeline and Run Detail after delivery without stealing primary', () => {
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
        revisionTimelineFacts={{
          currentVersionId: 'ver-1',
          versions: [
            {
              versionId: 'ver-1',
              title: '已交付版本',
              createdAt: '2026-07-21T10:00:00.000Z',
              source: 'merchant_edited',
              operatorDisplayName: '店长',
            },
          ],
        }}
        runDetailFacts={{
          phase: 'delivered',
          jobStatus: 'completed',
          productUsageQuantity: 1,
          supportReference: formatMerchantSupportReference(workId),
        }}
      />
    );

    expect(screen.getByTestId('result-primary-action')).toHaveTextContent(
      '基于此再创作'
    );
    // Overflow "更多" hosts version timeline / Run Detail — not the single primary.
    expect(screen.getByTestId('result-more-actions')).toBeTruthy();
    expect(screen.getByRole('button', { name: '版本与历史' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '运行详情' })).toBeTruthy();
  });

  it('renders ContentPackage revision timeline from canonical facts', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId, panel: 'history' },
          workspaceKind: 'copy',
          progressState: 'success',
          hasAdoptedCandidate: true,
          requestedPanel: 'history',
        }}
        revisionTimelineFacts={{
          currentVersionId: 'ver-2',
          versions: [
            {
              versionId: 'ver-1',
              title: '初稿',
              createdAt: '2026-07-20T08:00:00.000Z',
              source: 'ai_generated',
            },
            {
              versionId: 'ver-2',
              title: '手改版',
              createdAt: '2026-07-20T09:00:00.000Z',
              source: 'merchant_edited',
              derivedFromVersionId: 'ver-1',
              operatorDisplayName: '店长小美',
            },
          ],
        }}
        shellFactSources={[
          {
            id: 'price-1',
            kind: 'price',
            label: '美甲价格',
            summary: '128 元 · 已确认',
            status: 'confirmed',
          },
        ]}
      />
    );

    expect(
      screen.getByTestId('result-revision-timeline-panel')
    ).toHaveTextContent('版本与历史');
    expect(
      screen.getByTestId('result-revision-timeline-panel')
    ).toHaveTextContent('基于「初稿」');
    expect(
      screen.getByTestId('result-revision-timeline-panel')
    ).toHaveTextContent('店长小美');
    expect(
      screen.getByTestId('result-revision-timeline-restore')
    ).toHaveTextContent('恢复此版本');
    expect(
      screen.getByTestId('result-revision-timeline-panel')
    ).not.toHaveTextContent(workId);
  });

  it('keeps the mobile Result primary action sticky above the safe area', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        viewport="mobile"
        facts={{
          target: { workId },
          workspaceKind: 'image',
          progressState: 'success',
          hasUsableCandidate: true,
        }}
        onAction={() => undefined}
        supportedActionIds={['adopt_candidate', 'continue_adjust', 'deliver']}
      />
    );

    const actions = screen.getByTestId('result-shell-actions');
    expect(actions).toHaveAttribute('data-mobile-sticky-actions', 'true');
    expect(actions).toHaveClass('sticky');
    expect(actions).toHaveClass(
      'bottom-[calc(5.25rem+env(safe-area-inset-bottom))]'
    );
    expect(screen.getByTestId('result-primary-action')).toHaveTextContent(
      '采用这组'
    );
    expect(screen.queryAllByTestId('result-secondary-action')).toHaveLength(0);
  });

  it('keeps image-text media and the note editor together in the production result', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId },
          workspaceKind: 'image',
          progressState: 'success',
          hasUsableCandidate: true,
        }}
        imageWorksurface={{
          workId,
          baseRevisionId: 'version-note-1',
          outputType: 'ordered_image_set',
          slot: 'gallery',
          lifecycle: 'candidate',
          candidates: [
            {
              assetId: 'note-image-1',
              persisted: true,
              rightsOk: true,
              generationOk: true,
              recipeOrder: 1,
            },
          ],
          hasContentPackage: true,
          mediaVersionReady: true,
        }}
        copyWorksurface={{
          workId,
          baseRevisionId: 'version-note-1',
          document: {
            title: '春日护理笔记',
            body: '先讲护理体验，再说明到店建议。',
            conversionHook: '私信预约',
            topics: ['护理'],
            orderedAssetIds: ['note-image-1'],
          },
          factSources: [],
          lifecycle: 'candidate',
        }}
        onAdjust={vi.fn()}
      />
    );

    expect(screen.getByTestId('image-worksurface')).toBeInTheDocument();
    expect(screen.getByTestId('object-workspace-shell')).toHaveAttribute(
      'data-carrier',
      'note'
    );
    expect(screen.getByTestId('copy-field-body')).toHaveTextContent(
      '先讲护理体验，再说明到店建议。'
    );
    expect(
      screen.getByTestId('object-workspace-selection-ai')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('copy-adopt-action')).toBeNull();
    expect(screen.getAllByTestId('result-adjust-prompt')).toHaveLength(1);
  });

  it('renders Run Detail panel collapsed with merchant fee/stage language', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId, panel: 'run' },
          workspaceKind: 'copy',
          progressState: 'failed',
          requestedPanel: 'run',
        }}
        runDetailFacts={{
          phase: 'failed',
          progressState: 'failed',
          jobStatus: 'failed',
          failureCode: 'PROVIDER_ERROR',
          supportReference: formatMerchantSupportReference(workId),
        }}
      />
    );

    const panel = screen.getByTestId('result-run-detail-panel');
    expect(panel).toHaveTextContent('运行详情');
    expect(panel).toHaveTextContent('生成失败，可恢复');
    expect(panel).toHaveTextContent('生成服务暂时不可用');
    expect(panel).not.toHaveTextContent('PROVIDER_ERROR');
    expect(panel).not.toHaveTextContent(workId);
    // Collapsed by default: details element is present without open attr forced true
    const details = screen.getByTestId('result-run-detail');
    expect(details.hasAttribute('open')).toBe(false);
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
