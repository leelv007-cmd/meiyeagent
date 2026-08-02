/**
 * AI cover signature mismatch notice: visible when ratio changes after seed.
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAiCoverActionSeed,
  resolveSignedAiCover,
  shouldShowAiCoverSignatureMismatchNotice,
} from './ai-cover-action';
import { ComposerAiCoverMismatchNotice } from './composer-ai-cover-mismatch-notice';

afterEach(cleanup);

describe('AI cover signature mismatch notice', () => {
  it('shows the notice after the merchant changes aspect ratio', () => {
    const seed = buildAiCoverActionSeed({
      aspectRatio: '9:16',
      style: 'beauty_soft',
    });
    const signed = resolveSignedAiCover({
      activeAiCover: seed,
      creationMode: 'free',
      imageOperation: 'image.generate',
      recipeId: 'recipe.promotion_poster',
      deliverableKind: 'poster',
      platform: 'xiaohongshu',
      aspectRatio: '3:4',
    });
    const visible = shouldShowAiCoverSignatureMismatchNotice({
      activeAiCover: seed,
      signedAiCover: signed,
    });
    expect(visible).toBe(true);

    render(<ComposerAiCoverMismatchNotice visible={visible} />);
    expect(
      screen.getByTestId('composer-ai-cover-signature-mismatch')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('composer-ai-cover-signature-mismatch')
    ).toHaveTextContent(/比例|配方|AI 封面|cover|ratio|recipe/i);
  });

  it('hides the notice when the signature still matches', () => {
    const seed = buildAiCoverActionSeed({
      aspectRatio: '9:16',
      style: 'beauty_soft',
    });
    const signed = resolveSignedAiCover({
      activeAiCover: seed,
      creationMode: 'free',
      imageOperation: 'image.generate',
      recipeId: 'recipe.promotion_poster',
      deliverableKind: 'poster',
      platform: 'xiaohongshu',
      aspectRatio: '9:16',
    });
    const visible = shouldShowAiCoverSignatureMismatchNotice({
      activeAiCover: seed,
      signedAiCover: signed,
    });
    expect(visible).toBe(false);

    render(<ComposerAiCoverMismatchNotice visible={visible} />);
    expect(
      screen.queryByTestId('composer-ai-cover-signature-mismatch')
    ).toBeNull();
  });
});
