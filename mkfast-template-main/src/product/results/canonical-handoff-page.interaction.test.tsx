import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanonicalHandoffPage } from './canonical-handoff-page';

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
});
