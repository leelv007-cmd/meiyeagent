/**
 * V31-17 PublishHandoffPanel behavior (vitest + testing-library).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishHandoffPanel } from './publish-handoff-panel';
import { projectPublishHandoffPanel } from './publish-handoff-model';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (text: string) => {
      return `data:image/png;base64,${Buffer.from(text).toString('base64').slice(0, 24)}`;
    }),
  },
}));

afterEach(() => {
  cleanup();
});

function baseView(
  mode: 'assisted' | 'unavailable' | 'automatic_verified' = 'assisted'
) {
  return projectPublishHandoffPanel({
    contentPackageId: 'pkg-1',
    contentPackageRevision: 4,
    platform: 'xiaohongshu',
    title: '周末护理',
    body: '预约从速',
    topics: ['美甲'],
    cta: '私信预约',
    orderedAssetCount: 2,
    zipFileName: '美美店-图文-小红书-20260808-r4.zip',
    capabilityMode: mode,
    workId: 'work-1',
    mobileHandoff: {
      schemaVersion: 'publish-handoff/v1',
      handoffId: 'h1',
      token: 'tok123',
      handoffUrl: '/dashboard/handoff/tok123',
      expiresAt: '2026-08-11T00:00:00.000Z',
      contentPackageRef: { id: 'pkg-1', revision: 4 },
      platform: 'xiaohongshu',
      publishActor: 'merchant_self_publish',
      systemDrivenPublishAllowed: false,
    },
  });
}

describe('PublishHandoffPanel', () => {
  it('renders copy blocks and hides direct publish for assisted', () => {
    render(<PublishHandoffPanel view={baseView('assisted')} />);
    expect(screen.getByTestId('publish-handoff-panel')).toHaveAttribute(
      'data-show-direct-publish',
      'false'
    );
    expect(
      screen.getByTestId('publish-handoff-no-direct-publish')
    ).toBeTruthy();
    expect(screen.queryByTestId('publish-handoff-direct-publish')).toBeNull();
    expect(screen.getAllByTestId('publish-handoff-copy-block')).toHaveLength(4);
    expect(screen.getByTestId('publish-handoff-zip-name')).toHaveTextContent(
      '美美店-图文-小红书-20260808-r4.zip'
    );
    expect(screen.getByTestId('publish-handoff-image-order')).toHaveTextContent(
      'images/01.jpg'
    );
  });

  it('unavailable still shows export/copy path without direct publish', () => {
    render(<PublishHandoffPanel view={baseView('unavailable')} />);
    expect(
      screen.getByTestId('publish-handoff-no-direct-publish')
    ).toBeTruthy();
    expect(
      screen.getByTestId('publish-handoff-capability-label')
    ).toHaveTextContent('暂不可用');
  });

  it('MobilePublishHandoff rejects driven publish (A19)', () => {
    render(<PublishHandoffPanel view={baseView()} />);
    expect(screen.getByTestId('mobile-publish-handoff')).toHaveAttribute(
      'data-system-driven-allowed',
      'false'
    );
    fireEvent.click(
      screen.getByTestId('mobile-publish-handoff-driven-attempt')
    );
    expect(
      screen.getByTestId('mobile-publish-handoff-driven-reject')
    ).toHaveTextContent(/不会代发|A19/);
  });

  it('我已发布 binds exact content package revision', async () => {
    const onRecordPublished = vi.fn();
    render(
      <PublishHandoffPanel
        onRecordPublished={onRecordPublished}
        view={baseView()}
      />
    );
    expect(screen.getByTestId('publish-handoff-i-published')).toHaveAttribute(
      'data-binding-revision',
      '4'
    );
    fireEvent.change(screen.getByTestId('publish-handoff-platform-url'), {
      target: { value: 'https://www.xiaohongshu.com/explore/1' },
    });
    fireEvent.click(screen.getByTestId('publish-handoff-confirm-published'));
    expect(onRecordPublished).toHaveBeenCalledWith({
      contentPackageId: 'pkg-1',
      contentPackageRevision: 4,
      platformUrl: 'https://www.xiaohongshu.com/explore/1',
    });
  });

  it('self-report journey chips fire signals including no_activity', () => {
    const onSelfReport = vi.fn();
    render(
      <PublishHandoffPanel
        onSelfReport={onSelfReport}
        selfReportChips={[
          'inquiry',
          'wechat',
          'booking',
          'purchase',
          'visit',
          'no_activity',
        ]}
        selfReportPrompt="昨天的笔记有人来问吗？"
        view={baseView()}
      />
    );
    expect(screen.getByTestId('self-report-prompt')).toHaveTextContent(
      /有人来问/
    );
    fireEvent.click(screen.getByTestId('self-report-chip-no_activity'));
    expect(onSelfReport).toHaveBeenCalledWith('no_activity');
    fireEvent.click(screen.getByTestId('self-report-chip-inquiry'));
    expect(onSelfReport).toHaveBeenCalledWith('inquiry');
  });

  it('copy block action fires for title', () => {
    const onCopyBlock = vi.fn();
    render(<PublishHandoffPanel onCopyBlock={onCopyBlock} view={baseView()} />);
    fireEvent.click(screen.getByTestId('publish-handoff-copy-title'));
    expect(onCopyBlock).toHaveBeenCalledWith('title', '周末护理');
  });

  it('download ZIP button invokes export handler with deterministic file name', async () => {
    const onDownloadZip = vi.fn(async () => undefined);
    render(
      <PublishHandoffPanel onDownloadZip={onDownloadZip} view={baseView()} />
    );
    fireEvent.click(screen.getByTestId('publish-handoff-download-zip'));
    await waitFor(() => {
      expect(onDownloadZip).toHaveBeenCalledWith(
        '美美店-图文-小红书-20260808-r4.zip'
      );
    });
  });

  it('MobilePublishHandoff QR renders a real image and keeps frozen handoff URL', async () => {
    render(<PublishHandoffPanel view={baseView()} />);
    const qr = screen.getByTestId('mobile-publish-handoff-qr');
    expect(qr).toHaveAttribute('data-handoff-url', '/dashboard/handoff/tok123');
    await waitFor(() => {
      expect(
        screen.getByTestId('mobile-publish-handoff-qr-image')
      ).toBeTruthy();
    });
    const img = screen.getByTestId('mobile-publish-handoff-qr-image');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src') ?? '').toMatch(/^data:image\//u);
  });
});
