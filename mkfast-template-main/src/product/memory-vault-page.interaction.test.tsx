/**
 * D-164④ — 记忆 as a first-class destination.
 * P1-04 (#316) — three-layer IA: 待你确认 → 已记住（域）→ 证据抽屉.
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
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import type { MemoryEntryProjection } from '@meiye/contracts';
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryVaultPage />
      </QueryClientProvider>
    ),
  };
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

const emptyIdentity = {
  identities: [],
  defaultDecision: null,
  defaultIdentity: null,
  decisionRevision: 0,
};

function vaultEntry(
  entry: Partial<MemoryEntryProjection> &
    Pick<MemoryEntryProjection, 'entryId' | 'kind' | 'status'>
): MemoryEntryProjection {
  return {
    semanticKey: `memory.${entry.kind}.${entry.entryId}`,
    value: entry.statement ?? entry.kind,
    proposedAt: '2026-08-08T10:00:00.000Z',
    authority: entry.status === 'confirmed' ? 'confirmed' : 'observation',
    state: entry.status === 'confirmed' ? 'active' : 'proposed',
    revision: entry.status === 'confirmed' ? 1 : 0,
    statement: `${entry.kind} statement`,
    source: null,
    ...entry,
  };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('memory vault', () => {
  it('P1-4: shows three-layer IA with pending layer on top by default', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'confirmed-old',
                  semanticKey: 'tone.confirmed',
                  value: '已确认偏旧',
                  status: 'confirmed',
                  proposedAt: '2026-07-31T08:00:00.000Z',
                  source: null,
                },
                {
                  entryId: 'pending-new',
                  semanticKey: 'tone.pending',
                  value: '待确认偏新',
                  status: 'pending',
                  proposedAt: '2026-07-30T06:00:00.000Z',
                  source: null,
                },
              ],
              nextCursor: null,
            })
          : Promise.resolve({
              identities: [identity],
              defaultDecision: null,
              defaultIdentity: { identityId: 'identity-1', version: 1 },
              decisionRevision: 1,
            })
    );

    renderPage();

    // Wait until both layers have real entries (sections mount empty first).
    await screen.findByTestId('memory-entry-pending-new');
    await screen.findByTestId('memory-entry-confirmed-old');

    const pendingLayer = screen.getByTestId('memory-layer-pending');
    const rememberedLayer = screen.getByTestId('memory-layer-remembered');
    expect(pendingLayer).toBeInTheDocument();
    expect(rememberedLayer).toBeInTheDocument();

    // Pending layer is above remembered in document order (default on top).
    const position = pendingLayer.compareDocumentPosition(rememberedLayer);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Layer titles are merchant language (zh messages in interaction suite).
    expect(pendingLayer.textContent).toMatch(/待你确认/u);
    expect(rememberedLayer.textContent).toMatch(/已记住/u);

    // Pending entries only in layer 1; confirmed only under 已记住 domains.
    expect(
      within(pendingLayer).getByTestId('memory-entry-pending-new')
    ).toBeInTheDocument();
    expect(
      within(pendingLayer).queryByTestId('memory-entry-confirmed-old')
    ).not.toBeInTheDocument();
    expect(
      within(rememberedLayer).getByTestId('memory-entry-confirmed-old')
    ).toBeInTheDocument();
    expect(
      within(rememberedLayer).queryByTestId('memory-entry-pending-new')
    ).not.toBeInTheDocument();

    // Layer 3: evidence drawer affordance is present on entries.
    expect(
      screen.getByTestId('memory-entry-evidence-open-pending-new')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('memory-entry-evidence-open-confirmed-old')
    ).toBeInTheDocument();
  });

  it('shows all four domains D-164④ names under the remembered layer', async () => {
    p1.queryP1.mockResolvedValue({
      identities: [],
      defaultDecision: null,
      defaultIdentity: null,
      decisionRevision: 0,
    });

    renderPage();

    const remembered = await screen.findByTestId('memory-layer-remembered');
    for (const testId of [
      'memory-domain-identity',
      'memory-domain-campaigns',
      'memory-domain-workflows',
      'memory-domain-corrections',
    ]) {
      expect(within(remembered).getByTestId(testId)).toBeInTheDocument();
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

  it('does not mark preference/correction/procedure/episode domains as unbuilt', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({ items: [], nextCursor: null })
          : Promise.resolve({
              identities: [identity],
              defaultDecision: null,
              defaultIdentity: { identityId: 'identity-1', version: 1 },
              decisionRevision: 1,
            })
    );

    renderPage();

    expect(
      await screen.findByTestId('memory-remembered-corrections-empty')
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('memory-unbuilt-note')).toHaveLength(0);
    expect(
      screen.getByTestId('memory-remembered-workflows-empty')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('memory-remembered-campaigns-empty')
    ).toBeInTheDocument();
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

  it('opens the evidence drawer with merchant-language basis fields', async () => {
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

    renderPage();

    fireEvent.click(
      await screen.findByTestId('memory-entry-evidence-open-candidate-tone')
    );
    const drawer = await screen.findByTestId('memory-evidence-drawer');
    // Neutral title — must not claim the pending item is already remembered.
    expect(drawer.textContent).toMatch(/这条内容的依据/u);
    expect(drawer.textContent).not.toMatch(/这条记忆的依据/u);
    expect(drawer.textContent).toMatch(/克制、像熟客分享/u);
    expect(screen.getByTestId('memory-evidence-status').textContent).toMatch(
      /待你确认/u
    );
    expect(screen.getByTestId('memory-evidence-source').textContent).toMatch(
      /因为你 2026\/7\/30 说过/u
    );
    // Merchant language only: no internal object-model ids in the drawer.
    expect(drawer.textContent).not.toMatch(
      /conversation-a|turn-a|semanticKey/u
    );
  });

  it('opens the evidence drawer on a confirmed entry with remembered status', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'confirmed-tone',
                  semanticKey: 'tone.default',
                  value: '克制、像熟客分享',
                  status: 'confirmed',
                  proposedAt: '2026-07-30T06:00:00.000Z',
                  source: {
                    conversationId: 'conversation-b',
                    sourceTurnId: 'turn-b',
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

    renderPage();

    fireEvent.click(
      await screen.findByTestId('memory-entry-evidence-open-confirmed-tone')
    );
    const drawer = await screen.findByTestId('memory-evidence-drawer');
    expect(drawer.textContent).toMatch(/这条内容的依据/u);
    expect(screen.getByTestId('memory-evidence-status').textContent).toMatch(
      /已确认/u
    );
    expect(screen.getByTestId('memory-evidence-source').textContent).toMatch(
      /因为你 2026\/7\/30 说过/u
    );
    expect(drawer.textContent).not.toMatch(
      /conversation-b|turn-b|semanticKey/u
    );
  });

  it('renders a structured memory value as human key/value, never raw JSON', async () => {
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

    const value = await screen.findByTestId('memory-entry-value');
    expect(value).toHaveTextContent(/primary/u);
    expect(value).toHaveTextContent('warm-white');
    expect(value).toHaveTextContent(/accent/u);
    expect(value).toHaveTextContent('tea-brown');
    // P0-5: raw JSON.stringify blob must not be the merchant-facing main text.
    expect(value.textContent).not.toMatch(
      /^\s*\{[\s\S]*"primary"\s*:\s*"warm-white"[\s\S]*\}\s*$/u
    );
    expect(
      screen.queryByText('{"primary":"warm-white","accent":"tea-brown"}')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });

  it('lists array memory values instead of a JSON string', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'candidate-tones',
                  semanticKey: 'tone.list',
                  value: ['克制', '像熟客分享'],
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

    const value = await screen.findByTestId('memory-entry-value');
    expect(value.tagName).toBe('UL');
    expect(value).toHaveTextContent('克制');
    expect(value).toHaveTextContent('像熟客分享');
    expect(value.textContent).not.toMatch(/^\s*\[/u);
  });

  it('puts pending entries above confirmed by layer (pending first by default)', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'confirmed-old',
                  semanticKey: 'tone.confirmed',
                  value: '已确认偏旧',
                  status: 'confirmed',
                  proposedAt: '2026-07-31T08:00:00.000Z',
                  source: null,
                },
                {
                  entryId: 'rejected-mid',
                  semanticKey: 'tone.rejected',
                  value: '已拒绝',
                  status: 'rejected',
                  proposedAt: '2026-07-31T07:00:00.000Z',
                  source: null,
                },
                {
                  entryId: 'pending-new',
                  semanticKey: 'tone.pending',
                  value: '待确认偏新',
                  status: 'pending',
                  proposedAt: '2026-07-30T06:00:00.000Z',
                  source: null,
                },
                {
                  entryId: 'pending-older',
                  semanticKey: 'tone.pending-old',
                  value: '待确认偏旧',
                  status: 'pending',
                  proposedAt: '2026-07-29T06:00:00.000Z',
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

    // Wait until entries resolve; the container mounts empty first.
    await screen.findByTestId('memory-entry-pending-new');
    const pendingList = screen.getByTestId('memory-entries-pending');
    // Direct children only — nested value/provenance share the memory-entry- prefix.
    expect(
      [...pendingList.children].map((node) => node.getAttribute('data-testid'))
    ).toEqual(['memory-entry-pending-new', 'memory-entry-pending-older']);

    const confirmedList = screen.getByTestId('memory-entries-confirmed');
    expect(
      [...confirmedList.children].map((node) =>
        node.getAttribute('data-testid')
      )
    ).toEqual(['memory-entry-confirmed-old']);

    // Rejected leaves the merchant-facing page (not pending, not remembered).
    expect(
      screen.queryByTestId('memory-entry-rejected-mid')
    ).not.toBeInTheDocument();
  });

  it('renders nested structures without a raw JSON blob or duplicate handles', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'candidate-nested',
                  semanticKey: 'style.nested',
                  value: {
                    palette: { primary: 'warm-white' },
                    tags: ['温和', '熟客'],
                    retired: null,
                  },
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

    // findByTestId throws on multiple matches, so this also proves the nested
    // level does not clone the handle.
    const value = await screen.findByTestId('memory-entry-value');
    expect(value).toHaveTextContent('warm-white');
    expect(value).toHaveTextContent('温和');
    expect(value).toHaveTextContent('熟客');
    // P0-5: no brace/bracket blob anywhere in the merchant-facing body, and a
    // null leaf must not surface as the word "null".
    expect(value.textContent).not.toMatch(/[{}[\]"]|null/u);
  });

  it('shows an honest cold-start note when nothing has been learned', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({ items: [], nextCursor: null })
          : Promise.resolve({
              identities: [],
              defaultDecision: null,
              defaultIdentity: null,
              decisionRevision: 0,
            })
    );

    renderPage();

    const cold = await screen.findByTestId('memory-cold-start');
    // Scheme-one cold start: say nothing was learned, name what will appear
    // later, and mark it as future rather than as something already learned.
    expect(cold.textContent).toMatch(/还没学到/u);
    expect(cold.textContent).toMatch(/你常用的表达方式/u);
    expect(cold.textContent).toMatch(/还没有生成/u);
    // The old learning-over-time promise must not return on the cold state.
    expect(screen.queryByText(/越懂你的店/u)).not.toBeInTheDocument();
    // And the cold note is said once, not repeated as a per-section empty.
    expect(screen.queryByTestId('memory-entry-empty')).not.toBeInTheDocument();
    // Built domains stay distinct from "we haven't built this".
    expect(screen.queryAllByTestId('memory-unbuilt-note')).toHaveLength(0);
    // Three-layer shell still present on cold start (pending empty, remembered domains).
    expect(screen.getByTestId('memory-layer-pending')).toBeInTheDocument();
    expect(screen.getByTestId('memory-layer-remembered')).toBeInTheDocument();
  });

  it('does not call the shop cold when the memory read failed', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.reject(new Error('core unavailable'))
          : Promise.resolve({
              identities: [],
              defaultDecision: null,
              defaultIdentity: null,
              decisionRevision: 0,
            })
    );

    const { client } = renderPage();

    // Assert only after the failure has actually been processed — otherwise
    // this passes on the loading frame and proves nothing.
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .some((query) => query.state.status === 'error')
      ).toBe(true)
    );
    // An unanswered read is not evidence that the shop has learned nothing.
    expect(screen.queryByTestId('memory-cold-start')).not.toBeInTheDocument();
    expect(screen.getByTestId('memory-entries-error')).toBeInTheDocument();
    // Failed read must not invent two empty queues either.
    expect(screen.queryByTestId('memory-entry-empty')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('memory-remembered-identity-empty')
    ).not.toBeInTheDocument();
  });

  it('does not claim 越懂你的店 when only rejected history exists', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'rejected-only',
                  semanticKey: 'tone.rejected',
                  value: '已拒绝的建议',
                  status: 'rejected',
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
      await screen.findByTestId('memory-rejected-only-note')
    ).toHaveTextContent(/驳回过一些建议/u);
    expect(screen.queryByText(/越懂你的店/u)).not.toBeInTheDocument();
    expect(screen.queryByTestId('memory-cold-start')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('memory-entry-rejected-only')
    ).not.toBeInTheDocument();
    // Layers stay honest about nothing pending / nothing confirmed.
    expect(screen.getByTestId('memory-entry-empty').textContent).toMatch(
      /还没有待确认的内容/u
    );
    expect(
      screen.getByTestId('memory-remembered-identity-empty')
    ).toBeInTheDocument();
  });

  it('does not claim empty queues when the page window may still hide work', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                {
                  entryId: 'rejected-crowding',
                  semanticKey: 'tone.rejected',
                  value: '挤占窗口的拒绝',
                  status: 'rejected',
                  proposedAt: '2026-07-30T06:00:00.000Z',
                  source: null,
                },
              ],
              nextCursor: 'cursor-more',
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
      await screen.findByTestId('memory-pending-window-incomplete')
    ).toHaveTextContent(/更早的记录可能不在这一页/u);
    expect(screen.queryByTestId('memory-entry-empty')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('memory-remembered-identity-empty')
    ).not.toBeInTheDocument();
    // Incomplete window is not the standing "we know your shop" claim either.
    expect(screen.queryByText(/越懂你的店/u)).not.toBeInTheDocument();
  });

  it('keeps the standing description once the shop has sediment', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({ items: [], nextCursor: null })
          : Promise.resolve({
              identities: [identity],
              defaultDecision: null,
              defaultIdentity: { identityId: 'identity-1', version: 1 },
              decisionRevision: 1,
            })
    );

    renderPage();

    await screen.findByTestId('memory-identity-name');
    expect(screen.queryByTestId('memory-cold-start')).not.toBeInTheDocument();
    expect(
      screen.getByText(/你确认过、之后创作可参考的经验/u)
    ).toBeInTheDocument();
    // A shop with a persona but no candidates gets the scoped empty state —
    // that one is about the review queue, not about the product being cold.
    expect(screen.getByTestId('memory-entry-empty').textContent).toMatch(
      /还没有待确认的内容/u
    );
  });

  it('buckets mixed kinds, puts correction first, and keeps a deleted source row', async () => {
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({
              items: [
                vaultEntry({
                  entryId: 'pref-1',
                  kind: 'preference',
                  status: 'confirmed',
                  proposedAt: '2026-08-08T12:00:00.000Z',
                  statement: '语气要暖',
                }),
                vaultEntry({
                  entryId: 'proc-1',
                  kind: 'procedure',
                  status: 'confirmed',
                  proposedAt: '2026-08-08T11:00:00.000Z',
                  statement: '先出三图再补价格',
                }),
                vaultEntry({
                  entryId: 'epi-1',
                  kind: 'episode',
                  status: 'confirmed',
                  proposedAt: '2026-08-08T10:00:00.000Z',
                  statement: '上次团购删掉了价格强调',
                }),
                vaultEntry({
                  entryId: 'corr-1',
                  kind: 'correction',
                  status: 'confirmed',
                  proposedAt: '2026-08-08T09:00:00.000Z',
                  statement: '小林不是老板娘',
                  source: {
                    conversationId: 'conversation-corr',
                    sourceTurnId: 'turn-corr',
                    messageRange: { start: 0, end: 0 },
                    status: 'deleted',
                    observedAt: null,
                    preview: null,
                    deletedAt: '2026-08-08T12:30:00.000Z',
                  },
                }),
              ],
              nextCursor: null,
            })
          : Promise.resolve(emptyIdentity)
    );

    renderPage();

    const correction = await screen.findByTestId('memory-entry-corr-1');
    expect(
      within(screen.getByTestId('memory-domain-corrections')).getByTestId(
        'memory-entry-corr-1'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('memory-domain-identity')).getByTestId(
        'memory-entry-pref-1'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('memory-domain-workflows')).getByTestId(
        'memory-entry-proc-1'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('memory-domain-campaigns')).getByTestId(
        'memory-entry-epi-1'
      )
    ).toBeInTheDocument();

    const remembered = screen.getByTestId('memory-layer-remembered');
    const domainOrder = [
      'memory-domain-corrections',
      'memory-domain-identity',
      'memory-domain-workflows',
      'memory-domain-campaigns',
    ].map((testId) => within(remembered).getByTestId(testId));
    expect(
      domainOrder[0]!.compareDocumentPosition(domainOrder[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      domainOrder[1]!.compareDocumentPosition(domainOrder[2]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      domainOrder[2]!.compareDocumentPosition(domainOrder[3]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    expect(correction).toHaveAttribute('data-memory-kind', 'correction');
    expect(correction).toHaveAttribute('data-memory-authority', 'confirmed');
    expect(correction).toHaveAttribute('data-memory-state', 'active');
    expect(correction).toHaveAttribute('data-memory-revision', '1');
    expect(
      within(correction).getByTestId('memory-entry-statement')
    ).toHaveTextContent('小林不是老板娘');
    expect(
      within(correction).getByTestId('memory-entry-provenance')
    ).toHaveTextContent(/来源对话已删除/u);
    expect(screen.queryAllByTestId('memory-unbuilt-note')).toHaveLength(0);
  });

  it('shows loading then error with retry on the vault entries_page query', async () => {
    const pending = deferred<{
      items: MemoryEntryProjection[];
      nextCursor: null;
    }>();
    void pending.promise.catch(() => undefined);
    let calls = 0;
    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) => {
        if (module === 'memory' && input.action === 'entries_page') {
          calls += 1;
          if (calls === 1) return pending.promise;
          return Promise.reject(new Error('core unavailable'));
        }
        return Promise.resolve(emptyIdentity);
      }
    );

    const { client } = renderPage();
    expect(
      await screen.findByTestId('memory-entries-loading')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('memory-cold-start')).not.toBeInTheDocument();

    pending.reject(new Error('core unavailable'));
    expect(
      await screen.findByTestId('memory-entries-error')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('memory-cold-start')).not.toBeInTheDocument();

    p1.queryP1.mockImplementation(
      (module: string, input: { action: string }) =>
        module === 'memory' && input.action === 'entries_page'
          ? Promise.resolve({ items: [], nextCursor: null })
          : Promise.resolve(emptyIdentity)
    );
    fireEvent.click(
      within(screen.getByTestId('memory-entries-error')).getByRole('button')
    );
    expect(await screen.findByTestId('memory-cold-start')).toBeInTheDocument();
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((query) => query.state.status === 'success')
    ).toBe(true);
  });
});
