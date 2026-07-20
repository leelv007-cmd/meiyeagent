/**
 * RTL: image role feedback copy must match D-087 character-for-character.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageWorksurface } from './image-worksurface';
import type { ImageWorksurfaceFacts } from './image-worksurface-model';
import {
  createEmptyWorkingSelection,
  reduceWorkingSelection,
} from './working-selection-reducer';

afterEach(() => {
  cleanup();
});

const NOW = '2026-07-20T12:00:00.000Z';

function baseFacts(
  overrides: Partial<ImageWorksurfaceFacts> = {},
): ImageWorksurfaceFacts {
  return {
    workId: 'work-rtl',
    baseRevisionId: 'rev-1',
    outputType: 'single_image',
    slot: 'standalone',
    lifecycle: 'candidate',
    candidates: [
      {
        assetId: 'img-1',
        persisted: true,
        rightsOk: true,
        generationOk: true,
      },
      {
        assetId: 'img-2',
        persisted: true,
        rightsOk: true,
        generationOk: true,
      },
      {
        assetId: 'img-3',
        persisted: true,
        rightsOk: true,
        generationOk: true,
      },
    ],
    hasContentPackage: false,
    mediaVersionReady: true,
    ...overrides,
  };
}

describe('image role feedback (exact D-087 copy)', () => {
  it('shows 采用这张 for single mode and feedback 已采用这张图片', async () => {
    const user = userEvent.setup();
    render(
      <ImageWorksurface
        facts={baseFacts({
          candidates: [
            {
              assetId: 'img-1',
              persisted: true,
              rightsOk: true,
              generationOk: true,
            },
          ],
          explicitMode: 'single',
        })}
      />,
    );

    const primary = screen.getByTestId('image-role-primary');
    expect(primary).toHaveTextContent('采用这张');
    expect(primary).toHaveAttribute('data-action-kind', 'adopt_one');

    await user.click(primary);
    expect(screen.getByTestId('image-role-feedback-visible')).toHaveTextContent(
      '已采用这张图片',
    );
    expect(screen.getByTestId('image-role-feedback')).toHaveTextContent(
      '已采用这张图片',
    );
  });

  it('加入套图 feedback is 已加入套图，第 N 张', async () => {
    const user = userEvent.setup();
    render(
      <ImageWorksurface
        facts={baseFacts({
          explicitMode: 'set',
          outputType: 'ordered_image_set',
          slot: 'gallery',
          // Force join path: incomplete generation so full set is not ready.
          candidates: [
            {
              assetId: 'img-1',
              persisted: true,
              rightsOk: true,
              generationOk: true,
            },
            {
              assetId: 'img-2',
              persisted: true,
              rightsOk: true,
              generationOk: false,
            },
          ],
          focusedAssetId: 'img-1',
        })}
      />,
    );

    const primary = screen.getByTestId('image-role-primary');
    expect(primary).toHaveTextContent('加入套图');
    await user.click(primary);
    expect(screen.getByTestId('image-role-feedback-visible')).toHaveTextContent(
      '已加入套图，第 1 张',
    );
  });

  it('设为封面 (working) feedback is exact working-cover string', async () => {
    const user = userEvent.setup();
    let selection = createEmptyWorkingSelection({
      workId: 'work-rtl',
      baseRevisionId: 'rev-1',
      now: NOW,
    });
    for (const id of ['img-1', 'img-2']) {
      selection = reduceWorkingSelection(selection, {
        type: 'add',
        assetId: id,
        now: NOW,
      }).state;
    }

    render(
      <ImageWorksurface
        facts={baseFacts({
          explicitMode: 'set',
          outputType: 'ordered_image_set',
          slot: 'gallery',
          workingSelection: selection,
        })}
      />,
    );

    const tray = screen.getByTestId('image-set-tray');
    const slots = within(tray).getAllByTestId('image-set-slot');
    const second = slots[1]!;
    await user.click(within(second).getByTestId('image-set-cover'));
    expect(screen.getByTestId('image-role-feedback-visible')).toHaveTextContent(
      '已设为本组封面，采用这组后生效',
    );
  });

  it('a11y name on candidate includes order / role / state', () => {
    render(
      <ImageWorksurface
        facts={baseFacts({
          explicitMode: 'set',
          slot: 'gallery',
          outputType: 'ordered_image_set',
        })}
      />,
    );
    const candidates = screen.getAllByTestId('image-candidate');
    expect(candidates[0]).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/第 1 张/),
    );
    expect(candidates[0]?.getAttribute('aria-label')).toMatch(/候选|已采用/);
  });

  it('mobile has full primary actions and never 请到桌面继续', () => {
    render(
      <ImageWorksurface
        facts={baseFacts({
          viewport: 'mobile',
          explicitMode: 'set',
          candidates: baseFacts().candidates,
        })}
      />,
    );
    expect(screen.getByTestId('image-mobile-desktop-gate')).toBeEmptyDOMElement();
    expect(screen.queryByText('请到桌面继续')).toBeNull();
    expect(screen.queryByText('请在桌面端继续')).toBeNull();
    // Adjust prompt always present
    expect(screen.getByTestId('result-adjust-prompt')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('还想怎么改？')).toBeInTheDocument();
  });

  it('保存到素材库 feedback is 已在素材库 and independent of adopt', async () => {
    const user = userEvent.setup();
    const onSaveLibrary = vi.fn();
    render(
      <ImageWorksurface
        facts={baseFacts({
          candidates: [
            {
              assetId: 'img-1',
              persisted: true,
              rightsOk: true,
              generationOk: true,
            },
          ],
          explicitMode: 'single',
          focusedAssetId: 'img-1',
          mediaVersionReady: true,
        })}
        onSaveLibrary={onSaveLibrary}
      />,
    );
    const library = screen.getByTestId('image-library-save_one');
    expect(library).toHaveTextContent('保存到素材库');
    await user.click(library);
    expect(onSaveLibrary).toHaveBeenCalledWith('save_one', ['img-1']);
    expect(screen.getByTestId('image-role-feedback-visible')).toHaveTextContent(
      '已在素材库',
    );
  });
});
