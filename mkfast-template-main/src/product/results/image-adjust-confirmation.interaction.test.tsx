import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageAdjustConfirmation } from './image-adjust-confirmation';

describe('ImageAdjustConfirmation', () => {
  it('shows the server quote and requires an explicit confirmation click', () => {
    const onConfirm = vi.fn();
    render(
      <ImageAdjustConfirmation
        instruction="换成夏日风格"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        quote={{
          billingMode: 'per_request',
          catalogModelId: 'image-model',
          confirmedAmount: 4,
          formula: { currency: 'CNY', expression: 'server', unitRate: 2 },
          lifecycleStatus: 'quoted',
          quoteId: 'quote-1',
          quotePolicyRevision: 'policy-1',
          revision: 'revision-1',
        }}
        scope={{ kind: 'set', assetIds: ['asset-1', 'asset-2'] }}
      />
    );

    expect(screen.getByText('整组 2 张·4 CNY')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
