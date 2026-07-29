/**
 * RTL: cold recipes / apply / conflict / undo (C2 / #96, D-083, D-164②).
 * Pill = single button / touch ≥48×48 / single polite announcement, with the
 * always-visible action label of D-083 moved into the accessible name.
 */
import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import {
  COLD_CARD_TITLES,
  LAUNCH_CARD_SEEDS,
  REUSE_CONTENT_FAMILY_ID,
} from './launch-card-seeds';
import {
  createComposerLensState,
  selectLens,
  type ComposerLensState,
} from './lens-state-machine';
import { RecipeCardsPanel } from './recipe-cards-panel';

const REUSE_COLLECTION_TITLE = LAUNCH_CARD_SEEDS.find(
  (seed) => seed.familyId === REUSE_CONTENT_FAMILY_ID
)!.title;

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
  it('renders the cold recipes as grouped pills, action label in the a11y name', () => {
    render(<ColdHarness />);

    const row = screen.getByTestId('composer-recipe-pill-row');
    // Six cold cards, five pills: 旧内容换平台 is a reuse action rather than a
    // marketing task, and it keeps its home in the conversation's reuse chips.
    const buttons = within(row).getAllByRole('button');
    expect(buttons).toHaveLength(5);

    for (const title of COLD_CARD_TITLES) {
      const reuseCard = title === REUSE_COLLECTION_TITLE;
      expect(screen.queryByText(title) === null).toBe(reuseCard);
    }

    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.className).toMatch(/min-h-12/);
      // No nested buttons.
      expect(button.querySelector('button')).toBeNull();
    }

    // D-083 wants the action label discoverable without hover. On a pill there
    // is no room for it beside the title, so it moves into the accessible name
    // — the one place this row bends D-083, recorded for ratification in
    // docs/tickets/261/01-ia-three-sections.md §4.5. It must be in the a11y
    // name of every pill, not merely somewhere on the page.
    const labels = buttons.map((button) => button.getAttribute('aria-label'));
    expect(
      labels.filter((label) => label?.includes('选择图文并套用')).length
    ).toBeGreaterThanOrEqual(3);
    expect(labels.some((label) => label?.includes('选择文案并套用'))).toBe(
      true
    );
    expect(labels.some((label) => label?.includes('选择视频并套用'))).toBe(
      true
    );
    // 「选择创作形式」was the reuse collection's action; with no reuse pill it
    // must not be left behind on some other control.
    expect(labels.some((label) => label?.includes('选择创作形式'))).toBe(false);
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

describe('Reuse content is not a recipe pill (D-031 / D-164②)', () => {
  it('offers no reuse pill and never revives the source/form/carrier form', () => {
    render(<RecipeCardsPanel lensId={null} />);

    // Clicking a recipe pill applies a recipe. 旧内容换平台 does not apply
    // anything — it hands a sentence back to the conversation — so a pill of it
    // would be a pill that does not do what every neighbour does.
    expect(
      screen.queryByTestId(`composer-recipe-card-${'reuse_content'}`)
    ).not.toBeInTheDocument();

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
