/**
 * Object workspace shell + selection AI six actions (P2-10 / #322).
 */
import { cleanup, render, screen } from '@testing-library/react';
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

  it('exposes at least three selection AI actions with measurable previews', async () => {
    const user = userEvent.setup();
    const onSelectionRewrite = vi.fn();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onSelectionRewrite={onSelectionRewrite}
        onQuickEdit={vi.fn()}
      />
    );

    // 续写
    await user.click(screen.getByTestId('copy-rewrite-continue'));
    expect(onSelectionRewrite).toHaveBeenCalledWith(
      'continue',
      expect.anything()
    );
    let preview = await screen.findByTestId('copy-selection-rewrite-preview');
    expect(preview).toHaveAttribute('data-rewrite-action', 'continue');
    expect(
      screen.getByTestId('copy-selection-rewrite-after')
    ).toHaveTextContent('到店');
    await user.click(screen.getByTestId('copy-selection-rewrite-cancel'));

    // 改写
    await user.click(screen.getByTestId('copy-rewrite-rewrite'));
    preview = await screen.findByTestId('copy-selection-rewrite-preview');
    expect(preview).toHaveAttribute('data-rewrite-action', 'rewrite');
    await user.click(screen.getByTestId('copy-selection-rewrite-cancel'));

    // 精简
    await user.click(screen.getByTestId('copy-rewrite-shorten'));
    preview = await screen.findByTestId('copy-selection-rewrite-preview');
    expect(preview).toHaveAttribute('data-rewrite-action', 'shorten');
    const after = screen.getByTestId('copy-selection-rewrite-after')
      .textContent;
    const before = screen.getByTestId('copy-selection-rewrite-before')
      .textContent;
    expect((after ?? '').length).toBeLessThan((before ?? '').length);
  });

  it('routes custom through an instruction step before preview', async () => {
    const user = userEvent.setup();
    render(
      <CopyImageTextWorksurface
        facts={facts}
        onSelectionRewrite={vi.fn()}
        onQuickEdit={vi.fn()}
      />
    );
    await user.click(screen.getByTestId('copy-rewrite-custom'));
    expect(
      screen.getByTestId('selection-ai-instruction-panel')
    ).toBeInTheDocument();
    await user.type(
      screen.getByTestId('selection-ai-instruction-input'),
      '更口语'
    );
    await user.click(screen.getByTestId('selection-ai-instruction-confirm'));
    const preview = await screen.findByTestId('copy-selection-rewrite-preview');
    expect(preview).toHaveAttribute('data-rewrite-action', 'custom');
    expect(
      screen.getByTestId('copy-selection-rewrite-after')
    ).toHaveTextContent('更口语');
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
    render(<SelectionAiToolbar onAction={onAction} scopeKind="whole_document" />);
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
