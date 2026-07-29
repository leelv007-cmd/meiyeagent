/**
 * 成本即时反馈的渲染件 — D-164⑥ 决定 B / D3.
 *
 * Separate basename from the projection next door for the same reason the
 * confirm card is split: one basename across `.ts` and `.tsx` is ambiguous.
 *
 * One `<p>`, in the slot the confirm card just vacated: the merchant's eyes are
 * already there, so「就地」is literal rather than approximate. It lives on the
 * component tree rather than in the transcript because rejecting a run clears
 * the transcript — a feedback line that lives there would be wiped by the very
 * action it is reporting on.
 */

import { cn } from '@/lib/utils';

import type { ExecutionCostFeedback } from './execution-cost-feedback';

export function ExecutionCostFeedbackLine({
  className,
  feedback,
}: {
  className?: string;
  feedback: ExecutionCostFeedback | null;
}) {
  if (!feedback) return null;
  return (
    // <output> rather than a <p role="status">: the element already carries
    // that role, and its announcement is polite — this reports what already
    // happened and must not interrupt.
    <output
      className={cn(
        'text-sm',
        feedback.tone === 'positive' ? 'text-foreground' : 'meiye-type-aux',
        className
      )}
      data-outcome={feedback.outcome}
      data-testid="execution-cost-feedback"
    >
      {feedback.text}
    </output>
  );
}
