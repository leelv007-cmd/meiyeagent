import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeSourceSlotGuidanceCard } from './recipe-source-slot-guidance-card';

afterEach(cleanup);

describe('recipe source-slot guidance card (V31-73)', () => {
  it('names the case-image gap and offers upload and switch exits', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    const onSwitch = vi.fn();
    render(
      <RecipeSourceSlotGuidanceCard
        onSwitch={onSwitch}
        onUpload={onUpload}
        slot="case_image"
      />
    );

    const card = screen.getByTestId('composer-recipe-slot-guidance');
    expect(card).toHaveAttribute('data-slot', 'case_image');
    expect(card.textContent ?? '').toMatch(/案例图/u);
    expect(card.textContent ?? '').not.toMatch(/可以直接再发一次/u);

    await user.click(screen.getByTestId('composer-recipe-slot-upload'));
    await user.click(screen.getByTestId('composer-recipe-slot-switch'));
    expect(onUpload).toHaveBeenCalledOnce();
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it('uses generic copy for other required slots', () => {
    render(
      <RecipeSourceSlotGuidanceCard
        onSwitch={() => {}}
        onUpload={() => {}}
        slot="case_media"
      />
    );
    expect(screen.getByTestId('composer-recipe-slot-guidance')).toHaveAttribute(
      'data-slot',
      'case_media'
    );
    expect(
      screen.getByTestId('composer-recipe-slot-guidance').textContent ?? ''
    ).toMatch(/必要素材|material/iu);
  });
});
