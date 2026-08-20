import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function supportTiptapSelectionGeometry() {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => document.querySelector('[data-testid="copy-field-body"]'),
  });
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(),
    },
    getClientRects: {
      configurable: true,
      value: () => [],
    },
  });
}

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
  it('threads the object-workspace AI cover action to a reachable page exit', () => {
    const onImageAiCover = vi.fn();
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
          baseRevisionId: 'revision-1',
          outputType: 'single_image',
          slot: 'standalone',
          lifecycle: 'candidate',
          candidates: [
            {
              assetId: 'image-1',
              persisted: true,
              rightsOk: true,
              generationOk: true,
            },
          ],
          hasContentPackage: false,
          mediaVersionReady: true,
        }}
        onImageAiCover={onImageAiCover}
      />
    );

    const trigger = screen.getByTestId('image-ai-cover-tool');
    expect(trigger).toBeEnabled();
    expect(screen.queryByTestId('result-image-text-workspace')).toBeNull();
    fireEvent.click(trigger);
    expect(onImageAiCover).toHaveBeenCalledOnce();
  });

  it('hosts the note object workspace for an image-text package on the copy work', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId },
          workspaceKind: 'copy',
          progressState: 'success',
          hasUsableCandidate: true,
        }}
        copyWorksurface={{
          workId,
          baseRevisionId: 'revision-1',
          document: {
            body: '克制可信的到店笔记。',
            conversionHook: '私信预约',
            orderedAssetIds: ['image-1'],
            title: '到店笔记',
            topics: ['护理'],
          },
          lifecycle: 'candidate',
        }}
        imageWorksurface={{
          workId,
          baseRevisionId: 'revision-1',
          outputType: 'single_image',
          slot: 'standalone',
          lifecycle: 'candidate',
          candidates: [
            {
              assetId: 'image-1',
              persisted: true,
              rightsOk: true,
              generationOk: true,
            },
          ],
          hasContentPackage: true,
          mediaVersionReady: true,
        }}
      />
    );

    const workspace = screen.getByTestId('result-image-text-workspace');
    expect(
      within(workspace).getByTestId('object-workspace-shell')
    ).toHaveAttribute('data-carrier', 'note');
    expect(within(workspace).getByTestId('image-worksurface')).toBeVisible();
  });

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

  it('a Job-less failed Result never exposes retry and names 返回工作台', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId },
          workspaceKind: 'image',
          progressState: 'failed',
        }}
        onAction={onAction}
        supportedActionIds={['retry', 'leave_and_continue', 'continue_adjust']}
      />
    );

    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect(screen.queryByTestId('result-primary-action')).toHaveTextContent(
      '返回工作台'
    );
    await user.click(screen.getByTestId('result-primary-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({
      id: 'leave_and_continue',
      label: '返回工作台',
    });
    expect(onAction.mock.calls[0]?.[0]?.id).not.toBe('retry');
  });

  it('TIMEOUT Result never offers retry or 按 1 次创作计费 and names 返回工作台', () => {
    const onAction = vi.fn();
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId, panel: 'run' },
          workspaceKind: 'copy',
          progressState: 'failed',
          jobId: 'job_timeout',
          failureCode: 'TIMEOUT',
          requestedPanel: 'run',
        }}
        onAction={onAction}
        supportedActionIds={['retry', 'leave_and_continue', 'open_run_detail']}
        runDetailFacts={{
          phase: 'failed',
          progressState: 'failed',
          jobStatus: 'failed',
          failureCode: 'TIMEOUT',
          productUsageQuantity: 1,
          supportReference: formatMerchantSupportReference(workId),
        }}
      />
    );

    const page = screen.getByRole('main');
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect(screen.getByTestId('result-primary-action')).toHaveTextContent(
      '返回工作台'
    );
    expect(page).toHaveTextContent('返回工作台');
    expect(page).not.toHaveTextContent('可以重试');
    expect(page).not.toHaveTextContent('按 1 次创作计费');
    expect(page).not.toHaveTextContent('1 次创作');
    expect(onAction).not.toHaveBeenCalled();
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
    // Whole sentence, not just the honest half: #358 found the tail promising
    // a confirmation before a regeneration this page cannot start, and a
    // prefix-only assertion let it ride.
    expect(page).toHaveTextContent(
      '本次是否产生费用请以账单记录为准；当前页面不会重新发起本次创作。'
    );
    expect(page).not.toHaveTextContent(workId);
    expect(screen.getByTestId('result-support-reference')).toHaveTextContent(
      supportReference
    );
    expect(page).not.toHaveTextContent(workId);
    fireEvent.click(screen.getByTestId('result-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  // #358 / D-176: the same soft promise the Run Detail fee line carried, but
  // on the always-visible failure banner instead of inside a collapsed panel.
  // The sentence has to agree with the button next to it, so it splits on the
  // very fact that decides whether 「重试」 renders at all — `facts.jobId`, via
  // `retryableRun` in result-shell-model — and not on a second job-shaped
  // signal the action projection never reads.
  it('keeps the failed-fee promise only where a Job puts 重试 on screen', () => {
    render(
      <ResultCenterPage
        workId={workId}
        resolveOutcome={resolvedTarget()}
        facts={{
          target: { workId },
          workspaceKind: 'image',
          progressState: 'failed',
          jobId: 'job_5b1f0c3a-77a6-4a1e-9f0c-2c9a1d5e4b88',
        }}
        onAction={() => undefined}
      />
    );

    expect(screen.getByTestId('result-primary-action')).toHaveTextContent(
      '重试'
    );
    expect(screen.getByRole('main')).toHaveTextContent(
      '本次是否产生费用请以账单记录为准；重新生成前会再次确认费用。'
    );
  });

  it('leaves the video receiver fee line exactly as it was', () => {
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

    expect(screen.getByRole('main')).toHaveTextContent(
      '本次是否产生费用请以账单记录为准；上游结果接收失败，可返回工作台查看运行详情。'
    );
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

  it('keeps image-text media, editing and live note previews in one production workspace', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn();
    const onCopyQuickEdit = vi.fn();
    const onCopySelectionRewrite = vi.fn();
    const onImageAiCover = vi.fn();
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
              previewUrl: 'https://cdn.example/note-image-1.webp',
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
          packageId: 'package-note-1',
          sourcePlatform: 'xiaohongshu',
          document: {
            title: '春日护理笔记',
            body: '先讲护理💆体验，再说明到店建议。',
            conversionHook: '私信预约',
            topics: ['护理'],
            orderedAssetIds: ['note-image-1'],
          },
          alternativeCandidates: [
            {
              candidateId: 'note-alternative-1',
              title: '清透护理备选',
              body: '先讲真实感受，再给护理建议。',
              conversionHook: '到店咨询',
            },
          ],
          factSources: [
            {
              id: 'note-fact-1',
              kind: 'material',
              label: '护理项目',
              summary: '门店已确认',
              status: 'confirmed',
            },
          ],
          selectedCarrier: 'xiaohongshu',
          platformPreviews: [
            {
              carrier: 'xiaohongshu',
              title: '小红书护理版',
              body: '真实分享护理体验，到店前先沟通肤况。',
              conversionHook: '私信预约',
              topics: ['护理'],
              source: 'copy.adapt',
            },
          ],
          lifecycle: 'candidate',
        }}
        onAdjust={onAdjust}
        onCopyQuickEdit={onCopyQuickEdit}
        onCopySelectionRewrite={onCopySelectionRewrite}
        onImageAiCover={onImageAiCover}
      />
    );

    const shell = screen.getByTestId('object-workspace-shell');
    expect(screen.getAllByTestId('object-workspace-shell')).toHaveLength(1);
    expect(shell).toHaveAttribute('data-carrier', 'note');
    expect(within(shell).getByTestId('image-worksurface')).toBeInTheDocument();
    expect(screen.getByTestId('copy-field-body')).toHaveTextContent(
      '先讲护理💆体验，再说明到店建议。'
    );
    expect(
      screen.getByTestId('object-workspace-selection-ai')
    ).toBeInTheDocument();
    supportTiptapSelectionGeometry();
    const selectionBody = screen.getByTestId('copy-field-body');
    const selectionTextNode = selectionBody.querySelector('p')?.firstChild;
    if (!(selectionTextNode instanceof Text)) {
      throw new Error('Missing note editor text node');
    }
    selectionBody.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.collapse(selectionTextNode, 0);
    fireEvent(document, new Event('selectionchange', { bubbles: true }));
    const range = document.createRange();
    // JS/DOM offsets are UTF-16: the emoji occupies offsets 4-6.
    range.setStart(selectionTextNode, 6);
    range.setEnd(selectionTextNode, 8);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange', { bubbles: true }));
    await waitFor(() =>
      expect(
        screen.getByTestId('object-workspace-selection-ai')
      ).toHaveAttribute('data-rewrite-scope', 'selection')
    );
    fireEvent.click(screen.getByTestId('selection-ai-shorten'));
    await waitFor(() => expect(onAdjust).toHaveBeenCalledOnce());
    expect(onAdjust.mock.calls[0]?.[0]).toContain('精简以下选区');
    expect(onAdjust.mock.calls[0]?.[1]).toMatchObject({
      end: 8,
      field: 'body',
      kind: 'text_selection',
      packageId: 'package-note-1',
      platform: 'xiaohongshu',
      selectedText: '体验',
      start: 6,
      versionId: 'version-note-1',
    });
    fireEvent.click(screen.getByTestId('image-ai-cover-tool'));
    expect(onImageAiCover).toHaveBeenCalledOnce();
    expect(screen.getByTestId('copy-fact-sources')).toHaveTextContent(
      '护理项目'
    );
    expect(screen.getByTestId('copy-platform-preview-body')).toHaveTextContent(
      '小红书护理版'
    );
    expect(screen.getByTestId('copy-selection-rewrite')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('copy-rewrite-weaker_promo'));
    expect(onCopySelectionRewrite).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('copy-selection-rewrite-preview')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('copy-export-use-poster'));
    expect(onCopyQuickEdit).toHaveBeenCalledOnce();
    await user.click(screen.getByTestId('copy-alternatives-toggle'));
    expect(screen.getByText('清透护理备选')).toBeInTheDocument();

    const phone = screen.getByRole('region', {
      name: '小红书手机笔记预览',
    });
    expect(phone).toHaveAttribute('data-phone-shell', 'true');
    expect(within(phone).getByRole('img')).toHaveAttribute(
      'src',
      'https://cdn.example/note-image-1.webp'
    );
    const discovery = screen.getByRole('region', {
      name: '小红书发现页双列封面预览',
    });
    expect(
      within(discovery).getByTestId('note-discovery-columns')
    ).toHaveAttribute('data-column-count', '2');
    expect(
      within(discovery).getByTestId('note-discovery-own-card')
    ).toContainElement(within(discovery).getByRole('img'));

    const title = screen.getByTestId('copy-field-title');
    await user.clear(title);
    await user.type(title, '夏日焕亮笔记');
    expect(within(phone).getByText('夏日焕亮笔记')).toBeInTheDocument();
    expect(within(discovery).getByText('夏日焕亮笔记')).toBeInTheDocument();

    const body = screen.getByTestId('copy-field-body');
    supportTiptapSelectionGeometry();
    await user.click(body);
    await user.clear(body);
    await user.type(body, '编辑后的护理正文。');
    expect(within(phone).getByText('编辑后的护理正文。')).toBeInTheDocument();

    const hook = screen.getByTestId('copy-field-hook');
    await user.clear(hook);
    await user.type(hook, '评论区预约');
    expect(within(phone).getByText('评论区预约')).toBeInTheDocument();
    expect(screen.queryByTestId('copy-adopt-action')).toBeNull();
    expect(screen.getAllByTestId('result-adjust-prompt')).toHaveLength(1);
  });

  it('shows an honest empty cover when the canonical asset has no authorized preview URL', () => {
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
          baseRevisionId: 'version-note-empty-cover',
          outputType: 'ordered_image_set',
          slot: 'gallery',
          lifecycle: 'candidate',
          candidates: [
            {
              assetId: 'canonical-cover-without-url',
              persisted: true,
              rightsOk: true,
              generationOk: true,
              recipeOrder: 1,
            },
            {
              assetId: 'other-image-with-url',
              previewUrl: 'https://cdn.example/not-the-cover.webp',
              persisted: true,
              rightsOk: true,
              generationOk: true,
              recipeOrder: 2,
            },
          ],
          hasContentPackage: true,
          mediaVersionReady: true,
        }}
        copyWorksurface={{
          workId,
          baseRevisionId: 'version-note-empty-cover',
          document: {
            title: '封面待授权笔记',
            body: '展示真实空态。',
            conversionHook: '私信预约',
            topics: [],
            orderedAssetIds: [
              'canonical-cover-without-url',
              'other-image-with-url',
            ],
          },
          factSources: [],
          lifecycle: 'candidate',
        }}
      />
    );

    for (const regionName of [
      '小红书手机笔记预览',
      '小红书发现页双列封面预览',
    ]) {
      const region = screen.getByRole('region', { name: regionName });
      expect(within(region).queryByRole('img')).toBeNull();
      expect(within(region).getByRole('status')).toHaveTextContent(
        '暂无可预览封面'
      );
    }
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
