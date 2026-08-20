/**
 * Living Plan component behavior (V31-10): five sections, revision history,
 * diff after adjust, compact plan + commit strip, mobile bottom sheet.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LivingPlan } from './living-plan';
import type { LivingPlanRevisionFacts } from './living-plan-model';

afterEach(() => {
  cleanup();
});

const REV1: LivingPlanRevisionFacts = {
  planId: 'plan-1',
  revision: 1,
  goal: {
    summary: '填补明天下午空档，推奶油风美甲',
    desiredAction: '发笔记引流',
  },
  deliverables: [
    { kind: 'note', platform: '小红书', quantity: 6, purpose: '案例图文' },
    { kind: 'copy', platform: '朋友圈', quantity: 1 },
  ],
  expression: { voice: '专业温和', cta: '预约 CTA' },
  factsAssets: {
    factsSummary: '未写价格',
    assetsSummary: '5 张授权图片',
    rightsLabel: '素材授权通过',
  },
  costDuration: {
    creditCost: 38,
    balanceCredits: 126,
    durationLabel: '约 8–12 分钟',
    failureRefundsCredits: true,
  },
  readiness: 'ready',
};

const REV2: LivingPlanRevisionFacts = {
  ...REV1,
  revision: 2,
  adjustmentSummary: '只做小红书，减到 4 页',
  deliverables: [
    { kind: 'note', platform: '小红书', quantity: 4, purpose: '案例图文' },
  ],
  costDuration: {
    creditCost: 24,
    balanceCredits: 126,
    durationLabel: '约 6–10 分钟',
    failureRefundsCredits: true,
  },
};

describe('LivingPlan full document', () => {
  it('renders five sections for goal/deliverables/expression/facts/cost', () => {
    render(<LivingPlan revisions={[REV1]} viewport="desktop" />);

    expect(screen.getByTestId('agent-living-plan')).toBeInTheDocument();
    expect(screen.getByTestId('agent-plan-section-goal')).toHaveTextContent(
      '奶油风美甲'
    );
    expect(
      screen.getByTestId('agent-plan-section-deliverables')
    ).toHaveTextContent('小红书');
    expect(
      screen.getByTestId('agent-plan-section-expression')
    ).toHaveTextContent('专业温和');
    expect(
      screen.getByTestId('agent-plan-section-facts_assets')
    ).toHaveTextContent('5 张授权图片');
    expect(
      screen.getByTestId('agent-plan-section-cost_duration')
    ).toHaveTextContent('38');
    expect(screen.getByTestId('agent-commit-strip-status')).toHaveTextContent(
      '38 积分'
    );
  });

  it('shows readable diff and allows reviewing prior revision', () => {
    render(<LivingPlan revisions={[REV1, REV2]} viewport="desktop" />);

    expect(screen.getByTestId('agent-plan-diff')).toBeInTheDocument();
    expect(screen.getByTestId('agent-plan-diff-adjustment')).toHaveTextContent(
      '减到 4 页'
    );
    expect(screen.getByTestId('agent-living-plan')).toHaveAttribute(
      'data-revision',
      '2'
    );

    fireEvent.click(screen.getByTestId('agent-living-plan-revision-1'));
    expect(screen.getByTestId('agent-living-plan')).toHaveAttribute(
      'data-revision',
      '1'
    );
    expect(
      screen.getByTestId('agent-plan-section-deliverables')
    ).toHaveTextContent('6 页');
  });

  it('compact mode unifies Brief/quote/confirm into Compact Plan + commit strip', () => {
    const onAction = vi.fn();
    render(
      <LivingPlan
        compact
        onCommitAction={onAction}
        revisions={[REV1]}
        viewport="desktop"
      />
    );

    expect(screen.getByTestId('agent-compact-plan')).toBeInTheDocument();
    expect(screen.getByTestId('agent-compact-plan-summary')).toHaveTextContent(
      '38 分'
    );
    expect(screen.getByTestId('agent-commit-strip')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-commit-strip-start'));
    expect(onAction).toHaveBeenCalledWith('start');
  });

  it('paid image_text start stays disabled until the confirmation request id is bound', () => {
    const { rerender } = render(
      <LivingPlan
        revisions={[REV1]}
        requiresMerchantConfirmation
        viewport="desktop"
      />
    );

    const start = screen.getByTestId('agent-commit-strip-start');
    expect(start).toBeDisabled();
    expect(screen.getByTestId('agent-commit-strip')).toHaveAttribute(
      'data-start-disabled',
      'true'
    );

    rerender(
      <LivingPlan
        confirmationRequestId="confirmation:authority:image-text"
        revisions={[REV1]}
        requiresMerchantConfirmation
        viewport="desktop"
      />
    );
    expect(screen.getByTestId('agent-commit-strip-start')).toBeEnabled();
    expect(screen.getByTestId('agent-commit-strip')).toHaveAttribute(
      'data-start-disabled',
      'false'
    );
  });

  it('a ready paid plan keeps start enabled even when workbench inferred confirmed', () => {
    render(
      <LivingPlan
        confirmationRequestId="confirmation:authority:image-text"
        requiresMerchantConfirmation
        revisions={[{ ...REV1, planLifecycle: 'confirmed' }]}
        viewport="desktop"
      />
    );
    expect(screen.getByTestId('agent-commit-strip')).toHaveAttribute(
      'data-readiness',
      'ready'
    );
    expect(screen.getByTestId('agent-commit-strip')).toHaveAttribute(
      'data-start-disabled',
      'false'
    );
    expect(screen.getByTestId('agent-commit-strip-start')).toBeEnabled();
  });

  it('mobile mounts bottom sheet host for full plan', () => {
    render(<LivingPlan revisions={[REV1]} viewport="mobile" />);

    expect(screen.getByTestId('agent-living-plan')).toHaveAttribute(
      'data-viewport',
      'mobile'
    );
    expect(screen.getByTestId('agent-compact-plan')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-compact-plan-expand'));
    expect(
      screen.getByTestId('agent-living-plan-bottom-sheet')
    ).toBeInTheDocument();
  });
});
