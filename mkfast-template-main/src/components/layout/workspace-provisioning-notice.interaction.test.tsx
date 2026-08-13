import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import { WorkspaceProvisioningNotice } from './workspace-provisioning-notice';

afterEach(cleanup);

describe('workspace provisioning merchant notice', () => {
  it('renders a Chinese status line when provisioning is stuck', () => {
    overwriteGetLocale(() => 'zh');
    render(<WorkspaceProvisioningNotice visible />);

    const notice = screen.getByTestId('workspace-provisioning-notice');
    expect(notice).toBeInTheDocument();
    expect(notice.tagName.toLowerCase()).toBe('output');
    expect(notice.textContent).toMatch(/准备/u);
    expect(notice.textContent).not.toMatch(/500|INVALID_STATE|in_progress/u);
  });

  it('stays silent when provisioning is healthy', () => {
    render(<WorkspaceProvisioningNotice visible={false} />);
    expect(
      screen.queryByTestId('workspace-provisioning-notice')
    ).not.toBeInTheDocument();
  });
});
