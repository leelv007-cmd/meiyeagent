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
});
