import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveComposerQuoteReadiness,
  type ComposerQuoteReadinessInput,
} from './quote-readiness';
import { ComposerQuoteStatusLine } from './quote-status-line';

afterEach(cleanup);

function settled(
  overrides: Partial<ComposerQuoteReadinessInput> = {}
): ComposerQuoteReadinessInput {
  return {
    lensSelected: true,
    surface: 'success',
    catalog: 'success',
    preferences: 'success',
    quote: 'pending',
    hasRecipe: true,
    hasModel: true,
    hasDestination: true,
    hasSignedSubmission: true,
    hasQuoteView: false,
    settling: false,
    ...overrides,
  };
}

function renderFor(
  overrides: Partial<ComposerQuoteReadinessInput>,
  onRetry = vi.fn()
) {
  render(
    <ComposerQuoteStatusLine
      onRetry={onRetry}
      readiness={resolveComposerQuoteReadiness(settled(overrides))}
    />
  );
  return onRetry;
}

describe('composer quote status line', () => {
  it('shows the reading line only while a precondition read is in flight', () => {
    renderFor({ preferences: 'pending' });

    const status = screen.getByTestId('composer-quote-status');
    expect(status).toHaveAttribute('data-quote-state', 'loading');
    expect(status).toHaveTextContent('正在读取模型与报价…');
    expect(screen.queryByTestId('composer-quote-retry')).toBeNull();
  });

  it('a 200 catalog with no executable default model reads unavailable, not loading', () => {
    renderFor({ hasModel: false, quote: 'disabled' });

    const status = screen.getByTestId('composer-quote-status');
    expect(status).toHaveAttribute('data-quote-state', 'no_model');
    expect(status).toHaveTextContent(
      '这个方向暂时没有可用的模型，先算不出花多少。'
    );
    expect(status).not.toHaveTextContent('正在读取模型与报价');
  });

  it('a failed preferences read never renders the quote loading line', () => {
    renderFor({ preferences: 'error', quote: 'disabled' });

    const status = screen.getByTestId('composer-quote-status');
    expect(status).toHaveAttribute('data-quote-state', 'failed');
    expect(status).toHaveTextContent('刚才没能算出这次要花多少。');
    expect(status).not.toHaveTextContent('正在读取模型与报价');
  });

  it('offers the retry that can actually change the outcome', async () => {
    const onRetry = renderFor({ hasModel: false, quote: 'disabled' });

    await userEvent.click(screen.getByTestId('composer-quote-retry'));
    expect(onRetry).toHaveBeenCalledWith('catalog');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('routes a failed surface read back to the surface', async () => {
    const onRetry = renderFor({ surface: 'error' });

    await userEvent.click(screen.getByTestId('composer-quote-retry'));
    expect(onRetry).toHaveBeenCalledWith('surface');
  });

  it('routes a failed quote request back to the quote', async () => {
    const onRetry = renderFor({ quote: 'error' });

    await userEvent.click(screen.getByTestId('composer-quote-retry'));
    expect(onRetry).toHaveBeenCalledWith('quote');
  });

  it('asks for the missing platform instead of offering a useless retry', () => {
    renderFor({
      hasDestination: false,
      hasSignedSubmission: false,
      quote: 'disabled',
    });

    const status = screen.getByTestId('composer-quote-status');
    expect(status).toHaveAttribute('data-quote-state', 'invalid_submission');
    expect(status).toHaveTextContent(
      '先选一个要发去的平台，才能算这次花多少。'
    );
    expect(screen.queryByTestId('composer-quote-retry')).toBeNull();
  });

  it('names a lens with no published recipe', () => {
    renderFor({ hasRecipe: false, quote: 'disabled' });

    const status = screen.getByTestId('composer-quote-status');
    expect(status).toHaveAttribute('data-quote-state', 'no_recipe');
    expect(status).toHaveTextContent(
      '这个方向暂时没有可用的模板，换个方向或稍后再试。'
    );
  });

  it('says it is calculating only once the request is genuinely in flight', () => {
    renderFor({});

    const status = screen.getByTestId('composer-quote-status');
    expect(status).toHaveAttribute('data-quote-state', 'requesting');
    expect(status).toHaveTextContent('正在算这次大概花多少…');
    expect(screen.queryByTestId('composer-quote-retry')).toBeNull();
  });

  it('renders nothing at all once the quote itself is on screen', () => {
    renderFor({ hasQuoteView: true });

    expect(screen.queryByTestId('composer-quote-status')).toBeNull();
  });

  it('renders nothing before a lens is chosen', () => {
    renderFor({ lensSelected: false });

    expect(screen.queryByTestId('composer-quote-status')).toBeNull();
  });
});
