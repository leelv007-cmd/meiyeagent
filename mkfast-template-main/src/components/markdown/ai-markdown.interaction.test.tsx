import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiMarkdown, StreamingAiMarkdown } from './ai-markdown';

/**
 * These held the retired prompt-kit `ResponseStream` adaptation honest and now
 * hold its replacement (the HeroUI Pro `markdown` unit) to the same three
 * promises: model output is rendered as rich text, raw HTML from a model is
 * inert, and unsafe link protocols do not reach the DOM.
 */
describe('模型输出富渲染', () => {
  it('renders Chinese markdown as rich text, not as escaped source', () => {
    render(
      <AiMarkdown
        content={'# 美甲方案\n\n**亮点**：清透裸粉\n\n- 通勤\n- 约会'}
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: '美甲方案' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(document.querySelector('strong')?.textContent).toBe('亮点');
  });

  it('keeps CJK-adjacent emphasis bold — the reason the CJK remark plugin existed', () => {
    render(
      <AiMarkdown
        content={'门店提示：【**限时**】到店【**立减**】，（**周末**）也可用。'}
      />
    );

    const bold = Array.from(document.querySelectorAll('strong')).map(
      (node) => node.textContent
    );
    expect(bold).toEqual(['限时', '立减', '周末']);
  });

  it('keeps CJK strikethrough struck — the other half of that plugin', () => {
    // The retired dependency set carried remark-cjk-friendly-gfm-strikethrough
    // alongside the emphasis plugin. Pinning only 强调 would let GFM
    // strikethrough regress silently, so the awkward CJK shapes are named:
    // bare CJK, opened by full-width brackets, and glued to CJK on both sides.
    render(
      <AiMarkdown
        content={
          '~~中文删除线~~\n\n【~~原价~~】现价 99\n\n（~~旧价~~）新价\n\n原价~~199~~现价'
        }
      />
    );

    const struck = Array.from(document.querySelectorAll('del')).map(
      (node) => node.textContent
    );
    expect(struck).toEqual(['中文删除线', '原价', '旧价', '199']);
  });

  it('leaves raw HTML from a model inert', () => {
    render(
      <AiMarkdown
        content={'<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>'}
      />
    );

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('drops unsafe link protocols and keeps ordinary links', () => {
    render(
      <AiMarkdown
        content={
          '[危险链接](javascript:alert(1))\n\n[官网](https://example.com)'
        }
      />
    );

    const links = Array.from(document.querySelectorAll('a'));
    const hrefs = links.map((link) => link.getAttribute('href'));
    expect(hrefs.some((href) => href?.startsWith('javascript:'))).toBe(false);
    expect(hrefs).toContain('https://example.com');
  });

  it('shows only what has arrived — a half sentence stays a half sentence', () => {
    const { rerender } = render(
      <StreamingAiMarkdown content={'周末到店'} streaming />
    );
    expect(screen.getByText(/周末到店/)).toBeInTheDocument();
    expect(screen.queryByText(/立减/)).toBeNull();

    rerender(<StreamingAiMarkdown content={'周末到店立减'} streaming />);
    expect(screen.getByText(/周末到店立减/)).toBeInTheDocument();
  });

  it('drops the streaming affordances the moment the run is terminal', () => {
    const { rerender } = render(
      <StreamingAiMarkdown content={'周末到店立减'} streaming />
    );
    // While drafting: the reveal runs and the caret trails the last block.
    expect(streamingAffordances()).toEqual({ caret: true, reveal: true });

    // Same text, run now finished — the merchant is looking at delivered copy.
    rerender(
      <StreamingAiMarkdown content={'周末到店立减'} streaming={false} />
    );
    expect(streamingAffordances()).toEqual({ caret: false, reveal: false });
    expect(screen.getByText(/周末到店立减/)).toBeInTheDocument();
  });

  it('a finished body mounted fresh never replays as a stream', () => {
    // Reload / remount of a delivered run: there is no true → false edge to
    // ride, so a phase that still said drafting would animate it all over
    // again. Nothing here may depend on having seen the stream live.
    render(<StreamingAiMarkdown content={'周末到店立减'} streaming={false} />);
    expect(streamingAffordances()).toEqual({ caret: false, reveal: false });
    expect(screen.getByText(/周末到店立减/)).toBeInTheDocument();
  });
});

/**
 * What the supply-layer renderer actually puts in the DOM when it believes it
 * is streaming: a per-block reveal marker, and a caret custom property on the
 * container appended after the last block.
 */
function streamingAffordances() {
  const root = document.querySelector<HTMLElement>('[data-slot="markdown"]');
  const container = root?.firstElementChild as HTMLElement | null;
  return {
    caret: Boolean(container?.style.getPropertyValue('--streamdown-caret')),
    reveal: document.querySelector('[data-sd-animate="true"]') !== null,
  };
}
