import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminProviderCredentialControl } from './admin-provider-credential-control';
import {
  peekCredentialRotationHandoff,
  PLATFORM_CREDENTIAL_WORKSPACE_ID,
  resetCredentialRotationHandoffForTests,
} from './provider-credential-rotation-handoff';
import { p1QueryKeys } from './query-keys';

const p1Client = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('./client', () => p1Client);

const RECEIPT_ID = 'secure-write-123e4567-e89b-42d3-a456-426614174000';
const ACCOUNT_ID = 'credential-account:platform:model.direct';
const EXPIRES_AT = '2026-08-07T12:15:00.000Z';

const existingCredentials = [
  {
    effectiveSource: 'vault' as const,
    id: 'platform:model.direct',
    credentialAccountId: ACCOUNT_ID,
    workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
    accountStatus: 'active' as const,
    credential: {
      mask: '••••••••',
      scope: ['provider.connect'],
      status: 'active',
      version: 2,
      testedAt: '2026-08-07T10:00:00.000Z',
      testStatus: 'passed' as const,
    },
    updatedAt: '2026-08-07T10:00:00.000Z',
  },
  {
    effectiveSource: 'vault' as const,
    id: 'platform:ark.media',
    accountStatus: 'pending' as const,
  },
];

function renderControl() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  client.setQueryData(
    p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    existingCredentials
  );
  return render(
    <QueryClientProvider client={client}>
      <AdminProviderCredentialControl />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetCredentialRotationHandoffForTests();
  p1Client.commandP1.mockReset();
  p1Client.queryP1.mockReset();
});

afterEach(() => {
  cleanup();
  resetCredentialRotationHandoffForTests();
});

describe('AdminProviderCredentialControl rotation receipt handoff', () => {
  it('shows receipt id/expiry after rotate, stages SPA handoff, and never puts receiptId in the supply link', async () => {
    const user = userEvent.setup();
    p1Client.commandP1.mockResolvedValueOnce({
      account: {
        id: ACCOUNT_ID,
        workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      },
      secureWriteReceipt: {
        id: RECEIPT_ID,
        workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
        accountId: ACCOUNT_ID,
        nextSecretVersion: 3,
        expiresAt: EXPIRES_AT,
      },
    });
    p1Client.queryP1.mockResolvedValue(existingCredentials);

    renderControl();

    const slot = screen
      .getAllByTestId('provider-credential-slot')
      .find((node) => node.getAttribute('data-slot') === 'model.direct');
    if (!slot) throw new Error('model.direct slot missing');

    const secret = within(slot).getByLabelText(/model\.direct|新凭据|New secret/i);
    await user.type(secret, 'new-platform-secret-value-must-not-echo');
    await user.click(within(slot).getByRole('button', { name: /轮换|Rotate/i }));

    const receipt = await within(slot).findByTestId(
      'provider-credential-rotation-receipt'
    );
    expect(receipt).toHaveTextContent(RECEIPT_ID);
    expect(receipt).toHaveAttribute('data-account-id', ACCOUNT_ID);
    expect(
      within(slot).getByTestId('provider-credential-receipt-id')
    ).toHaveTextContent(RECEIPT_ID);
    expect(
      within(slot).getByTestId('provider-credential-receipt-expires')
    ).toBeInTheDocument();

    const complete = within(slot).getByTestId(
      'provider-credential-complete-rotation'
    );
    expect(complete).toHaveAttribute('href', '/admin/supply');
    expect(complete.getAttribute('href')).not.toMatch(/receipt/i);
    expect(complete.getAttribute('href')).not.toContain(RECEIPT_ID);

    const handoff = peekCredentialRotationHandoff(
      Date.parse('2026-08-07T12:00:00.000Z')
    );
    expect(handoff).toEqual({
      workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      accountId: ACCOUNT_ID,
      receiptId: RECEIPT_ID,
      expiresAt: EXPIRES_AT,
    });

    // Secret must leave the input and never appear in the receipt card.
    expect(secret).toHaveValue('');
    expect(receipt.textContent).not.toMatch(/new-platform-secret|secretReference/i);
    expect(JSON.stringify(p1Client.commandP1.mock.calls[0])).not.toMatch(
      /secureWriteReceipt|secretReference/
    );
  });

  it('does not stage a handoff for first-time store (no receipt)', async () => {
    const user = userEvent.setup();
    const emptySlots = [
      { effectiveSource: 'env_fallback' as const, id: 'platform:model.direct' },
      { effectiveSource: 'env_fallback' as const, id: 'platform:ark.media' },
    ];
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    client.setQueryData(
      p1QueryKeys.request('integrations', 'admin_provider_credentials'),
      emptySlots
    );
    p1Client.commandP1.mockResolvedValueOnce({
      id: 'platform:model.direct',
      credential: { mask: '••••••••', version: 1, status: 'active', scope: [] },
    });
    // Keep the vault empty on refetch so the control stays on the store path.
    p1Client.queryP1.mockResolvedValue(emptySlots);

    render(
      <QueryClientProvider client={client}>
        <AdminProviderCredentialControl />
      </QueryClientProvider>
    );

    const slot = screen
      .getAllByTestId('provider-credential-slot')
      .find((node) => node.getAttribute('data-slot') === 'model.direct');
    if (!slot) throw new Error('model.direct slot missing');
    await user.type(
      within(slot).getByLabelText(/model\.direct|新凭据|New secret/i),
      'first-store-secret'
    );
    // Empty slot only exposes the store action (no test/revoke until credential exists).
    await user.click(within(slot).getAllByRole('button')[0]!);

    await waitFor(() => expect(p1Client.commandP1).toHaveBeenCalled());
    expect(p1Client.commandP1.mock.calls[0]?.[1]).toMatchObject({
      action: 'admin_store_provider_credential',
    });
    expect(
      within(slot).queryByTestId('provider-credential-rotation-receipt')
    ).toBeNull();
    expect(peekCredentialRotationHandoff()).toBeNull();
  });
});
