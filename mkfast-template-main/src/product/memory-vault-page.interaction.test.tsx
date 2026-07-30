/**
 * D-164④ — 记忆 as a first-class destination.
 *
 * The assertion that matters most here is the last one: a domain with no
 * backend must not render the same thing a shop with no history renders.
 * "We haven't built this" and "you haven't done anything yet" are different
 * facts, and only one of them is the merchant's fault to fix.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const p1 = vi.hoisted(() => ({
  commandP1: vi.fn(),
  queryP1: vi.fn(),
}));

vi.mock('@/p1/client', () => ({
  commandP1: p1.commandP1,
  queryP1: p1.queryP1,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const { MemoryVaultPage } = await import('./memory-vault-page');

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryVaultPage />
    </QueryClientProvider>
  );
}

const identity = {
  identityId: 'identity-1',
  workspaceId: 'ws-1',
  version: 1,
  status: 'active',
  displayName: '晨光美容工作室',
  owner: '店主',
  kind: 'brand',
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('memory vault', () => {
  it('shows all four domains D-164④ names', async () => {
    p1.queryP1.mockResolvedValue({
      identities: [],
      defaultDecision: null,
      defaultIdentity: null,
      decisionRevision: 0,
    });

    renderPage();

    for (const testId of [
      'memory-domain-identity',
      'memory-domain-campaigns',
      'memory-domain-workflows',
      'memory-domain-corrections',
    ]) {
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    }
  });

  it('names the default identity when the shop has set one', async () => {
    p1.queryP1.mockResolvedValue({
      identities: [identity],
      defaultDecision: null,
      defaultIdentity: { identityId: 'identity-1', version: 1 },
      decisionRevision: 1,
    });

    renderPage();

    expect(await screen.findByTestId('memory-identity-name')).toHaveTextContent(
      '晨光美容工作室'
    );
  });

  it('says the shop has set no persona rather than going blank', async () => {
    p1.queryP1.mockResolvedValue({
      identities: [],
      defaultDecision: null,
      defaultIdentity: null,
      decisionRevision: 0,
    });

    renderPage();

    const section = await screen.findByTestId('memory-domain-identity');
    expect(section.textContent).toMatch(/还没有设定门店人设/u);
    // The shop's own emptiness is not the product's incompleteness.
    expect(section.textContent).not.toMatch(/还在建/u);
  });

  it('marks the domains that have no backend as unbuilt, not as empty', async () => {
    p1.queryP1.mockResolvedValue({
      identities: [identity],
      defaultDecision: null,
      defaultIdentity: { identityId: 'identity-1', version: 1 },
      decisionRevision: 1,
    });

    renderPage();

    await screen.findByTestId('memory-domain-campaigns');
    // campaigns / workflows / corrections have no producer yet. Assert on what
    // each note actually says, not just that the element is there — a testid
    // survives the copy being swapped for an ordinary empty state, which is
    // the exact confusion this test exists to prevent.
    const notes = screen.getAllByTestId('memory-unbuilt-note');
    expect(notes).toHaveLength(3);
    for (const note of notes) {
      expect(note.textContent).toMatch(/还在建/u);
    }
    // The one domain that does have a producer must not claim to be unbuilt.
    expect(
      screen.getByTestId('memory-domain-identity').textContent
    ).not.toMatch(/还在建/u);
  });

  it('shows human provenance and confirms a pending candidate through the memory seam', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'candidate-tone',
                  semanticKey: 'tone.default',
                  value: '克制、像熟客分享',
                  status: 'pending',
                  proposedAt: '2026-07-30T06:00:00.000Z',
                  source: {
                    conversationId: 'conversation-a',
                    sourceTurnId: 'turn-a',
                    messageRange: { start: 0, end: 1 },
                    status: 'available',
                    observedAt: '2026-07-30T05:59:00.000Z',
                    preview: '以后文案要克制，像熟客分享。',
                    deletedAt: null,
                  },
                },
              ],
              nextCursor: null,
            })
          : Promise.resolve({
              identities: [],
              defaultDecision: null,
              defaultIdentity: null,
              decisionRevision: 0,
            })
    );
    p1.commandP1.mockResolvedValue({ candidateId: 'candidate-tone' });

    renderPage();

    expect(
      await screen.findByTestId('memory-entry-provenance')
    ).toHaveTextContent('因为你 2026/7/30 说过：以后文案要克制，像熟客分享。');
    fireEvent.click(screen.getByRole('button', { name: '确认记住' }));
    await waitFor(() =>
      expect(p1.commandP1).toHaveBeenCalledWith(
        'memory',
        {
          action: 'confirm_candidate',
          payload: { entryId: 'candidate-tone' },
        },
        'memory:confirm_candidate:candidate-tone'
      )
    );
  });

  it('renders a structured memory value as readable JSON', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'candidate-palette',
                  semanticKey: 'palette.default',
                  value: { primary: 'warm-white', accent: 'tea-brown' },
                  status: 'pending',
                  proposedAt: '2026-07-30T06:00:00.000Z',
                  source: null,
                },
              ],
              nextCursor: null,
            })
          : Promise.resolve({
              identities: [],
              defaultDecision: null,
              defaultIdentity: null,
              decisionRevision: 0,
            })
    );

    renderPage();

    expect(
      await screen.findByText('{"primary":"warm-white","accent":"tea-brown"}')
    ).toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });
});
