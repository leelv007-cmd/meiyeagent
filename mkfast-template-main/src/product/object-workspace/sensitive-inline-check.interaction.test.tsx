import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundedQueryP1 = vi.hoisted(() => vi.fn());
vi.mock('@/p1/client', () => ({ boundedQueryP1 }));

import { CopyImageTextWorksurface } from '@/product/results/copy-image-text-worksurface';

const baseFacts = {
  workId: 'work-note-327',
  packageId: 'package-note-327',
  baseRevisionId: 'rev-327-a',
  document: {
    title: '护理笔记',
    body: '护理可以根治色斑。',
    conversionHook: '私信预约',
    topics: ['护理'],
    orderedAssetIds: ['asset-cover'],
  },
  factSources: [],
  lifecycle: 'candidate' as const,
  viewport: 'desktop' as const,
};

function scanFor(text: string) {
  const index = text.indexOf('根治');
  return {
    schemaVersion: 'sensitive-scan/v1',
    complete: true,
    textLength: text.length,
    hitCount: index < 0 ? 0 : 1,
    hits:
      index < 0
        ? []
        : [
            {
              wordId: 'sw-root',
              word: '根治',
              category: 'extreme',
              replacements: ['明显改善'],
              index,
              length: 2,
            },
          ],
  };
}

async function advanceDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

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

