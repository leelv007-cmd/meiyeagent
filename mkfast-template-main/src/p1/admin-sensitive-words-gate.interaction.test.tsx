/**
 * Spec F / D9 / #384 — three-state sensitive-words gate alert + shared query key.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdminSensitiveWordsGateAlert,
  SENSITIVE_WORDS_GATE_COPY,
} from './admin-sensitive-words-gate-alert';
import {
  adminEnabledSensitiveWordsQueryKey,
  readEnabledSensitiveWordsList,
} from './admin-sensitive-words-gate';
import { p1QueryKeys } from './query-keys';

const p1Client = vi.hoisted(() => ({
  queryP1: vi.fn(),
  commandP1: vi.fn(),
}));

vi.mock('@/p1/client', () => p1Client);

function renderWithClient(
  children: ReactNode,
  client?: QueryClient
): QueryClient {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return queryClient;
}

beforeEach(() => {
  p1Client.queryP1.mockReset();
  p1Client.commandP1.mockReset();
});

describe('AdminSensitiveWordsGateAlert three-state surface', () => {
  it('loading copy appears while the enabled-lexicon query is pending', async () => {
    let resolveList: ((value: { items: []; total: number }) => void) | undefined;
    p1Client.queryP1.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        })
    );

    renderWithClient(<AdminSensitiveWordsGateAlert />);

    expect(
      await screen.findByTestId('sensitive-words-gate-alert')
    ).toHaveAttribute('data-gate-status', 'loading');
    expect(screen.getByTestId('sensitive-words-gate-alert')).toHaveTextContent(
      SENSITIVE_WORDS_GATE_COPY.loading
    );
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.inactive)).toBeNull();
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.error)).toBeNull();

    resolveList?.({ items: [], total: 0 });
    await waitFor(() =>
      expect(screen.getByTestId('sensitive-words-gate-alert')).toHaveAttribute(
        'data-gate-status',
        'inactive'
      )
    );
  });

  it('error copy appears on failure and never shows inactive empty-lexicon alert', async () => {
    p1Client.queryP1.mockRejectedValue(new Error('core unavailable'));

    renderWithClient(<AdminSensitiveWordsGateAlert />);

    await waitFor(() =>
      expect(screen.getByTestId('sensitive-words-gate-alert')).toHaveAttribute(
        'data-gate-status',
        'error'
      )
    );
    const alert = screen.getByTestId('sensitive-words-gate-alert');
    expect(alert).toHaveTextContent(SENSITIVE_WORDS_GATE_COPY.error);
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.inactive)).toBeNull();
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.loading)).toBeNull();
    // Must not look like a successful empty-lexicon state.
    expect(alert).not.toHaveAttribute('data-gate-status', 'inactive');
    expect(alert).not.toHaveAttribute('data-enabled-total', '0');
  });

  it('success with total 0 shows inactive gate alert', async () => {
    p1Client.queryP1.mockResolvedValue({ items: [], total: 0 });

    renderWithClient(<AdminSensitiveWordsGateAlert />);

    await waitFor(() =>
      expect(screen.getByTestId('sensitive-words-gate-alert')).toHaveAttribute(
        'data-gate-status',
        'inactive'
      )
    );
    const alert = screen.getByTestId('sensitive-words-gate-alert');
    expect(alert).toHaveTextContent(SENSITIVE_WORDS_GATE_COPY.inactive);
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.error)).toBeNull();
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.loading)).toBeNull();
  });

  it('success with total > 0 shows no gate alert', async () => {
    p1Client.queryP1.mockResolvedValue({
      items: [
        {
          id: 'sw-1',
          word: '根治',
          category: 'medical',
          replacements: ['改善'],
          status: 'enabled',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });

    renderWithClient(<AdminSensitiveWordsGateAlert />);

    await waitFor(() =>
      expect(screen.queryByTestId('sensitive-words-gate-alert')).toBeNull()
    );
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.inactive)).toBeNull();
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.error)).toBeNull();
    expect(screen.queryByText(SENSITIVE_WORDS_GATE_COPY.loading)).toBeNull();
  });
});

describe('shared enabled-lexicon query key', () => {
  it('exports the same key both pages must consume', () => {
    expect(adminEnabledSensitiveWordsQueryKey).toEqual(
      p1QueryKeys.request('sensitive-words', 'list', { status: 'enabled' })
    );
  });

  it('two alert mounts on one client issue a single list query', async () => {
    p1Client.queryP1.mockResolvedValue({ items: [], total: 0 });

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <AdminSensitiveWordsGateAlert />
        <AdminSensitiveWordsGateAlert />
      </QueryClientProvider>
    );

    await screen.findAllByTestId('sensitive-words-gate-alert');
    await waitFor(() => expect(p1Client.queryP1).toHaveBeenCalledTimes(1));
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'sensitive-words',
      {
        action: 'list',
        payload: { status: 'enabled' },
      },
      expect.anything()
    );
  });

  it('readEnabledSensitiveWordsList uses status enabled payload', async () => {
    p1Client.queryP1.mockResolvedValue({ items: [], total: 0 });
    await readEnabledSensitiveWordsList();
    expect(p1Client.queryP1).toHaveBeenCalledWith(
      'sensitive-words',
      {
        action: 'list',
        payload: { status: 'enabled' },
      },
      undefined
    );
  });
});
