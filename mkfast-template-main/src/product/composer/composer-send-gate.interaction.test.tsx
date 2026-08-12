/**
 * D-C2: D-081 keeps the no-default-lens rule, so the send gate stays — but the
 * state it depends on has to be visible before the press, not revealed by a
 * press that appeared to do nothing.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreationLensId } from '@meiye/contracts';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerPromptBar } from './composer-conversation';
import {
  composerPendingInterruptGate,
  isComposerClarificationInterrupt,
} from './composer-pending-interrupt-gate';
import { LensRadiogroup } from './lens-radiogroup';
import { COMPOSER_LENS_LABELS, LENS_REQUIRED_SUBMIT_HINT } from './lens-labels';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

afterEach(cleanup);

/**
 * Mirrors the host wiring in composer-home: the gate, the label and the hint
 * all read the same "is a lens chosen" fact.
 */
function SendGateHarness({
  hasPendingInterrupt = false,
  onSubmit,
}: {
  hasPendingInterrupt?: boolean;
  onSubmit: () => void;
}) {
  const [lensId, setLensId] = useState<CreationLensId | null>(null);
  const interruptGate = composerPendingInterruptGate(
    hasPendingInterrupt ? 1 : 0
  );
  return (
    <ComposerPromptBar
      ariaLabel="描述这次想创作的内容"
      controlDensity="idle-compact"
      destination={null}
      destinationCapability={null}
      disabled={interruptGate.blocked}
      lensRequired={lensId == null}
      lensSlot={<LensRadiogroup onChange={setLensId} value={lensId} />}
      lensSummary={lensId ? COMPOSER_LENS_LABELS[lensId] : null}
      onDestinationChange={() => {}}
      onReuseChip={() => {}}
      onSubmit={onSubmit}
      onValueChange={() => {}}
      placeholder="说说想发什么"
      reuseChips={[]}
      running={false}
      signedPreview={null}
      submitDisabled={lensId == null || interruptGate.blocked}
      submitHint={
        interruptGate.hint ??
        (lensId == null
          ? '还没选创作类型：在上面的「创作类型（必选）」里选一个，发送就会亮起来。'
          : null)
      }
      submitLabel={lensId == null ? LENS_REQUIRED_SUBMIT_HINT : '开始创作'}
      value="帮我写一条美甲店夏日新款的种草文案"
    />
  );
}

describe('send gate visibility (D-C2)', () => {
  it('keeps the Composer answer input available for its own semantic clarification', () => {
    expect(
      isComposerClarificationInterrupt({ interruptType: 'answer_question' })
    ).toBe(true);
    expect(
      isComposerClarificationInterrupt({ interruptType: 'approval_required' })
    ).toBe(false);
  });

  it('disables send and says why before the merchant presses it', async () => {
    const onSubmit = vi.fn();
    render(<SendGateHarness onSubmit={onSubmit} />);

    const submit = screen.getByTestId('composer-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleName(LENS_REQUIRED_SUBMIT_HINT);

    // The reason is real text on the page, not something a failed press reveals.
    const hint = screen.getByTestId('composer-submit-intent');
    expect(hint).toBeVisible();
    expect(hint.textContent ?? '').toMatch(/创作类型/u);
    expect(submit).toHaveAttribute('aria-describedby', hint.id);
  });

  it('keeps the 必选 creation-type control on the idle face, out of 「更多」', () => {
    render(<SendGateHarness onSubmit={vi.fn()} />);

    const lensCapsule = screen.getByTestId('composer-capsule-lens');
    expect(lensCapsule).toBeVisible();
    expect(lensCapsule).not.toHaveAttribute('aria-required');
    expect(lensCapsule).toHaveAttribute('data-required-unmet', 'true');
    expect(lensCapsule).toHaveAccessibleName('选择创作类型（必选）');
  });

  it('enables send once a creation type is chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SendGateHarness onSubmit={onSubmit} />);

    await user.click(screen.getByTestId('composer-capsule-lens'));
    await user.click(await screen.findByRole('radio', { name: '图文' }));

    const submit = screen.getByTestId('composer-submit');
    expect(submit).toBeEnabled();
    expect(submit).toHaveAccessibleName('开始创作');
    expect(screen.queryByTestId('composer-submit-intent')).toBeNull();

    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('blocks new input and submit while an interrupt awaits a decision', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SendGateHarness hasPendingInterrupt onSubmit={onSubmit} />);

    const input = screen.getByLabelText('描述这次想创作的内容');
    expect(input).toBeDisabled();
    const submit = screen.getByTestId('composer-submit');
    expect(submit).toBeDisabled();
    expect(screen.getByTestId('composer-submit-intent')).toHaveTextContent(
      '请先处理上方待确认事项，再开始新的创作。'
    );
    await user.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