beforeEach(() => {
  vi.useFakeTimers();
  boundedQueryP1.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('note object workspace sensitive inline check', () => {
  it('debounces the bounded scan, decorates hits, and atomically replaces against the same draft', async () => {
    const onFieldChange = vi.fn();
    boundedQueryP1
      .mockResolvedValueOnce(scanFor(baseFacts.document.body))
      .mockResolvedValueOnce(scanFor('护理可以明显改善色斑。'));
    render(
      <CopyImageTextWorksurface
        facts={baseFacts}
        presentation="note_document"
        onFieldChange={onFieldChange}
        onHandEdit={vi.fn()}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(boundedQueryP1).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(boundedQueryP1).toHaveBeenCalledWith(
      'sensitive-words',
      {
        action: 'scan',
        payload: { text: baseFacts.document.body },
      },
      { signal: expect.any(AbortSignal), timeoutMs: 10_000 }
    );
    expect(screen.getByTestId('sensitive-inline-status')).toHaveTextContent(
      '检出 1 处'
    );
    expect(
      document.querySelector('.sensitive-word-highlight')
    ).toHaveTextContent('根治');

    fireEvent.click(
      screen.getByRole('button', { name: '将“根治”替换为“明显改善”' })
    );
    await act(async () => {});
    expect(screen.getByTestId('copy-field-body')).toHaveTextContent(
      '护理可以明显改善色斑。'
    );
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'body',
      '护理可以明显改善色斑。'
    );
    expect(document.querySelector('.sensitive-word-highlight')).toBeNull();
    expect(screen.getByTestId('copy-save-hand-edit')).toBeEnabled();

    await advanceDebounce();
    expect(boundedQueryP1).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('sensitive-inline-status')).toHaveTextContent(
      '未检出违禁词'
    );
  });

  it.each([
    '首段😀护理。\n第二行根治色斑。',
    '首段😀护理。\n\n第二段根治色斑。',
  ])('maps UTF-16 hits after emoji and line boundaries: %s', async (body) => {
    const onFieldChange = vi.fn();
    boundedQueryP1.mockResolvedValueOnce(scanFor(body));
    render(
      <CopyImageTextWorksurface
        facts={{
          ...baseFacts,
          document: { ...baseFacts.document, body },
        }}
        presentation="note_document"
        onFieldChange={onFieldChange}
      />
    );
    if (body.includes('\n\n')) {
      expect(
        screen.getByTestId('copy-field-body').querySelectorAll('p')
      ).toHaveLength(2);
    }
    await advanceDebounce();
    expect(
      document.querySelector('.sensitive-word-highlight')
    ).toHaveTextContent('根治');

    fireEvent.click(
      screen.getByRole('button', { name: '将“根治”替换为“明显改善”' })
    );
    await act(async () => {});
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'body',
      body.replace('根治', '明显改善')
    );
    expect(document.querySelector('.sensitive-word-highlight')).toBeNull();
  });

  it('preserves consecutive empty paragraphs while replacing a later UTF-16 sensitive anchor', async () => {
    const body = '前😀段\n换行。\n\n\n\n后段根治与护理。';
    const onFieldChange = vi.fn();
    boundedQueryP1.mockResolvedValueOnce(scanFor(body));
    render(
      <CopyImageTextWorksurface
        facts={{
          ...baseFacts,
          document: { ...baseFacts.document, body },
        }}
        presentation="note_document"
        onFieldChange={onFieldChange}
      />
    );

    const paragraphs = screen
      .getByTestId('copy-field-body')
      .querySelectorAll('p');
    expect(paragraphs).toHaveLength(3);
    await advanceDebounce();
    expect(
      document.querySelector('.sensitive-word-highlight')
    ).toHaveTextContent('根治');

    fireEvent.click(
      screen.getByRole('button', { name: '将“根治”替换为“明显改善”' })
    );
    await act(async () => {});
    expect(onFieldChange).toHaveBeenLastCalledWith(
      'body',
      '前😀段\n换行。\n\n\n\n后段明显改善与护理。'
    );
    expect(paragraphs[1]?.textContent).toBe('');
    expect(paragraphs[2]).toHaveTextContent('后段明显改善与护理。');
  });

  it('maps a second-paragraph emoji-prefixed Tiptap selection to the exact #322 anchor', async () => {
    const body = '首段😀护理。\n\n第二段根治色斑。';
    const onAdjust = vi.fn().mockResolvedValue(undefined);
    boundedQueryP1.mockImplementation(() => new Promise(() => {}));
    render(
      <CopyImageTextWorksurface
        facts={{
          ...baseFacts,
          document: { ...baseFacts.document, body },
        }}
        presentation="note_document"
        onAdjust={onAdjust}
      />
    );
    supportTiptapSelectionGeometry();

    const editor = screen.getByTestId('copy-field-body');
    const secondParagraph = editor.querySelectorAll('p')[1];
    const textNode = secondParagraph?.firstChild;
    expect(textNode).toBeInstanceOf(Text);
    const paragraphText = textNode?.textContent ?? '';
    const start = paragraphText.indexOf('根治');
    const range = document.createRange();
    range.setStart(textNode as Text, start);
    range.setEnd(textNode as Text, start + 2);
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    await act(async () => {});

    expect(
      screen.getByTestId('object-workspace-selection-ai-scope')
    ).toHaveTextContent('已选中 2 个字');
    fireEvent.click(screen.getByTestId('selection-ai-rewrite'));
    // The rewrite handler awaits buildTextSelectionAdjustScope, which awaits
    // crypto.subtle.digest (copy-image-text-worksurface.tsx:255 →
    // copy-image-text-worksurface-model.ts:218). That is a real async
    // operation, not a microtask, so one `act` flush is not always enough —
    // under CPU load it reproduces 1/3 locally and fired twice in CI. Wait for
    // the condition instead of a fixed amount of settling. `waitFor` cannot be
    // used here: this suite installs fake timers (:78), so its polling never
    // advances. The assertion below stays exact.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (onAdjust.mock.calls.length > 0) break;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }
    expect(onAdjust).toHaveBeenCalledTimes(1);
    expect(onAdjust.mock.calls[0]?.[0]).toContain('根治');
    expect(onAdjust.mock.calls[0]?.[0]).not.toContain('首段😀护理');
  });

  it('aborts the prior request and rejects a late same-length stale response', async () => {
    let resolveFirst!: (value: unknown) => void;
    boundedQueryP1
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const { rerender } = render(
      <CopyImageTextWorksurface
        facts={baseFacts}
        presentation="note_document"
      />
    );
    await advanceDebounce();
    const firstSignal = boundedQueryP1.mock.calls[0]?.[2]
      ?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    rerender(
      <CopyImageTextWorksurface
        facts={{
          ...baseFacts,
          baseRevisionId: 'rev-327-b',
          document: { ...baseFacts.document, body: '护理可以治疗色斑。' },
        }}
        presentation="note_document"
      />
    );
    await act(async () => {});
    expect(firstSignal.aborted).toBe(true);
    resolveFirst(scanFor(baseFacts.document.body));
    await act(async () => {});
    expect(document.querySelector('.sensitive-word-highlight')).toBeNull();
    expect(screen.queryByRole('button', { name: /替换为/u })).toBeNull();
  });

  it.each([
    ['forbidden', Object.assign(new Error('403'), { status: 403 })],
    ['timeout', new Error('P1_QUERY_TIMEOUT')],
    ['network', new TypeError('Failed to fetch')],
    ['bad schema', { schemaVersion: 'wrong' }],
    [
      'missing completeness',
      {
        schemaVersion: 'sensitive-scan/v1',
        textLength: baseFacts.document.body.length,
        hitCount: 0,
        hits: [],
      },
    ],
    [
      'incomplete response',
      {
        schemaVersion: 'sensitive-scan/v1',
        complete: false,
        textLength: baseFacts.document.body.length,
        hitCount: 0,
        hits: [],
      },
    ],
  ])('fails closed with explicit retry on %s', async (_name, outcome) => {
    if (outcome instanceof Error) boundedQueryP1.mockRejectedValue(outcome);
    else boundedQueryP1.mockResolvedValue(outcome);
    render(
      <CopyImageTextWorksurface
        facts={baseFacts}
        presentation="note_document"
      />
    );
    await advanceDebounce();

    expect(screen.getByRole('alert')).toHaveTextContent('检查未完成');
    expect(screen.getByTestId('sensitive-inline-retry')).toBeEnabled();
    expect(document.querySelector('.sensitive-word-highlight')).toBeNull();
    expect(screen.queryByRole('button', { name: /替换为/u })).toBeNull();
  });

  it('rejects 50,001 UTF-16 units locally and never scans or decorates', async () => {
    render(
      <CopyImageTextWorksurface
        facts={{
          ...baseFacts,
          document: {
            ...baseFacts.document,
            body: '根治'.repeat(25_000) + '超',
          },
        }}
        presentation="note_document"
      />
    );
    await advanceDebounce();
    expect(boundedQueryP1).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('50,000');
    expect(screen.getByTestId('sensitive-inline-retry')).toBeEnabled();
    expect(document.querySelector('.sensitive-word-highlight')).toBeNull();
  });

  it('does not mount the inline scanner on the copy carrier', async () => {
    render(
      <CopyImageTextWorksurface
        facts={{
          ...baseFacts,
          document: { ...baseFacts.document, orderedAssetIds: [] },
        }}
      />
    );
    await advanceDebounce();
    expect(boundedQueryP1).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sensitive-inline-check')).toBeNull();
  });
});
