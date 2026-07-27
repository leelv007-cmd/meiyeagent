/**
 * RTL: cold six / apply / conflict / undo (C2 / #96, D-083).
 * Card = single button / non-hover action / touch ≥48×48 / single polite announcement.
 */
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COLD_CARD_TITLES } from './launch-card-seeds';
import {
  createComposerLensState,
  selectLens,
  type ComposerLensState,
} from './lens-state-machine';
import { RecipeCardsPanel } from './recipe-cards-panel';

afterEach(() => {
  cleanup();
});

function ColdHarness({
  initialLens = null as null | 'copy' | 'image_text' | 'video',
  userText = '',
}: {
  initialLens?: null | 'copy' | 'image_text' | 'video';
  userText?: string;
}) {
  const [lensState, setLensState] = useState<ComposerLensState>(() => {
    let state: ComposerLensState = createComposerLensState({ userText });
    if (initialLens) state = selectLens(state, initialLens);
    return state;
  });

  return (
    <RecipeCardsPanel
      lensId={lensState.lensId}
      lensState={lensState}
      onLensStateChange={setLensState}
    />
  );
}

describe('Recipe cards cold six + a11y', () => {
  it('renders six cold cards with D-083 titles and always-visible actions', () => {
    render(<ColdHarness />);

    const grid = screen.getByTestId('composer-recipe-card-grid');
    expect(grid).toHaveAttribute('data-card-count', '6');

    for (const title of COLD_CARD_TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // Each card is a single button with min touch target classes.
    const buttons = within(grid).getAllByRole('button');
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.className).toMatch(/min-h-12/);
      // No nested buttons.
      expect(button.querySelector('button')).toBeNull();
    }

    // Action labels visible without hover (图文 appears on three cards).
    expect(screen.getAllByText('选择图文并套用').length).toBeGreaterThanOrEqual(
      3
    );
    expect(screen.getByText('选择文案并套用')).toBeInTheDocument();
    expect(screen.getByText('选择视频并套用')).toBeInTheDocument();
    expect(screen.getByText('选择创作形式')).toBeInTheDocument();
  });

  it('one-click apply from cold selects lens and shows tip + undo', async () => {
    const user = userEvent.setup();
    render(<ColdHarness userText="保留用户原文" />);

    await user.click(
      screen.getByTestId('composer-recipe-card-recipe.case_to_xhs_note')
    );

    expect(screen.getByTestId('composer-recipe-cards-panel')).toHaveAttribute(
      'data-phase',
      'applied'
    );
    const tip = screen.getByTestId('composer-recipe-apply-tip-text');
    expect(tip).toHaveTextContent('已选择图文并套用');
    expect(tip).toHaveTextContent('从案例图写小红书');

    // Single polite live region.
    const live = screen.getByTestId('composer-recipe-apply-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    // Announcement may already be cleared after microtask; tip stays.
    expect(screen.getByTestId('composer-recipe-apply-undo')).toHaveTextContent(
      '撤销'
    );
    expect(screen.getByTestId('composer-recipe-missing-input')).toHaveAttribute(
      'data-focus-slot',
      'case_image'
    );

    // No nested dialog for passthrough apply.
    expect(
      screen.queryByTestId('composer-recipe-patch-preview')
    ).not.toBeInTheDocument();
  });
});

/**
 * Cross-lens harness: draft lens is already `copy`, but card grid stays cold
 * six (catalog / pre-filter path) so a图文 card remains clickable.
 */
function CrossLensHarness() {
  const [lensState, setLensState] = useState<ComposerLensState>(() =>
    selectLens(createComposerLensState({ userText: '文案正文' }), 'copy')
  );

  return (
    <RecipeCardsPanel
      lensId={null}
      lensState={lensState}
      onLensStateChange={setLensState}
    />
  );
}

describe('Recipe cards conflict confirm + undo', () => {
  it('cross-lens conflict shows preview with two CTAs; cancel restores', async () => {
    const user = userEvent.setup();
    render(<CrossLensHarness />);

    await user.click(
      screen.getByTestId('composer-recipe-card-recipe.promotion_poster')
    );

    const dialog = screen.getByTestId('composer-recipe-patch-preview');
    expect(dialog).toHaveAttribute('data-conflict-kind', 'cross_lens');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('composer-patch-confirm')).toHaveTextContent(
      '切换到图文并套用'
    );
    expect(screen.getByTestId('composer-patch-cancel')).toHaveTextContent(
      '取消'
    );
    expect(screen.getByTestId('composer-patch-preserve')).toHaveTextContent(
      '你输入的内容'
    );

    await user.click(screen.getByTestId('composer-patch-cancel'));
    expect(
      screen.queryByTestId('composer-recipe-patch-preview')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-recipe-cards-panel')).toHaveAttribute(
      'data-phase',
      'idle'
    );
  });

  it('confirms cross-lens apply then undoes', async () => {
    const user = userEvent.setup();
    render(<CrossLensHarness />);

    await user.click(
      screen.getByTestId('composer-recipe-card-recipe.promotion_poster')
    );
    expect(
      screen.getByTestId('composer-recipe-patch-preview')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('composer-patch-confirm'));
    expect(
      screen.getByTestId('composer-recipe-apply-tip-text')
    ).toHaveTextContent('已切换到图文并套用');
    expect(
      screen.getByTestId('composer-recipe-apply-tip-text')
    ).toHaveTextContent('促销海报');

    await user.click(screen.getByTestId('composer-recipe-apply-undo'));
    expect(
      screen.queryByTestId('composer-recipe-apply-tip')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-recipe-cards-panel')).toHaveAttribute(
      'data-phase',
      'idle'
    );
  });
});

describe('Reuse content hands off to the conversation (D-031)', () => {
  it('emits the reuse intent and renders no source/form/carrier form', async () => {
    const user = userEvent.setup();
    const onReuseRequested = vi.fn();
    render(
      <RecipeCardsPanel lensId={null} onReuseRequested={onReuseRequested} />
    );

    await user.click(
      screen.getByTestId(`composer-recipe-card-${'reuse_content'}`)
    );

    expect(onReuseRequested).toHaveBeenCalledTimes(1);

    // The retired three-step panel must not come back in any form.
    expect(
      screen.queryByTestId('composer-reuse-content-panel')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('composer-reuse-confirm')
    ).not.toBeInTheDocument();
    for (const id of ['copy', 'image_text', 'video']) {
      expect(
        screen.queryByTestId(`composer-reuse-lens-${id}`)
      ).not.toBeInTheDocument();
    }
    expect(
      screen.queryByTestId('composer-reuse-carrier-wechat_moments')
    ).not.toBeInTheDocument();
    // Selecting it never strands the panel in the retired reuse phase.
    expect(screen.getByTestId('composer-recipe-cards-panel')).toHaveAttribute(
      'data-phase',
      'idle'
    );
  });
});

describe('polite announcement discipline', () => {
  it('does not use assertive live regions on apply', async () => {
    const user = userEvent.setup();
    render(<ColdHarness />);

    await user.click(
      screen.getByTestId('composer-recipe-card-recipe.project_intro')
    );

    expect(document.querySelector('[aria-live="assertive"]')).toBeNull();
    const polite = document.querySelectorAll('[aria-live="polite"]');
    expect(polite.length).toBeGreaterThanOrEqual(1);
  });
});
