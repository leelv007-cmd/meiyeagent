import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecipeSourceRequirement } from '@meiye/contracts';

import { ComposerLibrarySourcePicker } from './composer-library-source-picker';

afterEach(cleanup);

const CASE_IMAGE: RecipeSourceRequirement = {
  slot: 'case_image',
  required: true,
  kinds: ['image'],
};

describe('composer library source picker (V31-88)', () => {
  it('picks an authorized eligible asset into the callback', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const hash = 'ab'.repeat(32);
    render(
      <ComposerLibrarySourcePicker
        assets={[
          {
            id: 'asset-0a411f19',
            authorizationStatus: 'authorized',
            category: 'customer_case',
            mediaType: 'image',
            objectKey: `ws_1/assets/u/${hash}.png`,
            tags: ['护理案例'],
          },
        ]}
        onPick={onPick}
        requirements={[CASE_IMAGE]}
        selectedAssetIds={[]}
      />
    );

    await user.click(
      screen.getByTestId('composer-library-source-asset-0a411f19')
    );
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick.mock.calls[0]?.[0]?.id).toBe('asset-0a411f19');
  });

  it('shows an honest empty state when the library has no eligible assets', () => {
    render(
      <ComposerLibrarySourcePicker
        assets={[
          {
            id: 'asset-store',
            authorizationStatus: 'authorized',
            category: 'store',
            mediaType: 'image',
            objectKey: `ws_1/assets/u/${'cd'.repeat(32)}.png`,
            tags: [],
          },
        ]}
        onPick={() => {}}
        requirements={[CASE_IMAGE]}
        selectedAssetIds={[]}
      />
    );
    expect(screen.getByTestId('composer-library-source-empty')).toBeTruthy();
    expect(
      screen.queryByTestId('composer-library-source-asset-store')
    ).toBeNull();
  });

  it('shows an honest empty library when there are no authorized assets', () => {
    render(
      <ComposerLibrarySourcePicker
        assets={[]}
        onPick={() => {}}
        requirements={[CASE_IMAGE]}
        selectedAssetIds={[]}
      />
    );
    expect(screen.getByTestId('composer-library-source-empty')).toBeTruthy();
  });
});
