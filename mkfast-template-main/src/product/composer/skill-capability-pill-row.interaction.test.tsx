/**
 * Spec E / #380 — UI contract for merchant capability-pack pills.
 * @vitest-environment jsdom
 *
 * Three presentation policies (pos + neg), draft-only selection into the
 * submission payload field, browse/preview/apply must not submit, and the
 * pill surface never leaks engineering fields.
 */

import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createComposerLensState,
  selectLens,
  type ComposerLensState,
} from './lens-state-machine';
import { RecipeCardsPanel } from './recipe-cards-panel';
import { SkillCapabilityPillRow } from './skill-capability-pill-row';
import {
  FORBIDDEN_SKILL_PILL_SURFACE_KEYS,
  userSelectedSkillRefsForSubmission,
  type SkillCapabilityItemInput,
} from './skill-capability-selection';

afterEach(() => {
  cleanup();
});

const SELECTABLE: SkillCapabilityItemInput = {
  skillId: 'skill.story',
  skillRevisionRef: 'skill.story@3',
  title: 'Story structure',
  summary: 'Structured story line for the note.',
  presentationPolicy: 'user_selectable',
  selectionEligible: true,
};

const EXPLAINABLE: SkillCapabilityItemInput = {
  skillId: 'skill.tone',
  skillRevisionRef: 'skill.tone@1',
  title: 'Tone polish',
  summary: 'Closer to storefront voice.',
  presentationPolicy: 'explainable',
  selectionEligible: false,
};

const BACKEND_ONLY: SkillCapabilityItemInput = {
  skillId: 'skill.hidden',
  skillRevisionRef: 'skill.hidden@9',
  title: 'Hidden backend pack',
  summary: 'Must never render.',
  presentationPolicy: 'backend_only',
  selectionEligible: false,
};

const ALL_ITEMS = [SELECTABLE, EXPLAINABLE, BACKEND_ONLY];

function PillHarness({
  items = ALL_ITEMS,
  onSubmit = vi.fn(),
  onExecute = vi.fn(),
}: {
  items?: SkillCapabilityItemInput[];
  onSubmit?: () => void;
  onExecute?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const payload = userSelectedSkillRefsForSubmission(selected, items);

  return (
    <div>
      <SkillCapabilityPillRow
        items={items}
        onToggleSelectable={(ref) => {
          // Draft-only toggle — never auto-submit / execute.
          setSelected((current) => {
            if (current.includes(ref)) {
              return current.filter((entry) => entry !== ref);
            }
            return [...current, ref];
          });
        }}
        selectedSkillRevisionRefs={selected}
      />
      <output data-testid="draft-skill-payload">
        {JSON.stringify(payload)}
      </output>
      <button data-testid="fake-submit" onClick={onSubmit} type="button">
        Submit
      </button>
      <button data-testid="fake-execute" onClick={onExecute} type="button">
        Execute
      </button>
    </div>
  );
}

function PanelHarness({
  items = ALL_ITEMS,
  onSubmit = vi.fn(),
}: {
  items?: SkillCapabilityItemInput[];
  onSubmit?: () => void;
}) {
  const [lensState, setLensState] = useState<ComposerLensState>(() =>
    selectLens(createComposerLensState({ userText: 'draft text' }), 'copy')
  );

  return (
    <div>
      <RecipeCardsPanel
        lensId={lensState.lensId}
        lensState={lensState}
        onLensStateChange={setLensState}
        skillCapabilityItems={items}
      />
      <output data-testid="draft-skill-payload">
        {JSON.stringify(lensState.draft.selectedSkillRevisionRefs)}
      </output>
      <button data-testid="fake-submit" onClick={onSubmit} type="button">
        Submit
      </button>
    </div>
  );
}

describe('skill capability pill UI contract (#380)', () => {
  it('user_selectable: positive pill + select/cancel payload; unselected negative empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onExecute = vi.fn();
    render(<PillHarness onExecute={onExecute} onSubmit={onSubmit} />);

    const pill = screen.getByTestId('composer-skill-selectable-skill.story');
    expect(pill.tagName).toBe('BUTTON');
    expect(pill).toHaveAttribute('aria-pressed', 'false');
    expect(pill).toHaveAttribute('data-kind', 'user_selectable');
    // Negative unselected: empty payload
    expect(screen.getByTestId('draft-skill-payload')).toHaveTextContent('[]');

    await user.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('draft-skill-payload')).toHaveTextContent(
      JSON.stringify(['skill.story@3'])
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onExecute).not.toHaveBeenCalled();

    await user.click(pill);
    expect(pill).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('draft-skill-payload')).toHaveTextContent('[]');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('explainable: positive readonly chip; negative no toggle / no payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PillHarness onSubmit={onSubmit} />);

    const chip = screen.getByTestId('composer-skill-explainable-skill.tone');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).toHaveAttribute('data-kind', 'explainable');
    // No checkbox / select control
    expect(chip.querySelector('input')).toBeNull();
    expect(chip.closest('button')).toBeNull();

    // Clicking the chip does nothing to payload
    await user.click(chip);
    expect(screen.getByTestId('draft-skill-payload')).toHaveTextContent('[]');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('backend_only: negative — never rendered', () => {
    render(<PillHarness />);

    expect(
      screen.queryByTestId('composer-skill-selectable-skill.hidden')
    ).toBeNull();
    expect(
      screen.queryByTestId('composer-skill-explainable-skill.hidden')
    ).toBeNull();
    expect(screen.queryByText('Hidden backend pack')).toBeNull();

    const row = screen.getByTestId('composer-skill-capability-pill-row');
    expect(within(row).queryByText(/Hidden backend/)).toBeNull();
  });

  it('pill surface never exposes engineering fields (revision ref / provider / governance)', () => {
    render(<PillHarness />);

    const row = screen.getByTestId('composer-skill-capability-pill-row');
    const html = row.outerHTML;

    // Revision refs stay out of the DOM surface
    expect(html).not.toContain('skill.story@3');
    expect(html).not.toContain('skill.tone@1');
    expect(html).not.toContain('skill.hidden@9');

    for (const key of FORBIDDEN_SKILL_PILL_SURFACE_KEYS) {
      expect(html).not.toContain(`"${key}"`);
      expect(html).not.toContain(`data-${key}`);
    }

    // Merchant-facing title/summary still visible
    expect(screen.getByText('Story structure')).toBeTruthy();
    expect(html).toContain('Tone polish');
  });

  it('browse / recipe apply only mutates draft — never submits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PanelHarness onSubmit={onSubmit} />);

    // Capability select
    await user.click(
      screen.getByTestId('composer-skill-selectable-skill.story')
    );
    expect(screen.getByTestId('draft-skill-payload')).toHaveTextContent(
      JSON.stringify(['skill.story@3'])
    );
    expect(onSubmit).not.toHaveBeenCalled();

    // Recipe apply (same-lens browse/preview/apply path) — only draft phase.
    await user.click(
      screen.getByTestId('composer-recipe-card-recipe.project_intro')
    );
    expect(screen.getByTestId('composer-recipe-cards-panel')).toHaveAttribute(
      'data-phase',
      'applied'
    );
    // Apply must never auto-submit / execute a run.
    expect(onSubmit).not.toHaveBeenCalled();
    // Same-lens apply keeps the skill draft selection (draft-only surface).
    expect(screen.getByTestId('draft-skill-payload')).toHaveTextContent(
      JSON.stringify(['skill.story@3'])
    );
  });
});
