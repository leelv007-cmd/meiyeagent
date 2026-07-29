import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageAdjustConfirmation } from './image-adjust-confirmation';

afterEach(cleanup);

const quote = {
  billingMode: 'per_request' as const,
  catalogModelId: 'image-model',
  confirmedAmount: 4,
  debitUnits: [{ quantity: 2, resource: 'image' as const }],
  formula: { currency: 'CNY', expression: 'server', unitRate: 2 },
  lifecycleStatus: 'quoted' as const,
  quoteId: 'quote-1',
  quotePolicyRevision: 'policy-1',
  revision: 'revision-1',
};

describe('ImageAdjustConfirmation', () => {
  it('shows the cost in buckets, never in money, and waits for a click', () => {
    const onConfirm = vi.fn();
    render(
      <ImageAdjustConfirmation
        instruction="换成夏日风格"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        quote={quote}
        scope={{ kind: 'set', assetIds: ['asset-1', 'asset-2'] }}
      />
    );

    // D1 / D-109「供应细节不可见」: this read「整组 2 张·4 CNY」until 2026-07-29.
    // The quote still carries an amount and a currency — the fixture above keeps
    // both — and neither may reach the merchant.
    expect(
      screen.getByText('整组 2 张·本次用 2 张图片额度')
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/CNY|￥|¥|元/u);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('closes on Escape and returns focus to the adjustment input', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const Example = () => {
      const [open, setOpen] = useState(true);
      return (
        <>
          <textarea
            data-testid="result-adjust-input"
            id="result-adjust-input"
          />
          {open ? (
            <ImageAdjustConfirmation
              instruction="换成夏日风格"
              onCancel={() => {
                onCancel();
                setOpen(false);
              }}
              onConfirm={vi.fn()}
              quote={quote}
            />
          ) : null}
        </>
      );
    };

    render(<Example />);
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('result-adjust-input')).toHaveFocus();
  });
});
