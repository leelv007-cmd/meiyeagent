import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanonicalHandoffPage } from './canonical-handoff-page';
import {
  canonicalHandoffFixture,
  projectCanonicalHandoffPage,
} from './delivery-handoff-canonical';

afterEach(cleanup);

describe('canonical handoff unavailable recovery', () => {
  it('offers an accessible safe recovery for an expired one-shot link', () => {
    const onUnavailableRecovery = vi.fn();
    render(
      <CanonicalHandoffPage
        resolve={{ kind: 'expired', token: 'handoff-token-private' }}
        onUnavailableRecovery={onUnavailableRecovery}
      />
    );

    expect(
      screen.getByTestId('canonical-handoff-unavailable')
    ).toHaveTextContent('交接链接已过期');
    const recover = screen.getByTestId('canonical-handoff-recover');
    expect(recover).toHaveAccessibleName('返回工作台');
    fireEvent.click(recover);
    expect(onUnavailableRecovery).toHaveBeenCalledWith('expired');
    expect(screen.queryByTestId('handoff-section-download')).toBeNull();
    expect(
      screen.getByTestId('canonical-handoff-unavailable')
    ).not.toHaveTextContent('handoff-token-private');
  });

  it('uses the same safe recovery path for revoked or unknown links', () => {
    const onUnavailableRecovery = vi.fn();
    render(
      <CanonicalHandoffPage
        resolve={{ kind: 'not_found' }}
        onUnavailableRecovery={onUnavailableRecovery}
      />
    );

    fireEvent.click(screen.getByTestId('canonical-handoff-recover'));
    expect(onUnavailableRecovery).toHaveBeenCalledWith('not_found');
  });

  it('renders consumed tokens as unavailable without ready handoff contents', () => {
    render(<CanonicalHandoffPage resolve={{ kind: 'consumed' }} />);

    expect(
      screen.getByTestId('canonical-handoff-unavailable')
    ).toHaveTextContent('交接链接已使用');
    expect(screen.queryByTestId('canonical-handoff-page')).toBeNull();
    expect(screen.queryByTestId('handoff-section-share')).toBeNull();
    expect(screen.queryByTestId('handoff-section-download')).toBeNull();
    expect(screen.queryByTestId('handoff-section-copy')).toBeNull();
    expect(screen.queryByTestId('handoff-section-report')).toBeNull();
  });
});

function readyHandoffResolve() {
  const resolve = projectCanonicalHandoffPage(canonicalHandoffFixture(), {
    nowIso: '2026-07-20T12:00:00.000Z',
    canShareFiles: true,
  });
  if (resolve.kind !== 'ready') {
    throw new Error('expected a ready canonical handoff projection');
  }
  return resolve;
}

describe('canonical handoff published report', () => {
  it('sets data-published only after a successful 已发布 command', async () => {
    let complete!: () => void;
    const onReport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    render(
      <CanonicalHandoffPage
        resolve={readyHandoffResolve()}
        onReport={onReport}
      />
    );

    const section = screen.getByTestId('handoff-section-report');
    expect(section).toHaveAttribute('data-published', 'false');
    expect(section).toHaveAttribute('data-handed-over-not-published', 'true');

    fireEvent.change(screen.getByLabelText('平台链接'), {
      target: { value: 'https://example.test/posts/e2e-golden' },
    });
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: 'canonical Composer handoff e2e' },
    });
    fireEvent.click(screen.getByTestId('handoff-report-published'));

    expect(onReport).toHaveBeenCalledWith({
      note: 'canonical Composer handoff e2e',
      outcome: 'published',
      platformUrl: 'https://example.test/posts/e2e-golden',
    });
    expect(section).toHaveAttribute('data-published', 'false');
    expect(section).toHaveAttribute('data-handed-over-not-published', 'true');

    complete();
    await waitFor(() =>
      expect(screen.getByTestId('handoff-section-report')).toHaveAttribute(
        'data-published',
        'true'
      )
    );
    expect(screen.getByTestId('handoff-section-report')).toHaveAttribute(
      'data-handed-over-not-published',
      'false'
    );
    expect(screen.getByTestId('handoff-report-status')).toHaveTextContent(
      '已发布'
    );
  });

  it('keeps data-published false when the report command rejects', async () => {
    const onReport = vi.fn(() => Promise.reject(new Error('conflict')));
    render(
      <CanonicalHandoffPage
        resolve={readyHandoffResolve()}
        onReport={onReport}
      />
    );

    fireEvent.click(screen.getByTestId('handoff-report-published'));
    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('handoff-section-report')).toHaveAttribute(
      'data-published',
      'false'
    );
    expect(screen.getByTestId('handoff-section-report')).toHaveAttribute(
      'data-handed-over-not-published',
      'true'
    );
  });
});
