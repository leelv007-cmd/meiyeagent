import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ComposerImageOperationPicker,
  imageOperationCardinality,
} from './image-operation-picker';

afterEach(cleanup);

describe('free image operation entries', () => {
  it('renders exactly the three merchant-language entries', () => {
    render(
      <ComposerImageOperationPicker
        onChange={() => undefined}
        value="image.generate"
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText('生成新图')).toBeInTheDocument();
    expect(screen.getByText('修改这张图')).toBeInTheDocument();
    expect(screen.getByText('用几张图合成一张')).toBeInTheDocument();
    expect(screen.queryByText(/reference_transform/u)).toBeNull();
  });

  it('reports the selected canonical operation', async () => {
    const onChange = vi.fn();
    render(
      <ComposerImageOperationPicker
        onChange={onChange}
        value="image.generate"
      />
    );

    await userEvent.click(screen.getByText('修改这张图'));
    expect(onChange).toHaveBeenCalledWith('image.edit');
  });
});

describe('image source cardinality', () => {
  it('accepts only 0 / 1 / 2+ references for generate / edit / transform', () => {
    expect(imageOperationCardinality('image.generate', 0).valid).toBe(true);
    expect(imageOperationCardinality('image.generate', 1).valid).toBe(false);
    expect(imageOperationCardinality('image.edit', 1).valid).toBe(true);
    expect(imageOperationCardinality('image.edit', 0).valid).toBe(false);
    expect(
      imageOperationCardinality('image.reference_transform', 2).valid
    ).toBe(true);
    expect(
      imageOperationCardinality('image.reference_transform', 8).valid
    ).toBe(true);
    expect(
      imageOperationCardinality('image.reference_transform', 1).valid
    ).toBe(false);
  });
});
