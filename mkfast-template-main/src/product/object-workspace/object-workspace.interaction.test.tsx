/**
 * Object workspace shell + selection AI six actions (P2-10 / #322).
 */
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

import { CopyImageTextWorksurface } from '@/product/results/copy-image-text-worksurface';

import { ObjectWorkspaceShell } from './object-workspace-shell';
import { SelectionAiToolbar } from './selection-ai-toolbar';

afterEach(() => {
  cleanup();
});

const facts = {
  workId: 'work-copy-322',
  baseRevisionId: 'rev-1',
  document: {
    title: '夏日美甲',
    body: '限时优惠套餐，抢购从速。',
    conversionHook: '私信预约',
    topics: ['美甲'],
    orderedAssetIds: [] as string[],
  },
  factSources: [],
  lifecycle: 'candidate' as const,
  viewport: 'desktop' as const,
};

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

describe('object workspace shell + selection AI', () => {
  it('mounts the shared shell for the copy carrier', () => {
    render(<CopyImageTextWorksurface facts={facts} />);
    const shell = screen.getByTestId('object-workspace-shell');
    expect(shell).toHaveAttribute('data-object-workspace', 'true');
    expect(shell).toHaveAttribute('data-carrier', 'copy');
    expect(screen.getByTestId('object-workspace-carrier')).toHaveTextContent(
      '文案'
    );
  });

  it('uses Tiptap for the body field inside the object workspace', async () => {
    render(<CopyImageTextWorksurface facts={facts} />);
    const host = await screen.findByTestId('copy-field-body-host');
    expect(host).toHaveAttribute('data-editor', 'tiptap');
    // contenteditable textbox (Tiptap), not a plain textarea
    expect(screen.getByTestId('copy-field-body')).toHaveAttribute(
      'contenteditable',
      'true'
    );
  });

  it('submits at least three selection AI actions through the model adjust seam', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(<CopyImageTextWorksurface facts={facts} onAdjust={onAdjust} />);

    const toolbar = screen.getByRole('toolbar', { name: '选区 AI 六动作' });
    expect(within(toolbar).getAllByRole('button')).toHaveLength(6);
    expect(
      within(toolbar).queryByTestId('copy-rewrite-weaker_promo')
    ).toBeNull();

    await user.click(screen.getByTestId('selection-ai-continue'));
    await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(1));
    expect(onAdjust.mock.calls[0]?.[0]).toMatch(/\u81ea\u7136\u7eed\u5199/u);

    await user.click(screen.getByTestId('selection-ai-rewrite'));
    await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(2));
    expect(onAdjust.mock.calls[1]?.[0]).toMatch(
      /\u6539\u5199\u4ee5\u4e0b\u9009\u533a/u
    );

    await user.click(screen.getByTestId('selection-ai-shorten'));
    await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(3));
    expect(onAdjust.mock.calls[2]?.[0]).toMatch(
      /\u7cbe\u7b80\u4ee5\u4e0b\u9009\u533a/u
    );
    for (const [instruction] of onAdjust.mock.calls) {
      expect(instruction).toContain(facts.document.body);
    }
    expect(screen.queryByTestId('copy-selection-rewrite-preview')).toBeNull();
    expect(
      screen.getByTestId('object-workspace-selection-ai')
    ).toBeInTheDocument();
    expect(screen.getByTestId('object-workspace-selection-ai-actions')).toBe(
      toolbar
    );
  });

  it('routes custom through an instruction step before preview', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    render(<CopyImageTextWorksurface facts={facts} onAdjust={onAdjust} />);
    await user.click(screen.getByTestId('selection-ai-custom'));
    expect(
      screen.getByTestId('object-workspace-selection-ai-instruction')
    ).toBeInTheDocument();
    await user.type(
      screen.getByTestId('selection-ai-instruction-input'),
      '更口语'
    );
    await user.click(screen.getByTestId('selection-ai-instruction-confirm'));
    await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(1));
    expect(onAdjust.mock.calls[0]?.[0]).toContain('更口语');
    expect(onAdjust.mock.calls[0]?.[0]).toContain(facts.document.body);
  });

  it('keeps a failed selection AI submission visible and retryable', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn().mockRejectedValue(new Error('调整报价暂时不可用'));
    render(<CopyImageTextWorksurface facts={facts} onAdjust={onAdjust} />);

    await user.click(screen.getByTestId('selection-ai-expand'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '调整报价暂时不可用'
    );
    expect(screen.getByTestId('selection-ai-expand')).toBeEnabled();

    await user.click(screen.getByTestId('selection-ai-expand'));
    await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(2));
  });

  it('drops selection-dependent UI when the body is replaced', async () => {
    const user = userEvent.setup();
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <CopyImageTextWorksurface
        facts={facts}
        onAdjust={onAdjust}
        onQuickEdit={vi.fn()}
        onSelectionRewrite={vi.fn()}
      />
    );

    supportTiptapSelectionGeometry();

    const body = screen.getByTestId('copy-field-body');
    body.focus();
    await user.keyboard('{Control>}a{/Control}');
    await waitFor(() =>
      expect(
        screen.getByTestId('object-workspace-selection-ai-scope')
      ).toHaveTextContent(/已选中 \d+ 个字/u)
    );
    fireEvent.click(screen.getByTestId('copy-rewrite-weaker_promo'));
    expect(
      screen.getByTestId('copy-selection-rewrite-preview')
    ).toHaveAttribute('data-rewrite-scope', 'selection');

    rerender(
      <CopyImageTextWorksurface
        facts={{
          ...facts,
          baseRevisionId: 'rev-2',
          document: { ...facts.document, body: '全新护理正文。' },
        }}
        onAdjust={onAdjust}
        onQuickEdit={vi.fn()}
        onSelectionRewrite={vi.fn()}
      />
    );
    await waitFor(() => expect(body).toHaveTextContent('全新护理正文。'));
    expect(screen.queryByTestId('copy-selection-rewrite-preview')).toBeNull();
    expect(
      screen.getByTestId('object-workspace-selection-ai-scope')
    ).toHaveTextContent('将改写整篇文案');

    fireEvent.click(screen.getByTestId('selection-ai-rewrite'));
    await waitFor(() => expect(onAdjust).toHaveBeenCalledTimes(1));
    expect(onAdjust.mock.calls[0]?.[0]).toContain('全新护理正文。');
  });

  it('drops a selection preview when the merchant edits the body', async () => {
    const user = userEvent.setup();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onAdjust={vi.fn()}
        onQuickEdit={vi.fn()}
        onSelectionRewrite={vi.fn()}
      />
    );
    supportTiptapSelectionGeometry();

    const body = screen.getByTestId('copy-field-body');
    body.focus();
    await user.keyboard('{Control>}a{/Control}');
    await waitFor(() =>
      expect(
        screen.getByTestId('object-workspace-selection-ai-scope')
      ).toHaveTextContent(/已选中 \d+ 个字/u)
    );
    fireEvent.click(screen.getByTestId('copy-rewrite-weaker_promo'));
    expect(
      screen.getByTestId('copy-selection-rewrite-preview')
    ).toBeInTheDocument();

    await user.clear(body);
    await user.type(body, '商家刚改过的新正文。');
    await waitFor(() => expect(body).toHaveTextContent('商家刚改过的新正文。'));
    expect(screen.queryByTestId('copy-selection-rewrite-preview')).toBeNull();
    expect(
      screen.getByTestId('copy-selection-rewrite-scope')
    ).toHaveTextContent('将改写整篇文案');
  });

  it('reuses the same shell for the note carrier', () => {
    render(
      <ObjectWorkspaceShell carrier="note" title="多页笔记" workId="w-note">
        <p>body</p>
      </ObjectWorkspaceShell>
    );
    expect(screen.getByTestId('object-workspace-shell')).toHaveAttribute(
      'data-carrier',
      'note'
    );
    expect(screen.getByTestId('object-workspace-carrier')).toHaveTextContent(
      '笔记'
    );
  });

  it('selection AI toolbar alone exposes six primary actions', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <SelectionAiToolbar onAction={onAction} scopeKind="whole_document" />
    );
    for (const action of [
      'continue',
      'rewrite',
      'expand',
      'shorten',
      'tone',
      'custom',
    ]) {
      expect(screen.getByTestId(`selection-ai-${action}`)).toBeInTheDocument();
    }
    await user.click(screen.getByTestId('selection-ai-expand'));
    expect(onAction).toHaveBeenCalledWith('expand');
  });
});
