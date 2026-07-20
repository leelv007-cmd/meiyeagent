/**
 * RTL: cold six / apply / conflict / undo (C2 / #96, D-083).
 * Card = single button / non-hover action / touch ≥48×48 / single polite announcement.
 */
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { COLD_CARD_TITLES } from './launch-card-seeds';
import {
  createComposerLensState,
  selectLens,
  type ComposerLensState,
} from './lens-state-machine';
import { RecipeCardsPanel } from './recipe-cards-panel';
import { ComposerBriefChips } from './brief-chips';
import type { CreativeBrief } from '@meiye/contracts';

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
    expect(screen.getAllByText('选择图文并套用').length).toBeGreaterThanOrEqual(3);
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

describe('Reuse content panel', () => {
  it('opens with no default form/carrier; CTA incomplete until both chosen', async () => {
    const user = userEvent.setup();
    render(
      <RecipeCardsPanel
        lensId={null}
        reuseSources={[{ id: 'w1', label: '上周朋友圈' }]}
      />
    );

    await user.click(
      screen.getByTestId(`composer-recipe-card-${'reuse_content'}`)
    );

    const panel = screen.getByTestId('composer-reuse-content-panel');
    expect(panel).toBeInTheDocument();

    const confirm = screen.getByTestId('composer-reuse-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('先选择创作形式和目标载体');

    // No lens preselected.
    for (const id of ['copy', 'image_text', 'video']) {
      expect(screen.getByTestId(`composer-reuse-lens-${id}`)).toHaveAttribute(
        'aria-checked',
        'false'
      );
    }

    await user.click(screen.getByTestId('composer-reuse-source-w1'));
    await user.click(screen.getByTestId('composer-reuse-lens-copy'));
    // Still incomplete without carrier.
    expect(screen.getByTestId('composer-reuse-confirm')).toBeDisabled();

    await user.click(screen.getByTestId('composer-reuse-carrier-wechat_moments'));
    expect(screen.getByTestId('composer-reuse-confirm')).not.toBeDisabled();
    expect(screen.getByTestId('composer-reuse-confirm')).toHaveTextContent(
      '选择文案并套用'
    );
  });
});

describe('T1 brief chips re-hang', () => {
  it('shows compact chips without expand-four-card control', () => {
    const brief: CreativeBrief = {
      confirmedAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      fields: {
        intent: { current: '促销引流', owner: 'merchant' },
        scene: { current: '美甲店', owner: 'merchant' },
        tone: { current: '亲切', owner: 'ai' },
        audience: { current: '附近宝妈', owner: 'merchant' },
      },
    };

    render(<ComposerBriefChips brief={brief} />);

    expect(screen.getByTestId('composer-brief-chips')).toHaveTextContent(
      '本次将使用'
    );
    expect(screen.getByTestId('composer-brief-chip-intent')).toHaveTextContent(
      '促销引流'
    );
    // No expand button / four-card editor.
    expect(screen.queryByTestId('creative-brief-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开/ })).not.toBeInTheDocument();
  });

  it('auto-confirming keeps core seam without expand path', () => {
    render(<ComposerBriefChips autoConfirming />);
    expect(
      screen.getByTestId('composer-brief-auto-confirming')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('composer-brief-chips')).not.toBeInTheDocument();
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
