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
        canSwitch
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
        canSwitch
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

  it('hides the fake switch when no slot-free fallback exists (V31-85)', () => {
    render(
      <RecipeSourceSlotGuidanceCard
        canSwitch={false}
        onSwitch={() => {}}
        onUpload={() => {}}
        slot="case_media"
      />
    );
    const card = screen.getByTestId('composer-recipe-slot-guidance');
    expect(card).toHaveAttribute('data-can-switch', 'false');
    expect(screen.getByTestId('composer-recipe-slot-upload')).toBeTruthy();
    expect(screen.queryByTestId('composer-recipe-slot-switch')).toBeNull();
    expect(card.textContent ?? '').not.toMatch(/换不需要案例图的写法/u);
    expect(card.textContent ?? '').not.toMatch(/改一改再发就好/u);
  });
});
