/**
 * 执行确认卡 — D-164③ / D-159③ / D1.
 *
 * The card exists so the merchant knows what a run will do and what it will
 * cost before it starts. Two failure modes are worth testing: it becoming a
 * settings form (D-159③), and it describing the cost in a second vocabulary
 * the rest of the app does not use (D1 — counts, never money).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionConfirmCard } from './execution-confirm-card-panel';
import {
  projectExecutionConfirmCard,
  projectExecutionCost,
  projectExecutionParams,
  createExecutionConfirmState,
  openExecutionConfirm,
  rejectExecution,
} from './execution-confirm-card';

afterEach(() => {
  cleanup();
});

function openCard(
  overrides: Partial<Parameters<typeof projectExecutionConfirmCard>[1]> = {},
  costOverrides: Partial<Parameters<typeof projectExecutionCost>[0]> = {}
) {
  const params = projectExecutionParams({
    aspectRatio: '3:4',
    deliverable: '朋友圈图文',
    destination: '微信朋友圈',
    lensId: 'image_text',
    modelName: '通义万相',
    quantity: 3,
  });
  const cost = projectExecutionCost({
    available: { copy: 5, image: 9 },
    requirements: [{ cost: 3, resource: 'image' }],
    ...costOverrides,
  });
  const state = openExecutionConfirm(createExecutionConfirmState(), {
    composerSnapshot: {
      draftRevisionId: 'draft@1',
      lensId: 'image_text',
      sources: [],
      userText: '母亲节朋友圈',
    },
    cost,
    params,
  });
  return projectExecutionConfirmCard(state, overrides);
}

describe('the card says what will happen, in the shop owner language', () => {
  it('explains a technical parameter instead of printing its code', () => {
    render(<ExecutionConfirmCard {...openCard()} />);

    expect(
      screen.getByTestId('execution-confirm-param-aspectRatio').textContent
    ).toBe('3:4 竖版');
    // D-164③: the merchant is told what 3:4 is good for, not just its ratio.
    expect(
      screen.getByTestId('execution-confirm-hint-aspectRatio').textContent
    ).toMatch(/朋友圈|展架/u);
  });

  it('leaves the model unexplained rather than inventing a tier', () => {
    render(<ExecutionConfirmCard {...openCard()} />);

    expect(
      screen.getByTestId('execution-confirm-param-model').textContent
    ).toBe('通义万相');
    // 「高清档 / 标准档」would need a capability vocabulary that does not exist
    // yet (#252). Making one up here is the silent downgrade D-024 forbids.
    expect(
      screen.queryByTestId('execution-confirm-hint-model')
    ).not.toBeInTheDocument();
  });

  it('states the cost in buckets and never in money (D1 / D-109)', () => {
    render(<ExecutionConfirmCard {...openCard()} />);

    const costLine = screen.getByTestId('execution-confirm-cost');
    expect(costLine.textContent).toMatch(/本次用 3 张图片额度/u);
    // 供应细节不可见: no currency, anywhere on the card.
    const card = screen.getByTestId('execution-confirm-card');
    expect(card.textContent).not.toMatch(/CNY|￥|¥|元/u);
  });
});

describe('the card is a confirmation, not a settings form (D-159③)', () => {
  it('renders no control the merchant could change a parameter with', () => {
    render(<ExecutionConfirmCard {...openCard()} />);

    const card = screen.getByTestId('execution-confirm-card');
    // Buttons are allowed — but only the two that answer the card.
    const buttons = within(card).getAllByRole('button');
    expect(buttons.map((button) => button.dataset.testid)).toEqual([
      'execution-confirm-reject',
      'execution-confirm-accept',
    ]);
    for (const role of ['textbox', 'combobox', 'radio', 'checkbox', 'slider']) {
      expect(within(card).queryAllByRole(role)).toHaveLength(0);
    }
    expect(card.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('answers with exactly one of the two actions', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    render(<ExecutionConfirmCard {...openCard({ onConfirm, onReject })} />);

    await user.click(screen.getByTestId('execution-confirm-accept'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe('a balance that has not loaded', () => {
  it('still says what the run spends, and claims nothing about what is left', () => {
    render(
      <ExecutionConfirmCard
        {...openCard(
          {},
          { available: {}, requirements: [{ cost: 2, resource: 'image' }] }
        )}
      />
    );

    const costLine = screen.getByTestId('execution-confirm-cost');
    expect(costLine.textContent).toBe('本次用 2 张图片额度');
    // Silence would be wrong here — this is the moment of committing — but so
    // would a remaining figure nobody has read yet.
    expect(costLine.textContent).not.toMatch(/还剩/u);
  });
});

describe('a run the merchant cannot afford', () => {
  it('blocks 确认 but keeps 拒绝 and the reason on screen', () => {
    render(
      <ExecutionConfirmCard
        {...openCard(
          {},
          {
            available: { image: 1 },
            requirements: [{ cost: 3, resource: 'image' }],
          }
        )}
      />
    );

    expect(screen.getByTestId('execution-confirm-accept')).toBeDisabled();
    // Backing out must stay possible: a card with no way forward and no way
    // out is a dead end, and the reason has to stay readable next to it.
    expect(screen.getByTestId('execution-confirm-reject')).not.toBeDisabled();
    expect(screen.getByTestId('execution-confirm-short').textContent).toMatch(
      /图片额度不够/u
    );
  });
});

describe('the state machine', () => {
  it('hands the input snapshot back when the run is declined', () => {
    const opened = openExecutionConfirm(createExecutionConfirmState(), {
      composerSnapshot: {
        draftRevisionId: 'draft@1',
        lensId: 'copy',
        sources: [],
        userText: '写一条母亲节文案',
      },
      cost: projectExecutionCost({ available: {}, requirements: [] }),
      params: [],
    });

    const { restored, state } = rejectExecution(opened);

    expect(state.phase).toBe('rejected');
    // Declining must not cost the merchant what she typed.
    expect(restored?.userText).toBe('写一条母亲节文案');
    expect(projectExecutionConfirmCard(state).visible).toBe(false);
  });

  it('does not swap the numbers under a merchant who is reading them', () => {
    const first = openExecutionConfirm(createExecutionConfirmState(), {
      composerSnapshot: {
        draftRevisionId: 'draft@1',
        lensId: 'copy',
        sources: [],
        userText: 'first',
      },
      cost: projectExecutionCost({
        available: { copy: 5 },
        requirements: [{ cost: 1, resource: 'copy' }],
      }),
      params: [],
    });
    const second = openExecutionConfirm(first, {
      composerSnapshot: {
        draftRevisionId: 'draft@2',
        lensId: 'copy',
        sources: [],
        userText: 'second',
      },
      cost: projectExecutionCost({
        available: { copy: 5 },
        requirements: [{ cost: 4, resource: 'copy' }],
      }),
      params: [],
    });

    expect(second).toBe(first);
    expect(second.cost?.units).toEqual([{ cost: 1, resource: 'copy' }]);
  });
});
